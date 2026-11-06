import React, { useState, useEffect } from 'react';
import {
  FileCode,
  Upload,
  RefreshCw,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Code2,
  Database,
  Copy,
  Check,
  Eye,
  Sliders,
  Package,
  ShoppingCart,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { dbClient } from '../../lib/dbClient';
import { SqlScriptSlot, SqlScriptInfo, LoaderDomain } from '../../types/dcloader';

interface SqlScriptsViewProps {
  domain?: LoaderDomain;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  onRefreshData?: () => void;
  onOpenDbConfig: () => void;
  onDomainChange?: (domain: LoaderDomain) => void;
}

export const SqlScriptsView: React.FC<SqlScriptsViewProps> = ({
  domain: initialDomain = 'inventory',
  dbConnected,
  dbHost,
  dbDatabase,
  onRefreshData,
  onOpenDbConfig,
  onDomainChange,
}) => {
  const [activeDomain, setActiveDomain] = useState<LoaderDomain>(initialDomain);
  const [scripts, setScripts] = useState<Record<SqlScriptSlot, SqlScriptInfo> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [executingSlot, setExecutingSlot] = useState<SqlScriptSlot | null>(null);
  const [executionMessage, setExecutionMessage] = useState<{
    slot: SqlScriptSlot;
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Script editor / viewer modal
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [activeViewingSlot, setActiveViewingSlot] = useState<SqlScriptSlot | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [copied, setCopied] = useState(false);

  // Sync with prop when external domain changes
  useEffect(() => {
    if (initialDomain && initialDomain !== activeDomain) {
      setActiveDomain(initialDomain);
    }
  }, [initialDomain]);

  // Load scripts from backend for the active domain
  const loadScripts = async (targetDomain = activeDomain) => {
    setLoading(true);
    try {
      const all = await dbClient.getAllSqlScripts(targetDomain);
      setScripts(all);
    } catch (err) {
      console.error('Failed to load SQL scripts configuration:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScripts(activeDomain);
  }, [activeDomain]);

  // Handle uploading / replacing with custom script from a file
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
          activeDomain
        );

        // Also persist in localStorage for persistence across reloads
        try {
          const storageKey = `custom_sql_scripts_${activeDomain}`;
          const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
          stored[slot] = {
            name: res.fileName,
            content: res.fileContent,
            filePath: res.filePath,
          };
          localStorage.setItem(storageKey, JSON.stringify(stored));
        } catch (_) {}

        setScripts((prev) => (prev ? { ...prev, [slot]: updated } : null));
        setExecutionMessage({
          slot,
          type: 'success',
          text: `Custom script active: "${res.fileName}". Replaced default script.`,
        });
      }
    } catch (err: any) {
      setExecutionMessage({
        slot,
        type: 'error',
        text: `Failed to upload script: ${err.message}`,
      });
    }
  };

  // Restore default script for a slot
  const handleRestoreDefaultScript = async (slot: SqlScriptSlot) => {
    try {
      const updated = await dbClient.loadDefaultSqlScript(slot, activeDomain);

      try {
        const storageKey = `custom_sql_scripts_${activeDomain}`;
        const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
        delete stored[slot];
        localStorage.setItem(storageKey, JSON.stringify(stored));
      } catch (_) {}

      setScripts((prev) => (prev ? { ...prev, [slot]: updated } : null));
      setExecutionMessage({
        slot,
        type: 'success',
        text: `Restored hardcoded default script for "${updated.label}".`,
      });
    } catch (err: any) {
      setExecutionMessage({
        slot,
        type: 'error',
        text: `Failed to restore default script: ${err.message}`,
      });
    }
  };

  // Restore all default scripts for the active domain
  const handleRestoreAllDefaults = async () => {
    setLoading(true);
    try {
      const all = await dbClient.loadAllDefaultSqlScripts(activeDomain);
      try {
        localStorage.removeItem(`custom_sql_scripts_${activeDomain}`);
      } catch (_) {}
      setScripts(all);
      setExecutionMessage({
        slot: 'create_table',
        type: 'success',
        text: `Restored all default scripts for ${activeDomain === 'sales_orders' ? 'Sales Orders' : 'DC Inventory'}.`,
      });
    } catch (err: any) {
      console.error('Failed to restore all default scripts:', err);
    } finally {
      setLoading(false);
    }
  };

  // Execute Table Creation script explicitly
  const handleExecuteCreateTable = async () => {
    if (!dbConnected) {
      onOpenDbConfig();
      return;
    }

    setExecutingSlot('create_table');
    setExecutionMessage(null);
    try {
      const res = await dbClient.executeCreateTable(activeDomain);
      setExecutionMessage({
        slot: 'create_table',
        type: res.success ? 'success' : 'error',
        text: res.message,
      });
      if (res.success && onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      setExecutionMessage({
        slot: 'create_table',
        type: 'error',
        text: `Execution failed: ${err.message}`,
      });
    } finally {
      setExecutingSlot(null);
    }
  };

  // Open view/edit modal
  const handleOpenViewer = (slot: SqlScriptSlot) => {
    if (!scripts || !scripts[slot]) return;
    setActiveViewingSlot(slot);
    setEditorContent(scripts[slot].content || '');
    setCopied(false);
    setViewModalOpen(true);
  };

  // Save changes from viewer as custom script
  const handleSaveEditorContent = async () => {
    if (!activeViewingSlot || !scripts) return;
    const current = scripts[activeViewingSlot];
    const customName = current.isCustom
      ? current.currentFileName
      : `custom_${current.defaultFileName}`;

    try {
      const updated = await dbClient.setSqlScript(
        activeViewingSlot,
        {
          name: customName,
          content: editorContent,
          filePath: current.filePath,
        },
        activeDomain
      );

      try {
        const storageKey = `custom_sql_scripts_${activeDomain}`;
        const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
        stored[activeViewingSlot] = {
          name: customName,
          content: editorContent,
          filePath: current.filePath,
        };
        localStorage.setItem(storageKey, JSON.stringify(stored));
      } catch (_) {}

      setScripts((prev) => (prev ? { ...prev, [activeViewingSlot]: updated } : null));
      setViewModalOpen(false);
      setExecutionMessage({
        slot: activeViewingSlot,
        type: 'success',
        text: `Saved modified script for "${updated.label}". Custom script is now active.`,
      });
    } catch (err: any) {
      alert(`Error saving script: ${err.message}`);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(editorContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const slotsOrder: SqlScriptSlot[] = ['create_table', 'dry_run', 'loader', 'clean_tables'];

  const customCount = scripts
    ? Object.values(scripts).filter((s) => s.isCustom && s.content && s.content.trim().length > 0).length
    : 0;

  return (
    <div className="h-full flex flex-col p-6 space-y-5 overflow-y-auto">
      {/* Header section with Domain Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between border-b border-border pb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Sliders className="w-5 h-5 text-foreground" />
              SQL Scripts Configuration
            </h1>
            <Badge variant="outline" className="text-xs font-mono">
              {customCount > 0 ? `${customCount} Custom Overridden` : 'Default In-Use'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Built-in hardcoded default scripts are active by default. Upload your custom SQL file only if you need to override a script.
          </p>
        </div>

        {/* Domain Switcher & Global Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Domain tabs */}
          <div className="flex items-center rounded-md bg-secondary/80 p-0.5 border border-border text-xs">
            <button
              onClick={() => {
                setActiveDomain('inventory');
                if (onDomainChange) onDomainChange('inventory');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-all ${
                activeDomain === 'inventory'
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              DC Inventory
            </button>
            <button
              onClick={() => {
                setActiveDomain('sales_orders');
                if (onDomainChange) onDomainChange('sales_orders');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-all ${
                activeDomain === 'sales_orders'
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Sales Orders
            </button>
          </div>

          {customCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestoreAllDefaults}
              disabled={loading}
              className="text-xs text-muted-foreground hover:text-foreground"
              title="Reset all scripts in this domain back to embedded defaults"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Restore All Defaults
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadScripts(activeDomain)}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenDbConfig}
            className={`text-xs ${
              dbConnected
                ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                : 'border-rose-500/30 text-rose-700 dark:text-rose-400 bg-rose-500/10'
            }`}
          >
            <Database className="w-3.5 h-3.5 mr-1.5" />
            {dbConnected ? `${dbHost} [${dbDatabase}]` : 'Connect DB'}
          </Button>
        </div>
      </div>

      {/* Grid of script cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {slotsOrder.map((slot) => {
          const item = scripts ? scripts[slot] : null;
          if (!item) return null;

          const isCustom = item.isCustom && item.content && item.content.trim().length > 0;
          const isExecuting = executingSlot === slot;
          const msg = executionMessage?.slot === slot ? executionMessage : null;

          return (
            <Card
              key={slot}
              className={`bg-card border-border shadow-sm transition-all hover:border-muted-foreground/30 ${
                isCustom ? 'ring-1 ring-border' : ''
              }`}
            >
              <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Code2 className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-semibold text-foreground">
                        {item.label}
                      </CardTitle>
                    </div>
                    <CardDescription className="text-[11px] text-muted-foreground line-clamp-2">
                      {item.description}
                    </CardDescription>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase font-mono px-2 py-0.5 whitespace-nowrap ${
                      isCustom
                        ? 'border-sky-500/30 text-sky-700 dark:text-sky-300 bg-sky-500/10'
                        : 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                    }`}
                  >
                    {isCustom ? (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                        Custom Script
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Default (In-Use)
                      </span>
                    )}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 pt-2 space-y-3">
                {/* Active script file details */}
                <div className="bg-secondary/40 rounded-md border border-border p-2.5 font-mono text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase text-muted-foreground font-sans font-bold">
                      Active Script:
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {item.content ? `${item.content.length.toLocaleString()} chars` : '0 chars'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-foreground font-semibold truncate">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-foreground" />
                    <span className="truncate">
                      {item.currentFileName || item.defaultFileName}
                    </span>
                  </div>
                  {isCustom && item.filePath && (
                    <div className="text-[10px] text-muted-foreground truncate" title={item.filePath}>
                      File: {item.filePath}
                    </div>
                  )}
                  {isCustom && item.lastUpdated && (
                    <div className="text-[10px] text-muted-foreground">
                      Updated: {new Date(item.lastUpdated).toLocaleTimeString()}
                    </div>
                  )}
                  {!isCustom && (
                    <div className="text-[10px] text-muted-foreground">
                      Hardcoded embedded default script • In-use
                    </div>
                  )}
                </div>

                {/* Quick preview snippet */}
                <div className="relative group">
                  <pre className="bg-background border border-border rounded p-2 text-[10px] font-mono text-muted-foreground max-h-20 overflow-hidden select-text">
                    {(item.content || '').slice(0, 300)}...
                  </pre>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenViewer(slot)}
                    className="absolute top-1 right-1 h-6 px-1.5 text-[10px]"
                  >
                    <Eye className="w-3 h-3 mr-1" /> View Full
                  </Button>
                </div>

                {/* Message feedback */}
                {msg && (
                  <div
                    className={`text-[11px] p-2 rounded flex items-start gap-1.5 border ${
                      msg.type === 'success'
                        ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {msg.type === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    )}
                    <span className="leading-tight">{msg.text}</span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant={isCustom ? 'secondary' : 'default'}
                      onClick={() => handleUploadScript(slot)}
                      className="text-xs h-7 px-2.5"
                      title="Upload your own SQL script file to replace the default"
                    >
                      <Upload className="w-3 h-3 mr-1.5" />
                      {isCustom ? 'Replace Script' : 'Upload Script'}
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenViewer(slot)}
                      className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                    >
                      <Code2 className="w-3 h-3 mr-1" />
                      Edit
                    </Button>

                    {isCustom && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRestoreDefaultScript(slot)}
                        className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                        title="Revert back to the hardcoded default script"
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Restore Default
                      </Button>
                    )}
                  </div>

                  {slot === 'create_table' && (
                    <Button
                      size="sm"
                      onClick={handleExecuteCreateTable}
                      disabled={isExecuting}
                      className="text-xs font-medium h-7 px-2.5"
                      title={!dbConnected ? 'Connect database to execute table script' : 'Execute table creation DDL script'}
                    >
                      <Play className={`w-3 h-3 mr-1 ${isExecuting ? 'animate-spin' : ''}`} />
                      {isExecuting ? 'Executing...' : !dbConnected ? 'Connect DB' : 'Execute Script'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Code Viewer & Editor Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col bg-card border-border text-foreground p-6">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-foreground" />
                  {activeViewingSlot && scripts && scripts[activeViewingSlot]?.label}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  File:{' '}
                  <span className="font-mono text-foreground font-semibold">
                    {activeViewingSlot && scripts && scripts[activeViewingSlot]?.currentFileName}
                  </span>{' '}
                  ({activeDomain === 'sales_orders' ? 'Sales Orders' : 'DC Inventory'}) • Edit directly or copy SQL script
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyCode}
                  className="text-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 mr-1" /> Copy SQL
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Editor Textarea */}
          <div className="flex-1 min-h-0 border border-border rounded-md overflow-hidden bg-background relative">
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              spellCheck={false}
              className="w-full h-full p-4 font-mono text-xs bg-transparent text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed"
              placeholder="Paste or write T-SQL statements here..."
            />
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
            <div className="text-[11px] text-muted-foreground font-mono">
              {editorContent.split('\n').length} lines • {editorContent.length.toLocaleString()} characters
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveEditorContent}
                className="text-xs font-medium"
              >
                Save as Active Script
              </Button>
              {activeViewingSlot === 'create_table' && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await handleSaveEditorContent();
                    await handleExecuteCreateTable();
                  }}
                  disabled={executingSlot === 'create_table'}
                  className="text-xs font-medium"
                >
                  <Play className={`w-3 h-3 mr-1 ${executingSlot === 'create_table' ? 'animate-spin' : ''}`} />
                  Save & Execute
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
