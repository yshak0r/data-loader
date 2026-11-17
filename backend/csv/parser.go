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

	"dc-loader-wails/backend/database"
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

// UploadCsv streams a CSV file into the appropriate staging table using dynamic schema introspection.
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

	// Always invalidate schema cache to ensure any recent DDL alterations are immediately picked up
	database.InvalidateSchemaCache(domain)

	// Query physical table schema from SQL Server
	schemaCols, _, err := database.QueryTableSchema(ctx, db, domain)
	if err != nil {
		return domain, 0, fmt.Errorf("failed to introspect staging schema: %w", err)
	}

	// Filter out IDENTITY columns (e.g. ID or GEM_DBKEY) which cannot be inserted directly
	var targetCols []models.ColumnDefinition
	for _, c := range schemaCols {
		if c.IsIdentity || strings.EqualFold(c.Name, "ID") || (domain == "inventory" && strings.EqualFold(c.Name, "GEM_DBKEY")) {
			continue
		}
		targetCols = append(targetCols, c)
	}

	if domain == "sales_orders" {
		_, _ = db.ExecContext(ctx, "IF OBJECT_ID('[FIN].[KAS_SO_LOADS]', 'U') IS NOT NULL TRUNCATE TABLE [FIN].[KAS_SO_LOADS];")
		total, err := uploadSoCsv(ctx, db, file, targetCols, companyCode, division, onProgress)
		return "sales_orders", total, err
	}

	_, _ = db.ExecContext(ctx, "IF OBJECT_ID('[FIN].[KAS_DC_LOADS]', 'U') IS NOT NULL TRUNCATE TABLE [FIN].[KAS_DC_LOADS];")
	total, err := uploadDcCsv(ctx, db, file, targetCols, companyCode, onProgress)
	return "inventory", total, err
}

type columnBinding struct {
	Col            models.ColumnDefinition
	CsvIndex       int
	IsSystem       bool
	SystemVal      string
	IsComputedLine bool
}

var soStandardAliases = map[string][]string{
	"ORDER_DATE":            {"ORDERDATE", "ORDER_DATE", "DATE", "ORDDATE"},
	"CUSTOMER_NUMBER":       {"CUSTOMER", "CUSTOMERNUMBER", "CUSTOMER_NUMBER", "CUSTOMERCODE", "CUSTOMER_CODE", "CUSTNO", "CUST_NO", "CUST"},
	"DELIVERY_ADDRESS_CODE": {"DELIVERYCODE", "DELIVERY_CODE", "DELIVERYADDRESSCODE", "DELIVERY_ADDRESS_CODE", "SHIPTO", "SHIP_TO"},
	"CUSTOMER_REFERENCE":    {"CUSTREF", "CUST_REF", "CUSTOMERREF", "CUSTOMER_REF", "CUSTOMERREFERENCE", "CUSTOMER_REFERENCE", "PONUMBER", "PO_NUMBER", "POREF", "PO_REF", "REF"},
	"SYS_DELIVERY_DATE":     {"SYSDELIVERYDATE", "SYS_DELIVERY_DATE", "DELIVERYDATE", "DELIVERY_DATE", "REQDELIVERYDATE", "REQ_DELIVERY_DATE", "REQDATE", "REQ_DATE"},
	"WAREHOUSE":             {"WAREHOUSE", "WH", "WAREHOUSECODE", "WAREHOUSE_CODE"},
	"PART_CODE":             {"ROSSPARTCODE", "ROSS_PART_CODE", "PARTCODE", "PART_CODE", "ITEM", "ITEMCODE", "ITEM_CODE", "PRODUCT", "PRODUCTCODE", "PART"},
	"QUANTITY":              {"QUANTITY", "QUANTITY1", "QUANTITY_1", "QTY", "QTY1", "QTY_1", "ORDERQTY", "ORDER_QTY"},
	"SALES_PRICE":           {"SALESPRICE", "SALES_PRICE", "PRICE", "UNITPRICE", "UNIT_PRICE"},
	"FREIGHT":               {"FREIGHT", "FREIGHTCHARGE", "FREIGHT_CHARGE"},
	"EDI_ORDER":             {"EDIORDER", "EDI_ORDER", "EDI ORDER", "EDI"},
	"ORDER_NUMBER":          {"SALESORDERNUMBER", "SALES_ORDER_NUMBER", "SALESORDER", "SALES_ORDER", "ORDERNUMBER", "ORDER_NUMBER", "SONO", "SO_NO"},
	"UNIT_SALES":            {"UNITSALES", "UNIT_SALES", "UOM", "UNIT", "SALESUNIT", "SALES_UNIT"},
}

