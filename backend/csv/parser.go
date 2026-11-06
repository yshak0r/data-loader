package csv

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"dc-loader-wails/backend/models"
)

// ProgressCallback reports how many rows have been ingested so far.
type ProgressCallback func(loaded int)

// SniffDomain peeks at the CSV headers to detect whether it is Sales Orders or DC Inventory.
func SniffDomain(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "inventory", err
	}
	defer file.Close()

	reader := csv.NewReader(bufio.NewReader(file))
	header, err := reader.Read()
	if err != nil {
		return "inventory", err
	}

	headerJoined := strings.ToUpper(strings.Join(header, " "))
	if strings.Contains(headerJoined, "CUSTOMER") ||
		strings.Contains(headerJoined, "CUST REF") ||
		strings.Contains(headerJoined, "SALES PRICE") ||
		strings.Contains(headerJoined, "SYS_DELIVERY_DATE") ||
		strings.Contains(headerJoined, "DELIVERY CODE") {
		return "sales_orders", nil
	}

	return "inventory", nil
}

// UploadCsv streams a CSV file into the appropriate staging table.
func UploadCsv(
	ctx context.Context,
	db *sql.DB,
	filePath string,
	companyCode string,
	division string,
	preferredDomain string,
	onProgress ProgressCallback,
) (string, int, error) {
	if companyCode == "" {
		companyCode = "CORP"
	}
	if division == "" {
		division = "1"
	}

	domain := preferredDomain
	if domain == "" {
		detected, _ := SniffDomain(filePath)
		domain = detected
	}

	file, err := os.Open(filePath)
	if err != nil {
		return domain, 0, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	if domain == "sales_orders" {
		total, err := uploadSoCsv(ctx, db, file, companyCode, division, onProgress)
		return "sales_orders", total, err
	}

	total, err := uploadDcCsv(ctx, db, file, companyCode, onProgress)
	return "inventory", total, err
}

func uploadSoCsv(
	ctx context.Context,
	db *sql.DB,
	r io.Reader,
	companyCode string,
	division string,
	onProgress ProgressCallback,
) (int, error) {
	reader := csv.NewReader(bufio.NewReader(r))
	header, err := reader.Read()
	if err != nil {
		return 0, fmt.Errorf("failed to read CSV header: %w", err)
	}

	// Normalize header indices
	indices := make(map[string]int)
	for i, h := range header {
		clean := strings.ToUpper(strings.TrimSpace(h))
		indices[clean] = i
	}

	idxOrderDate := getIndex(indices, "ORDER DATE", "ORDER_DATE")
	idxCustomer := getIndex(indices, "CUSTOMER", "CUSTOMER_CODE", "CUST_CODE")
	idxDeliveryCode := getIndex(indices, "DELIVERY CODE", "DELIVERY_CODE", "SHIP_TO")
	idxCustRef := getIndex(indices, "CUST REF", "CUSTOMER_REF", "PO_NUMBER", "PO REF")
	idxSysDeliv := getIndex(indices, "SYS_DELIVERY_DATE", "REQ_DELIVERY_DATE", "DELIVERY_DATE")
	idxWarehouse := getIndex(indices, "WAREHOUSE", "WH", "WAREHOUSE_CODE")
	idxPartCode := getIndex(indices, "ROSS PART CODE", "PART_CODE", "ITEM", "ITEM_CODE")
	idxQty := getIndex(indices, "QUANTITY", "QTY", "ORDER_QTY")
	idxPrice := getIndex(indices, "SALES PRICE", "PRICE", "UNIT_PRICE")
	idxFreight := getIndex(indices, "FREIGHT", "FREIGHT_CHARGE")

	var records []models.KasSoLoadRecord
	orderLinesMap := make(map[string]int)
	batchSize := 500
	totalLoaded := 0

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		orderDate := getCol(row, idxOrderDate)
		customer := getCol(row, idxCustomer)
		deliveryCode := getCol(row, idxDeliveryCode)
		if deliveryCode == "" {
			deliveryCode = "1"
		}
		custRef := getCol(row, idxCustRef)
		sysDeliv := getCol(row, idxSysDeliv)
		wh := getCol(row, idxWarehouse)
		part := getCol(row, idxPartCode)
		qty := parseDecimal(getCol(row, idxQty), 0)
		price := parseDecimal(getCol(row, idxPrice), 0)
		freight := parseDecimal(getCol(row, idxFreight), 0)

		// Grouping key for multi-line order line numbering
		orderKey := fmt.Sprintf("%s|%s|%s|%s|%s", customer, deliveryCode, custRef, orderDate, sysDeliv)
		orderLinesMap[orderKey]++
		lineNum := orderLinesMap[orderKey]

		rec := models.KasSoLoadRecord{
			CompanyCode:         companyCode,
			Division:            division,
			OrderDate:           orderDate,
			CustomerNumber:      customer,
			DeliveryAddressCode: deliveryCode,
			CustomerReference:   custRef,
			SysDeliveryDate:     sysDeliv,
			Warehouse:           wh,
			PartCode:            part,
			Quantity1:           qty,
			SalesPrice:          price,
			Freight:             freight,
			OrderLineNumber:     lineNum,
			StatusFlag:          " ",
			RsMessageText:       "",
		}
		records = append(records, rec)

		if len(records) >= batchSize {
			if err := insertSoBatch(ctx, db, records); err != nil {
				return totalLoaded, err
			}
			totalLoaded += len(records)
			if onProgress != nil {
				onProgress(totalLoaded)
			}
			records = records[:0]
		}
	}

	if len(records) > 0 {
		if err := insertSoBatch(ctx, db, records); err != nil {
			return totalLoaded, err
		}
		totalLoaded += len(records)
		if onProgress != nil {
			onProgress(totalLoaded)
		}
	}

	return totalLoaded, nil
}

