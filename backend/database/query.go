package database

import (
	"context"
	"database/sql"
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

	// Automatically ensure the staging table and schema exist
	_, _ = m.EnsureTableExists(ctx, params.Domain)

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
			conditions = append(conditions, "STATUS_FLAG IN ('V', 'F', 'L', 'P')")
		} else {
			conditions = append(conditions, fmt.Sprintf("STATUS_FLAG = @p%d", argIdx))
			args = append(args, status)
			argIdx++
		}
	}

	// Text search
	search := strings.TrimSpace(params.Search)
	if search != "" {
		searchPattern := "%" + search + "%"
		if isSO {
			conditions = append(conditions, fmt.Sprintf(
				"(CUSTOMER_NUMBER LIKE @p%d OR CUSTOMER_REFERENCE LIKE @p%d OR PART_CODE LIKE @p%d OR WAREHOUSE LIKE @p%d OR ISNULL(ORDER_NUMBER, '') LIKE @p%d OR RS_MESSAGE_TEXT LIKE @p%d)",
				argIdx, argIdx, argIdx, argIdx, argIdx, argIdx,
			))
		} else {
			conditions = append(conditions, fmt.Sprintf(
				"(PART_CODE LIKE @p%d OR IC_LOT_NUMBER LIKE @p%d OR DC_LICENSE_PLATE_ID LIKE @p%d OR WAREHOUSE LIKE @p%d OR BIN_LOCATION LIKE @p%d OR RS_MESSAGE_TEXT LIKE @p%d)",
				argIdx, argIdx, argIdx, argIdx, argIdx, argIdx,
			))
		}
		args = append(args, searchPattern)
		argIdx++
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
	// valid = all records that have passed validation (V awaiting load, F load failed, P/L committed)
	countsQuery := fmt.Sprintf(`
		SELECT 
			COUNT(*) AS total,
			ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('V', 'F', 'P', 'L') THEN 1 ELSE 0 END), 0) AS valid,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'E' THEN 1 ELSE 0 END), 0) AS error,
			ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('L', 'P') THEN 1 ELSE 0 END), 0) AS loaded,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'F' THEN 1 ELSE 0 END), 0) AS failed
		FROM %s
	`, tableName)

	var counts models.GridCounts
	_ = db.QueryRowContext(ctx, countsQuery).Scan(&counts.Total, &counts.Valid, &counts.Error, &counts.Loaded, &counts.Failed)

	// If no rows match, return early with empty slice
	if totalFiltered == 0 {
		return &models.GridQueryResult{
			Rows:      []any{},
			Total:     0,
			Counts:    counts,
			Connected: true,
		}, nil
	}

	// 3. Paginated query
	rowsSlice := make([]any, 0)
	if isSO {
		dataQuery := fmt.Sprintf(`
			SELECT 
				GEM_DBKEY, COMPANY_CODE, DIVISION, ORDER_DATE, CUSTOMER_NUMBER,
				DELIVERY_ADDRESS_CODE, CUSTOMER_REFERENCE, SYS_DELIVERY_DATE, WAREHOUSE,
				PART_CODE, QUANTITY_1, UNIT_SALES, SALES_PRICE, FREIGHT,
				ORDER_LINE_NUMBER, ORDER_NUMBER, STATUS_FLAG, RS_MESSAGE_TEXT
			FROM %s
			%s
			ORDER BY GEM_DBKEY ASC
			OFFSET %d ROWS FETCH NEXT %d ROWS ONLY
		`, tableName, whereClause, offset, pageSize)

		rows, err := db.QueryContext(ctx, dataQuery, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to query SO grid data: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var r models.KasSoLoadRecord
			var unitSales, orderNum sql.NullString
			if err := rows.Scan(
				&r.GemDbKey, &r.CompanyCode, &r.Division, &r.OrderDate, &r.CustomerNumber,
				&r.DeliveryAddressCode, &r.CustomerReference, &r.SysDeliveryDate, &r.Warehouse,
				&r.PartCode, &r.Quantity1, &unitSales, &r.SalesPrice, &r.Freight,
				&r.OrderLineNumber, &orderNum, &r.StatusFlag, &r.RsMessageText,
			); err != nil {
				return nil, fmt.Errorf("failed to scan SO row: %w", err)
			}
			if unitSales.Valid {
				r.UnitSales = &unitSales.String
			}
			if orderNum.Valid {
				r.OrderNumber = &orderNum.String
			}
			rowsSlice = append(rowsSlice, r)
		}
	} else {
		dataQuery := fmt.Sprintf(`
			SELECT 
				GEM_DBKEY, COMPANY_CODE, WAREHOUSE, PART_CODE, IC_LOT_NUMBER,
				BIN_LOCATION, IC_STATUS_CODE, CREATION_DATE, BATCH_DATE,
				DC_LICENSE_PLATE_ID, DC_PARENT_LICENSE_PLATE_ID, UOM_1, QTY_1,
				UOM_2, QTY_2, STATUS_FLAG, RS_MESSAGE_TEXT, DC_LICENSE_PLATE_LINE,
				UNIT_COST, IC_VENDOR_LOT_NUMBER, BEST_BEFORE_DATE, IC_RETEST_DATE
			FROM %s
			%s
			ORDER BY GEM_DBKEY ASC
			OFFSET %d ROWS FETCH NEXT %d ROWS ONLY
		`, tableName, whereClause, offset, pageSize)

		rows, err := db.QueryContext(ctx, dataQuery, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to query DC grid data: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var r models.KasDcLoadRecord
			var partCode, batchDate, uom1, uom2, bestBefore sql.NullString
			var unitCost sql.NullFloat64
			if err := rows.Scan(
				&r.GemDbKey, &r.CompanyCode, &r.Warehouse, &partCode, &r.IcLotNumber,
				&r.BinLocation, &r.IcStatusCode, &r.CreationDate, &batchDate,
				&r.DcLicensePlateID, &r.DcParentLicensePlateID, &uom1, &r.Qty1,
				&uom2, &r.Qty2, &r.StatusFlag, &r.RsMessageText, &r.DcLicensePlateLine,
				&unitCost, &r.IcVendorLotNumber, &bestBefore, &r.IcRetestDate,
			); err != nil {
				return nil, fmt.Errorf("failed to scan DC row: %w", err)
			}
			if partCode.Valid {
				r.PartCode = &partCode.String
			}
			if batchDate.Valid {
				r.BatchDate = &batchDate.String
			}
			if uom1.Valid {
				r.Uom1 = &uom1.String
			}
			if uom2.Valid {
				r.Uom2 = &uom2.String
			}
			if bestBefore.Valid {
				r.BestBeforeDate = &bestBefore.String
			}
			if unitCost.Valid {
				r.UnitCost = &unitCost.Float64
			}
			rowsSlice = append(rowsSlice, r)
		}
	}

	return &models.GridQueryResult{
		Rows:      rowsSlice,
		Total:     totalFiltered,
		Counts:    counts,
		Connected: true,
	}, nil
}

