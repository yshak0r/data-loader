package database

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"dc-loader-wails/backend/models"
)

var (
	delFromRegex   = regexp.MustCompile(`(?i)\bDELETE(?:\s+(?:\w+|\[\w+\]))?\s+FROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?`)
	delDirectRegex = regexp.MustCompile(`(?i)\bDELETE\s+(?:TOP\s*\(\d+\)\s+)?(?:\[?(\w+)\]?\.)?\[?(\w+)\]?\s+(?:WHERE|JOIN|OUTPUT)`)
)

// extractTargetTableName identifies the target table name in a DELETE statement.
// Returns "" if the statement is not a DELETE or targets a temp table (#table).
func extractTargetTableName(statement string) string {
	if m := delFromRegex.FindStringSubmatch(statement); len(m) >= 3 {
		tbl := m[2]
		if tbl == "" {
			tbl = m[1]
		}
		if tbl != "" && !strings.HasPrefix(tbl, "#") {
			return strings.ToUpper(tbl)
		}
	}
	if m := delDirectRegex.FindStringSubmatch(statement); len(m) >= 3 {
		tbl := m[2]
		if tbl == "" {
			tbl = m[1]
		}
		if tbl != "" && !strings.HasPrefix(tbl, "#") {
			return strings.ToUpper(tbl)
		}
	}
	return ""
}

// splitStatements splits a SQL batch into individual executable statements by semicolon,
// ignoring semicolons inside single-quoted strings or comments.
func splitStatements(batch string) []string {
	var stmts []string
	var cur strings.Builder
	inQuote := false
	runes := []rune(batch)
	n := len(runes)

	for i := 0; i < n; i++ {
		r := runes[i]
		if r == '\'' {
			// Check for escaped single quote ''
			if inQuote && i+1 < n && runes[i+1] == '\'' {
				cur.WriteRune(r)
				cur.WriteRune(runes[i+1])
				i++
				continue
			}
			inQuote = !inQuote
			cur.WriteRune(r)
		} else if r == ';' && !inQuote {
			trimmed := strings.TrimSpace(cur.String())
			if trimmed != "" {
				stmts = append(stmts, trimmed)
			}
			cur.Reset()
		} else {
			cur.WriteRune(r)
		}
	}

	trimmed := strings.TrimSpace(cur.String())
	if trimmed != "" {
		stmts = append(stmts, trimmed)
	}

	return stmts
}

