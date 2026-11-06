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
  ExternalLink,
  Copy,
  Check,
  Eye,
  Sliders,
  Download,
  Trash2,
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
import { SqlScriptSlot, SqlScriptInfo } from '../../types/dcloader';

interface SqlScriptsViewProps {
  dbConnected: boolean;
  dbHost: string;
  dbDatabase: string;
  onRefreshData?: () => void;
  onOpenDbConfig: () => void;
}

export const SqlScriptsView: React.FC<SqlScriptsViewProps> = ({
  dbConnected,
  dbHost,
  dbDatabase,
  onRefreshData,
  onOpenDbConfig,
}) => {
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

  // Load scripts from backend / dbManager
  const loadScripts = async () => {
    setLoading(true);
    try {
      const all = await dbClient.getAllSqlScripts();
      setScripts(all);
    } catch (err) {
      console.error('Failed to load SQL scripts configuration:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, []);

  // Handle uploading / selecting custom script for a slot
  const handleUploadScript = async (slot: SqlScriptSlot) => {
    try {
      const res = await dbClient.openSqlFile();
      if (!res.canceled && res.fileContent && res.fileName) {
        const updated = await dbClient.setSqlScript(slot, {
          name: res.fileName,
          content: res.fileContent,
          filePath: res.filePath,
        });

        // Also persist in localStorage for persistence across reloads
        try {
          const stored = JSON.parse(localStorage.getItem('custom_sql_scripts') || '{}');
          stored[slot] = {
            name: res.fileName,
            content: res.fileContent,
            filePath: res.filePath,
          };
          localStorage.setItem('custom_sql_scripts', JSON.stringify(stored));
        } catch (_) {}

        setScripts((prev) => (prev ? { ...prev, [slot]: updated } : null));
        setExecutionMessage({
          slot,
          type: 'success',
          text: `Successfully uploaded and configured custom script: "${res.fileName}"`,
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

  // Upload default script for a slot
  const handleLoadDefaultScript = async (slot: SqlScriptSlot) => {
    try {
      const updated = await dbClient.loadDefaultSqlScript(slot);

      try {
        const stored = JSON.parse(localStorage.getItem('custom_sql_scripts') || '{}');
        delete stored[slot];
        localStorage.setItem('custom_sql_scripts', JSON.stringify(stored));
      } catch (_) {}

      setScripts((prev) => (prev ? { ...prev, [slot]: updated } : null));
      setExecutionMessage({
        slot,
        type: 'success',
        text: `Successfully uploaded default script: "${updated.defaultFileName}"`,
      });
    } catch (err: any) {
      setExecutionMessage({
        slot,
        type: 'error',
        text: `Failed to upload default script: ${err.message}`,
      });
    }
  };

  // Upload all default scripts
  const handleLoadAllDefaults = async () => {
    setLoading(true);
    try {
      const all = await dbClient.loadAllDefaultSqlScripts();
      setScripts(all);
      setExecutionMessage({
        slot: 'create_table',
        type: 'success',
        text: 'Successfully uploaded all default scripts.',
      });
    } catch (err: any) {
      console.error('Failed to upload all default scripts:', err);
    } finally {
      setLoading(false);
    }
  };

  // Clear script for a slot (resets back to empty)
  const handleClearScript = async (slot: SqlScriptSlot) => {
    try {
      const updated = await dbClient.clearSqlScript(slot);

      try {
        const stored = JSON.parse(localStorage.getItem('custom_sql_scripts') || '{}');
        delete stored[slot];
        localStorage.setItem('custom_sql_scripts', JSON.stringify(stored));
      } catch (_) {}

      setScripts((prev) => (prev ? { ...prev, [slot]: updated } : null));
      setExecutionMessage({
        slot,
        type: 'success',
        text: `Cleared SQL script for "${updated.label}". Slot is now empty.`,
      });
    } catch (err: any) {
      setExecutionMessage({
        slot,
        type: 'error',
        text: `Failed to clear script: ${err.message}`,
      });
    }
  };

  // Clear all scripts back to empty
  const handleClearAllScripts = async () => {
    setLoading(true);
    try {
      const all = await dbClient.clearAllSqlScripts();
      try {
        localStorage.removeItem('custom_sql_scripts');
      } catch (_) {}
      setScripts(all);
      setExecutionMessage({
        slot: 'create_table',
        type: 'success',
        text: 'Cleared all SQL scripts. All slots are now empty.',
      });
    } catch (err: any) {
      console.error('Failed to clear all scripts:', err);
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
      const res = await dbClient.executeCreateTable();
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

  // Save changes from viewer
  const handleSaveEditorContent = async () => {
    if (!activeViewingSlot || !scripts) return;
    const current = scripts[activeViewingSlot];
    const isLoaded = Boolean(current.isLoaded && current.content && current.content.trim().length > 0);
    const customName = isLoaded
      ? (current.isCustom ? current.currentFileName : `custom_${current.defaultFileName}`)
      : `custom_${current.defaultFileName}`;

    try {
      const updated = await dbClient.setSqlScript(activeViewingSlot, {
        name: customName,
        content: editorContent,
        filePath: current.filePath,
      });

      try {
        const stored = JSON.parse(localStorage.getItem('custom_sql_scripts') || '{}');
        stored[activeViewingSlot] = {
          name: customName,
          content: editorContent,
          filePath: current.filePath,
        };
        localStorage.setItem('custom_sql_scripts', JSON.stringify(stored));
      } catch (_) {}

      setScripts((prev) => (prev ? { ...prev, [activeViewingSlot]: updated } : null));
      setViewModalOpen(false);
      setExecutionMessage({
        slot: activeViewingSlot,
        type: 'success',
        text: `Saved modified SQL script for "${updated.label}".`,
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

  const loadedCount = scripts
    ? Object.values(scripts).filter((s) => s.isLoaded && s.content && s.content.trim().length > 0).length
    : 0;

  const customCount = scripts
    ? Object.values(scripts).filter((s) => s.isCustom && s.isLoaded && s.content && s.content.trim().length > 0).length
    : 0;

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto">
      {/* Header section */}
      <div className="flex items-center justify-between border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Sliders className="w-5 h-5 text-foreground" />
              SQL Scripts Configuration
            </h1>
            <Badge variant="outline" className="text-xs font-mono">
              {loadedCount === 0
                ? '0 / 4 Loaded (Empty)'
                : `${loadedCount} / 4 Loaded ${customCount > 0 ? `(${customCount} Custom)` : '(Default)'}`}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Scripts start empty by default. Upload custom script files or upload default scripts after startup.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadAllDefaults}
            disabled={loading}
            className="text-xs"
            title="Upload all default scripts"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Upload All Default Scripts
          </Button>

          {loadedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAllScripts}
              disabled={loading}
              className="text-xs text-muted-foreground hover:text-rose-500"
              title="Clear all active scripts back to empty"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Clear All
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={loadScripts}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Reload Scripts
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

          const isLoaded = Boolean(item.isLoaded && item.content && item.content.trim().length > 0);
          const isExecuting = executingSlot === slot;
          const msg = executionMessage?.slot === slot ? executionMessage : null;

          return (
            <Card
              key={slot}
              className={`bg-card border-border shadow-sm transition-all hover:border-muted-foreground/30 ${
                item.isCustom && isLoaded ? 'ring-1 ring-border' : ''
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

                  {isLoaded ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 whitespace-nowrap ${
                        item.isCustom ? '' : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      }`}
                    >
                      {item.isCustom ? (
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
                          Custom Uploaded
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Default Script
                        </span>
                      )}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-mono px-2 py-0.5 whitespace-nowrap text-muted-foreground border-dashed"
                    >
                      Empty / Not Loaded
                    </Badge>
                  )}
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
                      {isLoaded ? `${item.content.length.toLocaleString()} chars` : '0 chars (Empty)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-foreground font-semibold truncate">
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${isLoaded ? 'text-foreground' : 'text-muted-foreground'}`} />
                    <span className={`truncate ${isLoaded ? '' : 'text-muted-foreground font-normal italic'}`}>
                      {isLoaded ? item.currentFileName : 'No script loaded'}
                    </span>
                  </div>
                  {isLoaded && item.filePath && (
                    <div className="text-[10px] text-muted-foreground truncate" title={item.filePath}>
                      Path: {item.filePath}
                    </div>
                  )}
                  {isLoaded && item.lastUpdated && (
                    <div className="text-[10px] text-muted-foreground">
                      Updated: {new Date(item.lastUpdated).toLocaleTimeString()}
                    </div>
                  )}
                  {!isLoaded && (
                    <div className="text-[10px] text-muted-foreground">
                      Default script: <span className="font-mono text-foreground">{item.defaultFileName}</span>
                    </div>
                  )}
                </div>

                {/* Quick preview snippet */}
                <div className="relative group">
                  {isLoaded ? (
                    <>
                      <pre className="bg-background border border-border rounded p-2 text-[10px] font-mono text-muted-foreground max-h-20 overflow-hidden select-text">
                        {item.content.slice(0, 300)}...
                      </pre>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenViewer(slot)}
                        className="absolute top-1 right-1 h-6 px-1.5 text-[10px]"
                      >
                        <Eye className="w-3 h-3 mr-1" /> View Full
                      </Button>
                    </>
                  ) : (
                    <div className="bg-background/60 border border-dashed border-border rounded p-3 text-[11px] text-muted-foreground text-center">
                      No SQL script loaded for this slot. Use <strong className="text-foreground">Upload Script</strong> or <strong className="text-foreground">Upload Default Script</strong> below.
                    </div>
                  )}
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
                      variant="outline"
                      onClick={() => handleUploadScript(slot)}
                      className="text-xs"
                    >
                      <Upload className="w-3 h-3 mr-1.5" />
                      Upload Script
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleLoadDefaultScript(slot)}
                      className="text-xs"
                      title={`Upload default script (${item.defaultFileName})`}
                    >
                      <FileCode className="w-3 h-3 mr-1.5" />
                      Upload Default Script
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenViewer(slot)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Code2 className="w-3 h-3 mr-1" />
                      {isLoaded ? 'Edit' : 'Create'}
                    </Button>

                    {isLoaded && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleClearScript(slot)}
                        className="text-xs text-muted-foreground hover:text-rose-500"
                        title="Unload this script and clear slot back to empty"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>

                  {slot === 'create_table' && (
                    <Button
                      size="sm"
                      onClick={handleExecuteCreateTable}
                      disabled={isExecuting || !dbConnected || !isLoaded}
                      className="text-xs font-medium"
                      title={!isLoaded ? 'Please load or upload a script first' : ''}
                    >
                      <Play className={`w-3 h-3 mr-1 ${isExecuting ? 'animate-spin' : ''}`} />
                      {isExecuting ? 'Running...' : 'Execute DDL'}
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
                    {activeViewingSlot && scripts && scripts[activeViewingSlot]?.isLoaded
                      ? scripts[activeViewingSlot]?.currentFileName
                      : `New script (${activeViewingSlot && scripts ? scripts[activeViewingSlot]?.defaultFileName : ''})`}
                  </span>{' '}
                  • Edit directly or copy SQL script
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
                onClick={handleSaveEditorContent}
                className="text-xs font-medium"
              >
                Save as Active Script
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