var soPositionalFallbacks = map[string]int{
	"ORDER_DATE":            0,
	"CUSTOMER_NUMBER":       1,
	"DELIVERY_ADDRESS_CODE": 2,
	"CUSTOMER_REFERENCE":    3,
	"SYS_DELIVERY_DATE":     4,
	"WAREHOUSE":             5,
	"PART_CODE":             6,
	"QUANTITY":              7,
	"SALES_PRICE":           8,
	"FREIGHT":               9,
	"EDI_ORDER":             10,
	"ORDER_NUMBER":          11,
	"UNIT_SALES":            -1,
}

var dcStandardAliases = map[string][]string{
	"WAREHOUSE":                  {"WAREHOUSE", "WH", "WAREHOUSECODE", "WHCODE"},
	"PART_CODE":                  {"PARTCODE", "PART_CODE", "ROSSPARTCODE", "PART", "ITEMCODE", "ITEM", "PRODUCT", "PRODUCTCODE"},
	"IC_LOT_NUMBER":              {"ICLOTNUMBER", "IC_LOT_NUMBER", "LOTNUMBER", "LOT_NUMBER", "LOT", "BATCHNUMBER", "BATCH"},
	"BIN_LOCATION":               {"BINLOCATION", "BIN_LOCATION", "BIN", "LOCATION"},
	"IC_STATUS_CODE":             {"ICSTATUSCODE", "IC_STATUS_CODE", "STATUSCODE", "STATUS_CODE", "STATUS", "LOTSTATUS"},
	"UOM_1":                      {"UOM1", "UOM_1", "UOM", "PRIMARYUOM", "PRIMARY_UOM", "UNIT1", "UNIT_1", "PACKUOM"},
	"QTY_1":                      {"QUANTITY1", "QUANTITY_1", "QTY1", "QTY_1", "QUANTITY", "QTY", "PRIMARYQTY", "PRIMARY_QTY"},
	"UOM_2":                      {"UOM2", "UOM_2", "SECONDARYUOM", "SECONDARY_UOM", "UNIT2", "UNIT_2", "CWUOM"},
	"QTY_2":                      {"QUANTITY2", "QUANTITY_2", "QTY2", "QTY_2", "SECONDARYQTY", "SECONDARY_QTY"},
	"IC_VENDOR_LOT_NUMBER":       {"ICVENDORLOTNUMBER", "IC_VENDOR_LOT_NUMBER", "VENDORLOTNUMBER", "VENDOR_LOT_NUMBER", "VENDORLOT", "VENDOR_LOT", "SUPPLIERLOT", "SUPPLIER_LOT", "SUPPLOT", "SUPP_LOT"},
	"UNIT_COST":                  {"UNITCOST", "UNIT_COST", "COST", "ITEMCOST", "PRICE"},
	"BEST_BEFORE_DATE":           {"BESTBEFOREDATE", "BEST_BEFORE_DATE", "BESTBEFORE", "BEST_BEFORE", "BESTBF", "BBD", "BESTBY"},
	"BATCH_DATE":                 {"EXPIRYDATE", "EXPIRY_DATE", "BATCHDATE", "BATCH_DATE", "EXPIRY", "EXPDATE", "EXP_DATE", "EXPIRATIONDATE", "LOTEXPIRY"},
	"IC_RETEST_DATE":             {"ICRETESTDATE", "IC_RETEST_DATE", "RETESTDATE", "RETEST_DATE", "RETEST"},
	"CREATION_DATE":              {"CREATIONDATE", "CREATION_DATE", "CREATEDATE", "CREATE_DATE", "CREATE", "CREATED", "DATE"},
	"DC_LICENSE_PLATE_ID":        {"DCLICENSEPLATEID", "DC_LICENSE_PLATE_ID", "LPNNUMBER", "LPN_NUMBER", "LPNID", "LPN_ID", "LPN", "LP_NUMBER", "LPNUMBER", "LICENSEPLATE", "MHNUMBER", "MH_NUMBER", "MH"},
	"DC_PARENT_LICENSE_PLATE_ID": {"DCPARENTLICENSEPLATEID", "DC_PARENT_LICENSE_PLATE_ID", "PARENTLPNNUMBER", "PARENT_LPN_NUMBER", "PARENTLPNID", "PARENT_LPN_ID", "PARENTLPN", "PARENT_LPN"},
}

