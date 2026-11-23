import React, { useState, useEffect, useCallback } from 'react';
import {
  Table2,
  Trash2,
  Play,
  FileCode2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Code2,
  Database,
  Info,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { dbClient } from '../../lib/dbClient';
import { StagingTableInfo } from '../../types/dcloader';

interface CustomTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dbConnected: boolean;
  activeTargetTable?: string | null;
  onTableCreatedOrDropped?: (tableFullName?: string) => void;
}

const DEFAULT_DDL_TEMPLATE = `-- Custom Staging Table Creation Script
-- Creates a new table under [FIN] or [dbo] schema with dynamic columns
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'FIN')
BEGIN
    EXEC('CREATE SCHEMA [FIN]')
END
GO

IF OBJECT_ID(N'[FIN].[MY_CUSTOM_LOADS]', N'U') IS NULL
BEGIN
    CREATE TABLE [FIN].[MY_CUSTOM_LOADS](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [COMPANY_CODE] [varchar](10) NOT NULL CONSTRAINT [DF_MY_CUSTOM_COMPANY_CODE] DEFAULT ('CORP'),
        [STATUS_FLAG] [varchar](1) NOT NULL CONSTRAINT [DF_MY_CUSTOM_STATUS_FLAG] DEFAULT (' '),
        [RS_MESSAGE_TEXT] [varchar](2000) NOT NULL CONSTRAINT [DF_MY_CUSTOM_MSG] DEFAULT (' '),
        [ITEM_CODE] [varchar](50) NULL,
        [QUANTITY] [numeric](20, 6) NOT NULL CONSTRAINT [DF_MY_CUSTOM_QTY] DEFAULT ((0)),
        [UNIT_PRICE] [numeric](20, 6) NULL,
        [RECORD_DATE] [datetime] NULL,
        [NOTES] [varchar](255) NULL,
        CONSTRAINT [PK_MY_CUSTOM_LOADS] PRIMARY KEY CLUSTERED ([ID] ASC)
    );
END
GO
`;