func insertSoBatch(ctx context.Context, db *sql.DB, records []models.KasSoLoadRecord) error {
	if len(records) == 0 {
		return nil
	}

	var valStrings []string
	var args []any
	argIdx := 1

	for _, r := range records {
		valStrings = append(valStrings, fmt.Sprintf(
			"(@p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d)",
			argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+4, argIdx+5, argIdx+6, argIdx+7,
			argIdx+8, argIdx+9, argIdx+10, argIdx+11, argIdx+12, argIdx+13, argIdx+14,
		))
		args = append(args,
			r.CompanyCode, r.Division, r.OrderDate, r.CustomerNumber, r.DeliveryAddressCode,
			r.CustomerReference, r.SysDeliveryDate, r.Warehouse, r.PartCode, r.Quantity1,
			r.SalesPrice, r.Freight, r.OrderLineNumber, r.StatusFlag, r.RsMessageText,
		)
		argIdx += 15
	}

	query := fmt.Sprintf(`
		INSERT INTO [FIN].[KAS_SO_LOADS] (
			COMPANY_CODE, DIVISION, ORDER_DATE, CUSTOMER_NUMBER, DELIVERY_ADDRESS_CODE,
			CUSTOMER_REFERENCE, SYS_DELIVERY_DATE, WAREHOUSE, PART_CODE, QUANTITY_1,
			SALES_PRICE, FREIGHT, ORDER_LINE_NUMBER, STATUS_FLAG, RS_MESSAGE_TEXT
		) VALUES %s
	`, strings.Join(valStrings, ", "))

	_, err := db.ExecContext(ctx, query, args...)
	return err
}

