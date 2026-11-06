import React, { useState, useEffect, useRef } from 'react';
import {
  PlayCircle,
  CheckCircle2,
  AlertOctagon,
  Download,
  Terminal,
  RefreshCw,
  Zap,
  RotateCcw,
  Layers,
  Database,
  ArrowRight,
  ShieldCheck,
  CheckCheck,
  Server,
  AlertTriangle,
  Trash2,
  Upload,
  Code2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { GridCounts, RuleBreakdownItem, SqlScriptSlot, SqlScriptInfo, LoaderDomain } from '../../types/dcloader';
import { dbClient } from '../../lib/dbClient';

interface ExecutionViewProps {
  domain?: LoaderDomain;
  counts: GridCounts;
  fileName: string;
  companyCode: string;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  onRefreshData: () => Promise<void>;
  onNavigateToGrid: (statusFilter?: string) => void;
  onOpenDbConfig: () => void;
  onOpenCleanDialog?: () => void;
  onOpenClearStagedDialog?: () => void;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export const ExecutionView: React.FC<ExecutionViewProps> = ({
  domain = 'inventory',
  counts,
  fileName,
  companyCode,
  dbConnected,
  dbHost,
  dbDatabase,
  onRefreshData,
  onNavigateToGrid,
  onOpenDbConfig,
  onOpenCleanDialog,
  onOpenClearStagedDialog,
}) => {
  const tableName = domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]';
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [executionMode, setExecutionMode] = useState<'dryrun' | 'loader'>('dryrun');
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      level: dbConnected ? 'info' : 'warn',
      message: dbConnected
        ? `Execution console connected to SQL Server at ${dbHost} [${dbDatabase}]. Target table: ${tableName}.`
        : `SQL Server database is disconnected. Please connect before executing SQL scripts.`,
    },
  ]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [ruleBreakdown, setRuleBreakdown] = useState<RuleBreakdownItem[]>([]);
  const [activeScripts, setActiveScripts] = useState<Record<SqlScriptSlot, SqlScriptInfo> | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const loadScripts = async () => {
    try {
      const all = await dbClient.getAllSqlScripts(domain);
      setActiveScripts(all);
    } catch (_) {}
  };

  useEffect(() => {
    loadScripts();
  }, [domain]);

  const handleUploadScript = async (slot: SqlScriptSlot) => {
    try {
      const res = await dbClient.openSqlFile();
      if (!res.canceled && res.fileContent && res.fileName) {
        const updated = await dbClient.setSqlScript(
          slot,
          {
            name: res.fileName,
            content: res.fileContent,
            filePath: res.filePath,
          },
          domain
        );

        try {
          const storageKey = `custom_sql_scripts_${domain}`;
          const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
          stored[slot] = {
            name: res.fileName,
            content: res.fileContent,
            filePath: res.filePath,
          };
          localStorage.setItem(storageKey, JSON.stringify(stored));
        } catch (_) {}

        setActiveScripts((prev) => (prev ? { ...prev, [slot]: updated } : null));
        addLog('info', `Configured custom script for ${updated.label}: [${res.fileName}]`);
      }
    } catch (err: any) {
      addLog('error', `Failed to upload script: ${err.message}`);
    }
  };

  const steps = [
    'Verify SQL Server Connection & [FIN].[KAS_DC_LOADS]',
    'Execute Script Batch (Set-Based SQL Rules)',
    'Traverse Mandatory Fields, Status Codes, and LPNs',
    'Update STATUS_FLAG and RS_MESSAGE_TEXT',
    'Commit Transaction & Refresh Grid View',
  ];

  const addLog = (level: LogEntry['level'], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp,
        level,
        message,
      },
    ]);
  };

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleRunExecution = async () => {
    if (!dbConnected) {
      addLog('error', 'SQL Server connection required. Please connect to SQL Server first.');
      onOpenDbConfig();
      return;
    }

    if (counts.total === 0) {
      addLog('warn', 'No records found in [FIN].[KAS_DC_LOADS]. Please upload a CSV file to stage records first.');
      return;
    }

    setIsRunning(true);
    setIsCompleted(false);
    setProgress(10);
    setActiveStep(1);

    if (executionMode === 'dryrun') {
      const currentScript = activeScripts?.dry_run;
      const isLoaded = Boolean(currentScript && currentScript.content && currentScript.content.trim().length > 0);
      if (!isLoaded) {
        addLog('error', 'No Dry Run Validation script loaded. Please configure a script in SQL Scripts Config.');
        setIsRunning(false);
        return;
      }
      const scriptLabel = `[${currentScript!.currentFileName || currentScript!.defaultFileName}] (${currentScript!.isCustom ? 'Custom Uploaded' : 'Default Script'})`;

      addLog('info', `=== Launching SQL Dry Run Validation Batch ===`);
      addLog('info', `Server: ${dbHost} | Database: ${dbDatabase} | Staging Table: ${tableName}`);
      addLog('info', `Executing SQL Script: ${scriptLabel}`);

      setProgress(35);
      setActiveStep(2);

      try {
        const res = await dbClient.executeDryRun(domain);
        setProgress(70);
        setActiveStep(3);

        if (res.success) {
          addLog('success', `SQL script batch executed successfully.`);
          addLog('info', `Summary: Total ${res.counts.total} | Verified: ${res.counts.valid} | Errors: ${res.counts.errors}`);

          if (res.ruleBreakdown && res.ruleBreakdown.length > 0) {
            setRuleBreakdown(res.ruleBreakdown);
            addLog('info', `--- Validation Rules Breakdown ---`);
            res.ruleBreakdown.forEach((rb) => {
              if (rb.errorCount > 0) {
                addLog('warn', `  • ${rb.ruleName}: ${rb.errorCount} row(s) failed`);
              } else {
                addLog('info', `  • ${rb.ruleName}: Passed (0 errors)`);
              }
            });
          }

          setProgress(90);
          setActiveStep(4);
          await onRefreshData();

          setProgress(100);
          setActiveStep(5);
          setIsCompleted(true);
          addLog('success', `Grid state refreshed directly from SQL Server ${tableName}.`);
        } else {
          addLog('error', `Execution failed: ${res.message}`);
          setProgress(100);
        }
      } catch (err: any) {
        addLog('error', `Database execution error: ${err.message}`);
        setProgress(100);
      } finally {
        setIsRunning(false);
      }
    } else {
      // Live Loader Script
      const currentScript = activeScripts?.loader;
      const isLoaded = Boolean(currentScript && currentScript.content && currentScript.content.trim().length > 0);
      if (!isLoaded) {
        addLog('error', 'No Loader script loaded. Please configure a script in SQL Scripts Config.');
        setIsRunning(false);
        return;
      }
      const scriptLabel = `[${currentScript!.currentFileName || currentScript!.defaultFileName}] (${currentScript!.isCustom ? 'Custom Uploaded' : 'Default Script'})`;

      addLog('info', `=== Launching Live Loader SQL Batch Execution ===`);
      addLog('info', `Target: ${dbHost} / [${dbDatabase}].${tableName}`);
      addLog('info', `Executing SQL Script: ${scriptLabel} on records with STATUS_FLAG = 'V'...`);

      setProgress(35);
      setActiveStep(2);

      try {
        const res = await dbClient.executeLoader(domain);
        setProgress(70);
        setActiveStep(3);

        if (res.success) {
          if (res.loaded > 0) {
            addLog('success', `Transaction committed! Batch ID: [${res.batchId}].`);
            addLog('success', `${res.loaded} records loaded into Ross ERP.`);
          } else {
            addLog('warn', `${res.message}`);
          }

          setProgress(90);
          setActiveStep(4);
          await onRefreshData();

          setProgress(100);
          setActiveStep(5);
          setIsCompleted(true);
          addLog('info', `Reloaded updated records from SQL Server ${tableName}.`);
        } else {
          addLog('error', `Loader script error: ${res.message}`);
          setProgress(100);
        }
      } catch (err: any) {
        addLog('error', `Loader error: ${err.message}`);
        setProgress(100);
      } finally {
        setIsRunning(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* Top Disconnected Alert Banner */}
      {!dbConnected && (
        <div className="bg-rose-50 dark:bg-rose-950/90 border-b border-rose-200 dark:border-rose-500/50 px-4 py-2 flex items-center justify-between text-xs text-rose-900 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 animate-bounce" />
            <span className="font-semibold">
              SQL Server Disconnected:
            </span>
            <span>
              Scripts are executed directly in Microsoft SQL Server against <code className="font-mono bg-rose-100 dark:bg-rose-900/50 text-rose-950 dark:text-rose-200 px-1 py-0.5 rounded">[FIN].[KAS_DC_LOADS]</code>. Connect to SQL Server before executing scripts.
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

      {/* Top Banner */}
      <div className="p-4 bg-card border-b border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-secondary border border-border flex items-center justify-center text-foreground">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span>SQL Execution Engine</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {executionMode === 'dryrun' ? 'DRY RUN' : 'LOADER'}
              </Badge>
              {dbConnected ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-mono font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  ONLINE: {dbHost}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-400 font-mono font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  OFFLINE
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Executes high-performance SQL scripts directly against [FIN].[KAS_DC_LOADS] in SQL Server.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {onOpenClearStagedDialog && dbConnected && (
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenClearStagedDialog}
              disabled={isRunning || counts.total === 0}
              className="text-xs h-8 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              title="Clear all staged rows from [FIN].[KAS_DC_LOADS]"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5 text-rose-500" />
              Clear Staged Data
            </Button>
          )}

          {onOpenCleanDialog && dbConnected && (
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenCleanDialog}
              className="text-xs h-8 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-destructive/30 hover:bg-rose-50 dark:hover:bg-destructive/10"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5 text-rose-600 dark:text-rose-400" />
              Clean Tables
            </Button>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center rounded-md bg-secondary/80 p-0.5 border border-border text-xs">
            <button
              onClick={() => !isRunning && setExecutionMode('dryrun')}
              className={`px-3 py-1 rounded-sm text-xs font-medium transition-all ${
                executionMode === 'dryrun'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Dry Run Script
            </button>
            <button
              onClick={() => !isRunning && setExecutionMode('loader')}
              className={`px-3 py-1 rounded-sm text-xs font-medium transition-all ${
                executionMode === 'loader'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Loader Script
            </button>
          </div>

          {/* Active script indicator & quick upload */}
          <div className="flex items-center gap-1.5 bg-secondary/40 px-2.5 py-1 rounded-md border border-border text-xs">
            <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="flex flex-col text-left">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">
                {executionMode === 'dryrun' ? 'Validation Script' : 'Loader Script'}
              </span>
              <span className={`text-[11px] font-mono font-medium truncate max-w-[140px] ${
                (executionMode === 'dryrun' ? activeScripts?.dry_run?.content : activeScripts?.loader?.content)
                  ? 'text-foreground'
                  : 'text-muted-foreground italic'
              }`}>
                {executionMode === 'dryrun'
                  ? (activeScripts?.dry_run?.currentFileName || activeScripts?.dry_run?.defaultFileName || 'Default Validation')
                  : (activeScripts?.loader?.currentFileName || activeScripts?.loader?.defaultFileName || 'Default Loader')}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleUploadScript(executionMode === 'dryrun' ? 'dry_run' : 'loader')}
              className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground ml-1"
              title="Upload custom script for this slot"
            >
              <Upload className="w-3 h-3 mr-1" />
              Upload
            </Button>
          </div>

          <Button
            size="sm"
            onClick={dbConnected ? handleRunExecution : onOpenDbConfig}
            disabled={
              isRunning ||
              (!dbConnected
                ? false
                : counts.total === 0 ||
                  !(executionMode === 'dryrun' ? activeScripts?.dry_run?.content : activeScripts?.loader?.content))
            }
            className="text-xs font-medium h-8 shadow-sm"
            title={
              !(executionMode === 'dryrun' ? activeScripts?.dry_run?.content : activeScripts?.loader?.content)
                ? 'Please configure a script in SQL Scripts Config first'
                : ''
            }
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Executing SQL...
              </>
            ) : !dbConnected ? (
              <>
                <Server className="w-3.5 h-3.5 mr-1.5" />
                Connect DB First
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                {executionMode === 'dryrun' ? 'Run Dry Run' : 'Execute Loader'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main Execution Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-background">
        {/* Status Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div
            onClick={() => onNavigateToGrid('ALL')}
            className="p-3.5 rounded-lg bg-card border border-border hover:border-zinc-700 cursor-pointer transition-all shadow-sm"
          >
            <div className="text-muted-foreground text-xs font-medium">Total Staged Records</div>
            <div className="text-xl font-bold font-mono text-foreground mt-1">
              {dbConnected ? counts.total.toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">[FIN].[KAS_DC_LOADS]</div>
          </div>

          <div
            onClick={() => onNavigateToGrid('V')}
            className="p-3.5 rounded-lg bg-card border border-border hover:border-emerald-500/30 cursor-pointer transition-all shadow-sm"
          >
            <div className="text-emerald-400 text-xs font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Verified Valid (V)
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
              {dbConnected ? counts.valid.toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Ready for loader</div>
          </div>

          <div
            onClick={() => onNavigateToGrid('E')}
            className="p-3.5 rounded-lg bg-card border border-border hover:border-rose-500/30 cursor-pointer transition-all shadow-sm"
          >
            <div className="text-rose-400 text-xs font-medium flex items-center gap-1.5">
              <AlertOctagon className="w-3.5 h-3.5" /> Error Quarantine (E)
            </div>
            <div className="text-xl font-bold font-mono text-rose-400 mt-1">
              {dbConnected ? counts.error.toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Require correction</div>
          </div>

          <div
            onClick={() => onNavigateToGrid('L')}
            className="p-3.5 rounded-lg bg-card border border-border hover:border-zinc-700 cursor-pointer transition-all shadow-sm"
          >
            <div className="text-foreground text-xs font-medium flex items-center gap-1.5">
              <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" /> Loaded into Ross (L)
            </div>
            <div className="text-xl font-bold font-mono text-foreground mt-1">
              {dbConnected ? counts.loaded.toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Batch committed</div>
          </div>
        </div>

        {/* Progress & Stepper */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4 text-foreground" />
                Pipeline Execution Steps ({progress}%)
              </CardTitle>
              {isCompleted && (
                <div className="flex items-center gap-2">
                  <Badge variant="success" className="text-xs">
                    Execution Finished
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigateToGrid()}
                    className="h-7 text-xs font-medium"
                  >
                    View Grid Records
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              )}
            </div>
            <Progress value={progress} className="mt-2" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-1">
              {steps.map((st, idx) => {
                const stepNum = idx + 1;
                const isPassed = activeStep > stepNum || isCompleted;
                const isCurrent = activeStep === stepNum && isRunning;

                return (
                  <div
                    key={idx}
                    className={`p-2 rounded-md border text-xs flex items-start gap-2 transition-all ${
                      isPassed
                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                        : isCurrent
                        ? 'border-border bg-secondary text-foreground shadow-sm'
                        : 'border-border/60 bg-secondary/30 text-muted-foreground'
                    }`}
                  >
                    <span className="font-mono font-medium text-muted-foreground mt-0.5 text-[11px]">
                      0{stepNum}
                    </span>
                    <span className="line-clamp-2 leading-tight text-[11px]">{st}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 8 Enterprise Validation Rules Breakdown */}
        {ruleBreakdown.length > 0 && (
          <Card className="border-border shadow-sm">
            <CardHeader className="py-2.5 px-4 border-b border-border flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <CardTitle className="text-xs font-semibold text-foreground">
                  SQL Enterprise Rule Breakdown (Set-Based CTE Evaluation)
                </CardTitle>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono">
                8 Enterprise Rules Evaluated
              </Badge>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {ruleBreakdown.map((rule, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2 rounded-md border text-xs font-mono transition-all ${
                      rule.errorCount > 0
                        ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
                        : 'border-border bg-secondary/30 text-muted-foreground'
                    }`}
                  >
                    <span className="truncate pr-2 font-sans font-medium text-[11px]">{rule.ruleName}</span>
                    <Badge
                      variant={rule.errorCount > 0 ? 'destructive' : 'success'}
                      className="text-[10px] shrink-0 font-mono px-2 py-0.5"
                    >
                      {rule.errorCount > 0 ? `${rule.errorCount} Errors` : 'Passed'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live SQL Console Terminal */}
        <Card className="border-border flex flex-col h-80 shadow-sm">
          <CardHeader className="py-2 px-4 border-b border-border flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-xs font-mono font-medium text-foreground">
                SQL Execution Log ([FIN].[KAS_DC_LOADS])
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogs([])}
                className="h-6 text-[11px] px-2 font-mono"
              >
                Clear Log
              </Button>
            </div>
          </CardHeader>
          <CardContent
            ref={terminalRef}
            className="flex-1 p-3 font-mono text-xs overflow-y-auto space-y-1 terminal-pane select-text rounded-b-md"
          >
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed text-[11px]">
                <span className="opacity-40 shrink-0 text-inherit">[{log.timestamp}]</span>
                <span
                  className={`shrink-0 font-bold ${
                    log.level === 'error'
                      ? 'text-rose-400'
                      : log.level === 'warn'
                      ? 'text-amber-400'
                      : log.level === 'success'
                      ? 'text-emerald-400'
                      : 'opacity-60'
                  }`}
                >
                  [{log.level.toUpperCase()}]
                </span>
                <span
                  className={
                    log.level === 'error'
                      ? 'text-rose-300'
                      : log.level === 'warn'
                      ? 'text-amber-200'
                      : log.level === 'success'
                      ? 'text-emerald-300'
                      : 'opacity-80'
                  }
                >
                  {log.message}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