var dcPositionalFallbacks = map[string]int{
	"WAREHOUSE":                  0,
	"PART_CODE":                  1,
	"IC_LOT_NUMBER":              2,
	"BIN_LOCATION":               3,
	"IC_STATUS_CODE":             4,
	"UOM_1":                      6,
	"QTY_1":                      8,
	"UOM_2":                      7,
	"QTY_2":                      9,
	"IC_VENDOR_LOT_NUMBER":       10,
	"UNIT_COST":                  11,
	"BEST_BEFORE_DATE":           12,
	"BATCH_DATE":                 13,
	"IC_RETEST_DATE":             14,
	"CREATION_DATE":              15,
	"DC_LICENSE_PLATE_ID":        16,
	"DC_PARENT_LICENSE_PLATE_ID": -1,
}

func bindColumns(
	targetCols []models.ColumnDefinition,
	headerMap map[string]int,
	isSO bool,
	companyCode string,
	division string,
) []columnBinding {
	bindings := make([]columnBinding, len(targetCols))
	aliasesMap := dcStandardAliases
	fallbacksMap := dcPositionalFallbacks
	if isSO {
		aliasesMap = soStandardAliases
		fallbacksMap = soPositionalFallbacks
	}

	for i, col := range targetCols {
		upperName := strings.ToUpper(col.Name)
		b := columnBinding{
			Col:      col,
			CsvIndex: -1,
		}

		switch upperName {
		case "COMPANY_CODE":
			b.IsSystem = true
			b.SystemVal = companyCode
		case "DIVISION":
			b.IsSystem = true
			b.SystemVal = division
		case "STATUS_FLAG":
			b.IsSystem = true
			if isSO {
				b.SystemVal = "N"
			} else {
				b.SystemVal = " "
			}
		case "RS_MESSAGE_TEXT":
			b.IsSystem = true
			if isSO {
				b.SystemVal = "Staged in SQL Server [FIN].[KAS_SO_LOADS]"
			} else {
				b.SystemVal = "Staged in SQL Server [FIN].[KAS_DC_LOADS]"
			}
		case "ORDER_LINE_NUMBER", "DC_LICENSE_PLATE_LINE":
			b.IsComputedLine = true
		default:
			if headerMap != nil {
				// 1. Try known aliases
				if aliases, exists := aliasesMap[upperName]; exists {
					for _, alias := range aliases {
						if idx, ok := headerMap[cleanHeaderKey(alias)]; ok {
							b.CsvIndex = idx
							break
						}
					}
				}
				// 2. Direct clean name match
				if b.CsvIndex == -1 {
					cleanName := cleanHeaderKey(col.Name)
					if idx, ok := headerMap[cleanName]; ok {
						b.CsvIndex = idx
					}
				}
			} else {
				// Positional fallback for legacy headerless files
				if fallback, exists := fallbacksMap[upperName]; exists {
					b.CsvIndex = fallback
				}
			}
		}

		bindings[i] = b
	}

	return bindings
}

