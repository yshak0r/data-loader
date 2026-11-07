package csv

import (
	"testing"
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
}
