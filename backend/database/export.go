package database

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strings"
)

// ExportData exports staged data filtered by status ('all', 'valid', 'error', 'loaded') to CSV format.
func (m *Manager) ExportData(ctx context.Context, filter string, domain string) (string, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return "", err
	}

	isSO := domain == "sales_orders"
	tableName := "[FIN].[KAS_DC_LOADS]"
	if isSO {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	var statusWhere string
	f := strings.ToLower(strings.TrimSpace(filter))
	switch f {
	case "valid", "v":
		statusWhere = "WHERE STATUS_FLAG = 'V'"
	case "error", "e":
		statusWhere = "WHERE STATUS_FLAG = 'E'"
	case "loaded", "p", "l", "processed":
		statusWhere = "WHERE STATUS_FLAG IN ('L', 'P')"
	default:
		statusWhere = ""
	}

	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)

	if isSO {
		header := []string{
			"Order Date", "Customer", "Delivery Code", "Cust Ref", "SYS_DELIVERY_DATE",
			"WAREHOUSE", "ROSS Part code", "Quantity", "Sales Price", "Freight",
			"Line No", "Order No", "Status", "Message",
		}
		if err := writer.Write(header); err != nil {
			return "", err
		}

		query := fmt.Sprintf(`
			SELECT 
				ORDER_DATE, CUSTOMER_NUMBER, DELIVERY_ADDRESS_CODE, CUSTOMER_REFERENCE,
				SYS_DELIVERY_DATE, WAREHOUSE, PART_CODE, QUANTITY_1, SALES_PRICE, FREIGHT,
				ORDER_LINE_NUMBER, ISNULL(ORDER_NUMBER, ''), STATUS_FLAG, RS_MESSAGE_TEXT
			FROM %s
			%s
			ORDER BY GEM_DBKEY ASC
		`, tableName, statusWhere)

		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return "", fmt.Errorf("failed to query SO export data: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var orderDate, cust, deliv, ref, sysDeliv, wh, part, orderNum, status, msg string
			var qty, price, freight float64
			var lineNum int

			if err := rows.Scan(
				&orderDate, &cust, &deliv, &ref, &sysDeliv, &wh, &part,
				&qty, &price, &freight, &lineNum, &orderNum, &status, &msg,
			); err != nil {
				continue
			}

			record := []string{
				orderDate, cust, deliv, ref, sysDeliv, wh, part,
				fmt.Sprintf("%.4f", qty), fmt.Sprintf("%.4f", price), fmt.Sprintf("%.4f", freight),
				fmt.Sprintf("%d", lineNum), orderNum, status, msg,
			}
			_ = writer.Write(record)
		}
	} else {
		header := []string{
			"WAREHOUSE", "PART_CODE", "IC_LOT_NUMBER", "BIN_LOCATION", "IC_STATUS_CODE",
			"CREATION_DATE", "BATCH_DATE", "DC_LICENSE_PLATE_ID", "DC_PARENT_LICENSE_PLATE_ID",
			"UOM_1", "QTY_1", "UOM_2", "QTY_2", "STATUS_FLAG", "RS_MESSAGE_TEXT",
			"DC_LICENSE_PLATE_LINE", "UNIT_COST", "IC_VENDOR_LOT_NUMBER", "BEST_BEFORE_DATE", "IC_RETEST_DATE",
		}
		if err := writer.Write(header); err != nil {
			return "", err
		}

		query := fmt.Sprintf(`
			SELECT 
				WAREHOUSE, ISNULL(PART_CODE, ''), IC_LOT_NUMBER, BIN_LOCATION, IC_STATUS_CODE,
				CREATION_DATE, ISNULL(BATCH_DATE, ''), DC_LICENSE_PLATE_ID, DC_PARENT_LICENSE_PLATE_ID,
				ISNULL(UOM_1, ''), QTY_1, ISNULL(UOM_2, ''), QTY_2, STATUS_FLAG, RS_MESSAGE_TEXT,
				DC_LICENSE_PLATE_LINE, ISNULL(UNIT_COST, 0), IC_VENDOR_LOT_NUMBER, ISNULL(BEST_BEFORE_DATE, ''), IC_RETEST_DATE
			FROM %s
			%s
			ORDER BY GEM_DBKEY ASC
		`, tableName, statusWhere)

		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return "", fmt.Errorf("failed to query DC export data: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var wh, part, lot, bin, status, creation, batchDate, lpn, parentLpn, uom1, uom2, flag, msg, vendLot, bestBefore, retest string
			var qty1, qty2, cost float64
			var lineNum int

			if err := rows.Scan(
				&wh, &part, &lot, &bin, &status, &creation, &batchDate, &lpn, &parentLpn,
				&uom1, &qty1, &uom2, &qty2, &flag, &msg, &lineNum, &cost, &vendLot, &bestBefore, &retest,
			); err != nil {
				continue
			}

			record := []string{
				wh, part, lot, bin, status, creation, batchDate, lpn, parentLpn,
				uom1, fmt.Sprintf("%.4f", qty1), uom2, fmt.Sprintf("%.4f", qty2), flag, msg,
				fmt.Sprintf("%d", lineNum), fmt.Sprintf("%.4f", cost), vendLot, bestBefore, retest,
			}
			_ = writer.Write(record)
		}
	}

	writer.Flush()
	return buf.String(), nil
}