func uploadSoCsv(
	ctx context.Context,
	db *sql.DB,
	r io.Reader,
	targetCols []models.ColumnDefinition,
	companyCode string,
	division string,
	onProgress ProgressCallback,
) (int, error) {
	reader := csv.NewReader(bufio.NewReader(r))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	var headerMap map[string]int
	var bindings []columnBinding
	var rowsBatch [][]any
	orderLinesMap := make(map[string]int)

	batchSize := 100
	if len(targetCols) > 0 {
		batchSize = 2000 / len(targetCols)
		if batchSize < 10 {
			batchSize = 10
		} else if batchSize > 150 {
			batchSize = 150
		}
	}
	totalLoaded := 0

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(row) == 0 {
			continue
		}

		firstRaw := strings.TrimSpace(row[0])
		isComment := strings.HasPrefix(firstRaw, "!") || strings.HasPrefix(firstRaw, "#")

		if isComment {
			if headerMap == nil && isSoHeaderRow(row) {
				headerMap = buildHeaderMap(row)
				bindings = bindColumns(targetCols, headerMap, true, companyCode, division)
			}
			continue
		}

		if headerMap == nil {
			if isSoHeaderRow(row) {
				headerMap = buildHeaderMap(row)
				bindings = bindColumns(targetCols, headerMap, true, companyCode, division)
				continue
			}
			// Headerless CSV encounter: bind with fallbacks
			bindings = bindColumns(targetCols, nil, true, companyCode, division)
		} else if isSoHeaderRow(row) {
			// Skip repeated headers
			continue
		}

		// Calculate order key for line numbering
		orderDateRaw := getField(row, headerMap, 0, "ORDERDATE", "ORDER_DATE", "DATE", "ORDDATE")
		orderDateStr := "2006-01-02"
		if d := parseDate(orderDateRaw); d != nil {
			orderDateStr = *d
		} else {
			orderDateStr = time.Now().Format("2006-01-02")
		}

		customer := getField(row, headerMap, 1, "CUSTOMER", "CUSTOMERNUMBER", "CUSTOMER_NUMBER", "CUSTOMERCODE", "CUSTOMER_CODE", "CUSTNO", "CUST_NO", "CUST")
		if customer == "" {
			customer = " "
		}
		deliveryCode := getField(row, headerMap, 2, "DELIVERYCODE", "DELIVERY_CODE", "DELIVERYADDRESSCODE", "DELIVERY_ADDRESS_CODE", "SHIPTO", "SHIP_TO")
		if deliveryCode == "" {
			deliveryCode = "1"
		}
		custRef := getField(row, headerMap, 3, "CUSTREF", "CUST_REF", "CUSTOMERREF", "CUSTOMER_REF", "CUSTOMERREFERENCE", "CUSTOMER_REFERENCE", "PONUMBER", "PO_NUMBER", "POREF", "PO_REF", "REF")
		if custRef == "" {
			custRef = " "
		}
		sysDelivRaw := getField(row, headerMap, 4, "SYSDELIVERYDATE", "SYS_DELIVERY_DATE", "DELIVERYDATE", "DELIVERY_DATE", "REQDELIVERYDATE", "REQ_DELIVERY_DATE", "REQDATE", "REQ_DATE")
		sysDelivStr := orderDateStr
		if d := parseDate(sysDelivRaw); d != nil {
			sysDelivStr = *d
		}

		orderKey := fmt.Sprintf("%s|%s|%s|%s|%s", customer, deliveryCode, custRef, orderDateStr, sysDelivStr)
		orderLinesMap[orderKey]++
		lineNum := orderLinesMap[orderKey]

		// Format row according to targetCols
		rowVals := make([]any, len(bindings))
		for i, b := range bindings {
			if b.IsSystem {
				rowVals[i] = b.SystemVal
				continue
			}
			if b.IsComputedLine {
				rowVals[i] = lineNum
				continue
			}

			raw := ""
			if b.CsvIndex >= 0 && b.CsvIndex < len(row) {
				raw = strings.TrimSpace(row[b.CsvIndex])
			}

			// Apply standard business defaults if raw is blank
			upper := strings.ToUpper(b.Col.Name)
			if raw == "" {
				switch upper {
				case "ORDER_DATE":
					raw = orderDateStr
				case "SYS_DELIVERY_DATE":
					raw = sysDelivStr
				case "CUSTOMER_NUMBER":
					raw = customer
				case "DELIVERY_ADDRESS_CODE":
					raw = deliveryCode
				case "CUSTOMER_REFERENCE":
					raw = custRef
				case "WAREHOUSE", "PART_CODE":
					raw = " "
				}
			}

			rowVals[i] = formatColumnValue(b.Col, raw)
		}

		rowsBatch = append(rowsBatch, rowVals)
		if len(rowsBatch) >= batchSize {
			if err := insertDynamicBatch(ctx, db, "[FIN].[KAS_SO_LOADS]", targetCols, rowsBatch); err != nil {
				return totalLoaded, err
			}
			totalLoaded += len(rowsBatch)
			if onProgress != nil {
				onProgress(totalLoaded)
			}
			rowsBatch = rowsBatch[:0]
		}
	}

	if len(rowsBatch) > 0 {
		if err := insertDynamicBatch(ctx, db, "[FIN].[KAS_SO_LOADS]", targetCols, rowsBatch); err != nil {
			return totalLoaded, err
		}
		totalLoaded += len(rowsBatch)
		if onProgress != nil {
			onProgress(totalLoaded)
		}
	}

	return totalLoaded, nil
}

