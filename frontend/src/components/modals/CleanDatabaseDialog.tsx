import React, { useState, useEffect } from 'react';
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Layers,
  Database,
  Building,
  Table as TableIcon,
  ShieldAlert,
  Upload,
  Code2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { dbClient } from '../../lib/dbClient';
import { CleanTableResult, CleanPreview, SqlScriptInfo } from '../../types/dcloader';

interface CleanDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  onCleanComplete: () => Promise<void>;
}

export const CleanDatabaseDialog: React.FC<CleanDatabaseDialogProps> = ({
  open,
  onOpenChange,
  dbConnected,
  dbHost,
  dbDatabase,
  onCleanComplete,
}) => {
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [preview, setPreview] = useState<CleanPreview>({
    warehouses: [],
    companyCodes: [],
    recordCount: 0,
  });
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<CleanTableResult | null>(null);
  const [cleanScript, setCleanScript] = useState<SqlScriptInfo | null>(null);

  const fetchCleanScript = async () => {
    try {
      const all = await dbClient.getAllSqlScripts();
      if (all && all.clean_tables) {
        setCleanScript(all.clean_tables);
      }
    } catch (_) {}
  };

  const handleUploadCleanScript = async () => {
    try {
      const res = await dbClient.openSqlFile();
      if (!res.canceled && res.fileContent && res.fileName) {
        const updated = await dbClient.setSqlScript('clean_tables', {
          name: res.fileName,
          content: res.fileContent,
          filePath: res.filePath,
        });

        try {
          const stored = JSON.parse(localStorage.getItem('custom_sql_scripts') || '{}');
          stored.clean_tables = {
            name: res.fileName,
            content: res.fileContent,
            filePath: res.filePath,
          };
          localStorage.setItem('custom_sql_scripts', JSON.stringify(stored));
        } catch (_) {}

        setCleanScript(updated);
      }
    } catch (err: any) {
      alert(`Failed to upload clean script: ${err.message}`);
    }
  };

  const targetTables = [
    'IC_PRODUCT_STATUS',
    'IC_LOT_STATUS',
    'IC_BIN_DETAIL_STATUS',
    'BIN_LOCATION_DETAILS',
    'DC_LICENSE_PLATES',
    'DC_LICENSE_PLATE_LINES',
    'DC_LICENSE_PLATE_LINE_DETAILS',
    'IC_QUALITY_DOCS',
    'IC_QUALITY_DOC_LINES',
    'IC_QUALITY_DOC_LINE_DETAILS',
  ];

  const fetchPreview = async () => {
    if (!dbConnected) return;
    setIsLoadingPreview(true);
    setResult(null);
    try {
      const p = await dbClient.getCleanPreview();
      setPreview(p);
    } catch (err) {
      console.error('Failed to load clean preview:', err);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setResult(null);
      fetchPreview();
      fetchCleanScript();
    }
  }, [open, dbConnected]);

  const handleExecuteClean = async () => {
    if (!dbConnected || confirmText.trim().toUpperCase() !== 'CLEAN') return;

    const isScriptLoaded = Boolean(cleanScript?.isLoaded && cleanScript?.content && cleanScript?.content.trim().length > 0);
    if (!isScriptLoaded) {
      setResult({
        success: false,
        totalDeleted: 0,
        tableBreakdown: [],
        targetWarehouses: [],
        message: 'No Clean Tables script loaded. Please load or upload a script first in SQL Scripts Config.',
      });
      return;
    }

    setIsCleaning(true);
    try {
      const res = await dbClient.cleanTables();
      setResult(res);
      if (res.success) {
        await onCleanComplete();
      }
    } catch (err: any) {
      setResult({
        success: false,
        totalDeleted: 0,
        tableBreakdown: [],
        targetWarehouses: [],
        message: err.message || 'Execution error',
      });
    } finally {
      setIsCleaning(false);
    }
  };

  const isConfirmValid = confirmText.trim().toUpperCase() === 'CLEAN';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                Clean Target Inventory Tables
                <Badge variant="outline" className="text-rose-700 dark:text-rose-400 border-rose-500/30 bg-rose-500/10 text-[10px]">
                  Warehouse Scoped
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Target Database: <span className="font-mono text-foreground">{dbDatabase}</span> on{' '}
                <span className="font-mono text-foreground">{dbHost}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Warning Banner */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3.5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1 text-amber-900 dark:text-amber-200">
              <p className="font-semibold text-amber-700 dark:text-amber-300">Production Safety Notice & Scope</p>
              <p className="leading-relaxed">
                This action runs inside an isolated <strong>SQL Transaction</strong>. It deletes inventory and license plate
                records from 10 target tables <strong>only for the warehouses</strong> present in the current staged batch
                (<code className="bg-amber-500/20 px-1 py-0.5 rounded text-amber-800 dark:text-amber-200">KAS_DC_LOADS WHERE STATUS_FLAG &lt;&gt; &apos;E&apos;</code>).
              </p>
            </div>
          </div>

          {/* Active Clean Script Banner */}
          <div className="bg-secondary/40 border border-border rounded-lg p-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground mr-2">Clean Script:</span>
                <span className={`font-mono font-semibold ${cleanScript?.isLoaded ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                  {cleanScript?.isLoaded ? cleanScript.currentFileName : 'None (Not loaded)'}
                </span>
                <Badge
                  variant={cleanScript?.isLoaded ? (cleanScript?.isCustom ? 'outline' : 'secondary') : 'outline'}
                  className={`ml-2 text-[10px] py-0 px-1.5 font-mono ${
                    cleanScript?.isLoaded
                      ? cleanScript?.isCustom
                        ? ''
                        : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-dashed text-muted-foreground'
                  }`}
                >
                  {cleanScript?.isLoaded ? (cleanScript?.isCustom ? 'Custom' : 'Default Script') : 'Not Loaded'}
                </Badge>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUploadCleanScript}
              className="h-6 px-2 text-[10px]"
            >
              <Upload className="w-3 h-3 mr-1" />
              Upload Script
            </Button>
          </div>

          {/* Scope Preview Card */}
          <div className="bg-background/80 border border-border rounded-lg p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-primary" /> Target Scope (From Staged KAS_DC_LOADS)
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchPreview}
                disabled={isLoadingPreview}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingPreview ? 'animate-spin' : ''}`} /> Refresh Scope
              </Button>
            </div>

            {isLoadingPreview ? (
              <div className="text-xs text-muted-foreground py-3 text-center">Loading target scope...</div>
            ) : preview.warehouses.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground mr-1">Warehouses to Clean:</span>
                  {preview.warehouses.map((wh) => (
                    <Badge key={wh} className="bg-primary/20 text-primary border border-primary/40 font-mono text-xs px-2">
                      WH {wh}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>
                    Company Codes:{' '}
                    <strong className="text-foreground">{preview.companyCodes.join(', ') || 'CORP'}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Eligible Records in Staging:{' '}
                    <strong className="text-foreground">{preview.recordCount.toLocaleString()}</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 p-2.5 rounded">
                No eligible records in <code className="font-mono">KAS_DC_LOADS</code> with <code className="font-mono">STATUS_FLAG &lt;&gt; &apos;E&apos;</code>.
                Please import a CSV batch first to define which warehouses to clean.
              </div>
            )}
          </div>

          {/* 10 Target Tables Grid */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <TableIcon className="w-3.5 h-3.5" /> 10 Target Inventory Tables:
            </span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono bg-background/50 border border-border/60 p-2.5 rounded-lg max-h-36 overflow-y-auto">
              {targetTables.map((tbl, i) => (
                <div key={tbl} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="text-muted-foreground/60 text-[10px] w-4">{i + 1}.</span>
                  <span className="truncate">{tbl}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Results Summary if executed */}
          {result && (
            <div
              className={`rounded-lg border p-4 space-y-3 ${
                result.success
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-900 dark:text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {result.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                )}
                <div>
                  <h4 className={`text-sm font-bold ${result.success ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>
                    {result.success ? 'Clean Transaction Committed Successfully' : 'Clean Transaction Failed (Rolled Back)'}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {result.success
                      ? 'Target inventory records have been safely cleared in a single atomic transaction.'
                      : 'An error occurred during execution. No database changes were applied.'}
                  </p>
                </div>
              </div>

              {/* Collective Final Result Cards */}
              {result.success && (
                <div className="bg-emerald-100/70 dark:bg-emerald-950/40 border border-emerald-300/80 dark:border-emerald-500/25 rounded-lg p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-800 dark:text-emerald-300">
                      Collective Cleaned Total
                    </span>
                    <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-0.5 flex items-baseline gap-1.5">
                      {result.totalDeleted.toLocaleString()}
                      <span className="text-xs font-normal text-emerald-800/80 dark:text-emerald-300/80">
                        record(s) removed
                      </span>
                    </div>
                  </div>

                  {result.targetWarehouses && result.targetWarehouses.length > 0 && (
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-800 dark:text-emerald-300">
                        Scoped Warehouses
                      </span>
                      <div className="flex flex-wrap gap-1 mt-1 justify-end">
                        {result.targetWarehouses.map((wh) => (
                          <Badge
                            key={wh}
                            className="bg-emerald-200/90 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-300 border-emerald-400/60 dark:border-emerald-500/40 text-[11px] font-mono px-2 py-0.5"
                          >
                            WH {wh}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Final collective message from execution */}
              <div className="text-xs leading-relaxed pt-2 border-t border-emerald-200 dark:border-emerald-500/20">
                <span className="font-semibold text-emerald-800 dark:text-emerald-300 mr-1.5">Result:</span>
                <span className="text-emerald-900 dark:text-emerald-200">
                  {result.message.replace(/\s*\([A-Za-z0-9_,\s\.]+\)\.?$/, '.')}
                </span>
              </div>
            </div>
          )}

          {/* Confirmation Input Safeguard */}
          {!result?.success && (
            <div className="space-y-1.5 bg-background/80 border border-border p-3 rounded-lg">
              <label className="text-xs text-muted-foreground block">
                To confirm execution, type <span className="font-bold text-rose-600 dark:text-rose-400">CLEAN</span> in uppercase below:
              </label>
              <Input
                placeholder="Type CLEAN to confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={isCleaning || preview.warehouses.length === 0}
                className="font-mono text-xs bg-background uppercase border-rose-500/30 focus-visible:ring-rose-500"
              />
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-border flex items-center justify-between sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isCleaning}>
            {result?.success ? 'Done' : 'Cancel'}
          </Button>

          {!result?.success && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleExecuteClean}
              disabled={!isConfirmValid || isCleaning || preview.warehouses.length === 0 || !cleanScript?.isLoaded}
              className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5 font-medium shadow-md shadow-rose-950/50"
              title={!cleanScript?.isLoaded ? 'Please load or upload a clean script in SQL Scripts Config first' : ''}
            >
              {isCleaning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> Cleaning Inventory Tables...
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" /> Execute Scoped Clean
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
