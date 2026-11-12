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

// SniffDomain peeks at the CSV content to detect whether it is Sales Orders or DC Inventory.
func SniffDomain(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "inventory", err
	}
	defer file.Close()

	buf := make([]byte, 4096)
	n, _ := file.Read(buf)
	content := strings.ToUpper(string(buf[:n]))

	if strings.Contains(content, "CUSTOMER") ||
		strings.Contains(content, "CUST REF") ||
		strings.Contains(content, "CUST_REF") ||
		strings.Contains(content, "SALES PRICE") ||
		strings.Contains(content, "SALES_PRICE") ||
		strings.Contains(content, "SYS_DELIVERY_DATE") ||
		strings.Contains(content, "DELIVERY CODE") ||
		strings.Contains(content, "DELIVERY_CODE") {
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
		_, _ = db.ExecContext(ctx, "IF OBJECT_ID('[FIN].[KAS_SO_LOADS]', 'U') IS NOT NULL TRUNCATE TABLE [FIN].[KAS_SO_LOADS];")
		total, err := uploadSoCsv(ctx, db, file, companyCode, division, onProgress)
		return "sales_orders", total, err
	}

	_, _ = db.ExecContext(ctx, "IF OBJECT_ID('[FIN].[KAS_DC_LOADS]', 'U') IS NOT NULL TRUNCATE TABLE [FIN].[KAS_DC_LOADS];")
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
	reader.FieldsPerRecord = -1 // Allow variable columns
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	var headerMap map[string]int
	var records []models.KasSoLoadRecord
	orderLinesMap := make(map[string]int)
	batchSize := 100 // 100 * 16 params = 1,600 params (< 2,100 limit)
	totalLoaded := 0

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		if len(row) == 0 {
			continue
		}

		firstRaw := strings.TrimSpace(row[0])
		firstClean := cleanHeaderKey(firstRaw)

		// Check if this row is comment or header
		isCommentOrHeader := strings.HasPrefix(firstRaw, "!") || strings.HasPrefix(firstRaw, "#")
		if isCommentOrHeader {
			if headerMap == nil && isSoHeaderToken(firstClean) {
				headerMap = buildHeaderMap(row)
			}
			continue
		}

		// Non-comment line: if headerMap not yet established, check if this is the header row
		if headerMap == nil {
			if isSoHeaderToken(firstClean) {
				headerMap = buildHeaderMap(row)
				continue
			}
		} else if isSoHeaderToken(firstClean) {
			// Skip repeated header row
			continue
		}

		// Field extraction with comprehensive aliases and positional fallbacks
		orderDateRaw := getField(row, headerMap, 0, "ORDERDATE", "ORDER_DATE", "DATE", "ORDDATE")
		orderDateStr := "2006-01-02"
		if d := parseDate(orderDateRaw); d != nil {
			orderDateStr = *d
		} else {
			orderDateStr = time.Now().Format("2006-01-02")
		}

		customer := getField(row, headerMap, 1, "CUSTOMER", "CUSTOMERNUMBER", "CUSTOMER_NUMBER", "CUSTOMERCODE", "CUSTOMER_CODE", "CUSTNO", "CUST_NO", "CUST")
		if len(customer) > 8 {
			customer = customer[:8]
		}
		if customer == "" {
			customer = " "
		}

		deliveryCode := getField(row, headerMap, 2, "DELIVERYCODE", "DELIVERY_CODE", "DELIVERYADDRESSCODE", "DELIVERY_ADDRESS_CODE", "SHIPTO", "SHIP_TO")
		if len(deliveryCode) > 10 {
			deliveryCode = deliveryCode[:10]
		}
		if deliveryCode == "" {
			deliveryCode = "1"
		}

		custRef := getField(row, headerMap, 3, "CUSTREF", "CUST_REF", "CUSTOMERREF", "CUSTOMER_REF", "CUSTOMERREFERENCE", "CUSTOMER_REFERENCE", "PONUMBER", "PO_NUMBER", "POREF", "PO_REF", "REF")
		if len(custRef) > 25 {
			custRef = custRef[:25]
		}
		if custRef == "" {
			custRef = " "
		}

		sysDelivRaw := getField(row, headerMap, 4, "SYSDELIVERYDATE", "SYS_DELIVERY_DATE", "DELIVERYDATE", "DELIVERY_DATE", "REQDELIVERYDATE", "REQ_DELIVERY_DATE", "REQDATE", "REQ_DATE")
		sysDelivStr := orderDateStr
		if d := parseDate(sysDelivRaw); d != nil {
			sysDelivStr = *d
		}

		wh := getField(row, headerMap, 5, "WAREHOUSE", "WH", "WAREHOUSECODE", "WAREHOUSE_CODE")
		if len(wh) > 2 {
			wh = wh[:2]
		}
		if wh == "" {
			wh = " "
		}

		part := getField(row, headerMap, 6, "ROSSPARTCODE", "ROSS_PART_CODE", "PARTCODE", "PART_CODE", "ITEM", "ITEMCODE", "ITEM_CODE", "PRODUCT", "PRODUCTCODE", "PART")
		if len(part) > 15 {
			part = part[:15]
		}
		if part == "" {
			part = " "
		}

		qty := parseDecimal(getField(row, headerMap, 7, "QUANTITY", "QUANTITY1", "QUANTITY_1", "QTY", "QTY1", "QTY_1", "ORDERQTY", "ORDER_QTY"), 0)
		price := parseDecimal(getField(row, headerMap, 8, "SALESPRICE", "SALES_PRICE", "PRICE", "UNITPRICE", "UNIT_PRICE"), 0)
		freight := parseDecimal(getField(row, headerMap, 9, "FREIGHT", "FREIGHTCHARGE", "FREIGHT_CHARGE"), 0)

		ediVal := getField(row, headerMap, 10, "EDIORDER", "EDI_ORDER", "EDI ORDER", "EDI")
		var ediOrder *string
		if ediVal != "" {
			if len(ediVal) > 1 {
				ediVal = ediVal[:1]
			}
			ediOrder = &ediVal
		}

		soNumVal := getField(row, headerMap, 11, "SALESORDERNUMBER", "SALES_ORDER_NUMBER", "SALESORDER", "SALES_ORDER", "ORDERNUMBER", "ORDER_NUMBER", "SONO", "SO_NO")
		var orderNumber *string
		if soNumVal != "" {
			if len(soNumVal) > 20 {
				soNumVal = soNumVal[:20]
			}
			orderNumber = &soNumVal
		}

		// Also allow UNIT_SALES if header explicitly provides it
		unitSalesVal := getField(row, headerMap, -1, "UNITSALES", "UNIT_SALES", "UOM", "UNIT", "SALESUNIT", "SALES_UNIT")
		var unitSales *string
		if unitSalesVal != "" {
			if len(unitSalesVal) > 10 {
				unitSalesVal = unitSalesVal[:10]
			}
			unitSales = &unitSalesVal
		}

		// Group key for multi-line order line numbering
		orderKey := fmt.Sprintf("%s|%s|%s|%s|%s", customer, deliveryCode, custRef, orderDateStr, sysDelivStr)
		orderLinesMap[orderKey]++
		lineNum := orderLinesMap[orderKey]

		rec := models.KasSoLoadRecord{
			CompanyCode:         companyCode,
			Division:            division,
			OrderNumber:         orderNumber,
			OrderLineNumber:     lineNum,
			OrderDate:           orderDateStr,
			CustomerNumber:      customer,
			DeliveryAddressCode: deliveryCode,
			CustomerReference:   custRef,
			EdiOrder:            ediOrder,
			SysDeliveryDate:     sysDelivStr,
			Warehouse:           wh,
			PartCode:            part,
			Quantity1:           qty,
			UnitSales:           unitSales,
			SalesPrice:          price,
			Freight:             freight,
			StatusFlag:          "N",
			RsMessageText:       "Staged in SQL Server [FIN].[KAS_SO_LOADS]",
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
			"(@p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d)",
			argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+4, argIdx+5, argIdx+6, argIdx+7,
			argIdx+8, argIdx+9, argIdx+10, argIdx+11, argIdx+12, argIdx+13, argIdx+14, argIdx+15,
			argIdx+16, argIdx+17,
		))
		args = append(args,
			r.CompanyCode, r.Division, r.OrderNumber, r.OrderLineNumber, r.OrderDate,
			r.CustomerNumber, r.DeliveryAddressCode, r.CustomerReference, r.EdiOrder,
			r.SysDeliveryDate, r.Warehouse, r.PartCode, strconv.FormatFloat(r.Quantity1, 'f', -1, 64),
			r.UnitSales, r.SalesPrice, r.Freight, r.StatusFlag, r.RsMessageText,
		)
		argIdx += 18
	}

	query := fmt.Sprintf(`
		INSERT INTO [FIN].[KAS_SO_LOADS] (
			COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, ORDER_DATE,
			CUSTOMER_NUMBER, DELIVERY_ADDRESS_CODE, CUSTOMER_REFERENCE, EDI_ORDER,
			SYS_DELIVERY_DATE, WAREHOUSE, PART_CODE, QUANTITY,
			UNIT_SALES, SALES_PRICE, FREIGHT, STATUS_FLAG, RS_MESSAGE_TEXT
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
	reader.FieldsPerRecord = -1 // Allow variable columns
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	var headerMap map[string]int
	var records []models.KasDcLoadRecord
	batchSize := 90 // 90 * 21 params = 1,890 params (< 2,100 limit)
	totalLoaded := 0

	// Track line numbers per LPN (mirrors GET_NEXT_LPN_LINE_NUMBER in Ross ERP)
	lpnPartLotLines := make(map[string]map[string]int)
	lpnMaxLine := make(map[string]int)

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		if len(row) == 0 {
			continue
		}

		firstRaw := strings.TrimSpace(row[0])
		firstClean := cleanHeaderKey(firstRaw)

		// Check if this row is comment or header
		isCommentOrHeader := strings.HasPrefix(firstRaw, "!") || strings.HasPrefix(firstRaw, "#")
		if isCommentOrHeader {
			if headerMap == nil && isDcHeaderToken(firstClean) {
				headerMap = buildHeaderMap(row)
			}
			continue
		}

		// Non-comment line: if headerMap not yet established, check if this is the header row
		if headerMap == nil {
			if isDcHeaderToken(firstClean) {
				headerMap = buildHeaderMap(row)
				continue
			}
		} else if isDcHeaderToken(firstClean) {
			// Skip repeated header row
			continue
		}

		// Field extraction with comprehensive aliases and positional fallbacks
		wh := getField(row, headerMap, 0, "WAREHOUSE", "WH", "WAREHOUSECODE", "WHCODE")
		if len(wh) > 2 {
			wh = wh[:2]
		}
		if wh == "" {
			wh = " "
		}

		partVal := getField(row, headerMap, 1, "PARTCODE", "PART_CODE", "ROSSPARTCODE", "PART", "ITEMCODE", "ITEM", "PRODUCT", "PRODUCTCODE")
		var partCode *string
		if partVal != "" {
			if len(partVal) > 15 {
				partVal = partVal[:15]
			}
			partCode = &partVal
		}

		lot := getField(row, headerMap, 2, "ICLOTNUMBER", "IC_LOT_NUMBER", "LOTNUMBER", "LOT_NUMBER", "LOT", "BATCHNUMBER", "BATCH")
		if len(lot) > 20 {
			lot = lot[:20]
		}
		if lot == "" {
			lot = " "
		}

		bin := getField(row, headerMap, 3, "BINLOCATION", "BIN_LOCATION", "BIN", "LOCATION")
		if len(bin) > 15 {
			bin = bin[:15]
		}
		if bin == "" {
			bin = " "
		}

		status := getField(row, headerMap, 4, "ICSTATUSCODE", "IC_STATUS_CODE", "STATUSCODE", "STATUS_CODE", "STATUS", "LOTSTATUS")
		if len(status) > 8 {
			status = status[:8]
		}
		if status == "" {
			status = "QOH"
		}

		// UOM 1 and Quantity 1
		uom1Val := getField(row, headerMap, 6, "UOM1", "UOM_1", "UOM", "PRIMARYUOM", "PRIMARY_UOM", "UNIT1", "UNIT_1", "PACKUOM")
		var uom1 *string
		if uom1Val != "" {
			if len(uom1Val) > 4 {
				uom1Val = uom1Val[:4]
			}
			uom1 = &uom1Val
		}

		qty1 := parseDecimal(getField(row, headerMap, 8, "QUANTITY1", "QUANTITY_1", "QTY1", "QTY_1", "QUANTITY", "QTY", "PRIMARYQTY", "PRIMARY_QTY"), 0)

		// UOM 2 and Quantity 2 (Catchweight)
		uom2Val := getField(row, headerMap, 7, "UOM2", "UOM_2", "SECONDARYUOM", "SECONDARY_UOM", "UNIT2", "UNIT_2", "CWUOM")
		var uom2 *string
		if uom2Val != "" {
			if len(uom2Val) > 4 {
				uom2Val = uom2Val[:4]
			}
			uom2 = &uom2Val
		}

		qty2 := parseDecimal(getField(row, headerMap, 9, "QUANTITY2", "QUANTITY_2", "QTY2", "QTY_2", "SECONDARYQTY", "SECONDARY_QTY"), 0)

		// Vendor Lot Number
		vendLot := getField(row, headerMap, 10, "ICVENDORLOTNUMBER", "IC_VENDOR_LOT_NUMBER", "VENDORLOTNUMBER", "VENDOR_LOT_NUMBER", "VENDORLOT", "VENDOR_LOT", "SUPPLIERLOT", "SUPPLIER_LOT", "SUPPLOT", "SUPP_LOT")
		if len(vendLot) > 20 {
			vendLot = vendLot[:20]
		}
		if vendLot == "" {
			vendLot = " "
		}

		// Unit Cost
		costRaw := getField(row, headerMap, 11, "UNITCOST", "UNIT_COST", "COST", "ITEMCOST", "PRICE")
		var unitCost *float64
		if costRaw != "" {
			v := parseDecimal(costRaw, -1)
			if v >= 0 {
				unitCost = &v
			}
		}

		// Dates: Best Before, Batch Date (Expiry), Retest, Creation
		bestBfRaw := getField(row, headerMap, 12, "BESTBEFOREDATE", "BEST_BEFORE_DATE", "BESTBEFORE", "BEST_BEFORE", "BESTBF", "BBD", "BESTBY")
		bestBeforeDate := parseDate(bestBfRaw)

		batchDateRaw := getField(row, headerMap, 13, "EXPIRYDATE", "EXPIRY_DATE", "BATCHDATE", "BATCH_DATE", "EXPIRY", "EXPDATE", "EXP_DATE", "EXPIRATIONDATE", "LOTEXPIRY")
		batchDate := parseDate(batchDateRaw)

		retestRaw := getField(row, headerMap, 14, "ICRETESTDATE", "IC_RETEST_DATE", "RETESTDATE", "RETEST_DATE", "RETEST")
		retestDateStr := "1858-11-17"
		if d := parseDate(retestRaw); d != nil {
			retestDateStr = *d
		}

		createRaw := getField(row, headerMap, 15, "CREATIONDATE", "CREATION_DATE", "CREATEDATE", "CREATE_DATE", "CREATE", "CREATED", "DATE")
		creationDateStr := "2006-01-02"
		if d := parseDate(createRaw); d != nil {
			creationDateStr = *d
		} else {
			creationDateStr = time.Now().Format("2006-01-02")
		}

		// License Plate ID (LPN)
		lpn := getField(row, headerMap, 16, "DCLICENSEPLATEID", "DC_LICENSE_PLATE_ID", "LPNNUMBER", "LPN_NUMBER", "LPNID", "LPN_ID", "LPN", "LP_NUMBER", "LPNUMBER", "LICENSEPLATE", "MHNUMBER", "MH_NUMBER", "MH")
		if len(lpn) > 30 {
			lpn = lpn[:30]
		}
		if lpn == "" {
			lpn = " "
		}

		parentLpn := getField(row, headerMap, -1, "DCPARENTLICENSEPLATEID", "DC_PARENT_LICENSE_PLATE_ID", "PARENTLPNNUMBER", "PARENT_LPN_NUMBER", "PARENTLPNID", "PARENT_LPN_ID", "PARENTLPN", "PARENT_LPN")
		if len(parentLpn) > 30 {
			parentLpn = parentLpn[:30]
		}

		// Calculate LPN Line Number per Ross ERP GET_NEXT_LPN_LINE_NUMBER rule
		assignedLine := 1
		if lpn != " " && lpn != "" {
			partKey := ""
			if partCode != nil {
				partKey = *partCode
			}
			plKey := fmt.Sprintf("%s|%s", partKey, lot)

			pMap, ok := lpnPartLotLines[lpn]
			if !ok {
				pMap = make(map[string]int)
				lpnPartLotLines[lpn] = pMap
				lpnMaxLine[lpn] = 0
			}

			if existingLine, exists := pMap[plKey]; exists {
				assignedLine = existingLine
			} else {
				nextLine := lpnMaxLine[lpn] + 1
				lpnMaxLine[lpn] = nextLine
				pMap[plKey] = nextLine
				assignedLine = nextLine
			}
		}

		rec := models.KasDcLoadRecord{
			CompanyCode:            companyCode,
			Warehouse:              wh,
			PartCode:               partCode,
			IcLotNumber:            lot,
			BinLocation:            bin,
			IcStatusCode:           status,
			CreationDate:           creationDateStr,
			BatchDate:              batchDate,
			DcLicensePlateID:       lpn,
			DcParentLicensePlateID: parentLpn,
			Uom1:                   uom1,
			Qty1:                   qty1,
			Uom2:                   uom2,
			Qty2:                   qty2,
			StatusFlag:             " ",
			RsMessageText:          "Staged in SQL Server [FIN].[KAS_DC_LOADS]",
			DcLicensePlateLine:     assignedLine,
			UnitCost:               unitCost,
			IcVendorLotNumber:      vendLot,
			BestBeforeDate:         bestBeforeDate,
			IcRetestDate:           retestDateStr,
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
			"(@p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d, @p%d)",
			argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+4, argIdx+5, argIdx+6, argIdx+7,
			argIdx+8, argIdx+9, argIdx+10, argIdx+11, argIdx+12, argIdx+13, argIdx+14,
			argIdx+15, argIdx+16, argIdx+17, argIdx+18, argIdx+19, argIdx+20,
		))
		args = append(args,
			r.CompanyCode, r.Warehouse, r.PartCode, r.IcLotNumber, r.BinLocation,
			r.IcStatusCode, r.CreationDate, r.BatchDate, r.DcLicensePlateID, r.DcParentLicensePlateID,
			r.Uom1, r.Qty1, r.Uom2, r.Qty2, r.StatusFlag, r.RsMessageText,
			r.DcLicensePlateLine, r.UnitCost, r.IcVendorLotNumber, r.BestBeforeDate, r.IcRetestDate,
		)
		argIdx += 21
	}

	query := fmt.Sprintf(`
		INSERT INTO [FIN].[KAS_DC_LOADS] (
			COMPANY_CODE, WAREHOUSE, PART_CODE, IC_LOT_NUMBER, BIN_LOCATION,
			IC_STATUS_CODE, CREATION_DATE, BATCH_DATE, DC_LICENSE_PLATE_ID, DC_PARENT_LICENSE_PLATE_ID,
			UOM_1, QTY_1, UOM_2, QTY_2, STATUS_FLAG, RS_MESSAGE_TEXT,
			DC_LICENSE_PLATE_LINE, UNIT_COST, IC_VENDOR_LOT_NUMBER, BEST_BEFORE_DATE, IC_RETEST_DATE
		) VALUES %s
	`, strings.Join(valStrings, ", "))

	_, err := db.ExecContext(ctx, query, args...)
	return err
}

// cleanHeaderKey normalizes a CSV column name by removing all punctuation, BOM, and whitespace.
func cleanHeaderKey(s string) string {
	s = strings.TrimLeft(s, "\ufeff!# ")
	s = strings.ToUpper(s)
	var b strings.Builder
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func buildHeaderMap(header []string) map[string]int {
	m := make(map[string]int)
	for i, col := range header {
		key := cleanHeaderKey(col)
		if key != "" {
			m[key] = i
		}
	}
	return m
}

func getField(row []string, headerMap map[string]int, fallbackIdx int, aliases ...string) string {
	if headerMap != nil {
		for _, a := range aliases {
			clean := cleanHeaderKey(a)
			if idx, ok := headerMap[clean]; ok {
				if idx >= 0 && idx < len(row) {
					return strings.TrimSpace(row[idx])
				}
			}
		}
	}
	if fallbackIdx >= 0 && fallbackIdx < len(row) {
		return strings.TrimSpace(row[fallbackIdx])
	}
	return ""
}

func isDcHeaderToken(token string) bool {
	return token == "WH" || token == "WAREHOUSE" || token == "PART" || token == "PARTCODE" || token == "LOT" || token == "LPN"
}

func isSoHeaderToken(token string) bool {
	return token == "ORDERDATE" || token == "ORDER" || token == "CUSTOMER" || token == "CUSTREF" || token == "SALESPRICE" || token == "EDIORDER" || token == "EDI"
}

func parseDecimal(s string, def float64) float64 {
	clean := strings.TrimSpace(s)
	clean = strings.ReplaceAll(clean, ",", "")
	clean = strings.ReplaceAll(clean, "$", "")
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, "\"", "")
	if clean == "" {
		return def
	}
	v, err := strconv.ParseFloat(clean, 64)
	if err != nil {
		return def
	}
	return v
}

var monthMap = map[string]string{
	"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
	"MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
	"SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
}

// parseDate normalizes varied date representations into standard YYYY-MM-DD format for SQL Server.
func parseDate(dateStr string) *string {
	s := strings.TrimSpace(dateStr)
	s = strings.Trim(s, "\"")
	if s == "" || strings.EqualFold(s, "NULL") || s == "1858-11-17" || strings.HasPrefix(s, "1858") {
		return nil
	}
	if strings.HasPrefix(strings.ToUpper(s), "%TODAY") || strings.EqualFold(s, "TODAY") {
		now := time.Now().Format("2006-01-02")
		return &now
	}

	// 1. Match DD-MMM-YYYY or DD-MMM-YY (e.g. 15-JUL-2027, 15-Jul-27, 10-Mar-2025)
	if parts := strings.Split(s, "-"); len(parts) == 3 {
		dayStr := strings.TrimSpace(parts[0])
		mStr := strings.ToUpper(strings.TrimSpace(parts[1]))
		yrStr := strings.TrimSpace(parts[2])

		if mCode, ok := monthMap[mStr]; ok {
			day, errD := strconv.Atoi(dayStr)
			if errD == nil && day >= 1 && day <= 31 {
				yr, errY := strconv.Atoi(yrStr)
				if errY == nil {
					if yr < 100 {
						if yr > 50 {
							yr += 1900
						} else {
							yr += 2000
						}
					}
					res := fmt.Sprintf("%04d-%s-%02d", yr, mCode, day)
					return &res
				}
			}
		}
	}

	// 2. Match YYYY-MM-DD
	if len(s) >= 10 && s[4] == '-' && s[7] == '-' {
		res := s[:10]
		return &res
	}

	// 3. Match YYYY/MM/DD
	if len(s) >= 10 && s[4] == '/' && s[7] == '/' {
		res := strings.ReplaceAll(s[:10], "/", "-")
		return &res
	}

	// 4. Try common time formats
	layouts := []string{
		"02-Jan-2006",
		"02-Jan-06",
		"01/02/2006",
		"02/01/2006",
		"01-02-2006",
		"02-01-2006",
		"1/2/2006",
		"2/1/2006",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			res := t.Format("2006-01-02")
			return &res
		}
	}

	return &s
}
