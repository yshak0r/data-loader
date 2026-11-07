package models

// DatabaseConfig holds SQL Server connection configuration parameters.
type DatabaseConfig struct {
	ProfileName            string `json:"profileName"`
	Host                   string `json:"host"`
	Port                   int    `json:"port"`
	Database               string `json:"database"`
	User                   string `json:"user"`
	Password               string `json:"password"`
	CompanyCode            string `json:"companyCode"`
	Division               string `json:"division"`
	AuthType               string `json:"authType"` // "sql" | "windows"
	Encrypt                bool   `json:"encrypt"`
	TrustServerCertificate bool   `json:"trustServerCertificate"`
}

// ConnectionStatus reports current database connection state.
type ConnectionStatus struct {
	Connected bool   `json:"connected"`
	Host      string `json:"host,omitempty"`
	Database  string `json:"database,omitempty"`
	Port      int    `json:"port,omitempty"`
	User      string `json:"user,omitempty"`
	Table     string `json:"table,omitempty"`
	Message   string `json:"message,omitempty"`
}

// GridCounts summarizes staged record statuses.
type GridCounts struct {
	Total  int `json:"total"`
	Valid  int `json:"valid"`
	Error  int `json:"error"`
	Loaded int `json:"loaded"`
	Failed int `json:"failed"`
}

// GridQueryParams contains grid filtering and pagination criteria.
type GridQueryParams struct {
	Page         int    `json:"page"`
	PageSize     int    `json:"pageSize"`
	StatusFilter string `json:"statusFilter"`
	Search       string `json:"search"`
	Domain       string `json:"domain"` // "inventory" | "sales_orders"
}

// GridQueryResult represents paginated data returned to frontend.
type GridQueryResult struct {
	Rows      []any      `json:"rows"`
	Total     int        `json:"total"`
	Counts    GridCounts `json:"counts"`
	Connected bool       `json:"connected"`
}

// RuleBreakdownItem contains counts per validation rule failure.
type RuleBreakdownItem struct {
	RuleName   string `json:"ruleName"`
	ErrorCount int    `json:"errorCount"`
}

// DryRunCounts summarizes dry run status.
type DryRunCounts struct {
	Total   int `json:"total"`
	Valid   int `json:"valid"`
	Errors  int `json:"errors"`
	Loaded  int `json:"loaded"`
	Pending int `json:"pending"`
}

// DryRunResult reports validation outcome.
type DryRunResult struct {
	Success       bool                `json:"success"`
	Counts        DryRunCounts        `json:"counts"`
	RuleBreakdown []RuleBreakdownItem `json:"ruleBreakdown,omitempty"`
	Message       string              `json:"message"`
}

// LoaderResult reports execution outcome.
type LoaderResult struct {
	Success bool   `json:"success"`
	Loaded  int    `json:"loaded"`
	Failed  int    `json:"failed"`
	BatchID string `json:"batchId"`
	Message string `json:"message"`
}

// CleanTableResult reports records deleted per table.
type CleanTableResult struct {
	Success          bool                `json:"success"`
	TotalDeleted     int                 `json:"totalDeleted"`
	TableBreakdown   []CleanBreakdownItem `json:"tableBreakdown"`
	TargetWarehouses []string            `json:"targetWarehouses"`
	Message          string              `json:"message"`
}

// CleanBreakdownItem records deletion count per individual Ross table.
type CleanBreakdownItem struct {
	TableName   string `json:"tableName"`
	RowsDeleted int    `json:"rowsDeleted"`
}

// CleanPreview reports target warehouses and records before executing clean.
type CleanPreview struct {
	Warehouses   []string `json:"warehouses"`
	CompanyCodes []string `json:"companyCodes"`
	RecordCount  int      `json:"recordCount"`
}

// ConnectionResult reports connection operation status.
type ConnectionResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	LatencyMs int64  `json:"latencyMs"`
}

// TableResult reports table DDL operation status.
type TableResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// ClearResult reports truncate operation status.
type ClearResult struct {
	Success     bool   `json:"success"`
	DeletedRows int    `json:"deletedRows"`
	Message     string `json:"message"`
}

// UploadResult reports CSV bulk upload status.
type UploadResult struct {
	Success   bool   `json:"success"`
	TotalRows int    `json:"totalRows"`
	Message   string `json:"message"`
	Domain    string `json:"domain"`
}

// LicenseFileResult contains license file picker outcome.
type LicenseFileResult struct {
	Canceled    bool   `json:"canceled"`
	FilePath    string `json:"filePath,omitempty"`
	FileName    string `json:"fileName,omitempty"`
	FileContent string `json:"fileContent,omitempty"`
	Error       string `json:"error,omitempty"`
}

// ActivateResult reports license activation outcome.
type ActivateResult struct {
	Success bool          `json:"success"`
	Message string        `json:"message"`
	Status  LicenseStatus `json:"status"`
}

// SaveFileResult reports file save dialog outcome.
type SaveFileResult struct {
	Success  bool   `json:"success"`
	FilePath string `json:"filePath,omitempty"`
	Error    string `json:"error,omitempty"`
}

// FileDialogResult reports file open dialog outcome.
type FileDialogResult struct {
	Canceled bool   `json:"canceled"`
	FilePath string `json:"filePath,omitempty"`
	FileName string `json:"fileName,omitempty"`
}