export const CustomTableDialog: React.FC<CustomTableDialogProps> = ({
  open,
  onOpenChange,
  dbConnected,
  activeTargetTable,
  onTableCreatedOrDropped,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'drop'>('create');
  const [ddlScript, setDdlScript] = useState(DEFAULT_DDL_TEMPLATE);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Drop Tab State
  const [tables, setTables] = useState<StagingTableInfo[]>([]);
  const [selectedDropTable, setSelectedDropTable] = useState<string>('');
  const [confirmDropText, setConfirmDropText] = useState('');
  const [isDropping, setIsDropping] = useState(false);
  const [dropResult, setDropResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadTables = useCallback(async () => {
    if (!dbConnected) return;
    try {
      const list = await dbClient.listStagingTables();
      setTables(list || []);
      // If activeTargetTable is custom, preselect it for drop
      if (activeTargetTable) {
        setSelectedDropTable(activeTargetTable);
      } else {
        const firstCustom = list.find((t) => !t.isStandard);
        if (firstCustom) {
          setSelectedDropTable(firstCustom.fullName);
        }
      }
    } catch (err) {
      console.warn('Failed to load tables in dialog:', err);
    }
  }, [dbConnected, activeTargetTable]);

  useEffect(() => {
    if (open) {
      loadTables();
      setResult(null);
      setDropResult(null);
      setConfirmDropText('');
    }
  }, [open, loadTables]);

  const handleExecuteDDL = async () => {
    if (!dbConnected || !ddlScript.trim()) return;
    setIsExecuting(true);
    setResult(null);
    try {
      const res = await dbClient.executeCustomDDL(ddlScript);
      setResult(res);
      if (res.success) {
        await loadTables();
        if (onTableCreatedOrDropped) {
          onTableCreatedOrDropped();
        }
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || 'Execution error.' });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleDropTable = async () => {
    if (!dbConnected || !selectedDropTable) return;
    setIsDropping(true);
    setDropResult(null);
    try {
      const res = await dbClient.dropCustomTable(selectedDropTable);
      setDropResult(res);
      if (res.success) {
        setConfirmDropText('');
        await loadTables();
        if (onTableCreatedOrDropped) {
          onTableCreatedOrDropped(selectedDropTable);
        }
      }
    } catch (err: any) {
      setDropResult({ success: false, message: err.message || 'Failed to drop table.' });
    } finally {
      setIsDropping(false);
    }
  };

  const customTables = tables.filter((t) => !t.isStandard);
  const selectedTableMeta = tables.find((t) => t.fullName === selectedDropTable);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl bg-card border-border shadow-2xl overflow-hidden p-0">
        <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Table2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                Custom Table Management
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Create custom staging tables or drop existing ones with schema introspection.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="create" className="flex items-center gap-1.5 text-xs">
                <Code2 className="w-3.5 h-3.5" />
                <span>Create / Alter Table (DDL)</span>
              </TabsTrigger>
              <TabsTrigger value="drop" className="flex items-center gap-1.5 text-xs">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Drop Table</span>
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: CREATE / ALTER DDL */}
            <TabsContent value="create" className="space-y-3.5 mt-0">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">SQL DDL Execution Script</span>
                <button
                  type="button"
                  onClick={() => setDdlScript(DEFAULT_DDL_TEMPLATE)}
                  className="text-primary hover:underline flex items-center gap-1 text-[11px]"
                >
                  <FileCode2 className="w-3 h-3" />
                  Reset to Template
                </button>
              </div>

              <div className="relative rounded-md border border-border bg-zinc-950 font-mono text-xs overflow-hidden">
                <textarea
                  value={ddlScript}
                  onChange={(e) => setDdlScript(e.target.value)}
                  rows={11}
                  className="w-full p-3 bg-transparent text-emerald-400 focus:outline-none resize-none font-mono text-[11px] leading-relaxed selection:bg-emerald-800/40"
                  placeholder="CREATE TABLE [FIN].[MY_TABLE] (...)"
                  spellCheck={false}
                />
              </div>

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded border border-border/60">
                <Info className="w-4 h-4 text-sky-400 shrink-0" />
                <span>
                  Executed via SQL Server batches separated by <code className="text-foreground font-mono">GO</code>.
                  After execution, the table schema cache is immediately refreshed and discoverable in the switcher.
                </span>
              </div>

              {result && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                    result.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {result.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-0.5">
                    <div className="font-semibold">{result.success ? 'Success' : 'Execution Failed'}</div>
                    <div className="font-mono text-[11px] leading-relaxed break-words">{result.message}</div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleExecuteDDL}
                  disabled={isExecuting || !dbConnected || !ddlScript.trim()}
                  className="gap-2"
                >
                  {isExecuting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  {isExecuting ? 'Executing Script...' : 'Execute DDL Script'}
                </Button>
              </div>
            </TabsContent>

            {/* TAB 2: DROP CUSTOM TABLE */}
            <TabsContent value="drop" className="space-y-4 mt-0">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Select Custom Table to Drop</label>
                {customTables.length === 0 ? (
                  <div className="p-4 rounded-md border border-dashed border-border text-center text-xs text-muted-foreground">
                    No custom staging tables found in the connected database.
                  </div>
                ) : (
                  <select
                    value={selectedDropTable}
                    onChange={(e) => setSelectedDropTable(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  >
                    {customTables.map((t) => (
                      <option key={t.fullName} value={t.fullName}>
                        {t.fullName} ({t.rowCount.toLocaleString()} rows)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedTableMeta && (
                <div className="p-3 bg-muted/40 rounded-lg border border-border/80 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Target Table:</span>
                    <span className="font-mono font-medium text-foreground">{selectedTableMeta.fullName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Current Records:</span>
                    <span className="font-mono text-foreground">
                      {selectedTableMeta.rowCount.toLocaleString()} rows
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Created Date:</span>
                    <span className="font-mono text-muted-foreground">{selectedTableMeta.createDate}</span>
                  </div>
                </div>
              )}

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Irreversible Action:</span> Dropping this table permanently removes
                  its physical structure, indexes, and all staged data from Microsoft SQL Server.
                </div>
              </div>

              {selectedTableMeta && (
                <div className="space-y-2 pt-1">
                  <label className="text-xs text-muted-foreground">
                    To confirm deletion, type <code className="font-mono font-bold text-foreground">DROP</code> below:
                  </label>
                  <input
                    type="text"
                    value={confirmDropText}
                    onChange={(e) => setConfirmDropText(e.target.value)}
                    placeholder="Type DROP to confirm"
                    className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              )}

              {dropResult && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                    dropResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {dropResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-0.5">
                    <div className="font-semibold">{dropResult.success ? 'Table Dropped' : 'Drop Failed'}</div>
                    <div className="font-mono text-[11px] leading-relaxed break-words">{dropResult.message}</div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  variant="destructive"
                  onClick={handleDropTable}
                  disabled={
                    isDropping ||
                    !dbConnected ||
                    !selectedDropTable ||
                    confirmDropText.trim().toUpperCase() !== 'DROP'
                  }
                  className="gap-2"
                >
                  {isDropping ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {isDropping ? 'Dropping Table...' : 'Permanently Drop Table'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="p-3 px-5 border-t border-border bg-muted/10 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
