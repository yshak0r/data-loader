export type LoaderDomain = 'inventory' | 'sales_orders';

export interface StagingTableInfo {
  schemaName: string;
  tableName: string;
  fullName: string;
  rowCount: number;
  isStandard: boolean;
  hasStatusFlag: boolean;
  createDate: string;
}

export interface ColumnDefinition {
  name: string;
  dataType: string;
  maxLength: number;
  isNullable: boolean;
  isIdentity?: boolean;
}

// ---------------------------------------------------------------------------
// DC Inventory Types
// ---------------------------------------------------------------------------
export interface CsvRow {
  warehouse: string;
  partCode: string;
  lotNumber: string;
  binLocation: string;
  statusCode: string;
  mhNumber: string;
  uom1: string;
  uom2: string;
  quantity1: string;
  quantity2: string;
  supplierLot: string;
  unitCost: string;
  bestBeforeDate: string;
  expiryDate: string;
  retestDate: string;
  createDate: string;
  lpNumber: string;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationError {
  line: number;
  column: keyof CsvRow | 'GENERAL';
  fieldIndex?: number;
  code: string;
  message: string;
  severity: ValidationSeverity;
  remediation: string;
  rawLine?: string;
  itemValue?: string;
}

export interface ProcessedRow {
  id: string;
  lineIndex: number;
  raw: string;
  data: CsvRow;
  isValid: boolean;
  errors: ValidationError[];
  status: 'valid' | 'error' | 'warning' | 'loaded' | 'skipped';
  assignedLineNumber?: number;
  transactionNumber?: string;
}

export interface LpnGroup {
  lpNumber: string;
  warehouse: string;
  binLocation: string;
  statusCode: string;
  linesCount: number;
  totalQty1: number;
  uom1: string;
  rows: ProcessedRow[];
  hasConflict: boolean;
  conflictReason?: string;
}

export interface KasDcLoadRecord {
  GEM_DBKEY: number;
  COMPANY_CODE: string;
  WAREHOUSE: string;
  PART_CODE: string | null;
  IC_LOT_NUMBER: string;
  BIN_LOCATION: string;
  IC_STATUS_CODE: string;
  CREATION_DATE: string;
  BATCH_DATE: string | null;
  DC_LICENSE_PLATE_ID: string;
  DC_PARENT_LICENSE_PLATE_ID: string;
  UOM_1: string | null;
  QTY_1: number;
  UOM_2: string | null;
  QTY_2: number;
  STATUS_FLAG: string; // ' ' (Pending), 'V' (Valid), 'E' (Error), 'P' / 'L' (Loaded/Processed)
  RS_MESSAGE_TEXT: string;
  DC_LICENSE_PLATE_LINE: number;
  UNIT_COST: number | null;
  IC_VENDOR_LOT_NUMBER: string;
  BEST_BEFORE_DATE: string | null;
  IC_RETEST_DATE: string;
}

// ---------------------------------------------------------------------------
// Sales Order Types
// ---------------------------------------------------------------------------
export interface SoCsvRow {
  orderDate: string;
  customer: string;
  deliveryCode: string;
  custRef: string;
  sysDeliveryDate: string;
  warehouse: string;
  partCode: string;
  quantity: string;
  salesPrice: string;
  freight: string;
  ediOrder?: string;
  comments?: string;
}

export interface KasSoLoadRecord {
  GEM_DBKEY: number;
  COMPANY_CODE: string;
  DIVISION: string;
  ORDER_DATE: string;
  CUSTOMER_NUMBER: string;
  DELIVERY_ADDRESS_CODE: string;
  CUSTOMER_REFERENCE: string;
  SYS_DELIVERY_DATE: string;
  WAREHOUSE: string;
  PART_CODE: string;
  QUANTITY_1: number;
  UNIT_SALES: string | null;
  SALES_PRICE: number;
  FREIGHT: number;
  ORDER_LINE_NUMBER: number;
  ORDER_NUMBER: string | null;
  STATUS_FLAG: string; // ' ' (Pending), 'V' (Valid), 'E' (Error), 'P' / 'L' (Loaded/Processed)
  RS_MESSAGE_TEXT: string;
  BATCH_DATE?: string | null;
}

export interface OrderLineItem {
  id: string;
  lineNumber: number;
  partCode: string;
  warehouse: string;
  quantity: number;
  unitSales?: string;
  salesPrice: number;
  extendedPrice: number;
  freight: number;
  status: string;
  message: string;
}

export interface OrderGroup {
  orderKey: string;
  customerReference: string;
  customerNumber: string;
  deliveryAddressCode: string;
  orderDate: string;
  sysDeliveryDate: string;
  totalQuantity: number;
  totalValue: number;
  totalFreight: number;
  linesCount: number;
  hasErrors: boolean;
  errorCount: number;
  lines: OrderLineItem[];
  orderNumber?: string;
  status: 'valid' | 'error' | 'loaded' | 'failed' | 'pending';
}

// ---------------------------------------------------------------------------
// Common Grid & Configuration Types
// ---------------------------------------------------------------------------
export interface GridCounts {
  total: number;
  valid: number;
  error: number;
  loaded: number;
  failed?: number;
}

export interface DatabaseConfig {
  profileName: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  companyCode: string;
  division?: string; // AR Division (default: '1')
  authType: 'sql' | 'windows';
  /** TLS encryption - required for Azure SQL / cloud endpoints (default: auto-detected) */
  encrypt?: boolean;
  /** Trust self-signed certs - only for on-premise/dev servers without CA cert (default: false) */
  trustServerCertificate?: boolean;
}

export interface RossWarehouseMeta {
  warehouse: string;
  description: string;
  dataCaptureInUse: boolean;
  binSizing: boolean;
}

export interface RossProductMeta {
  partCode: string;
  description: string;
  active: boolean;
  capacityUom: string;
  batchesExist: boolean;
  batchExpiry: boolean;
  uomControl: 'S' | 'C' | 'P'; // Single, Catchweight, Potency
  packagedProduct: boolean;
  validPackUoms?: string[];
  valuationMethod: 'STD' | 'WAC' | 'LOT' | 'FIFO' | 'LIFO';
  standardCost: number;
  averageCost: number;
  warehouses: string[]; // Active warehouses for this part
}

export interface RossBinMeta {
  warehouse: string;
  binLocation: string;
  status: 'A' | 'I'; // Active or Inactive
}

export interface RossExistingLotMeta {
  warehouse: string;
  partCode: string;
  lotNumber: string;
  expiryDate?: string;
}

export interface RossExistingLpnMeta {
  lpNumber: string;
  warehouse: string;
  binLocation: string;
  statusCode: string;
  status: 'ACTIVE' | 'CLOSED' | 'HOLD';
  partLotPairs: Array<{ partCode: string; lotNumber: string; lineNumber: number }>;
}

export interface LoadExecutionSummary {
  jobId: string;
  startedAt: string;
  completedAt?: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  loadedRows: number;
  mode: 'simulation' | 'production';
  status: 'idle' | 'validating' | 'running' | 'completed' | 'aborted';
  logs: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    line?: number;
  }>;
}

export interface CleanTableResult {
  success: boolean;
  totalDeleted: number;
  tableBreakdown: Array<{ tableName: string; rowsDeleted: number }>;
  targetWarehouses: string[];
  message: string;
}

export interface CleanPreview {
  warehouses: string[];
  companyCodes: string[];
  recordCount: number;
}

export interface RuleBreakdownItem {
  ruleName: string;
  errorCount: number;
}

export type SqlScriptSlot = 'create_table' | 'dry_run' | 'loader' | 'clean_tables';

export interface SqlScriptInfo {
  slot: SqlScriptSlot;
  label: string;
  description: string;
  defaultFileName: string;
  currentFileName: string;
  filePath?: string;
  content: string;
  isCustom: boolean;
  isLoaded?: boolean;
  lastUpdated?: string;
}

export interface DistinctValuesParams {
  domain?: LoaderDomain | string;
  targetTable?: string;
  columnName: string;
  search?: string;
  limit?: number;
}

export interface DistinctValuesResult {
  values: string[];
  totalCount: number;
  truncated: boolean;
  hasBlanks: boolean;
}
