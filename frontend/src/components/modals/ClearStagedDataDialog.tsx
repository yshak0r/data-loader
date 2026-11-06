import React, { useState } from 'react';
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  RefreshCw,
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
import { dbClient } from '../../lib/dbClient';
import { LoaderDomain } from '../../types/dcloader';

interface ClearStagedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  stagedRowsCount: number;
  domain?: LoaderDomain;
  onClearComplete: (deletedRows: number) => Promise<void>;
}

export const ClearStagedDataDialog: React.FC<ClearStagedDataDialogProps> = ({
  open,
  onOpenChange,
  dbConnected,
  dbHost,
  dbDatabase,
  stagedRowsCount,
  domain = 'inventory',
  onClearComplete,
}) => {
  const [isClearing, setIsClearing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; deletedRows: number } | null>(null);

  const tableName = domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]';

  const handleClear = async () => {
    if (!dbConnected) return;

    setIsClearing(true);
    setResult(null);
    try {
      const res = await dbClient.clearStagedData(domain);
      setResult(res);
      if (res.success) {
        await onClearComplete(res.deletedRows);
      }
    } catch (err: any) {
      setResult({
        success: false,
        message: err.message || 'Failed to clear staged data',
        deletedRows: 0,
      });
    } finally {
      setIsClearing(false);
    }
  };

  const handleClose = (newOpen: boolean) => {
    if (!isClearing) {
      setResult(null);
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg bg-card border-border p-6 overflow-hidden">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                Clear Staged Data
                <Badge variant="outline" className="text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/10 text-[10px]">
                  {tableName}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Truncate the staging table to discard the active batch without re-uploading a CSV.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {/* Target Database & Table Info */}
          <div className="p-3 rounded-lg bg-secondary/40 border border-border text-xs space-y-2 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-sans text-[11px]">Database Server:</span>
              <span className="text-foreground font-medium">{dbHost || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-sans text-[11px]">Database Name:</span>
              <span className="text-foreground font-medium">{dbDatabase || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-sans text-[11px]">Staging Table:</span>
              <span className="text-foreground font-semibold">{tableName}</span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-border">
              <span className="text-muted-foreground font-sans text-[11px]">Currently Staged:</span>
              <span className="text-foreground font-bold text-sm">
                {stagedRowsCount.toLocaleString()} row(s)
              </span>
            </div>
          </div>

          {/* Warning / explanation box */}
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Action will truncate the staging table:</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                All records currently in <code className="font-mono text-foreground font-medium">{tableName}</code> will be deleted immediately.
                The table schema, columns, and indexes are preserved so you can upload a new CSV file or run scripts at any time.
              </p>
            </div>
          </div>

          {/* Result message */}
          {result && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                result.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
              }`}
            >
              {result.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-snug">{result.message}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleClose(false)}
            disabled={isClearing}
            className="text-xs"
          >
            {result?.success ? 'Close' : 'Cancel'}
          </Button>
          {!result?.success && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClear}
              disabled={isClearing || !dbConnected || stagedRowsCount === 0}
              className="text-xs font-semibold"
            >
              {isClearing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Clearing Table...
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Clear Staged Data
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