func uploadDcCsv(
	ctx context.Context,
	db *sql.DB,
	r io.Reader,
	companyCode string,
	onProgress ProgressCallback,
) (int, error) {
	reader := csv.NewReader(bufio.NewReader(r))
	header, err := reader.Read()
	if err != nil {
		return 0, fmt.Errorf("failed to read CSV header: %w", err)
	}

	indices := make(map[string]int)
	for i, h := range header {
		clean := strings.ToUpper(strings.TrimSpace(h))
		indices[clean] = i
	}

	idxWh := getIndex(indices, "WAREHOUSE", "WH")
	idxPart := getIndex(indices, "PART_CODE", "ITEM_CODE", "PART")
	idxLot := getIndex(indices, "IC_LOT_NUMBER", "LOT_NUMBER", "LOT")
	idxBin := getIndex(indices, "BIN_LOCATION", "BIN", "LOCATION")
	idxStatus := getIndex(indices, "IC_STATUS_CODE", "STATUS_CODE", "STATUS")
	idxCreation := getIndex(indices, "CREATION_DATE", "CREATED_DATE", "DATE")
	idxLpn := getIndex(indices, "DC_LICENSE_PLATE_ID", "LPN_ID", "LPN")
	idxParentLpn := getIndex(indices, "DC_PARENT_LICENSE_PLATE_ID", "PARENT_LPN_ID", "PARENT_LPN")
	idxUom1 := getIndex(indices, "UOM_1", "UOM")
	idxQty1 := getIndex(indices, "QTY_1", "QUANTITY", "QTY")
	idxUom2 := getIndex(indices, "UOM_2")
	idxQty2 := getIndex(indices, "QTY_2")
	idxUnitCost := getIndex(indices, "UNIT_COST", "COST")
	idxVendLot := getIndex(indices, "IC_VENDOR_LOT_NUMBER", "VENDOR_LOT")
	idxRetest := getIndex(indices, "IC_RETEST_DATE", "RETEST_DATE")
	idxBestBefore := getIndex(indices, "BEST_BEFORE_DATE", "EXPIRY_DATE")

	var records []models.KasDcLoadRecord
	batchSize := 500
	totalLoaded := 0

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		wh := getCol(row, idxWh)
		part := getCol(row, idxPart)
		lot := getCol(row, idxLot)
		bin := getCol(row, idxBin)
		status := getCol(row, idxStatus)
		creation := getCol(row, idxCreation)
		if creation == "" {
			creation = time.Now().Format("2006-01-02")
		}
		lpn := getCol(row, idxLpn)
		parentLpn := getCol(row, idxParentLpn)
		if parentLpn == "" {
			parentLpn = lpn
		}
		uom1 := getCol(row, idxUom1)
		qty1 := parseDecimal(getCol(row, idxQty1), 0)
		uom2 := getCol(row, idxUom2)
		qty2 := parseDecimal(getCol(row, idxQty2), 0)
		vendLot := getCol(row, idxVendLot)
		retest := getCol(row, idxRetest)
		bestBefore := getCol(row, idxBestBefore)

		rec := models.KasDcLoadRecord{
			CompanyCode:            companyCode,
			Warehouse:              wh,
			IcLotNumber:            lot,
			BinLocation:            bin,
			IcStatusCode:           status,
			CreationDate:           creation,
			DcLicensePlateID:       lpn,
			DcParentLicensePlateID: parentLpn,
			Qty1:                   qty1,
			Qty2:                   qty2,
			StatusFlag:             " ",
			RsMessageText:          "",
			DcLicensePlateLine:     1,
			IcVendorLotNumber:      vendLot,
			IcRetestDate:           retest,
		}
		if part != "" {
			rec.PartCode = &part
		}
		if uom1 != "" {
			rec.Uom1 = &uom1
		}
		if uom2 != "" {
			rec.Uom2 = &uom2
		}
		if bestBefore != "" {
			rec.BestBeforeDate = &bestBefore
		}
		costVal := parseDecimal(getCol(row, idxUnitCost), -1)
		if costVal >= 0 {
			rec.UnitCost = &costVal
		}

		records = append(records, rec)

		if len(records) >= batchSize {
			if err := insertDcBatch(ctx, db, records); err != nil {
				return totalLoaded, err
			}
			totalLoaded += len(records)
			if onProgress != nil {
				onProgress(totalLoaded)
			}
			records = records[:0]
		}
	}

	if len(records) > 0 {
		if err := insertDcBatch(ctx, db, records); err != nil {
			return totalLoaded, err
		}
		totalLoaded += len(records)
		if onProgress != nil {
			onProgress(totalLoaded)
		}
	}

	return totalLoaded, nil
}

func insertDcBatch(ctx context.Context, db *sql.DB, records []models.KasDcLoadRecord) error {
	if len(records) == 0 {
		return nil
	}

	var valStrings []string
	var args []any
	argIdx := 1

	for _, r := range records {
		valStrings = append(valStrings, fmt.Sprintf(
			"(@p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d)",
			argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+4, argIdx+5, argIdx+6, argIdx+7,
			argIdx+8, argIdx+9, argIdx+10, argIdx+11, argIdx+12, argIdx+13, argIdx+14,
			argIdx+15, argIdx+16, argIdx+17, argIdx+18, argIdx+19,
		))
		args = append(args,
			r.CompanyCode, r.Warehouse, r.PartCode, r.IcLotNumber, r.BinLocation,
			r.IcStatusCode, r.CreationDate, r.BatchDate, r.DcLicensePlateID, r.DcParentLicensePlateID,
			r.Uom1, r.Qty1, r.Uom2, r.Qty2, r.StatusFlag, r.RsMessageText,
			r.DcLicensePlateLine, r.UnitCost, r.IcVendorLotNumber, r.IcRetestDate,
		)
		argIdx += 20
	}

	query := fmt.Sprintf(`
		INSERT INTO [FIN].[KAS_DC_LOADS] (
			COMPANY_CODE, WAREHOUSE, PART_CODE, IC_LOT_NUMBER, BIN_LOCATION,
			IC_STATUS_CODE, CREATION_DATE, BATCH_DATE, DC_LICENSE_PLATE_ID, DC_PARENT_LICENSE_PLATE_ID,
			UOM_1, QTY_1, UOM_2, QTY_2, STATUS_FLAG, RS_MESSAGE_TEXT,
			DC_LICENSE_PLATE_LINE, UNIT_COST, IC_VENDOR_LOT_NUMBER, IC_RETEST_DATE
		) VALUES %s
	`, strings.Join(valStrings, ", "))

	_, err := db.ExecContext(ctx, query, args...)
	return err
}

func getIndex(m map[string]int, aliases ...string) int {
	for _, a := range aliases {
		if idx, ok := m[a]; ok {
			return idx
		}
	}
	return -1
}

func getCol(row []string, idx int) string {
	if idx >= 0 && idx < len(row) {
		return strings.TrimSpace(row[idx])
	}
	return ""
}

func parseDecimal(s string, def float64) float64 {
	clean := strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if clean == "" {
		return def
	}
	v, err := strconv.ParseFloat(clean, 64)
	if err != nil {
		return def
	}
	return v
}