func uploadDcCsv(
	ctx context.Context,
	db *sql.DB,
	r io.Reader,
	targetCols []models.ColumnDefinition,
	companyCode string,
	onProgress ProgressCallback,
) (int, error) {
	reader := csv.NewReader(bufio.NewReader(r))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	var headerMap map[string]int
	var bindings []columnBinding
	var rowsBatch [][]any

	lpnPartLotLines := make(map[string]map[string]int)
	lpnMaxLine := make(map[string]int)

	batchSize := 90
	if len(targetCols) > 0 {
		batchSize = 2000 / len(targetCols)
		if batchSize < 10 {
			batchSize = 10
		} else if batchSize > 150 {
			batchSize = 150
		}
	}
	totalLoaded := 0

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(row) == 0 {
			continue
		}

		firstRaw := strings.TrimSpace(row[0])
		isComment := strings.HasPrefix(firstRaw, "!") || strings.HasPrefix(firstRaw, "#")

		if isComment {
			if headerMap == nil && isDcHeaderRow(row) {
				headerMap = buildHeaderMap(row)
				bindings = bindColumns(targetCols, headerMap, false, companyCode, "1")
			}
			continue
		}

		if headerMap == nil {
			if isDcHeaderRow(row) {
				headerMap = buildHeaderMap(row)
				bindings = bindColumns(targetCols, headerMap, false, companyCode, "1")
				continue
			}
			// Headerless CSV encounter: bind with fallbacks
			bindings = bindColumns(targetCols, nil, false, companyCode, "1")
		} else if isDcHeaderRow(row) {
			// Skip repeated headers
			continue
		}

		// Calculate LPN Line Number per Ross ERP GET_NEXT_LPN_LINE_NUMBER rule
		partVal := getField(row, headerMap, 1, "PARTCODE", "PART_CODE", "ROSSPARTCODE", "PART", "ITEMCODE", "ITEM", "PRODUCT", "PRODUCTCODE")
		lot := getField(row, headerMap, 2, "ICLOTNUMBER", "IC_LOT_NUMBER", "LOTNUMBER", "LOT_NUMBER", "LOT", "BATCHNUMBER", "BATCH")
		lpn := getField(row, headerMap, 16, "DCLICENSEPLATEID", "DC_LICENSE_PLATE_ID", "LPNNUMBER", "LPN_NUMBER", "LPNID", "LPN_ID", "LPN", "LP_NUMBER", "LPNUMBER", "LICENSEPLATE", "MHNUMBER", "MH_NUMBER", "MH")
		if len(lpn) > 30 {
			lpn = lpn[:30]
		}
		if lpn == "" {
			lpn = " "
		}

		assignedLine := 1
		if lpn != " " && lpn != "" {
			plKey := fmt.Sprintf("%s|%s", partVal, lot)
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

		// Format row according to targetCols
		rowVals := make([]any, len(bindings))
		for i, b := range bindings {
			if b.IsSystem {
				rowVals[i] = b.SystemVal
				continue
			}
			if b.IsComputedLine {
				rowVals[i] = assignedLine
				continue
			}

			raw := ""
			if b.CsvIndex >= 0 && b.CsvIndex < len(row) {
				raw = strings.TrimSpace(row[b.CsvIndex])
			}

			// Apply standard business defaults if raw is blank
			upper := strings.ToUpper(b.Col.Name)
			if raw == "" {
				switch upper {
				case "WAREHOUSE", "IC_LOT_NUMBER", "BIN_LOCATION", "DC_LICENSE_PLATE_ID":
					raw = " "
				case "IC_STATUS_CODE":
					raw = "QOH"
				case "CREATION_DATE":
					raw = time.Now().Format("2006-01-02")
				case "IC_RETEST_DATE":
					raw = "1858-11-17"
				}
			}

			rowVals[i] = formatColumnValue(b.Col, raw)
		}

		rowsBatch = append(rowsBatch, rowVals)
		if len(rowsBatch) >= batchSize {
			if err := insertDynamicBatch(ctx, db, "[FIN].[KAS_DC_LOADS]", targetCols, rowsBatch); err != nil {
				return totalLoaded, err
			}
			totalLoaded += len(rowsBatch)
			if onProgress != nil {
				onProgress(totalLoaded)
			}
			rowsBatch = rowsBatch[:0]
		}
	}

	if len(rowsBatch) > 0 {
		if err := insertDynamicBatch(ctx, db, "[FIN].[KAS_DC_LOADS]", targetCols, rowsBatch); err != nil {
			return totalLoaded, err
		}
		totalLoaded += len(rowsBatch)
		if onProgress != nil {
			onProgress(totalLoaded)
		}
	}

	return totalLoaded, nil
}

