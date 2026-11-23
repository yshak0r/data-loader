package database

import (
	"context"
	"fmt"
	"strings"

	"dc-loader-wails/backend/models"
)

// QueryGrid fetches a paginated subset of staged records with filters and count summary.
func (m *Manager) QueryGrid(ctx context.Context, params models.GridQueryParams) (*models.GridQueryResult, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return &models.GridQueryResult{Connected: false}, err
	}

	isSO := params.Domain == "sales_orders"
	tableName, _ := ResolveTableName(params.Domain, params.TargetTable)

	// Ensure the staging table exists if not already present
	checkQuery := fmt.Sprintf("IF OBJECT_ID('%s', 'U') IS NULL SELECT 0 ELSE SELECT 1", tableName)
	var tblExists int
	if err := db.QueryRowContext(ctx, checkQuery).Scan(&tblExists); err == nil && tblExists == 0 {
		_, _ = m.EnsureTableExists(ctx, params.Domain)
	}

	// Dynamically inspect existing physical columns from SQL Server
	lookupDomain := params.Domain
	if strings.TrimSpace(params.TargetTable) != "" {
		lookupDomain = params.TargetTable
	}
	schemaCols, _, _ := m.GetTableSchema(ctx, lookupDomain)

	page := params.Page
	if page < 1 {
		page = 1
	}
	pageSize := params.PageSize
	if pageSize < 1 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	// Build WHERE clause
	var conditions []string
	var args []any
	argIdx := 1

	// Check if table has STATUS_FLAG
	hasStatusFlag := false
	for _, c := range schemaCols {
		if strings.EqualFold(c.Name, "STATUS_FLAG") {
			hasStatusFlag = true
			break
		}
	}

	// Status filter (only applied if table contains STATUS_FLAG)
	status := strings.TrimSpace(params.StatusFilter)
	if hasStatusFlag && status != "" && status != "ALL" {
		if strings.EqualFold(status, "L") || strings.EqualFold(status, "P") || strings.EqualFold(status, "LOADED") {
			conditions = append(conditions, "STATUS_FLAG IN ('L', 'P')")
		} else if strings.EqualFold(status, "F") || strings.EqualFold(status, "FAILED") {
			conditions = append(conditions, "STATUS_FLAG = 'F'")
		} else if strings.EqualFold(status, "V") || strings.EqualFold(status, "VALID") {
			conditions = append(conditions, "STATUS_FLAG = 'V'")
		} else {
			conditions = append(conditions, fmt.Sprintf("STATUS_FLAG = @p%d", argIdx))
			args = append(args, status)
			argIdx++
		}
	}

	// Column-specific filters
	if len(params.ColumnFilters) > 0 {
		colMap := make(map[string]models.ColumnDefinition)
		for _, c := range schemaCols {
			colMap[strings.ToUpper(c.Name)] = c
		}

		for colName, filterVal := range params.ColumnFilters {
			filterVal = strings.TrimSpace(filterVal)
			if filterVal == "" {
				continue
			}
			c, exists := colMap[strings.ToUpper(colName)]
			if !exists {
				continue
			}

			if strings.EqualFold(filterVal, "(Blanks)") || strings.EqualFold(filterVal, "(Blank)") {
				conditions = append(conditions, fmt.Sprintf("(ISNULL([%s], '') = '')", c.Name))
			} else if strings.EqualFold(filterVal, "(Non-Blanks)") || strings.EqualFold(filterVal, "(Non-Blank)") {
				conditions = append(conditions, fmt.Sprintf("(ISNULL([%s], '') <> '')", c.Name))
			} else {
				lowerType := strings.ToLower(c.DataType)
				if strings.Contains(lowerType, "datetime") || lowerType == "date" {
					conditions = append(conditions, fmt.Sprintf("(CONVERT(VARCHAR(19), [%s], 120) LIKE @p%d OR CONVERT(VARCHAR(10), [%s], 120) = @p%d)", c.Name, argIdx, c.Name, argIdx))
					args = append(args, filterVal+"%")
					argIdx++
				} else {
					conditions = append(conditions, fmt.Sprintf("CONVERT(VARCHAR(500), [%s]) = @p%d", c.Name, argIdx))
					args = append(args, filterVal)
					argIdx++
				}
			}
		}
	}

	// Text search: build dynamic LIKE filter across all textual columns
	search := strings.TrimSpace(params.Search)
	if search != "" {
		searchPattern := "%" + search + "%"
		var textColExprs []string
		for _, c := range schemaCols {
			lowerType := strings.ToLower(c.DataType)
			if strings.Contains(lowerType, "char") || strings.Contains(lowerType, "text") {
				textColExprs = append(textColExprs, fmt.Sprintf("ISNULL([%s], '') LIKE @p%d", c.Name, argIdx))
			}
		}
		if len(textColExprs) > 0 {
			conditions = append(conditions, "("+strings.Join(textColExprs, " OR ")+")")
			args = append(args, searchPattern)
			argIdx++
		}
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// 1. Compute total matching filtered rows
	countFilteredQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s %s", tableName, whereClause)
	var totalFiltered int
	if err := db.QueryRowContext(ctx, countFilteredQuery, args...).Scan(&totalFiltered); err != nil {
		// If table is still initializing or empty, return 0 rows cleanly instead of erroring
		return &models.GridQueryResult{
			Rows:      []any{},
			Total:     0,
			Counts:    models.GridCounts{},
			Connected: true,
		}, nil
	}

	// 2. Compute status counts breakdown across the whole table
	var counts models.GridCounts
	if hasStatusFlag {
		countsQuery := fmt.Sprintf(`
			SELECT 
				COUNT(*) AS total,
				ISNULL(SUM(CASE WHEN STATUS_FLAG = 'V' THEN 1 ELSE 0 END), 0) AS valid,
				ISNULL(SUM(CASE WHEN STATUS_FLAG = 'E' THEN 1 ELSE 0 END), 0) AS error,
				ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('L', 'P') THEN 1 ELSE 0 END), 0) AS loaded,
				ISNULL(SUM(CASE WHEN STATUS_FLAG = 'F' THEN 1 ELSE 0 END), 0) AS failed
			FROM %s
		`, tableName)
		_ = db.QueryRowContext(ctx, countsQuery).Scan(&counts.Total, &counts.Valid, &counts.Error, &counts.Loaded, &counts.Failed)
	} else {
		// Generic or custom table: simply count all rows
		_ = db.QueryRowContext(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", tableName)).Scan(&counts.Total)
	}

	// If no rows match, return early with empty slice and discovered column metadata
	if totalFiltered == 0 {
		return &models.GridQueryResult{
			Rows:      []any{},
			Total:     0,
			Counts:    counts,
			Connected: true,
			Columns:   schemaCols,
		}, nil
	}

	// 3. Paginated dynamic query
	var selectExpressions []string
	for _, c := range schemaCols {
		lowerType := strings.ToLower(c.DataType)
		if strings.Contains(lowerType, "datetime") || lowerType == "date" {
			selectExpressions = append(selectExpressions, fmt.Sprintf("ISNULL(CONVERT(VARCHAR(19), [%s], 120), '') AS [%s]", c.Name, c.Name))
		} else if strings.Contains(lowerType, "decimal") || strings.Contains(lowerType, "numeric") || strings.Contains(lowerType, "money") {
			selectExpressions = append(selectExpressions, fmt.Sprintf("ISNULL(TRY_CAST([%s] AS DECIMAL(18, 4)), 0) AS [%s]", c.Name, c.Name))
		} else if strings.Contains(lowerType, "int") || strings.Contains(lowerType, "bigint") || lowerType == "smallint" || lowerType == "tinyint" {
			selectExpressions = append(selectExpressions, fmt.Sprintf("ISNULL([%s], 0) AS [%s]", c.Name, c.Name))
		} else {
			selectExpressions = append(selectExpressions, fmt.Sprintf("ISNULL([%s], '') AS [%s]", c.Name, c.Name))
		}
	}

	// Determine primary key or ordering column
	primaryKeyCol := ""
	for _, c := range schemaCols {
		if c.IsIdentity {
			primaryKeyCol = c.Name
			break
		}
	}
	if primaryKeyCol == "" {
		if isSO {
			primaryKeyCol = "ID"
		} else {
			primaryKeyCol = "GEM_DBKEY"
		}
	}
	hasPk := false
	for _, c := range schemaCols {
		if strings.EqualFold(c.Name, primaryKeyCol) {
			hasPk = true
			primaryKeyCol = c.Name
			break
		}
	}
	if !hasPk && len(schemaCols) > 0 {
		primaryKeyCol = schemaCols[0].Name
	}

	orderClause := fmt.Sprintf("[%s] ASC", primaryKeyCol)
	if primaryKeyCol == "" || primaryKeyCol == "1" {
		orderClause = "(SELECT NULL)"
	}

	selectClause := strings.Join(selectExpressions, ", ")
	if selectClause == "" {
		selectClause = "*"
	}

	dataQuery := fmt.Sprintf(`
		SELECT 
			%s
		FROM %s
		%s
		ORDER BY %s
		OFFSET %d ROWS FETCH NEXT %d ROWS ONLY
	`, selectClause, tableName, whereClause, orderClause, offset, pageSize)

	rows, err := db.QueryContext(ctx, dataQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query grid data: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns from result set: %w", err)
	}

	rowsSlice := make([]any, 0)
	for rows.Next() {
		colValues := make([]any, len(colNames))
		scanArgs := make([]any, len(colNames))
		for i := range colValues {
			scanArgs[i] = &colValues[i]
		}

		if err := rows.Scan(scanArgs...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		rowMap := make(map[string]any)
		for i, col := range colNames {
			val := colValues[i]
			upperCol := strings.ToUpper(col)

			switch v := val.(type) {
			case nil:
				rowMap[upperCol] = nil
			case []byte:
				rowMap[upperCol] = string(v)
			default:
				rowMap[upperCol] = v
			}
		}

		// Backward-compatibility aliases for views expecting standardized keys
		if isSO {
			if idVal, exists := rowMap["ID"]; exists {
				rowMap["GEM_DBKEY"] = idVal
			}
			if qtyVal, exists := rowMap["QUANTITY"]; exists {
				rowMap["QUANTITY_1"] = qtyVal
			}
		}

		rowsSlice = append(rowsSlice, rowMap)
	}

	// Ensure all returned column names are present in Columns metadata
	colSet := make(map[string]bool)
	for _, c := range schemaCols {
		colSet[strings.ToUpper(c.Name)] = true
	}
	for _, name := range colNames {
		upper := strings.ToUpper(name)
		if !colSet[upper] {
			schemaCols = append(schemaCols, models.ColumnDefinition{
				Name:       name,
				DataType:   "varchar",
				MaxLength:  0,
				IsNullable: true,
				IsIdentity: false,
			})
			colSet[upper] = true
		}
	}

	return &models.GridQueryResult{
		Rows:      rowsSlice,
		Total:     totalFiltered,
		Counts:    counts,
		Connected: true,
		Columns:   schemaCols,
	}, nil
}

// GetColumnDistinctValues returns unique values for a column up to limit (default 100), with optional search and blank indicator.
func (m *Manager) GetColumnDistinctValues(ctx context.Context, params models.DistinctValuesParams) (*models.DistinctValuesResult, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	tableName, _ := ResolveTableName(params.Domain, params.TargetTable)

	lookupDomain := params.Domain
	if strings.TrimSpace(params.TargetTable) != "" {
		lookupDomain = params.TargetTable
	}
	schemaCols, _, err := m.GetTableSchema(ctx, lookupDomain)
	if err != nil {
		return nil, err
	}

	// Validate column exists in schema to strictly prevent SQL injection
	var targetCol *models.ColumnDefinition
	for _, c := range schemaCols {
		if strings.EqualFold(c.Name, params.ColumnName) {
			targetCol = &c
			break
		}
	}
	if targetCol == nil {
		return nil, fmt.Errorf("column %q not found in table %s", params.ColumnName, tableName)
	}

	limit := params.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	var whereParts []string
	var args []any
	argIdx := 1

	whereParts = append(whereParts, fmt.Sprintf("[%s] IS NOT NULL", targetCol.Name))
	whereParts = append(whereParts, fmt.Sprintf("CONVERT(VARCHAR(500), [%s]) <> ''", targetCol.Name))

	search := strings.TrimSpace(params.Search)
	if search != "" {
		whereParts = append(whereParts, fmt.Sprintf("CONVERT(VARCHAR(500), [%s]) LIKE @p%d", targetCol.Name, argIdx))
		args = append(args, "%"+search+"%")
		argIdx++
	}

	whereClause := "WHERE " + strings.Join(whereParts, " AND ")
	query := fmt.Sprintf(`
		SELECT DISTINCT TOP (%d)
			ISNULL(CONVERT(VARCHAR(500), [%s]), '') AS val
		FROM %s
		%s
		ORDER BY val ASC
	`, limit+1, targetCol.Name, tableName, whereClause)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query distinct values for %s: %w", targetCol.Name, err)
	}
	defer rows.Close()

	var values []string
	for rows.Next() {
		var val string
		if err := rows.Scan(&val); err != nil {
			continue
		}
		trimmed := strings.TrimSpace(val)
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}

	truncated := false
	if len(values) > limit {
		truncated = true
		values = values[:limit]
	}

	// Check if column has any blanks or nulls in the table
	hasBlanks := false
	blankCheckQuery := fmt.Sprintf("SELECT TOP 1 1 FROM %s WHERE [%s] IS NULL OR CONVERT(VARCHAR(500), [%s]) = ''", tableName, targetCol.Name, targetCol.Name)
	var dummy int
	if err := db.QueryRowContext(ctx, blankCheckQuery).Scan(&dummy); err == nil && dummy == 1 {
		hasBlanks = true
	}

	return &models.DistinctValuesResult{
		Values:     values,
		TotalCount: len(values),
		Truncated:  truncated,
		HasBlanks:  hasBlanks,
	}, nil
}

