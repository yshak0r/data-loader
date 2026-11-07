import React from 'react';
import {
  Upload,
  Search,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  FolderOpen,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Zap,
  CheckCheck,
  Clock,
  Database,
  Server,
  AlertTriangle,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../ui/table';
import { KasDcLoadRecord, GridCounts, LoaderDomain } from '../../types/dcloader';

interface ImportAndGridViewProps {
  rows: any[];
  totalRows: number;
  counts: GridCounts;
  fileName: string;
  currentPage: number;
  pageSize: number;
  statusFilter: string;
  searchQuery: string;
  isLoading: boolean;
  isUploading: boolean;
  uploadProgress: number;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  lastStagedInfo: string | null;
  domain?: LoaderDomain;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onStatusFilterChange: (status: string) => void;
  onSearchChange: (search: string) => void;
  onOpenFilePicker: () => void;
  onRunDryRun: () => void;
  onRefresh: () => void;
  onExportValid: () => void;
  onExportErrors: () => void;
  onExportAll: () => void;
  onOpenDbConfig: () => void;
  onOpenClearStagedDialog?: () => void;
}

export const ImportAndGridView: React.FC<ImportAndGridViewProps> = ({
  rows,
  totalRows,
  counts,
  fileName,
  currentPage,
  pageSize,
  statusFilter,
  searchQuery,
  isLoading,
  isUploading,
  uploadProgress,
  dbConnected,
  dbHost,
  dbDatabase,
  lastStagedInfo,
  domain = 'inventory',
  onPageChange,
  onPageSizeChange,
  onStatusFilterChange,
  onSearchChange,
  onOpenFilePicker,
  onRunDryRun,
  onRefresh,
  onExportValid,
  onExportErrors,
  onExportAll,
  onOpenDbConfig,
  onOpenClearStagedDialog,
}) => {
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  const renderStatusBadge = (flag: string) => {
    switch (flag) {
      case 'V':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-500/30 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            VALID
          </span>
        );
      case 'E':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-500/30 px-1.5 py-0.5 rounded">
            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            ERROR
          </span>
        );
      case 'L':
      case 'P':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-500/30 px-1.5 py-0.5 rounded">
            <CheckCheck className="w-3 h-3 text-sky-600 dark:text-sky-400" />
            {flag === 'P' ? 'LOADED (P)' : 'LOADED'}
          </span>
        );
      case 'F':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-500/30 px-1.5 py-0.5 rounded" title="Load Failed — record was not committed to Ross ERP">
            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            LOAD FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-500/40 px-1.5 py-0.5 rounded" title="Staged in [FIN].[KAS_DC_LOADS] - Click Run Dry Run (SQL) to validate">
            <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            STAGED (PENDING)
          </span>
        );
    }
  };

  const renderDateCell = (dateStr: string | null | undefined) => {
    if (!dateStr || dateStr.trim() === '' || dateStr.startsWith('1858-11-17') || dateStr.startsWith('1858')) {
      return <span className="text-muted-foreground/40">—</span>;
    }
    const cleanDate = dateStr.split(' ')[0] || dateStr;
    return <span className="font-mono text-[11px] text-foreground">{cleanDate}</span>;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* Top Disconnected Alert Banner if DB is offline */}
      {!dbConnected && (
        <div className="bg-rose-50 dark:bg-rose-950/90 border-b border-rose-200 dark:border-rose-500/50 px-4 py-2 flex items-center justify-between text-xs text-rose-900 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 animate-bounce" />
            <span className="font-semibold">
              SQL Server Connection Required:
            </span>
            <span>
              The application requires an active SQL Server database connection to stage records into <code className="font-mono bg-rose-100 dark:bg-rose-900/50 text-rose-950 dark:text-rose-200 px-1 py-0.5 rounded">[FIN].[KAS_DC_LOADS]</code> and execute validation scripts.
            </span>
          </div>
          <Button
            size="sm"
            onClick={onOpenDbConfig}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold h-7 text-xs px-3 shadow"
          >
            Connect to SQL Server
          </Button>
        </div>
      )}

      {/* Staged Confirmation Notification Banner */}
      {dbConnected && lastStagedInfo && (
        <div className="bg-emerald-50 dark:bg-emerald-950/90 border-b border-emerald-200 dark:border-emerald-500/40 px-4 py-2 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{lastStagedInfo}</span>
          </div>
          <Button
            size="sm"
            onClick={onRunDryRun}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-7 text-xs px-3 shadow"
          >
            <Zap className="w-3.5 h-3.5 mr-1" />
            Run Dry Run (SQL)
          </Button>
        </div>
      )}

      {/* Top Toolbar / Filter Header */}
      <div className="p-3 bg-card border-b border-border flex flex-wrap items-center justify-between gap-3">
        {/* Left: File and Database Staging Info */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={dbConnected ? onOpenFilePicker : onOpenDbConfig}
            disabled={isUploading}
            className="h-8 text-xs font-medium shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
            {isUploading ? 'Uploading...' : dbConnected ? 'Upload CSV' : 'Connect DB'}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={dbConnected ? onRunDryRun : onOpenDbConfig}
            disabled={isLoading || isUploading || counts.total === 0 || !dbConnected}
            className="h-8 text-xs font-medium shadow-sm"
          >
            <Zap className="w-3.5 h-3.5 mr-1 text-amber-400" />
            Run Dry Run (SQL)
          </Button>

          {onOpenClearStagedDialog && (
            <Button
              size="sm"
              variant="outline"
              onClick={dbConnected ? onOpenClearStagedDialog : onOpenDbConfig}
              disabled={isLoading || isUploading || counts.total === 0 || !dbConnected}
              className="h-8 text-xs font-medium shadow-sm text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              title="Clear all staged records from [FIN].[KAS_DC_LOADS]"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-500" />
              Clear Staging
            </Button>
          )}

          {/* Connected target database badge */}
          <div
            onClick={onOpenDbConfig}
            className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-border bg-secondary/40 text-xs cursor-pointer hover:bg-secondary/70 transition-all"
            title="Target SQL Server Staging Table"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dbConnected ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
            />
            <span className="font-mono font-medium text-[11px] text-foreground">
              {dbConnected ? `${dbHost} / [${dbDatabase}].[FIN].[KAS_DC_LOADS]` : 'DB OFFLINE'}
            </span>
            {fileName && (
              <>
                <span className="text-border">|</span>
                <FileSpreadsheet className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-mono text-muted-foreground text-[11px] truncate max-w-[130px]">{fileName}</span>
              </>
            )}
            <span className="text-border">|</span>
            <span className="font-mono text-muted-foreground text-[11px]">{counts.total.toLocaleString()} rows</span>
          </div>
        </div>

        {/* Right: Search & Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Search */}
          <div className="relative w-52">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search staging table..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              disabled={!dbConnected}
              className="pl-8 h-8 text-xs font-mono"
            />
          </div>

          {/* Status filter buttons */}
          <div className="flex items-center rounded-md bg-secondary/80 p-0.5 border border-border text-xs">
            <button
              onClick={() => onStatusFilterChange('ALL')}
              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-all ${
                statusFilter === 'ALL'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({counts.total})
            </button>
            <button
              onClick={() => onStatusFilterChange('V')}
              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-all ${
                statusFilter === 'V'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Valid ({counts.valid})
            </button>
            <button
              onClick={() => onStatusFilterChange('E')}
              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-all ${
                statusFilter === 'E'
                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Errors ({counts.error})
            </button>
            <button
              onClick={() => onStatusFilterChange('L')}
              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-all ${
                statusFilter === 'L' || statusFilter === 'P'
                  ? 'bg-secondary text-foreground font-semibold border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Loaded ({counts.loaded})
            </button>
            <button
              onClick={() => onStatusFilterChange('F')}
              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-all ${
                statusFilter === 'F'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Load Failed — uncommitted or failed during loader (F)"
            >
              Failed ({counts.failed || 0})
            </button>
          </div>

          {/* Refresh Grid */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading || !dbConnected}
            className="h-8 px-2.5 text-xs"
            title="Refresh directly from SQL Server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          {/* Export Buttons */}
          <Button
            variant="outline"
            size="sm"
            onClick={onExportValid}
            disabled={counts.valid === 0 || !dbConnected}
            className="h-8 text-xs font-medium"
            title="Export Valid records from SQL"
          >
            <Download className="w-3.5 h-3.5 mr-1 text-emerald-400" />
            Valid
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onExportErrors}
            disabled={counts.error === 0 || !dbConnected}
            className="h-8 text-xs font-medium text-rose-300 border-destructive/30 hover:bg-destructive/10"
            title="Export Error records from SQL"
          >
            <Download className="w-3.5 h-3.5 mr-1 text-rose-400" />
            Errors
          </Button>
        </div>
      </div>

      {/* Uploading progress notification bar */}
      {isUploading && (
        <div className="bg-sky-50 dark:bg-sky-950/90 border-b border-sky-200 dark:border-sky-500/40 px-4 py-2 flex items-center justify-between text-xs text-sky-900 dark:text-sky-200 shadow-inner">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400" />
            <span className="font-semibold">
              Bulk inserting records directly into SQL Server [{dbDatabase}].[FIN].[KAS_DC_LOADS] at {dbHost}...
            </span>
          </div>
          <span className="font-mono font-bold bg-sky-100 dark:bg-sky-900/60 px-2 py-0.5 rounded text-sky-800 dark:text-sky-300">
            {uploadProgress.toLocaleString()} rows streamed
          </span>
        </div>
      )}

      {/* Main High-Performance SQL Server Grid */}
      <div className="flex-1 overflow-auto bg-background relative">
        {isLoading && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center z-10">
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-card border border-border text-xs text-foreground shadow-2xl">
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              <span>Querying SQL Server {domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}...</span>
            </div>
          </div>
        )}

        {/* When DB is disconnected */}
        {!dbConnected ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Server className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-base font-bold text-foreground">
                SQL Server Connection Required
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The desktop app does not stage data in local memory. All CSV records, dry run validations, and loading operations are executed directly against Microsoft SQL Server in table <code className="text-foreground font-mono">{domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}</code>.
              </p>
            </div>
            <Button
              onClick={onOpenDbConfig}
              variant="outline"
              className="text-xs h-9 px-4 border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
            >
              <Database className="w-4 h-4 mr-2" />
              Configure & Connect SQL Server
            </Button>
          </div>
        ) : rows.length === 0 && !isLoading ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-secondary border border-border flex items-center justify-center text-muted-foreground">
              <Upload className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-base font-semibold text-foreground">
                {counts.total === 0 ? `No Data in ${domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}` : 'No Records Match Filter'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {counts.total === 0
                  ? `SQL Server connected at ${dbHost} [${dbDatabase}]. Open a Ross ERP ${domain === 'sales_orders' ? 'Sales Order' : 'DC loader'} CSV file to bulk-load records into ${domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}.`
                  : `No rows found in ${domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'} matching status filter '${statusFilter}' or search query '${searchQuery}'.`}
              </p>
            </div>
            {counts.total === 0 && (
              <Button
                onClick={onOpenFilePicker}
                className="text-xs font-medium"
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Select CSV File to Stage in SQL Server
              </Button>
            )}
          </div>
        ) : domain === 'sales_orders' ? (
          /* Sales Orders Table View */
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 text-[11px] whitespace-nowrap">
                <TableHead className="w-14 text-center">DBKey</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24">Order Date</TableHead>
                <TableHead className="w-24">Customer</TableHead>
                <TableHead className="w-20">Ship-To</TableHead>
                <TableHead className="w-28">Cust PO Ref</TableHead>
                <TableHead className="w-24">Req Delivery</TableHead>
                <TableHead className="w-12">Wh</TableHead>
                <TableHead className="w-28">ROSS Part Code</TableHead>
                <TableHead className="w-20 text-right">Quantity</TableHead>
                <TableHead className="w-20 text-right">Price</TableHead>
                <TableHead className="w-20 text-right">Freight</TableHead>
                <TableHead className="w-14 text-center">Line #</TableHead>
                <TableHead className="w-24">Order #</TableHead>
                <TableHead className="min-w-72">SQL Message Column [RS_MESSAGE_TEXT]</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => {
                const isError = r.STATUS_FLAG === 'E';
                const isValid = r.STATUS_FLAG === 'V';
                const isLoaded = r.STATUS_FLAG === 'L' || r.STATUS_FLAG === 'P';
                const isFailed = r.STATUS_FLAG === 'F';

                return (
                  <TableRow
                    key={r.GEM_DBKEY}
                    className={`transition-colors text-xs whitespace-nowrap ${
                      isError
                        ? 'bg-destructive/5 hover:bg-destructive/10 border-l-2 border-l-rose-500'
                        : isFailed
                        ? 'bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-l-amber-500'
                        : isLoaded
                        ? 'bg-secondary/40 hover:bg-secondary/60 border-l-2 border-l-border'
                        : isValid
                        ? 'bg-emerald-500/5 hover:bg-emerald-500/10 border-l-2 border-l-emerald-500'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <TableCell className="font-mono text-center text-muted-foreground text-[11px]">
                      {r.GEM_DBKEY}
                    </TableCell>
                    <TableCell>{renderStatusBadge(r.STATUS_FLAG)}</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-[11px]">
                      {r.ORDER_DATE || '—'}
                    </TableCell>
                    <TableCell className="font-mono font-bold text-foreground">
                      {r.CUSTOMER_NUMBER}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {r.DELIVERY_ADDRESS_CODE}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-foreground">
                      {r.CUSTOMER_REFERENCE}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-[11px]">
                      {r.SYS_DELIVERY_DATE || '—'}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-foreground">
                      {r.WAREHOUSE}
                    </TableCell>
                    <TableCell className="font-mono text-foreground font-medium">
                      {r.PART_CODE}
                    </TableCell>
                    <TableCell className="font-mono text-right font-bold text-foreground">
                      {Number(r.QUANTITY_1 || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="font-mono text-right text-foreground">
                      ${Number(r.SALES_PRICE || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="font-mono text-right text-muted-foreground">
                      {Number(r.FREIGHT || 0) > 0 ? `$${Number(r.FREIGHT).toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-center text-muted-foreground font-semibold">
                      {r.ORDER_LINE_NUMBER ?? 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-sky-600 dark:text-sky-400">
                      {r.ORDER_NUMBER || <span className="text-muted-foreground/40 font-normal">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">
                      <span
                        className={
                          isError
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : isValid
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : isLoaded
                            ? 'text-sky-600 dark:text-sky-400 font-medium'
                            : 'text-amber-800 dark:text-amber-300'
                        }
                      >
                        {r.RS_MESSAGE_TEXT || (isValid ? 'Dry run passed' : 'Staged in SQL Server')}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          /* DC Inventory Table View */
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 text-[11px] whitespace-nowrap">
                <TableHead className="w-16 text-center">DBKey</TableHead>
                <TableHead className="w-28">Status Flag</TableHead>
                <TableHead className="w-16">Co</TableHead>
                <TableHead className="w-12">Wh</TableHead>
                <TableHead className="w-24">Part Code</TableHead>
                <TableHead className="w-28">Lot Number</TableHead>
                <TableHead className="w-28">Vendor Lot</TableHead>
                <TableHead className="w-20">Bin</TableHead>
                <TableHead className="w-16">IC Status</TableHead>
                <TableHead className="w-16">UOM 1</TableHead>
                <TableHead className="w-20 text-right">Qty 1</TableHead>
                <TableHead className="w-20 text-right">Unit Cost</TableHead>
                <TableHead className="w-16">UOM 2</TableHead>
                <TableHead className="w-20 text-right">Qty 2</TableHead>
                <TableHead className="w-40">License Plate (LPN)</TableHead>
                <TableHead className="w-32">Parent LPN</TableHead>
                <TableHead className="w-14 text-center">Line</TableHead>
                <TableHead className="w-24">Best Before</TableHead>
                <TableHead className="w-24">Expiry Date</TableHead>
                <TableHead className="w-24">Retest Date</TableHead>
                <TableHead className="w-24">Create Date</TableHead>
                <TableHead className="min-w-72">SQL Message Column [RS_MESSAGE_TEXT]</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isError = r.STATUS_FLAG === 'E';
                const isValid = r.STATUS_FLAG === 'V';
                const isLoaded = r.STATUS_FLAG === 'L' || r.STATUS_FLAG === 'P';
                const isFailed = r.STATUS_FLAG === 'F';

                return (
                  <TableRow
                    key={r.GEM_DBKEY}
                    className={`transition-colors text-xs whitespace-nowrap ${
                      isError
                        ? 'bg-destructive/5 hover:bg-destructive/10 border-l-2 border-l-rose-500'
                        : isFailed
                        ? 'bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-l-amber-500'
                        : isLoaded
                        ? 'bg-secondary/40 hover:bg-secondary/60 border-l-2 border-l-border'
                        : isValid
                        ? 'bg-emerald-500/5 hover:bg-emerald-500/10 border-l-2 border-l-emerald-500'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    {/* Identity DBKey */}
                    <TableCell className="font-mono text-center text-muted-foreground text-[11px]">
                      {r.GEM_DBKEY}
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell>{renderStatusBadge(r.STATUS_FLAG)}</TableCell>

                    {/* Company Code */}
                    <TableCell className="font-mono text-muted-foreground text-[11px]">
                      {r.COMPANY_CODE}
                    </TableCell>

                    {/* Warehouse */}
                    <TableCell className="font-mono font-semibold text-foreground">
                      {r.WAREHOUSE}
                    </TableCell>

                    {/* Part Code */}
                    <TableCell className="font-mono text-foreground font-medium">
                      {r.PART_CODE || <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Lot Number */}
                    <TableCell className="font-mono text-foreground">
                      {r.IC_LOT_NUMBER || <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Vendor Lot */}
                    <TableCell className="font-mono text-muted-foreground text-[11px]">
                      {r.IC_VENDOR_LOT_NUMBER?.trim() || <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Bin Location */}
                    <TableCell className="font-mono text-foreground">
                      {r.BIN_LOCATION || <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Status Code */}
                    <TableCell>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                          r.IC_STATUS_CODE === 'QOH'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25'
                            : r.IC_STATUS_CODE === 'QC'
                            ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/25'
                            : r.IC_STATUS_CODE === 'QR'
                            ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/25'
                            : 'bg-secondary text-muted-foreground border border-border'
                        }`}
                      >
                        {r.IC_STATUS_CODE || '—'}
                      </span>
                    </TableCell>

                    {/* UOM 1 */}
                    <TableCell className="font-mono text-muted-foreground">{r.UOM_1 || '—'}</TableCell>

                    {/* Qty 1 */}
                    <TableCell className="font-mono text-right font-medium text-foreground">
                      {Number(r.QTY_1).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}
                    </TableCell>

                    {/* Unit Cost */}
                    <TableCell className="font-mono text-right text-xs text-muted-foreground">
                      {r.UNIT_COST !== null && r.UNIT_COST !== undefined ? (
                        `$${Number(r.UNIT_COST).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>

                    {/* UOM 2 */}
                    <TableCell className="font-mono text-muted-foreground">{r.UOM_2 || '—'}</TableCell>

                    {/* Qty 2 */}
                    <TableCell className="font-mono text-right text-muted-foreground">
                      {r.QTY_2 ? Number(r.QTY_2).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 }) : '—'}
                    </TableCell>

                    {/* LPN */}
                    <TableCell className="font-mono text-foreground truncate max-w-[180px]">
                      {r.DC_LICENSE_PLATE_ID || <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Parent LPN */}
                    <TableCell className="font-mono text-muted-foreground truncate max-w-[140px] text-[11px]">
                      {r.DC_PARENT_LICENSE_PLATE_ID?.trim() || <span className="text-muted-foreground/40">—</span>}
                    </TableCell>

                    {/* Line */}
                    <TableCell className="font-mono text-center text-muted-foreground text-[11px]">
                      {r.DC_LICENSE_PLATE_LINE ?? 1}
                    </TableCell>

                    {/* Best Before Date */}
                    <TableCell>{renderDateCell(r.BEST_BEFORE_DATE)}</TableCell>

                    {/* Expiry / Batch Date */}
                    <TableCell>{renderDateCell(r.BATCH_DATE)}</TableCell>

                    {/* Retest Date */}
                    <TableCell>{renderDateCell(r.IC_RETEST_DATE)}</TableCell>

                    {/* Create Date */}
                    <TableCell>{renderDateCell(r.CREATION_DATE)}</TableCell>

                    {/* Diagnostic / Error Message Column directly from SQL */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 truncate text-[11px]">
                        <span
                          className={
                            isError
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : isLoaded
                              ? 'text-sky-700 dark:text-sky-300 font-medium'
                              : isValid
                              ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                              : 'text-amber-800 dark:text-amber-300 font-mono text-[11px]'
                          }
                          title={r.RS_MESSAGE_TEXT}
                        >
                          {r.RS_MESSAGE_TEXT || (isValid ? 'Dry run passed' : 'Staged in DB')}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Grid Footer Pagination */}
      {dbConnected && totalRows > 0 && (
        <div className="p-2.5 bg-card border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground select-none">
          <div className="flex items-center gap-3">
            <span>
              Showing {Math.min(totalRows, (currentPage - 1) * pageSize + 1)} -{' '}
              {Math.min(totalRows, currentPage * pageSize)} of {totalRows.toLocaleString()} rows in <code className="font-mono text-foreground">[FIN].[KAS_DC_LOADS]</code>
            </span>

            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>Page size:</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground font-mono text-[11px]"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1 || isLoading}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="h-7 px-2.5 text-xs font-medium"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              Previous
            </Button>
            <span className="font-mono text-foreground px-2 text-xs">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages || isLoading}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="h-7 px-2.5 text-xs font-medium"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
