package models

// KasSoLoadRecord models records staged in [FIN].[KAS_SO_LOADS].
type KasSoLoadRecord struct {
	GemDbKey            int64   `json:"GEM_DBKEY"`
	CompanyCode         string  `json:"COMPANY_CODE"`
	Division            string  `json:"DIVISION"`
	OrderDate           string  `json:"ORDER_DATE"`
	CustomerNumber      string  `json:"CUSTOMER_NUMBER"`
	DeliveryAddressCode string  `json:"DELIVERY_ADDRESS_CODE"`
	CustomerReference   string  `json:"CUSTOMER_REFERENCE"`
	EdiOrder            *string `json:"EDI_ORDER,omitempty"`
	SysDeliveryDate     string  `json:"SYS_DELIVERY_DATE"`
	Warehouse           string  `json:"WAREHOUSE"`
	PartCode            string  `json:"PART_CODE"`
	Quantity1           float64 `json:"QUANTITY_1"`
	UnitSales           *string `json:"UNIT_SALES"`
	SalesPrice          float64 `json:"SALES_PRICE"`
	Freight             float64 `json:"FREIGHT"`
	OrderLineNumber     int     `json:"ORDER_LINE_NUMBER"`
	OrderNumber         *string `json:"ORDER_NUMBER"`
	StatusFlag          string  `json:"STATUS_FLAG"`
	RsMessageText       string  `json:"RS_MESSAGE_TEXT"`
	DateStaged          *string `json:"DATE_STAGED,omitempty"`
	BatchID             *string `json:"BATCH_ID,omitempty"`
}

// OrderLineItem represents an individual line within an order group.
type OrderLineItem struct {
	LineNumber    int     `json:"lineNumber"`
	PartCode      string  `json:"partCode"`
	Warehouse     string  `json:"warehouse"`
	Quantity      float64 `json:"quantity"`
	SalesPrice    float64 `json:"salesPrice"`
	Freight       float64 `json:"freight"`
	TotalAmount   float64 `json:"totalAmount"`
	Status        string  `json:"status"`
	RsMessageText string  `json:"rsMessageText"`
	GemDbKey      int64   `json:"gemDbKey"`
}

// OrderGroup represents a grouped sales order header with its line items.
type OrderGroup struct {
	OrderKey            string          `json:"orderKey"`
	CustomerNumber      string          `json:"customerNumber"`
	DeliveryAddressCode string          `json:"deliveryAddressCode"`
	CustomerReference   string          `json:"customerReference"`
	OrderDate           string          `json:"orderDate"`
	SysDeliveryDate     string          `json:"sysDeliveryDate"`
	TotalQuantity       float64         `json:"totalQuantity"`
	TotalValue          float64         `json:"totalValue"`
	TotalFreight        float64         `json:"totalFreight"`
	LineCount           int             `json:"lineCount"`
	HasErrors           bool            `json:"hasErrors"`
	AllLoaded           bool            `json:"allLoaded"`
	OrderNumber         *string         `json:"orderNumber"`
	Lines               []OrderLineItem `json:"lines"`
}