// GetCleanPreview retrieves target warehouses, company codes, and eligible record count from staged data.
func (m *Manager) GetCleanPreview(ctx context.Context, domain string) (*models.CleanPreview, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	tableName := "[FIN].[KAS_DC_LOADS]"
	isSO := domain == "sales_orders"
	if isSO {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	whQuery := fmt.Sprintf(`SELECT DISTINCT WAREHOUSE FROM %s WHERE WAREHOUSE IS NOT NULL AND LTRIM(RTRIM(WAREHOUSE)) != ''`, tableName)
	rows, err := db.QueryContext(ctx, whQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query warehouses: %w", err)
	}
	defer rows.Close()

	var warehouses []string
	for rows.Next() {
		var wh string
		if err := rows.Scan(&wh); err == nil && wh != "" {
			warehouses = append(warehouses, wh)
		}
	}
	rows.Close()

	coQuery := fmt.Sprintf(`SELECT DISTINCT COMPANY_CODE FROM %s WHERE COMPANY_CODE IS NOT NULL AND LTRIM(RTRIM(COMPANY_CODE)) != ''`, tableName)
	coRows, err := db.QueryContext(ctx, coQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query companies: %w", err)
	}
	defer coRows.Close()

	var companies []string
	for coRows.Next() {
		var co string
		if err := coRows.Scan(&co); err == nil && co != "" {
			companies = append(companies, co)
		}
	}

	var totalRecords int
	if isSO {
		// In Sales Orders, scope to clean is loaded orders (STATUS_FLAG = 'P' with ORDER_NUMBER)
		soCountQuery := `SELECT COUNT(*) FROM [FIN].[KAS_SO_LOADS] WHERE STATUS_FLAG = 'P' AND ORDER_NUMBER IS NOT NULL`
		_ = db.QueryRowContext(ctx, soCountQuery).Scan(&totalRecords)
		if totalRecords == 0 {
			_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM [FIN].[KAS_SO_LOADS]`).Scan(&totalRecords)
		}
	} else {
		countQuery := `SELECT COUNT(*) FROM [FIN].[KAS_DC_LOADS]`
		_ = db.QueryRowContext(ctx, countQuery).Scan(&totalRecords)
	}

	return &models.CleanPreview{
		Warehouses:   warehouses,
		CompanyCodes: companies,
		RecordCount:  totalRecords,
	}, nil
}

// GetCleanWarehousesPreview retrieves target warehouses and company codes from staged data (backward compatible).
func (m *Manager) GetCleanWarehousesPreview(ctx context.Context) (*models.CleanPreview, error) {
	return m.GetCleanPreview(ctx, "inventory")
}

// CleanInventoryTables is a backward-compatible wrapper calling CleanTablesWithScript for inventory.
func (m *Manager) CleanInventoryTables(ctx context.Context) (*models.CleanTableResult, error) {
	return m.CleanTablesWithScript(ctx, "inventory", "")
}

// CleanInventoryTablesWithScript executes the provided SQL clean script inside an isolated transaction for inventory.
func (m *Manager) CleanInventoryTablesWithScript(ctx context.Context, script string) (*models.CleanTableResult, error) {
	return m.CleanTablesWithScript(ctx, "inventory", script)
}

// CleanTablesWithScript executes the clean script inside an isolated transaction for the given domain.
func (m *Manager) CleanTablesWithScript(ctx context.Context, domain string, script string) (*models.CleanTableResult, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	isSO := domain == "sales_orders"
	preview, err := m.GetCleanPreview(ctx, domain)
	if err != nil {
		return nil, err
	}

	if !isSO && len(preview.Warehouses) == 0 {
		return &models.CleanTableResult{
			Success:          false,
			TotalDeleted:     0,
			TableBreakdown:   []models.CleanBreakdownItem{},
			TargetWarehouses: []string{},
			Message:          "No staged warehouses found. Please upload a CSV before cleaning inventory tables.",
		}, nil
	}

	if isSO && preview.RecordCount == 0 {
		return &models.CleanTableResult{
			Success:          false,
			TotalDeleted:     0,
			TableBreakdown:   []models.CleanBreakdownItem{},
			TargetWarehouses: []string{},
			Message:          "No staged sales orders found in [FIN].[KAS_SO_LOADS]. Nothing to clean.",
		}, nil
	}

	if strings.TrimSpace(script) == "" {
		return &models.CleanTableResult{
			Success:          false,
			TotalDeleted:     0,
			TableBreakdown:   []models.CleanBreakdownItem{},
			TargetWarehouses: preview.Warehouses,
			Message:          "No clean script content available. Please load or reset the Clean Tables SQL script.",
		}, nil
	}

	// Begin atomic transaction
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}

	tableOrder := []string{}
	tableRows := map[string]int{}
	var recordsetBreakdown []models.CleanBreakdownItem

	batches := SplitSqlBatches(script)
	stmtIndex := 0

	for bIdx, batch := range batches {
		trimmedBatch := strings.TrimSpace(batch)
		if trimmedBatch == "" {
			continue
		}

		stmts := splitStatements(trimmedBatch)
		for _, stmt := range stmts {
			trimmedStmt := strings.TrimSpace(stmt)
			if trimmedStmt == "" {
				continue
			}
			stmtIndex++

			// Check if this statement is a SELECT that might produce a summary recordset
			upperStmt := strings.ToUpper(trimmedStmt)
			if strings.HasPrefix(upperStmt, "SELECT") {
				qRows, qErr := tx.QueryContext(ctx, trimmedStmt)
				if qErr != nil {
					_ = tx.Rollback()
					return &models.CleanTableResult{
						Success:          false,
						TotalDeleted:     0,
						TableBreakdown:   []models.CleanBreakdownItem{},
						TargetWarehouses: preview.Warehouses,
						Message:          fmt.Sprintf("Statement %d (Batch %d) query failed: %s", stmtIndex, bIdx+1, qErr.Error()),
					}, nil
				}

				cols, _ := qRows.Columns()
				tableColIdx := -1
				countColIdx := -1
				for cIdx, col := range cols {
					lc := strings.ToLower(col)
					if lc == "table_name" || lc == "tablename" || lc == "table" || lc == "entity" || lc == "target_table" {
						tableColIdx = cIdx
					}
					if lc == "rows_deleted" || lc == "rowsdeleted" || lc == "deleted_count" || lc == "row_count" || lc == "cnt" || lc == "count" || lc == "records" {
						countColIdx = cIdx
					}
				}

				if tableColIdx >= 0 && countColIdx >= 0 {
					for qRows.Next() {
						values := make([]any, len(cols))
						valPtrs := make([]any, len(cols))
						for i := range values {
							valPtrs[i] = &values[i]
						}
						if scanErr := qRows.Scan(valPtrs...); scanErr == nil {
							tblName := fmt.Sprintf("%v", values[tableColIdx])
							tblName = strings.TrimSpace(tblName)
							cntVal := 0
							switch v := values[countColIdx].(type) {
							case int64:
								cntVal = int(v)
							case int:
								cntVal = v
							default:
								var parsed int
								_, _ = fmt.Sscanf(fmt.Sprintf("%v", v), "%d", &parsed)
								cntVal = parsed
							}
							if len(tblName) > 2 {
								recordsetBreakdown = append(recordsetBreakdown, models.CleanBreakdownItem{
									TableName:   strings.ToUpper(tblName),
									RowsDeleted: cntVal,
								})
							}
						}
					}
				}
				qRows.Close()
				continue
			}

			// Execute non-SELECT statements (DELETE, DROP, temp table manipulation, etc.)
			res, execErr := tx.ExecContext(ctx, trimmedStmt)
			if execErr != nil {
				_ = tx.Rollback()
				return &models.CleanTableResult{
					Success:          false,
					TotalDeleted:     0,
					TableBreakdown:   []models.CleanBreakdownItem{},
					TargetWarehouses: preview.Warehouses,
					Message:          fmt.Sprintf("Statement %d (Batch %d) failed (rolled back): %s", stmtIndex, bIdx+1, execErr.Error()),
				}, nil
			}

			// If this statement was a DELETE targeting a permanent table, record affected rows
			tbl := extractTargetTableName(trimmedStmt)
			if tbl != "" && res != nil {
				aff, _ := res.RowsAffected()
				if _, seen := tableRows[tbl]; !seen {
					tableOrder = append(tableOrder, tbl)
				}
				tableRows[tbl] += int(aff)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return &models.CleanTableResult{
			Success:          false,
			TotalDeleted:     0,
			TableBreakdown:   []models.CleanBreakdownItem{},
			TargetWarehouses: preview.Warehouses,
			Message:          fmt.Sprintf("Transaction commit failed: %s", err.Error()),
		}, nil
	}

	// Prepare final breakdown: prefer recordset breakdown if produced by script, otherwise tracked DELETEs
	var breakdown []models.CleanBreakdownItem
	totalDeleted := 0

	if len(recordsetBreakdown) > 0 {
		breakdown = recordsetBreakdown
		for _, b := range breakdown {
			totalDeleted += b.RowsDeleted
		}
	} else {
		for _, name := range tableOrder {
			cnt := tableRows[name]
			breakdown = append(breakdown, models.CleanBreakdownItem{
				TableName:   name,
				RowsDeleted: cnt,
			})
			totalDeleted += cnt
		}
	}

	affectedCount := 0
	for _, b := range breakdown {
		if b.RowsDeleted > 0 {
			affectedCount++
		}
	}

	msg := fmt.Sprintf(
		"Clean completed: %d total record(s) removed across %d table(s) for warehouse(s): %s.",
		totalDeleted, affectedCount, strings.Join(preview.Warehouses, ", "),
	)
	if isSO {
		msg = fmt.Sprintf(
			"Clean completed: %d total sales order record(s) removed across %d table(s).",
			totalDeleted, affectedCount,
		)
	}

	return &models.CleanTableResult{
		Success:          true,
		TotalDeleted:     totalDeleted,
		TableBreakdown:   breakdown,
		TargetWarehouses: preview.Warehouses,
		Message:          msg,
	}, nil
}
