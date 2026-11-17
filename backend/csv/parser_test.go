package csv

import (
	"testing"

	"dc-loader-wails/backend/models"
)

func TestParseDate(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"15-JUL-2027", "2027-07-15"},
		{"10-Mar-2025", "2025-03-10"},
		{"15-Jul-27", "2027-07-15"},
		{"2026-04-21", "2026-04-21"},
		{"2026/04/21", "2026-04-21"},
		{"", ""},
		{"NULL", ""},
		{"1858-11-17", ""},
	}

	for _, tt := range tests {
		res := parseDate(tt.input)
		if tt.expected == "" {
			if res != nil {
				t.Errorf("parseDate(%q) expected nil, got %v", tt.input, *res)
			}
		} else {
			if res == nil || *res != tt.expected {
				t.Errorf("parseDate(%q) expected %q, got %v", tt.input, tt.expected, res)
			}
		}
	}
}

func TestCleanHeaderKey(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"!WH", "WH"},
		{" Quantity ", "QUANTITY"},
		{"UOM 1", "UOM1"},
		{"UOM_1", "UOM1"},
		{"QUANTITY 1", "QUANTITY1"},
		{"ROSS Part code", "ROSSPARTCODE"},
		{"BEST BEFORE DATE", "BESTBEFOREDATE"},
		{"EXPIRY DATE", "EXPIRYDATE"},
		{"IC VENDOR LOTNUMBER", "ICVENDORLOTNUMBER"},
		{"IC_VENDOR_LOT_NUMBER", "ICVENDORLOTNUMBER"},
		{"SYS_DELIVERY_DATE", "SYSDELIVERYDATE"},
	}

	for _, tt := range tests {
		got := cleanHeaderKey(tt.input)
		if got != tt.expected {
			t.Errorf("cleanHeaderKey(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestGetFieldAliases(t *testing.T) {
	header := []string{"!WH", "PART", "LOT", "BIN", "STATUS", "MH", "UOM 1", "UOM 2", "QUANTITY 1", "QUANTITY 2", "SUPP_LOT", "COST", "BEST BEFORE DATE", "EXPIRY DATE", "RETEST DATE", "CREATE DATE", "LPN NUMBER"}
	hMap := buildHeaderMap(header)

	row := []string{"10", "1000", "LOT01", "A-01", "QOH", "", "LBS", "", "100.5", "", "VEND99", "12.50", "15-JUL-2027", "15-JUL-2027", "", "2026-04-21", "LPN123"}

	uom1 := getField(row, hMap, 6, "UOM1", "UOM_1", "UOM")
	if uom1 != "LBS" {
		t.Errorf("expected UOM1 to be LBS, got %q", uom1)
	}

	qty1 := parseDecimal(getField(row, hMap, 8, "QUANTITY1", "QUANTITY_1", "QTY1", "QTY_1", "QUANTITY", "QTY"), 0)
	if qty1 != 100.5 {
		t.Errorf("expected QTY1 to be 100.5, got %v", qty1)
	}

	bestBf := getField(row, hMap, 12, "BESTBEFOREDATE", "BEST_BEFORE_DATE", "BESTBF")
	if bestBf != "15-JUL-2027" {
		t.Errorf("expected BEST_BEFORE_DATE to be 15-JUL-2027, got %q", bestBf)
	}

	batchDate := getField(row, hMap, 13, "EXPIRYDATE", "EXPIRY_DATE", "BATCHDATE", "BATCH_DATE")
	if batchDate != "15-JUL-2027" {
		t.Errorf("expected EXPIRY_DATE to be 15-JUL-2027, got %q", batchDate)
	}

	dateParsed := parseDate(batchDate)
	if dateParsed == nil || *dateParsed != "2027-07-15" {
		t.Errorf("expected dateParsed to be 2027-07-15, got %v", dateParsed)
	}

	// Verify PARENT LPN is empty when not provided in CSV
	parentLpn := getField(row, hMap, -1, "DCPARENTLICENSEPLATEID", "DC_PARENT_LICENSE_PLATE_ID", "PARENTLPNNUMBER", "PARENT_LPN_NUMBER", "PARENTLPNID", "PARENT_LPN_ID", "PARENTLPN", "PARENT_LPN")
	if parentLpn != "" {
		t.Errorf("expected parent LPN to be empty string when omitted from CSV, got %q", parentLpn)
	}
}

func TestDynamicColumnBinding(t *testing.T) {
	// Target table has standard columns plus custom columns (CUSTOM_NOTE, UNIT_SALES)
	targetCols := []models.ColumnDefinition{
		{Name: "COMPANY_CODE", DataType: "varchar", MaxLength: 8},
		{Name: "DIVISION", DataType: "varchar", MaxLength: 8},
		{Name: "ORDER_LINE_NUMBER", DataType: "int"},
		{Name: "CUSTOMER_NUMBER", DataType: "varchar", MaxLength: 8},
		{Name: "QUANTITY", DataType: "decimal", MaxLength: 18},
		{Name: "UNIT_SALES", DataType: "varchar", MaxLength: 10, IsNullable: true},
		{Name: "CUSTOM_NOTE", DataType: "varchar", MaxLength: 50, IsNullable: true},
		{Name: "STATUS_FLAG", DataType: "varchar", MaxLength: 1},
	}

	// CSV has headers, including EXTRA_UNUSED_COL (should be ignored) and CUSTOM_NOTE
	header := []string{"EXTRA_UNUSED_COL", "Customer", "Quantity", "Custom Note", "Unit Sales"}
	hMap := buildHeaderMap(header)

	bindings := bindColumns(targetCols, hMap, true, "CORP", "1")

	bMap := make(map[string]columnBinding)
	for _, b := range bindings {
		bMap[b.Col.Name] = b
	}

	// Verify COMPANY_CODE and DIVISION are bound as system
	if !bMap["COMPANY_CODE"].IsSystem || bMap["COMPANY_CODE"].SystemVal != "CORP" {
		t.Errorf("expected COMPANY_CODE to be system CORP, got %+v", bMap["COMPANY_CODE"])
	}
	if !bMap["DIVISION"].IsSystem || bMap["DIVISION"].SystemVal != "1" {
		t.Errorf("expected DIVISION to be system 1, got %+v", bMap["DIVISION"])
	}
	if !bMap["ORDER_LINE_NUMBER"].IsComputedLine {
		t.Errorf("expected ORDER_LINE_NUMBER to be computed line, got %+v", bMap["ORDER_LINE_NUMBER"])
	}

	// Verify CUSTOMER_NUMBER mapped via alias "Customer" (index 1)
	if bMap["CUSTOMER_NUMBER"].CsvIndex != 1 {
		t.Errorf("expected CUSTOMER_NUMBER to be at index 1, got %d", bMap["CUSTOMER_NUMBER"].CsvIndex)
	}

	// Verify QUANTITY mapped via alias "Quantity" (index 2)
	if bMap["QUANTITY"].CsvIndex != 2 {
		t.Errorf("expected QUANTITY to be at index 2, got %d", bMap["QUANTITY"].CsvIndex)
	}

	// Verify CUSTOM_NOTE mapped dynamically via clean name (index 3)
	if bMap["CUSTOM_NOTE"].CsvIndex != 3 {
		t.Errorf("expected CUSTOM_NOTE to be at index 3, got %d", bMap["CUSTOM_NOTE"].CsvIndex)
	}

	// Verify UNIT_SALES mapped via alias/clean name (index 4)
	if bMap["UNIT_SALES"].CsvIndex != 4 {
		t.Errorf("expected UNIT_SALES to be at index 4, got %d", bMap["UNIT_SALES"].CsvIndex)
	}
}

func TestDcUserCsvBinding(t *testing.T) {
	header := []string{
		"WAREHOUSE", "PART_CODE", "IC_LOT_NUMBER", "BIN_LOCATION", "IC_STATUS_CODE",
		"MH NUMBER", "UOM 1", "UOM 2", "QUANTITY 1", "QUANTITY 2", "IC VENDOR LOTNUMBER",
		"UNIT COST", "BEST BEFORE DATE", "EXPIRY DATE", "RETEST DATE", "CREATE DATE",
		"LPN NUMBER", "TEST COLUMN", "",
	}
	hMap := buildHeaderMap(header)

	targetCols := []models.ColumnDefinition{
		{Name: "COMPANY_CODE", DataType: "varchar", MaxLength: 10},
		{Name: "WAREHOUSE", DataType: "varchar", MaxLength: 2},
		{Name: "PART_CODE", DataType: "varchar", MaxLength: 15, IsNullable: true},
		{Name: "IC_LOT_NUMBER", DataType: "varchar", MaxLength: 20},
		{Name: "BIN_LOCATION", DataType: "varchar", MaxLength: 15},
		{Name: "IC_STATUS_CODE", DataType: "varchar", MaxLength: 8},
		{Name: "CREATION_DATE", DataType: "datetime"},
		{Name: "BATCH_DATE", DataType: "datetime", IsNullable: true},
		{Name: "DC_LICENSE_PLATE_ID", DataType: "varchar", MaxLength: 30},
		{Name: "DC_PARENT_LICENSE_PLATE_ID", DataType: "varchar", MaxLength: 30},
		{Name: "UOM_1", DataType: "varchar", MaxLength: 4, IsNullable: true},
		{Name: "QTY_1", DataType: "numeric"},
		{Name: "UOM_2", DataType: "varchar", MaxLength: 4, IsNullable: true},
		{Name: "TEST_COLUMN", DataType: "varchar", MaxLength: 100, IsNullable: true},
		{Name: "QTY_2", DataType: "numeric"},
		{Name: "STATUS_FLAG", DataType: "varchar", MaxLength: 1},
		{Name: "RS_MESSAGE_TEXT", DataType: "varchar", MaxLength: 2000},
		{Name: "DC_LICENSE_PLATE_LINE", DataType: "smallint"},
		{Name: "UNIT_COST", DataType: "numeric", IsNullable: true},
		{Name: "IC_VENDOR_LOT_NUMBER", DataType: "varchar", MaxLength: 20},
		{Name: "BEST_BEFORE_DATE", DataType: "datetime", IsNullable: true},
		{Name: "IC_RETEST_DATE", DataType: "datetime"},
	}

	bindings := bindColumns(targetCols, hMap, false, "CORP", "1")

	bMap := make(map[string]columnBinding)
	for _, b := range bindings {
		bMap[b.Col.Name] = b
	}

	if bMap["TEST_COLUMN"].CsvIndex != 17 {
		t.Fatalf("expected TEST_COLUMN to be at CSV index 17, got %d", bMap["TEST_COLUMN"].CsvIndex)
	}

	row := []string{
		"04", "C01572", "G261115D", "", "QOH", "", "CA", "", "1", "",
		"0", "7.877", "15-JUL-2027", "15-JUL-2027", "27-DEC-2026", "21-APR-2026",
		"5", "string",
	}

	raw := ""
	if bMap["TEST_COLUMN"].CsvIndex >= 0 && bMap["TEST_COLUMN"].CsvIndex < len(row) {
		raw = row[bMap["TEST_COLUMN"].CsvIndex]
	}
	val := formatColumnValue(bMap["TEST_COLUMN"].Col, raw)
	if val != "string" {
		t.Fatalf("expected formatted value to be 'string', got %v", val)
	}
}

func TestFormatColumnValue(t *testing.T) {
	colVarchar := models.ColumnDefinition{Name: "PART_CODE", DataType: "varchar", MaxLength: 5, IsNullable: false}
	val1 := formatColumnValue(colVarchar, "TOOLONGPARTCODE")
	if val1 != "TOOLO" {
		t.Errorf("expected varchar trimmed to 5 chars 'TOOLO', got %v", val1)
	}

	colDecimal := models.ColumnDefinition{Name: "PRICE", DataType: "decimal", IsNullable: false}
	val2 := formatColumnValue(colDecimal, "$1,234.50")
	if val2 != 1234.50 {
		t.Errorf("expected decimal 1234.50, got %v", val2)
	}

	colDate := models.ColumnDefinition{Name: "ORDER_DATE", DataType: "datetime", IsNullable: true}
	val3 := formatColumnValue(colDate, "15-JUL-2027")
	if val3 != "2027-07-15" {
		t.Errorf("expected date 2027-07-15, got %v", val3)
	}

	colNullDate := models.ColumnDefinition{Name: "OPT_DATE", DataType: "datetime", IsNullable: true}
	val4 := formatColumnValue(colNullDate, "")
	if val4 != nil {
		t.Errorf("expected nullable date with empty input to be nil, got %v", val4)
	}
}
