package database

import (
	"context"
	"fmt"
	"strings"

	"dc-loader-wails/backend/models"
)

// GetCleanWarehousesPreview retrieves target warehouses and company codes from staged data.
func (m *Manager) GetCleanWarehousesPreview(ctx context.Context) (*models.CleanPreview, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	whQuery := `SELECT DISTINCT WAREHOUSE FROM [FIN].[KAS_DC_LOADS] WHERE WAREHOUSE IS NOT NULL AND LTRIM(RTRIM(WAREHOUSE)) != ''`
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

	coQuery := `SELECT DISTINCT COMPANY_CODE FROM [FIN].[KAS_DC_LOADS] WHERE COMPANY_CODE IS NOT NULL AND LTRIM(RTRIM(COMPANY_CODE)) != ''`
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

	countQuery := `SELECT COUNT(*) FROM [FIN].[KAS_DC_LOADS]`
	var totalRecords int
	_ = db.QueryRowContext(ctx, countQuery).Scan(&totalRecords)

	return &models.CleanPreview{
		Warehouses:   warehouses,
		CompanyCodes: companies,
		RecordCount:  totalRecords,
	}, nil
}

// CleanInventoryTables cleans inventory records in Ross ERP scoped to staged warehouses.
func (m *Manager) CleanInventoryTables(ctx context.Context) (*models.CleanTableResult, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	preview, err := m.GetCleanWarehousesPreview(ctx)
	if err != nil {
		return nil, err
	}

	if len(preview.Warehouses) == 0 {
		return &models.CleanTableResult{
			Success:          false,
			TotalDeleted:     0,
			TargetWarehouses: []string{},
			Message:          "No staged warehouses found. Please upload a CSV before cleaning inventory tables.",
		}, nil
	}

	var placeholders []string
	var args []any
	for i, w := range preview.Warehouses {
		placeholders = append(placeholders, fmt.Sprintf("@p%d", i+1))
		args = append(args, w)
	}
	inClause := strings.Join(placeholders, ", ")

	targetTables := []struct {
		name      string
		colWh     string
	}{
		{"DC_LICENSE_PLATE_DETAIL", "WAREHOUSE"},
		{"DC_LICENSE_PLATE_HEADER", "WAREHOUSE"},
		{"IC_LOT_BALANCE", "WAREHOUSE"},
		{"IC_BIN_BALANCE", "WAREHOUSE"},
	}

	var breakdown []models.CleanBreakdownItem
	totalDeleted := 0

	for _, t := range targetTables {
		checkQuery := fmt.Sprintf("IF OBJECT_ID(N'%s', N'U') IS NOT NULL SELECT 1 ELSE SELECT 0", t.name)
		var exists int
		if err := db.QueryRowContext(ctx, checkQuery).Scan(&exists); err == nil && exists == 1 {
			delQuery := fmt.Sprintf("DELETE FROM [%s] WHERE [%s] IN (%s)", t.name, t.colWh, inClause)
			res, delErr := db.ExecContext(ctx, delQuery, args...)
			if delErr == nil {
				aff, _ := res.RowsAffected()
				breakdown = append(breakdown, models.CleanBreakdownItem{
					TableName:   t.name,
					RowsDeleted: int(aff),
				})
				totalDeleted += int(aff)
			}
		}
	}

	return &models.CleanTableResult{
		Success:          true,
		TotalDeleted:     totalDeleted,
		TableBreakdown:   breakdown,
		TargetWarehouses: preview.Warehouses,
		Message:          fmt.Sprintf("Clean completed: %d total records removed across %d tables.", totalDeleted, len(breakdown)),
	}, nil
}

