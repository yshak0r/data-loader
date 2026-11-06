import React from 'react';
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertOctagon,
  Boxes,
  Database,
  ArrowRight,
  Upload,
  RefreshCw,
  FolderOpen,
  CheckCheck,
  ShieldCheck,
  Zap,
  AlertTriangle,
  Server,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { GridCounts, LoaderDomain } from '../../types/dcloader';

interface DashboardViewProps {
  counts: GridCounts;
  fileName: string;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  domain?: LoaderDomain;
  onNavigateTab: (tab: any, filter?: string) => void;
  onOpenFilePicker: () => void;
  onRunDryRun: () => void;
  onExecuteLoader: () => void;
  onLoadSampleCsv: (type: 'valid' | 'errors') => void;
  onOpenDbConfig: () => void;
  onOpenCleanDialog?: () => void;
  onOpenClearStagedDialog?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  counts,
  fileName,
  dbConnected,
  dbHost,
  dbDatabase,
  domain = 'inventory',
  onNavigateTab,
  onOpenFilePicker,
  onRunDryRun,
  onExecuteLoader,
  onLoadSampleCsv,
  onOpenDbConfig,
  onOpenCleanDialog,
  onOpenClearStagedDialog,
}) => {
  const total = counts.total;
  const validCount = counts.valid;
  const errorCount = counts.error;
  const loadedCount = counts.loaded;

  const successPercent = total > 0 ? Math.round((validCount / total) * 100) : 100;

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-2.5rem)]">
      {/* Top Disconnected Alert Banner */}
      {!dbConnected && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-destructive/15 border border-destructive/30 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-rose-300">
                SQL Server Database Disconnected
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                Connect to your Microsoft SQL Server database before staging CSV records into <code className="font-mono text-foreground">{domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}</code> or executing validation scripts.
              </p>
            </div>
          </div>
          <Button
            onClick={onOpenDbConfig}
            variant="destructive"
            size="sm"
            className="text-xs font-medium shrink-0"
          >
            <Database className="w-3.5 h-3.5 mr-1.5" />
            Connect Database
          </Button>
        </div>
      )}

      {/* Header Banner */}
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-secondary text-muted-foreground text-xs font-mono border border-border">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  dbConnected ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              {dbConnected
                ? `Online: ${dbHost} / [${dbDatabase}].${domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}`
                : 'Offline: SQL Server Staging'}
            </div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              {domain === 'sales_orders' ? 'Ross ERP Sales Order Loader (SOP)' : 'Ross ERP DC Inventory Loader'}
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {domain === 'sales_orders'
                ? 'High-performance staging and grouping engine for Ross ERP Sales Orders. Streams CSV records into SQL Server table [FIN].[KAS_SO_LOADS], automatically sequences lines and groups by customer reference per facility SOPC_T_003, and validates in real time.'
                : 'High-performance staging engine for Ross ERP. Streams CSV records into SQL Server table [FIN].[KAS_DC_LOADS], executes validation and loading via configurable scripts, and displays results in real time.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            <Button
              onClick={dbConnected ? onOpenFilePicker : onOpenDbConfig}
              size="sm"
              className="text-xs font-medium"
            >
              <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
              {dbConnected ? 'Upload CSV File' : 'Connect DB First'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab('importer')}
              className="text-xs font-medium"
            >
              Open SQL Grid
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Records in Table */}
        <Card
          className="border-border hover:border-foreground/30 transition-all cursor-pointer shadow-sm"
          onClick={() => (dbConnected ? onNavigateTab('importer', 'ALL') : onOpenDbConfig())}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Total Staged in DB</p>
              <div className="text-2xl font-bold font-mono text-foreground">
                {dbConnected ? total.toLocaleString() : '—'}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                {domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}
              </p>
            </div>
            <div className="w-10 h-10 rounded-md bg-secondary border border-border flex items-center justify-center text-muted-foreground">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </CardContent>
        </Card>

        {/* Valid Records Passed Dry Run */}
        <Card
          className="border-border hover:border-emerald-500/40 transition-all cursor-pointer shadow-sm"
          onClick={() => (dbConnected ? onNavigateTab('importer', 'V') : onOpenDbConfig())}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Dry Run Passed (Valid)</p>
              <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {dbConnected ? validCount.toLocaleString() : '—'}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {dbConnected ? `${successPercent}% verified` : 'SQL Server required'}
              </p>
            </div>
            <div className="w-10 h-10 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </CardContent>
        </Card>

        {/* Quarantine Errors */}
        <Card
          className="border-border hover:border-rose-500/40 transition-all cursor-pointer shadow-sm"
          onClick={() => (dbConnected ? onNavigateTab('importer', 'E') : onOpenDbConfig())}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Quarantine Errors</p>
              <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
                {dbConnected ? errorCount.toLocaleString() : '—'}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {dbConnected ? (errorCount === 0 ? 'Zero syntax failures' : 'Action required in grid') : 'SQL Server required'}
              </p>
            </div>
            <div className="w-10 h-10 rounded-md bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <AlertOctagon className="w-4 h-4" />
            </div>
          </CardContent>
        </Card>

        {/* Loaded into Ross ERP */}
        <Card
          className="border-border hover:border-foreground/30 transition-all cursor-pointer shadow-sm"
          onClick={() => (dbConnected ? onNavigateTab('importer', 'L') : onOpenDbConfig())}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Committed to Ross ERP</p>
              <div className="text-2xl font-bold font-mono text-foreground">
                {dbConnected ? loadedCount.toLocaleString() : '—'}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">STATUS_FLAG = 'L'</p>
            </div>
            <div className="w-10 h-10 rounded-md bg-secondary border border-border flex items-center justify-center text-muted-foreground">
              <CheckCheck className="w-4 h-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operations Quick Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Quick SQL Execution Actions */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-foreground" />
              Database Operations Pipeline
            </CardTitle>
            <CardDescription className="text-xs">
              Execute operations directly against SQL Server staging table.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
              <div>
                <p className="text-xs font-medium text-foreground">1. Run Dry Run Validation Script</p>
                <p className="text-[11px] text-muted-foreground">
                  Executes validation script to verify syntax, mandatory fields & LPN rules.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={dbConnected ? onRunDryRun : onOpenDbConfig}
                disabled={!dbConnected || total === 0}
                className="text-xs shrink-0 ml-3"
              >
                <Zap className="w-3.5 h-3.5 mr-1 text-amber-400" />
                Run Dry Run
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
              <div>
                <p className="text-xs font-medium text-foreground">2. Execute Live Loader Script</p>
                <p className="text-[11px] text-muted-foreground">
                  Executes loader script on verified records and marks status as loaded.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={dbConnected ? onExecuteLoader : onOpenDbConfig}
                disabled={!dbConnected || validCount === 0}
                className="text-xs shrink-0 ml-3"
              >
                <CheckCheck className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                Execute Loader
              </Button>
            </div>

            {onOpenClearStagedDialog && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" /> 3. Clear Staged Data
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Discard current staged batch by truncating table <span className="font-mono text-foreground">[FIN].[KAS_DC_LOADS]</span> without uploading a new CSV.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={dbConnected ? onOpenClearStagedDialog : onOpenDbConfig}
                  disabled={!dbConnected || total === 0}
                  className="text-xs shrink-0 ml-3 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-500" />
                  Clear Staging
                </Button>
              </div>
            )}

            {onOpenCleanDialog && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <div>
                  <p className="text-xs font-medium text-rose-300 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" /> 4. Clean Target Inventory Tables
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Transactional clean of 10 tables scoped by staged warehouses in <span className="font-mono text-foreground">KAS_DC_LOADS</span>.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={dbConnected ? onOpenCleanDialog : onOpenDbConfig}
                  disabled={!dbConnected}
                  className="text-xs shrink-0 ml-3"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Clean Tables
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test Datasets & Quick Loaders */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Boxes className="w-4 h-4 text-foreground" />
              Quick Datasets & Benchmarks
            </CardTitle>
            <CardDescription className="text-xs">
              Load built-in test suites into [FIN].[KAS_DC_LOADS] for quick validation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
              <div>
                <p className="text-xs font-medium text-foreground">Valid Reference Dataset</p>
                <p className="text-[11px] text-muted-foreground">
                  Loads <span className="font-mono text-foreground">dcload_test.csv</span> (all standard inventory categories).
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => (dbConnected ? onLoadSampleCsv('valid') : onOpenDbConfig())}
                className="text-xs shrink-0 ml-3"
              >
                Load Valid CSV
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
              <div>
                <p className="text-xs font-medium text-foreground">Error Verification Dataset</p>
                <p className="text-[11px] text-muted-foreground">
                  Loads <span className="font-mono text-foreground">dcload_test_errors.csv</span> to test error trapping and flag updates.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => (dbConnected ? onLoadSampleCsv('errors') : onOpenDbConfig())}
                className="text-xs shrink-0 ml-3 border-destructive/30 hover:bg-destructive/10 text-rose-300"
              >
                Load Errors CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
