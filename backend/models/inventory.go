package models

// KasDcLoadRecord models records staged in [FIN].[KAS_DC_LOADS].
type KasDcLoadRecord struct {
	GemDbKey                int64    `json:"GEM_DBKEY"`
	CompanyCode             string   `json:"COMPANY_CODE"`
	Warehouse               string   `json:"WAREHOUSE"`
	PartCode                *string  `json:"PART_CODE"`
	IcLotNumber             string   `json:"IC_LOT_NUMBER"`
	BinLocation             string   `json:"BIN_LOCATION"`
	IcStatusCode            string   `json:"IC_STATUS_CODE"`
	CreationDate            string   `json:"CREATION_DATE"`
	BatchDate               *string  `json:"BATCH_DATE"`
	DcLicensePlateID        string   `json:"DC_LICENSE_PLATE_ID"`
	DcParentLicensePlateID  string   `json:"DC_PARENT_LICENSE_PLATE_ID"`
	Uom1                    *string  `json:"UOM_1"`
	Qty1                    float64  `json:"QTY_1"`
	Uom2                    *string  `json:"UOM_2"`
	Qty2                    float64  `json:"QTY_2"`
	StatusFlag              string   `json:"STATUS_FLAG"` // ' ' (pending), 'V' (valid), 'E' (error), 'L' (loaded)
	RsMessageText           string   `json:"RS_MESSAGE_TEXT"`
	DcLicensePlateLine      int      `json:"DC_LICENSE_PLATE_LINE"`
	UnitCost                *float64 `json:"UNIT_COST"`
	IcVendorLotNumber       string   `json:"IC_VENDOR_LOT_NUMBER"`
	BestBeforeDate          *string  `json:"BEST_BEFORE_DATE"`
	IcRetestDate            string   `json:"IC_RETEST_DATE"`
}