func insertDynamicBatch(ctx context.Context, db *sql.DB, tableName string, cols []models.ColumnDefinition, rows [][]any) error {
	if len(rows) == 0 {
		return nil
	}
	numCols := len(cols)
	var colNames []string
	for _, c := range cols {
		colNames = append(colNames, fmt.Sprintf("[%s]", c.Name))
	}
	colList := strings.Join(colNames, ", ")

	var valStrings []string
	var args []any
	argIdx := 1

	for _, r := range rows {
		var placeholders []string
		for i := 0; i < numCols; i++ {
			placeholders = append(placeholders, fmt.Sprintf("@p%d", argIdx))
			args = append(args, r[i])
			argIdx++
		}
		valStrings = append(valStrings, fmt.Sprintf("(%s)", strings.Join(placeholders, ", ")))
	}

	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES %s", tableName, colList, strings.Join(valStrings, ", "))
	_, err := db.ExecContext(ctx, query, args...)
	return err
}

func formatColumnValue(col models.ColumnDefinition, raw string) any {
	raw = strings.TrimSpace(raw)
	lowerType := strings.ToLower(col.DataType)

	if strings.Contains(lowerType, "datetime") || lowerType == "date" {
		if d := parseDate(raw); d != nil {
			return *d
		}
		if !col.IsNullable {
			if strings.EqualFold(col.Name, "IC_RETEST_DATE") {
				return "1858-11-17"
			}
			return time.Now().Format("2006-01-02")
		}
		return nil
	}

	if strings.Contains(lowerType, "decimal") || strings.Contains(lowerType, "numeric") || strings.Contains(lowerType, "money") || strings.Contains(lowerType, "float") {
		if raw == "" {
			if col.IsNullable {
				return nil
			}
			return 0.0
		}
		return parseDecimal(raw, 0)
	}

	if strings.Contains(lowerType, "int") || lowerType == "tinyint" || lowerType == "smallint" {
		if raw == "" {
			if col.IsNullable {
				return nil
			}
			return 0
		}
		clean := raw
		if dot := strings.Index(clean, "."); dot >= 0 {
			clean = clean[:dot]
		}
		v, err := strconv.Atoi(clean)
		if err != nil {
			if col.IsNullable {
				return nil
			}
			return 0
		}
		return v
	}

	if strings.Contains(lowerType, "bigint") {
		if raw == "" {
			if col.IsNullable {
				return nil
			}
			return int64(0)
		}
		clean := raw
		if dot := strings.Index(clean, "."); dot >= 0 {
			clean = clean[:dot]
		}
		v, err := strconv.ParseInt(clean, 10, 64)
		if err != nil {
			if col.IsNullable {
				return nil
			}
			return int64(0)
		}
		return v
	}

	if lowerType == "bit" {
		if strings.EqualFold(raw, "true") || raw == "1" || strings.EqualFold(raw, "yes") || strings.EqualFold(raw, "y") {
			return 1
		}
		return 0
	}

	// Textual types: varchar, nvarchar, char, etc.
	if col.MaxLength > 0 && len(raw) > col.MaxLength {
		raw = raw[:col.MaxLength]
	}

	if raw == "" {
		if col.IsNullable {
			return nil
		}
		return " "
	}

	return raw
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

func isDcHeaderRow(row []string) bool {
	for _, cell := range row {
		if isDcHeaderToken(cleanHeaderKey(cell)) {
			return true
		}
	}
	return false
}

func isSoHeaderRow(row []string) bool {
	for _, cell := range row {
		if isSoHeaderToken(cleanHeaderKey(cell)) {
			return true
		}
	}
	return false
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
