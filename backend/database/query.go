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
	tableName := "[FIN].[KAS_DC_LOADS]"
	if isSO {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	// Ensure the staging table exists if not already present
	checkQuery := fmt.Sprintf("IF OBJECT_ID('%s', 'U') IS NULL SELECT 0 ELSE SELECT 1", tableName)
	var tblExists int
	if err := db.QueryRowContext(ctx, checkQuery).Scan(&tblExists); err == nil && tblExists == 0 {
		_, _ = m.EnsureTableExists(ctx, params.Domain)
	}

	// Dynamically inspect existing physical columns from SQL Server
	schemaCols, _, _ := m.GetTableSchema(ctx, params.Domain)

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

	// Status filter
	status := strings.TrimSpace(params.StatusFilter)
	if status != "" && status != "ALL" {
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

	// Text search: build dynamic LIKE filter across all textual columns
	search := strings.TrimSpace(params.Search)
	if search != "" {
		searchPattern := "%" + search + "%"
		var textColExprs []string
		for _, c := range schemaCols {
			lowerType := strings.ToLower(c.DataType)
			if strings.Contains(lowerType, "char") || strings.Contains(lowerType, "text") {
				textColExprs = append(textColExprs, fmt.Sprintf("ISNULL(%s, '') LIKE @p%d", c.Name, argIdx))
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
	// valid = only records with STATUS_FLAG = 'V' (passed dry-run, awaiting loader)
	countsQuery := fmt.Sprintf(`
		SELECT 
			COUNT(*) AS total,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'V' THEN 1 ELSE 0 END), 0) AS valid,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'E' THEN 1 ELSE 0 END), 0) AS error,
			ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('L', 'P') THEN 1 ELSE 0 END), 0) AS loaded,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'F' THEN 1 ELSE 0 END), 0) AS failed
		FROM %s
	`, tableName)

	var counts models.GridCounts
	_ = db.QueryRowContext(ctx, countsQuery).Scan(&counts.Total, &counts.Valid, &counts.Error, &counts.Loaded, &counts.Failed)

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

	primaryKeyCol := "GEM_DBKEY"
	if isSO {
		primaryKeyCol = "ID"
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
		ORDER BY [%s] ASC
		OFFSET %d ROWS FETCH NEXT %d ROWS ONLY
	`, selectClause, tableName, whereClause, primaryKeyCol, offset, pageSize)

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

