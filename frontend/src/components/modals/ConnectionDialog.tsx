import React, { useState, useEffect, useRef } from 'react';
import {
  Database, CheckCircle2, XCircle, RefreshCw, ShieldCheck,
  Globe, Lock, LockOpen, Eye, EyeOff, BookMarked, Trash2,
  Plus, ChevronDown, ChevronUp, Code2, ClipboardPaste, Unplug,
  FileCode2, FolderOpen, Shield, AlertTriangle, Sparkles, Check,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { DatabaseConfig } from '../../types/dcloader';
import { dbClient } from '../../lib/dbClient';
import {
  parseIafXml,
  IafParseResult,
  IafEnvironment,
  IafConnectionString,
  parseAdoNetConnectionString,
  isProductionDatabase,
} from '../../lib/iafXmlParser';

// ---------------------------------------------------------------------------
// localStorage profile store - profiles survive app restarts automatically
// ---------------------------------------------------------------------------
const PROFILES_KEY = 'dc_loader_connection_profiles';

function loadProfiles(): DatabaseConfig[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const profiles: DatabaseConfig[] = raw ? JSON.parse(raw) : [];
    // Ensure any Azure SQL / cloud hosts have correct security flags applied
    return profiles.map((p) => {
      const isCloudOrProd = isProductionDatabase('', '', p.database || '', p.host || '');
      if (isCloudOrProd) {
        return {
          ...p,
          encrypt: true,
          trustServerCertificate: false,
        };
      }
      return p;
    });
  } catch {
    return [];
  }
}

function saveProfiles(profiles: DatabaseConfig[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error('Failed to save profiles to localStorage:', err);
  }
}

function upsertProfile(profile: DatabaseConfig): DatabaseConfig[] {
  const all = loadProfiles();
  const idx = all.findIndex((p) => p.profileName === profile.profileName);
  if (idx >= 0) {
    all[idx] = { ...profile };
  } else {
    all.push({ ...profile });
  }
  saveProfiles(all);
  return all;
}

function removeProfile(profileName: string): DatabaseConfig[] {
  const all = loadProfiles().filter((p) => p.profileName !== profileName);
  saveProfiles(all);
  return all;
}

// ---------------------------------------------------------------------------
// ADO.NET / MSSQL connection string parser
// ---------------------------------------------------------------------------
function parseConnectionString(cs: string): Partial<DatabaseConfig> & { parseError?: string } {
  return parseAdoNetConnectionString(cs);
}

// ---------------------------------------------------------------------------
// Toggle switch component
// ---------------------------------------------------------------------------
interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  colorOn?: string;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, colorOn = 'bg-primary' }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent
      transition-colors focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed
      ${checked ? colorOn : 'bg-input'}`}
  >
    <span
      className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-md transition-transform
        ${checked ? 'translate-x-4' : 'translate-x-0'}`}
    />
  </button>
);

