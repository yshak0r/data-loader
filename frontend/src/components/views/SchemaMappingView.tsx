import React, { useState } from 'react';
import {
  Database,
  ArrowRight,
  Table as TableIcon,
  Layers,
  FileCode,
  Shield,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';

interface MappingItem {
  colIndex: number;
  csvField: string;
  targetTable: string;
  targetColumn: string;
  sqlType: string;
  required: boolean;
  notes: string;
}

const SCHEMA_MAPPINGS: MappingItem[] = [
  {
    colIndex: 1,
    csvField: 'WAREHOUSE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'WAREHOUSE',
    sqlType: 'VARCHAR(4)',
    required: true,
    notes: 'Must exist in WAREHOUSE_CONTROLS with DATA_CAPTURE_IN_USE = Y.',
  },
  {
    colIndex: 2,
    csvField: 'PART_CODE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'PART_CODE',
    sqlType: 'VARCHAR(15)',
    required: true,
    notes: 'Active in PRODUCT_MASTER and assigned to warehouse in PRODUCT_WAREHOUSE.',
  },
  {
    colIndex: 3,
    csvField: 'IC_LOT_NUMBER',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'IC_LOT_NUMBER',
    sqlType: 'VARCHAR(15)',
    required: false,
    notes: 'Mandatory if PRODUCT_MASTER(BATCHES_EXIST) = Y; blank otherwise.',
  },
  {
    colIndex: 4,
    csvField: 'BIN_LOCATION',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'BIN_LOCATION',
    sqlType: 'VARCHAR(10)',
    required: false,
    notes: 'Mandatory if WAREHOUSE_CONTROLS(BIN_SIZING) = Y; must be active in BIN_LOCATIONS.',
  },
  {
    colIndex: 5,
    csvField: 'IC_STATUS_CODE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'IC_STATUS_CODE',
    sqlType: 'VARCHAR(4)',
    required: true,
    notes: 'Allowed values: QOH (BGNQOH), QC (BGNQC), QR (BGNQR). Cannot mix on same LPN.',
  },
  {
    colIndex: 6,
    csvField: 'MH_NUMBER',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'MH_NUMBER',
    sqlType: 'VARCHAR(10)',
    required: false,
    notes: 'Material Handling Equipment identifier (optional tracking).',
  },
  {
    colIndex: 7,
    csvField: 'UOM_1',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'UOM_1',
    sqlType: 'VARCHAR(4)',
    required: true,
    notes: 'Must match Capacity UOM, or Pack UOM if Packaged Product = Y.',
  },
  {
    colIndex: 8,
    csvField: 'UOM_2',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'UOM_2',
    sqlType: 'VARCHAR(4)',
    required: false,
    notes: 'Mandatory for Catchweight (UOM_CONTROL = C); must be blank for Single/Potent.',
  },
  {
    colIndex: 9,
    csvField: 'QUANTITY_1',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'QUANTITY_1',
    sqlType: 'NUMERIC(14,4)',
    required: true,
    notes: 'Primary quantity > 0. Formatted per UOM quantity mask.',
  },
  {
    colIndex: 10,
    csvField: 'QUANTITY_2',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'QUANTITY_2',
    sqlType: 'NUMERIC(14,4)',
    required: false,
    notes: 'Secondary quantity > 0 for Catchweight; blank otherwise.',
  },
  {
    colIndex: 11,
    csvField: 'SUPPLIER_LOT',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'IC_VENDOR_LOT_NUMBER',
    sqlType: 'VARCHAR(20)',
    required: false,
    notes: 'Vendor traceability lot number (max 20 characters).',
  },
  {
    colIndex: 12,
    csvField: 'UNIT_COST',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'UNIT_COST',
    sqlType: 'NUMERIC(14,4)',
    required: false,
    notes: 'Mandatory > 0 if LOT/FIFO/LIFO costing. STD/WAC defaults to standard/average cost.',
  },
  {
    colIndex: 13,
    csvField: 'BEST_BEFORE_DATE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'BEST_BEFORE_DATE',
    sqlType: 'DATE (DD-MMM-YYYY)',
    required: false,
    notes: 'Blank if lot exists in PART_BATCHES or expiry tracking disabled.',
  },
  {
    colIndex: 14,
    csvField: 'EXPIRY_DATE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'EXPIRY_DATE',
    sqlType: 'DATE (DD-MMM-YYYY)',
    required: false,
    notes: 'Blank if lot exists in PART_BATCHES or expiry tracking disabled.',
  },
  {
    colIndex: 15,
    csvField: 'RETEST_DATE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'IC_RETEST_DATE',
    sqlType: 'DATE (DD-MMM-YYYY)',
    required: false,
    notes: 'Blank if lot exists in PART_BATCHES or expiry tracking disabled.',
  },
  {
    colIndex: 16,
    csvField: 'CREATE_DATE',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'CREATION_DATE',
    sqlType: 'DATE (DD-MMM-YYYY)',
    required: false,
    notes: 'Defaults to %TODAY if blank; cleared if lot exists in PART_BATCHES.',
  },
  {
    colIndex: 17,
    csvField: 'LP_NUMBER',
    targetTable: 'DC_INCREASE_INVENTORY_LINES',
    targetColumn: 'DC_LICENSE_PLATE_ID',
    sqlType: 'VARCHAR(30)',
    required: true,
    notes: 'Mandatory LPN. Assigned line number generated in DC_LICENSE_PLATE_LINES.',
  },
];

const SO_SCHEMA_MAPPINGS: MappingItem[] = [
  {
    colIndex: 1,
    csvField: 'Order Date',
    targetTable: 'KAS_SO_LOADS / CUST_ORDERS',
    targetColumn: 'ORDER_DATE',
    sqlType: 'DATETIME',
    required: true,
    notes: 'Date order was placed. Validated against standard date formats (DD-MMM-YYYY, YYYY-MM-DD).',
  },
  {
    colIndex: 2,
    csvField: 'Customer',
    targetTable: 'KAS_SO_LOADS / CUSTOMERS',
    targetColumn: 'CUSTOMER_NUMBER',
    sqlType: 'VARCHAR(10)',
    required: true,
    notes: 'Customer account ID. Must exist and be active (ACTIVATION_STATUS = "A") in CUSTOMERS.',
  },
  {
    colIndex: 3,
    csvField: 'Delivery Code',
    targetTable: 'KAS_SO_LOADS / CUSTOMER_ADDRESSES',
    targetColumn: 'DELIVERY_ADDRESS_CODE',
    sqlType: 'VARCHAR(8)',
    required: true,
    notes: 'Ship-to address code. Must be valid for the customer account in CUSTOMER_ADDRESSES.',
  },
  {
    colIndex: 4,
    csvField: 'Cust Ref',
    targetTable: 'KAS_SO_LOADS / CUST_ORDERS',
    targetColumn: 'CUSTOMER_REFERENCE',
    sqlType: 'VARCHAR(30)',
    required: true,
    notes: 'Customer Purchase Order reference. Orders are split and grouped by unique customer reference.',
  },
  {
    colIndex: 5,
    csvField: 'SYS_DELIVERY_DATE',
    targetTable: 'KAS_SO_LOADS / CUST_ORDERS',
    targetColumn: 'SYS_DELIVERY_DATE',
    sqlType: 'DATETIME',
    required: true,
    notes: 'Requested delivery arrival date. Must be greater than or equal to ORDER_DATE.',
  },
  {
    colIndex: 6,
    csvField: 'WAREHOUSE',
    targetTable: 'KAS_SO_LOADS / WAREHOUSE_CONTROLS',
    targetColumn: 'WAREHOUSE',
    sqlType: 'VARCHAR(2)',
    required: true,
    notes: 'Shipping fulfillment warehouse code. Must be active in WAREHOUSE_CONTROLS.',
  },
  {
    colIndex: 7,
    csvField: 'ROSS Part code',
    targetTable: 'KAS_SO_LOADS / PRODUCT_MASTER',
    targetColumn: 'PART_CODE',
    sqlType: 'VARCHAR(15)',
    required: true,
    notes: 'Finished good / product item code. Must exist in PRODUCT_MASTER and be active.',
  },
  {
    colIndex: 8,
    csvField: 'Quantity',
    targetTable: 'KAS_SO_LOADS / CUST_ORDER_LINES',
    targetColumn: 'QUANTITY_1',
    sqlType: 'NUMERIC(20,6)',
    required: true,
    notes: 'Sales order item quantity. Must be strictly greater than zero (> 0).',
  },
  {
    colIndex: 9,
    csvField: 'Sales Price',
    targetTable: 'KAS_SO_LOADS / CUST_ORDER_LINES',
    targetColumn: 'SALES_PRICE',
    sqlType: 'NUMERIC(20,6)',
    required: true,
    notes: 'Unit selling price. Must be >= 0 (zero allowed for promotional/sample orders).',
  },
  {
    colIndex: 10,
    csvField: 'Freight',
    targetTable: 'KAS_SO_LOADS / CUST_ORDERS',
    targetColumn: 'FREIGHT',
    sqlType: 'NUMERIC(20,6)',
    required: false,
    notes: 'Optional freight charge accumulated onto the generated sales order header.',
  },
  {
    colIndex: 11,
    csvField: '(Profile Config)',
    targetTable: 'KAS_SO_LOADS / AR_CONTROLS',
    targetColumn: 'DIVISION',
    sqlType: 'VARCHAR(10)',
    required: true,
    notes: 'AR Division code from Database Config (default "1"). Must have SOP_ACTIVE = "Y".',
  },
  {
    colIndex: 12,
    csvField: '(Auto-Sequenced)',
    targetTable: 'KAS_SO_LOADS / CUST_ORDER_LINES',
    targetColumn: 'ORDER_LINE_NUMBER',
    sqlType: 'SMALLINT',
    required: true,
    notes: 'Auto-sequenced 1..N per unique order header group during staging.',
  },
];

export const SchemaMappingView: React.FC = () => {
  const [selectedSchema, setSelectedSchema] = useState<'inventory' | 'sales_orders'>('inventory');
  const isSo = selectedSchema === 'sales_orders';
  const mappings = isSo ? SO_SCHEMA_MAPPINGS : SCHEMA_MAPPINGS;

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* Top Banner */}
      <div className="p-4 bg-card border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-secondary border border-border flex items-center justify-center text-foreground">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span>Ross ERP SQL Server Schema Mapping</span>
              <Badge variant="outline" className="text-[10px]">
                {mappings.length} Fields Mapped
              </Badge>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Direct mapping specification from incoming CSV tokens to Ross database staging tables.
            </p>
          </div>
        </div>

        {/* Schema Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md bg-secondary/80 p-0.5 border border-border">
            <button
              onClick={() => setSelectedSchema('inventory')}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                !isSo
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              DC Inventory ([FIN].[KAS_DC_LOADS])
            </button>
            <button
              onClick={() => setSelectedSchema('sales_orders')}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                isSo
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sales Orders ([FIN].[KAS_SO_LOADS])
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
        {/* Architecture overview card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-center gap-2 text-foreground text-xs font-semibold">
              <FileCode className="w-4 h-4 text-muted-foreground" />
              <span>{isSo ? '1. Ingestion & Validation' : '1. Ingestion & Validation'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isSo
                ? 'CSV data is parsed and validated against Ross master tables (CUSTOMERS, CUSTOMER_ADDRESSES, PRODUCT_MASTER, WAREHOUSE_CONTROLS, AR_CONTROLS).'
                : 'CSV data is parsed and validated against Ross master tables (PRODUCT_MASTER, WAREHOUSE_CONTROLS, BIN_LOCATIONS).'}
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-center gap-2 text-foreground text-xs font-semibold">
              <Layers className="w-4 h-4 text-muted-foreground" />
              <span>{isSo ? '2. Staging & Order Grouping' : '2. Staging & LPN Generation'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isSo
                ? 'Lines are grouped into distinct Sales Order Headers by Customer, Ship-To, Reference (PO), and Dates with 1..N line auto-sequencing in [FIN].[KAS_SO_LOADS].'
                : 'Rows are staged into DC_INCREASE_INVENTORY_LINES and [FIN].[KAS_DC_LOADS] with sequential pallet line numbering.'}
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-center gap-2 text-foreground text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{isSo ? '3. SOPC_T_003 Execution' : '3. Movement Execution'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isSo
                ? 'Invokes SOP facility SOPC_T_003 (SOP_S_L_UPDATE_SO_FOR_MD) to commit orders into CUST_ORDERS and CUST_ORDER_LINES.'
                : 'Invokes GEMDC:DC_S_L_INCR_DECR_INVENTORY routine to post GL debit/credit and increment on-hand QOH.'}
            </p>
          </div>
        </div>

        {/* Detailed Mapping Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <TableIcon className="w-4 h-4 text-muted-foreground" />
              <span>{isSo ? 'Sales Orders ([FIN].[KAS_SO_LOADS]) CSV Mapping' : 'DC Inventory ([FIN].[KAS_DC_LOADS]) CSV Mapping'}</span>
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Exact column order, SQL Server data types, nullability, and business rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-muted/40 border-y border-border text-[11px] text-muted-foreground font-semibold">
                    <th className="py-2.5 px-4 w-12 text-center">#</th>
                    <th className="py-2.5 px-4 w-36">CSV Header</th>
                    <th className="py-2.5 px-4 w-48">Target Ross Column</th>
                    <th className="py-2.5 px-4 w-32">SQL Data Type</th>
                    <th className="py-2.5 px-4 w-24">Required</th>
                    <th className="py-2.5 px-4">Ross ERP Business Rule & DML Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {mappings.map((m) => (
                    <tr key={m.colIndex} className="hover:bg-muted/30">
                      <td className="py-2.5 px-4 text-center text-muted-foreground">
                        {m.colIndex}
                      </td>
                      <td className="py-2.5 px-4 text-foreground font-semibold font-mono">
                        {m.csvField}
                      </td>
                      <td className="py-2.5 px-4 text-foreground/90 font-mono">
                        {m.targetColumn}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground text-[11px]">
                        {m.sqlType}
                      </td>
                      <td className="py-2.5 px-4">
                        {m.required ? (
                          <span className="text-foreground font-sans font-medium text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border">
                            REQUIRED
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-sans text-[10px] px-1.5 py-0.5 rounded bg-transparent border border-border/60">
                            OPTIONAL
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground font-sans text-xs">
                        {m.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