// ---------------------------------------------------------------------------
// Empty default template for new connections
// ---------------------------------------------------------------------------
const EMPTY_CONFIG: DatabaseConfig = {
  profileName: '',
  host: '',
  port: 1433,
  database: '',
  user: '',
  password: '',
  companyCode: 'CORP',
  division: '1',
  authType: 'sql',
  encrypt: false,
  trustServerCertificate: true,
};

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------
interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DatabaseConfig;
  onSaveConfig: (config: DatabaseConfig) => Promise<{ success: boolean; message?: string } | boolean>;
  onConnectionStatusChange: (connected: boolean) => void;
  dbConnected?: boolean;
  onDisconnect?: () => Promise<void> | void;
  domain?: 'inventory' | 'sales_orders';
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
  open,
  onOpenChange,
  config,
  onSaveConfig,
  onConnectionStatusChange,
  dbConnected = false,
  onDisconnect,
  domain = 'inventory',
}) => {
  const [profiles, setProfiles] = useState<DatabaseConfig[]>([]);
  const [selectedProfileKey, setSelectedProfileKey] = useState<string>('__new__');
  const [formData, setFormData] = useState<DatabaseConfig>({ ...config });
  const [portInput, setPortInput] = useState<string>(String(config.port || 1433));
  const [showPassword, setShowPassword] = useState(false);
  const [showConnStr, setShowConnStr] = useState(false);
  const [connStr, setConnStr] = useState('');
  const [connStrError, setConnStrError] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    success: boolean;
    message: string;
    latencyMs?: number;
  }>({ tested: false, success: false, message: '' });

  // XML IAF Import states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showXmlImport, setShowXmlImport] = useState(false);
  const [xmlParseResult, setXmlParseResult] = useState<IafParseResult | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [selectedConnName, setSelectedConnName] = useState<string>('');
  const [rawXmlInput, setRawXmlInput] = useState<string>('');
  const [xmlInputTab, setXmlInputTab] = useState<'file' | 'paste'>('file');
  const [xmlError, setXmlError] = useState<string>('');
  const [importSuccessBanner, setImportSuccessBanner] = useState<string | null>(null);

  // Initialize and load saved profiles whenever dialog opens
  useEffect(() => {
    if (open) {
      const saved = loadProfiles();
      setProfiles(saved);
      setTestResult({ tested: false, success: false, message: '' });
      setShowPassword(false);
      setShowConnStr(false);
      setConnStr('');
      setConnStrError('');
      setProfileSaved(false);
      setSaveError('');
      setShowXmlImport(false);
      setImportSuccessBanner(null);
      setXmlError('');

      // Prioritize the currently active/connected configuration passed via props
      // If config has host and database, search if it matches an existing profile or present it directly
      const hasActiveConfig = !!(config && (config.host?.trim() || config.database?.trim()));

      const matched = saved.find(
        (p) =>
          (config.profileName && p.profileName === config.profileName) ||
          (config.host && p.host === config.host && p.database === config.database && (!config.user || p.user === config.user))
      );

      if (matched) {
        setSelectedProfileKey(matched.profileName);
        // Blend matched profile with any current config values (like credentials/session state)
        setFormData({ ...matched, ...config });
        setPortInput(String(config.port || matched.port || 1433));
      } else if (hasActiveConfig) {
        // Active configuration is in use (e.g., custom host or connection not yet saved as profile)
        setSelectedProfileKey('__new__');
        setFormData({ ...config });
        setPortInput(String(config.port || 1433));
      } else if (saved.length > 0) {
        // Disconnected and no specific config: default to first saved profile
        setSelectedProfileKey(saved[0].profileName);
        setFormData({ ...saved[0] });
        setPortInput(String(saved[0].port || 1433));
      } else {
        // Fall back to provided config or defaults
        setSelectedProfileKey('__new__');
        setFormData({ ...config });
        setPortInput(String(config.port || 1433));
      }
    }
  }, [open]);

  // Handle dropdown selection of saved profile
  const handleSelectProfile = (profileName: string) => {
    setSelectedProfileKey(profileName);
    setSaveError('');
    setTestResult({ tested: false, success: false, message: '' });

    if (profileName === '__new__') {
      const blank: DatabaseConfig = {
        ...EMPTY_CONFIG,
        companyCode: formData.companyCode || 'CORP',
      };
      setFormData(blank);
      setPortInput('1433');
    } else {
      const found = profiles.find((p) => p.profileName === profileName);
      if (found) {
        setFormData({ ...found });
        setPortInput(String(found.port || 1433));
      }
    }
  };

  // Handle deleting the currently selected profile
  const handleDeleteProfile = () => {
    if (selectedProfileKey === '__new__') return;
    const updated = removeProfile(selectedProfileKey);
    setProfiles(updated);
    if (updated.length > 0) {
      setSelectedProfileKey(updated[0].profileName);
      setFormData({ ...updated[0] });
      setPortInput(String(updated[0].port || 1433));
    } else {
      setSelectedProfileKey('__new__');
      setFormData({ ...EMPTY_CONFIG });
      setPortInput('1433');
    }
  };

  // Save current profile to localStorage
  const handleSaveProfile = () => {
    setSaveError('');
    const name = formData.profileName.trim();
    if (!name) {
      setSaveError('Please enter a Profile Name before saving.');
      return;
    }

    const toSave: DatabaseConfig = {
      ...formData,
      profileName: name,
      port: parseInt(portInput, 10) || 1433,
    };

    const updated = upsertProfile(toSave);
    setProfiles(updated);
    setSelectedProfileKey(name);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  // Test database connection
  const handleTest = async () => {
    setIsTesting(true);
    setTestResult({ tested: false, success: false, message: '' });
    const targetConfig: DatabaseConfig = {
      ...formData,
      port: parseInt(portInput, 10) || 1433,
    };

    try {
      const res = await dbClient.testConnection(targetConfig);

      setTestResult({
        tested: true,
        success: res.success,
        message: res.message,
        latencyMs: res.latencyMs,
      });
      // Note: Test Connection only tests connectivity — it does NOT change the active session connection status.
    } catch (err: any) {
      setTestResult({
        tested: true,
        success: false,
        message: err.message || 'Connection error occurred.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Disconnect from database
  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const res = await dbClient.disconnect();
      if (res.success) {
        onConnectionStatusChange(false);
        setTestResult({
          tested: true,
          success: true,
          message: 'Successfully disconnected from SQL Server database.',
        });
        if (onDisconnect) {
          await onDisconnect();
        }
      }
    } catch (err: any) {
      setTestResult({
        tested: true,
        success: false,
        message: `Failed to disconnect: ${err.message || 'Unknown error'}`,
      });
    } finally {
      setIsDisconnecting(false);
    }
  };
  const handleConnect = async () => {
    setIsConnecting(true);
    setTestResult({ tested: false, success: false, message: '' });

    const targetConfig: DatabaseConfig = {
      ...formData,
      port: parseInt(portInput, 10) || 1433,
    };

    if (!targetConfig.host?.trim() || !targetConfig.database?.trim()) {
      setTestResult({
        tested: true,
        success: false,
        message: 'Host server address and Database name are required to connect.',
      });
      setIsConnecting(false);
      return;
    }

    try {
      const res = await onSaveConfig(targetConfig);
      const isSuccess = typeof res === 'boolean' ? res : Boolean(res?.success);
      const errMsg =
        typeof res === 'object' && res?.message
          ? res.message
          : 'Connection failed. Please verify credentials, host, and that SQL Server TCP/IP is active.';

      if (isSuccess) {
        if (targetConfig.profileName.trim()) {
          upsertProfile(targetConfig);
        }
        onConnectionStatusChange(true);
        onOpenChange(false);
      } else {
        setTestResult({
          tested: true,
          success: false,
          message: errMsg,
        });
      }
    } catch (err: any) {
      setTestResult({
        tested: true,
        success: false,
        message: err.message || 'Connection attempt threw an error.',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  // Open XML file via Wails native dialog (or fallback to file input)
  const handleOpenXmlFile = async () => {
    setXmlError('');
    try {
      const res = await dbClient.openXmlFile();
      if (res.error) {
        setXmlError(`Failed to read XML file: ${res.error}`);
        return;
      }
      if (!res.canceled && res.fileContent) {
        processXmlContent(res.fileContent, res.fileName);
      }
    } catch (err: any) {
      setXmlError(`Failed to read XML file: ${err.message || 'Unknown error'}`);
    }
  };

  // Open XML file via file input fallback
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processXmlContent(content, file.name);
    };
    reader.onerror = () => {
      setXmlError('Failed to read the selected file.');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Process raw XML string
  const processXmlContent = (content: string, fileName?: string) => {
    setXmlError('');
    const result = parseIafXml(content, fileName);
    if (!result.success || result.environments.length === 0) {
      setXmlError(result.error || 'No valid environments found in XML.');
      setXmlParseResult(null);
      return;
    }
    setXmlParseResult(result);
    // Select first environment (or DEV if present)
    const defaultEnv = result.environments.find((e) => /dev/i.test(e.id)) || result.environments[0];
    setSelectedEnvId(defaultEnv.id);
    // Select FIN connection string if present, else first available
    const defaultConn = defaultEnv.connectionStrings.find((c) => /fin/i.test(c.name)) || defaultEnv.connectionStrings[0];
    setSelectedConnName(defaultConn?.name || '');
  };

  // Apply selected XML environment & connection string to the form
  const handleApplyXmlSelection = (saveAsProfile: boolean = false) => {
    if (!xmlParseResult) return;
    const env = xmlParseResult.environments.find((e) => e.id === selectedEnvId);
    if (!env) return;
    const conn = env.connectionStrings.find((c) => c.name === selectedConnName) || env.connectionStrings[0];
    if (!conn) return;

    const isCloudOrProd = conn.isProduction || isProductionDatabase(env.id, env.description, conn.database, conn.host);
    const profileName = `${env.id} - ${conn.name}${conn.database ? ` (${conn.database})` : ''}`;
    const newConfig: DatabaseConfig = {
      profileName,
      host: conn.host,
      port: conn.port || 1433,
      database: conn.database,
      user: conn.user,
      password: conn.password || '',
      companyCode: formData.companyCode || 'CORP',
      division: formData.division || '1',
      authType: 'sql',
      encrypt: isCloudOrProd ? true : conn.encrypt,
      trustServerCertificate: isCloudOrProd ? false : conn.trustServerCertificate,
    };

    setFormData(newConfig);
    setPortInput(String(conn.port || 1433));

    if (saveAsProfile) {
      const updated = upsertProfile(newConfig);
      setProfiles(updated);
      setSelectedProfileKey(newConfig.profileName);
      setProfileSaved(true);
    } else {
      setSelectedProfileKey('__new__');
    }

    setImportSuccessBanner(
      `Imported connection for [${env.id}] - ${conn.name} (${conn.database}). ${
        conn.isProduction
          ? 'Cloud / Production database detected: Encrypt (TLS) is ENABLED, and Trust Server Certificate is DISABLED (verifying server CA certificate).'
          : 'Non-production environment: Encrypt is OFF, and Trust Server Certificate is ENABLED.'
      }`
    );

    setTestResult({ tested: false, success: false, message: '' });
    setShowXmlImport(false);
  };

  // Parse and apply connection string to form fields
  const applyConnectionString = () => {
    const parsed = parseConnectionString(connStr);
    if (parsed.parseError) {
      setConnStrError(parsed.parseError);
      return;
    }
    if (!parsed.host && !parsed.database) {
      setConnStrError('No Server or Database found in connection string.');
      return;
    }

    const host = parsed.host || '';
    const isCloudOrProd = isProductionDatabase('', '', parsed.database || '', host);
    const encrypt = parsed.encrypt !== undefined ? parsed.encrypt : isCloudOrProd;
    const trustServerCertificate = parsed.trustServerCertificate !== undefined ? parsed.trustServerCertificate : !isCloudOrProd;

    setConnStrError('');
    setFormData((prev) => ({
      ...prev,
      ...(parsed.host !== undefined && { host: parsed.host }),
      ...(parsed.database !== undefined && { database: parsed.database }),
      ...(parsed.user !== undefined && { user: parsed.user }),
      ...(parsed.password !== undefined && { password: parsed.password }),
      encrypt,
      trustServerCertificate,
    }));

    if (parsed.port) {
      setPortInput(String(parsed.port));
    }

    setShowConnStr(false);
    setTestResult({ tested: false, success: false, message: '' });
  };

  const selectedEnvironment = xmlParseResult?.environments.find((e) => e.id === selectedEnvId);
  const activeConn =
    selectedEnvironment?.connectionStrings.find((c) => c.name === selectedConnName) ||
    selectedEnvironment?.connectionStrings[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-card border-border text-foreground shadow-2xl p-6">
        {/* Header */}
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-secondary border border-border flex items-center justify-center text-foreground">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  SQL Server Connection
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Target catalog staging table:{' '}
                  <code className="text-foreground font-mono">
                    {domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}
                  </code>
                  {dbConnected && config.host && (
                    <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-mono">
                      (Active: {config.host}{config.database ? ` / [${config.database}]` : ''})
                    </span>
                  )}
                </DialogDescription>
              </div>
            </div>

            {dbConnected && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  ONLINE
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting || isConnecting || isTesting}
                  className="h-7 px-2 text-xs border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 gap-1"
                  title="Disconnect active SQL Server connection"
                >
                  <Unplug className="w-3 h-3" />
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable Form Body */}
        <div className="max-h-[68vh] overflow-y-auto pr-1 space-y-4 py-1 text-xs">

          {/* Profile Selector Section */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                <BookMarked className="w-3.5 h-3.5 text-primary" />
                Saved Connection Profile
              </Label>
              {selectedProfileKey !== '__new__' && (
                <button
                  type="button"
                  onClick={handleDeleteProfile}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-500 transition-colors"
                  title="Delete this saved profile"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete Profile
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedProfileKey}
                onChange={(e) => handleSelectProfile(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {profiles.map((p) => (
                  <option key={p.profileName} value={p.profileName}>
                    {p.profileName} ({p.host}{p.port && p.port !== 1433 ? `:${p.port}` : ''} / {p.database})
                  </option>
                ))}
                <option value="__new__">+ New Connection / Custom</option>
              </select>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowXmlImport(!showXmlImport)}
                className={`h-9 px-2.5 text-xs gap-1.5 shrink-0 transition-colors ${showXmlImport
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border text-foreground hover:border-primary/50'
                  }`}
                title="Import database connections from Ross IAF master XML file"
              >
                <FileCode2 className="w-3.5 h-3.5 text-primary" />
                Import XML
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSelectProfile('__new__')}
                className="h-9 px-2.5 text-xs gap-1 shrink-0"
                title="Create a new connection profile"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </Button>
            </div>
          </div>

          {/* Import Success Notification Banner */}
          {importSuccessBanner && (
            <div className="p-3 rounded-lg border text-xs flex items-start justify-between gap-2.5 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                    Connection Imported Successfully
                  </p>
                  <p className="text-[11px] leading-relaxed text-emerald-900/90 dark:text-emerald-200/90">
                    {importSuccessBanner}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportSuccessBanner(null)}
                className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-200 p-0.5"
                title="Dismiss"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* XML Import Interactive Panel */}
          {showXmlImport && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 space-y-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <FileCode2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
                      Import from IAF XML Configuration
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-primary/30 text-primary">
                        iBrowser / Ross ERP
                      </Badge>
                    </h4>
                    <p className="text-[10px] text-muted-foreground">
                      Loads <code className="font-mono text-primary font-semibold">&lt;IafConfiguration&gt;</code> XML with multiple environments (DEV, UAT, PROD).
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowXmlImport(false)}
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                >
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>

              {/* File selector or Paste option */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenXmlFile}
                  className="h-8 text-xs gap-1.5 flex-1 bg-background hover:bg-secondary font-medium"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-primary" />
                  Browse XML File...
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInputChange}
                  accept=".xml,.config"
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setXmlInputTab(xmlInputTab === 'paste' ? 'file' : 'paste')}
                  className={`h-8 text-xs gap-1.5 px-3 ${xmlInputTab === 'paste' ? 'border-primary bg-primary/10 text-primary' : ''
                    }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  {xmlInputTab === 'paste' ? 'Hide Paste' : 'Paste XML'}
                </Button>
              </div>

              {/* Paste XML Input Area */}
              {xmlInputTab === 'paste' && (
                <div className="space-y-2 pt-1 border-t border-border/60">
                  <textarea
                    value={rawXmlInput}
                    onChange={(e) => {
                      setRawXmlInput(e.target.value);
                      setXmlError('');
                    }}
                    rows={4}
                    placeholder="Paste <IafConfiguration><Environments><Environment id='DEV'>...</Environment></Environments></IafConfiguration>..."
                    className="w-full resize-none rounded-md border border-input bg-background p-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => processXmlContent(rawXmlInput, 'Pasted XML')}
                    disabled={!rawXmlInput.trim()}
                    className="w-full h-7 text-xs gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Parse XML Content
                  </Button>
                </div>
              )}

              {/* Parse Error Display */}
              {xmlError && (
                <div className="p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{xmlError}</span>
                </div>
              )}

              {/* Parsed Environments & Connections Wizard */}
              {xmlParseResult && xmlParseResult.environments.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-border/60 bg-background/50 p-3 rounded-lg border border-border">
                  {/* Source File Badge */}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground font-medium">Source:</span>
                    <span className="font-mono text-foreground font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      {xmlParseResult.sourceFileName || 'Loaded IAF Configuration'}
                      <Badge variant="secondary" className="text-[10px] py-0 px-1 font-mono">
                        {xmlParseResult.environments.length} Environment{xmlParseResult.environments.length > 1 ? 's' : ''}
                      </Badge>
                    </span>
                  </div>

                  {/* Step 1: Environment Selection */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold flex items-center justify-between">
                      <span>1. Choose Environment</span>
                      <span className="text-[10px] text-muted-foreground font-normal">Select target deployment</span>
                    </Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {xmlParseResult.environments.map((env) => {
                        const isSelected = env.id === selectedEnvId;
                        return (
                          <button
                            key={env.id}
                            type="button"
                            onClick={() => {
                              setSelectedEnvId(env.id);
                              const finConn = env.connectionStrings.find((c) => /fin/i.test(c.name)) || env.connectionStrings[0];
                              setSelectedConnName(finConn?.name || '');
                            }}
                            className={`flex flex-col items-start p-2 rounded-md border text-left transition-all ${isSelected
                                ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                                : 'border-border bg-card hover:bg-secondary/60'
                              }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-bold text-xs text-foreground font-mono">{env.id}</span>
                              {env.isProduction ? (
                                <Badge variant="destructive" className="text-[9px] py-0 px-1 uppercase tracking-wider font-bold">
                                  PROD
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px] py-0 px-1 uppercase tracking-wider">
                                  {env.id}
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
                              {env.description !== env.id ? env.description : `${env.connectionStrings.length} Conn(s)`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selected Environment Details & Connection Strings */}
                  {selectedEnvironment && (
                    <div className="space-y-2.5 pt-1">
                      {/* Step 2: Choose Connection String if multiple */}
                      {selectedEnvironment.connectionStrings.length > 1 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold flex items-center justify-between">
                            <span>2. Target Connection String</span>
                            <span className="text-[10px] text-muted-foreground font-normal">
                              Select database schema
                            </span>
                          </Label>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedEnvironment.connectionStrings.map((conn) => {
                              const isConnSelected = conn.name === selectedConnName;
                              const isFin = /fin/i.test(conn.name);
                              return (
                                <button
                                  key={conn.name}
                                  type="button"
                                  onClick={() => setSelectedConnName(conn.name)}
                                  className={`px-2.5 py-1 rounded text-xs font-mono font-medium border transition-all flex items-center gap-1.5 ${isConnSelected
                                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                  <span>{conn.name}</span>
                                  {isFin && (
                                    <span className={`text-[9px] px-1 rounded ${isConnSelected ? 'bg-primary-foreground/20 text-white' : 'bg-secondary text-primary font-bold'}`}>
                                      DC LOADER
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Step 3: Connection Preview & Production Policy */}
                      {activeConn && (
                        <div className="space-y-2 rounded-md border border-border bg-card p-3 text-[11px]">
                          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-muted-foreground/80 block">Database</span>
                              <span className="font-mono text-foreground font-semibold break-all">{activeConn.database}</span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase font-bold text-muted-foreground/80 block">User</span>
                              <span className="font-mono text-foreground font-semibold">{activeConn.user}</span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[10px] uppercase font-bold text-muted-foreground/80 block">Host / Server</span>
                              <span className="font-mono text-foreground truncate block">{activeConn.host}{activeConn.port && activeConn.port !== 1433 ? `:${activeConn.port}` : ''}</span>
                            </div>
                          </div>

                          {/* Production Security Policy Badge */}
                          {(() => {
                            const isCloudOrProd =
                              activeConn.isProduction ||
                              isProductionDatabase(selectedEnvironment?.id || '', selectedEnvironment?.description || '', activeConn.database, activeConn.host);

                            return isCloudOrProd ? (
                              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 space-y-1">
                                <div className="flex items-center gap-1.5 font-bold text-[11px]">
                                  <Shield className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                  <span>Cloud / Production Database Detected</span>
                                </div>
                                <p className="text-[10px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                                  <strong>Security policy applied:</strong> Encrypt (TLS) is <strong>ON</strong> and Trust Server Certificate is <strong>OFF</strong> (CA validation enforced).
                                </p>
                              </div>
                            ) : (
                              <div className="p-2 rounded bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-300 space-y-1">
                                <div className="flex items-center gap-1.5 font-bold text-[11px]">
                                  <Globe className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                                  <span>Local / Dev Database ({selectedEnvironment?.id})</span>
                                </div>
                                <p className="text-[10px] leading-relaxed text-sky-900/90 dark:text-sky-200/90">
                                  <strong>Standard dev settings:</strong> Encrypt is <strong>OFF</strong> and Trust Server Certificate is <strong>ON</strong> for development compatibility.
                                </p>
                              </div>
                            );
                          })()}

                          {/* Action Buttons */}
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleApplyXmlSelection(false)}
                              className="h-7 text-xs gap-1.5"
                            >
                              <ClipboardPaste className="w-3 h-3" />
                              Apply to Form
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleApplyXmlSelection(true)}
                              className="h-7 text-xs gap-1.5 font-semibold"
                            >
                              <BookMarked className="w-3 h-3" />
                              Apply &amp; Save Profile
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Profile Name Field */}
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>Profile Name</span>
              <span className="text-[10px] text-muted-foreground">Used to label &amp; save this connection</span>
            </Label>
            <Input
              value={formData.profileName || ''}
              onChange={(e) => {
                const val = e.target.value;
                setFormData((prev) => ({ ...prev, profileName: val }));
                setSaveError('');
              }}
              placeholder="e.g. Primary Production SQL, Dev Local, Azure QA"
              className="bg-background border-input text-xs text-foreground font-mono"
            />
            {saveError && <p className="text-[11px] text-rose-500">{saveError}</p>}
          </div>

          {/* Host & Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Host / IP or Named Instance</Label>
              <Input
                value={formData.host || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, host: e.target.value }))}
                placeholder="localhost or server.database.windows.net"
                className="bg-background border-input text-xs text-foreground font-mono"
              />
              <span className="text-[10px] text-muted-foreground">
                Named instance: <code className="font-mono">localhost\SQLEXPRESS</code>
              </span>
            </div>
            <div className="space-y-1.5">
              <Label>TCP Port</Label>
              <Input
                type="number"
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                placeholder="1433"
                className="bg-background border-input text-xs text-foreground font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Default: 1433</span>
            </div>
          </div>

          {/* Database Name */}
          <div className="space-y-1.5">
            <Label>Database Name (Catalog)</Label>
            <Input
              value={formData.database || ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, database: e.target.value }))}
              placeholder="fin_demo"
              className="bg-background border-input text-xs text-foreground font-mono"
            />
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <LockOpen className="w-3.5 h-3.5 text-muted-foreground" />
                SQL Username
              </Label>
              <Input
                value={formData.user || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, user: e.target.value }))}
                placeholder="sa or fin_user"
                className="bg-background border-input text-xs text-foreground font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                Password
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password || ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="password"
                  className="bg-background border-input text-xs text-foreground font-mono pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Company Code & AR Division */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ross Company Code</Label>
              <Input
                value={formData.companyCode || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, companyCode: e.target.value }))}
                placeholder="CORP"
                className="bg-background border-input text-xs text-foreground font-mono"
              />
              <span className="text-[10px] text-muted-foreground block truncate">
                Default: <code className="font-mono">CORP</code>
              </span>
            </div>
            <div className="space-y-1.5">
              <Label>AR / SOP Division</Label>
              <Input
                value={formData.division || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, division: e.target.value }))}
                placeholder="1"
                className="bg-background border-input text-xs text-foreground font-mono"
              />
              <span className="text-[10px] text-muted-foreground block truncate">
                Applied to Sales Order staging
              </span>
            </div>
          </div>

          {/* TLS Options */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                Encrypt (TLS)
              </Label>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={!!formData.encrypt}
                  onChange={(v) => setFormData((prev) => ({ ...prev, encrypt: v }))}
                  colorOn="bg-primary"
                />
                <span className="text-[11px] text-muted-foreground">
                  {formData.encrypt ? 'Required for Azure / Cloud / Prod' : 'Off (on-premise / local dev)'}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                Trust Server Cert
              </Label>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={!!formData.trustServerCertificate}
                  onChange={(v) => setFormData((prev) => ({ ...prev, trustServerCertificate: v }))}
                  disabled={!formData.encrypt}
                  colorOn="bg-amber-500"
                />
                <span className="text-[11px] text-muted-foreground">
                  {formData.trustServerCertificate ? 'Self-signed (dev)' : 'Verify CA cert (enforced)'}
                </span>
              </div>
            </div>
          </div>

          {/* Expandable ADO.NET Connection String section */}
          <div className="rounded-lg border border-border/80 bg-muted/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowConnStr(!showConnStr)}
              className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-primary" />
                Import from ADO.NET Connection String
              </span>
              {showConnStr ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showConnStr && (
              <div className="p-3 pt-0 space-y-2 border-t border-border/60">
                <textarea
                  value={connStr}
                  onChange={(e) => {
                    setConnStr(e.target.value);
                    setConnStrError('');
                  }}
                  rows={3}
                  spellCheck={false}
                  placeholder="Server=server.database.windows.net,1433; Database=fin_demo; User ID=sa; Password=...; Encrypt=True;"
                  className="w-full resize-none rounded-md border border-input bg-background p-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {connStrError && (
                  <p className="text-[11px] text-rose-500 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    {connStrError}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={applyConnectionString}
                  disabled={!connStr.trim()}
                  className="w-full h-7 text-xs gap-1.5"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Parse &amp; Populate Form Fields
                </Button>
              </div>
            )}
          </div>

          {/* Test / Connect Result Banner */}
          {testResult.tested && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
                }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 flex-1">
                <p className="font-semibold text-xs">
                  {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                  {testResult.latencyMs !== undefined && ` (${testResult.latencyMs}ms)`}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{testResult.message}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          {/* Left: Test + Save Profile */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={isTesting || isConnecting}
              className="text-xs h-8 gap-1.5"
            >
              {isTesting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  Test Connection
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveProfile}
              disabled={isConnecting}
              className={`text-xs h-8 gap-1.5 ${profileSaved ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : ''
                }`}
            >
              {profileSaved ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Saved!
                </>
              ) : (
                <>
                  <BookMarked className="w-3.5 h-3.5" />
                  Save Profile
                </>
              )}
            </Button>
          </div>

          {/* Right: Disconnect / Cancel + Connect */}
          <div className="flex items-center gap-2">
            {dbConnected && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting || isConnecting || isTesting}
                className="text-xs h-8 gap-1.5 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/50"
              >
                {isDisconnecting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <Unplug className="w-3.5 h-3.5" />
                    Disconnect
                  </>
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground hover:text-foreground text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConnect}
              disabled={isConnecting || isTesting || isDisconnecting}
              className="text-xs h-8 px-4 font-semibold"
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
