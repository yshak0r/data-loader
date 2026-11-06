import React from 'react';
import { Layers, Boxes, ShoppingCart, Trash2, Unplug, KeyRound, Moon, Sun, Minus, Square, X, ShieldCheck } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { LoaderDomain } from '@/types/dcloader';
import { LicenseStatus } from '@/types/security';
import { MinimizeWindow, ToggleMaximizeWindow, CloseWindow } from '@/../wailsjs/go/main/App';

interface TitleBarProps {
  companyCode: string;
  division?: string;
  dbConnected: boolean;
  dbHost: string;
  dbDatabase?: string;
  domain: LoaderDomain;
  onDomainChange: (domain: LoaderDomain) => void;
  onOpenDbConfig: () => void;
  onOpenCleanDialog?: () => void;
  onOpenClearStagedDialog?: () => void;
  onDisconnect?: () => void;
  licenseStatus?: LicenseStatus;
  onOpenLicenseDialog?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  companyCode,
  division = '1',
  dbConnected,
  dbHost,
  dbDatabase,
  domain,
  onDomainChange,
  onOpenDbConfig,
  onOpenCleanDialog,
  onOpenClearStagedDialog,
  onDisconnect,
  licenseStatus,
  onOpenLicenseDialog,
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-10 bg-card border-b border-border flex items-center justify-between px-3 select-none wails-drag z-50 text-xs">
      {/* Left: App Identity */}
      <div className="flex items-center gap-2.5 wails-no-drag">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-secondary border border-border text-foreground shadow-sm">
          <Layers className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <span className="tracking-tight font-medium">ROSS ERP</span>
          <span className="text-muted-foreground text-[11px] font-normal">/</span>
          <span className="text-foreground font-mono text-[11px] font-medium">
            {domain === 'sales_orders' ? 'SOP LOADER' : 'DC LOADER'}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground font-mono">
            {domain === 'sales_orders' ? 'SOP' : 'STAGING'}
          </span>
        </div>
      </div>

      {/* Middle: Domain Mode Switcher & DB Status */}
      <div className="flex items-center gap-2 wails-no-drag">
        {/* Domain Mode Switcher Pill */}
        <div className="flex items-center rounded-md bg-secondary p-0.5 border border-border shadow-inner">
          <button
            onClick={() => onDomainChange('inventory')}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-medium transition-all ${
              domain === 'inventory'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Switch to DC Inventory Loader Mode"
          >
            <Boxes className="w-3 h-3 text-sky-500" />
            <span>DC Inventory</span>
          </button>
          <button
            onClick={() => onDomainChange('sales_orders')}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-medium transition-all ${
              domain === 'sales_orders'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Switch to Sales Order Loader Mode (SOPC_T_003)"
          >
            <ShoppingCart className="w-3 h-3 text-amber-500" />
            <span>Sales Orders</span>
          </button>
        </div>

        {/* Database Status Button */}
        <button
          onClick={onOpenDbConfig}
          className={`flex items-center gap-2 px-3 py-1 rounded-md transition-all text-[11px] border ${
            dbConnected
              ? 'bg-secondary/60 hover:bg-secondary border-border text-foreground'
              : 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-600 dark:text-rose-400'
          }`}
          title={
            dbConnected
              ? `Connected to ${dbHost}${dbDatabase ? ` / [${dbDatabase}]` : ''} - Click to configure connection`
              : 'Click to configure and test database connection'
          }
        >
          {dbConnected ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
          )}

          <span className="font-mono text-xs">
            {dbConnected ? (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">SQL:</span>
                <span className="font-semibold text-foreground">{dbHost}</span>
                {dbDatabase && (
                  <span className="text-muted-foreground font-normal">[{dbDatabase}]</span>
                )}
              </span>
            ) : (
              'SQL DISCONNECTED'
            )}
          </span>

          <span className="w-1 h-1 rounded-full bg-border" />
          <span className="text-muted-foreground text-[10px] uppercase font-bold">CO:</span>
          <span className="font-mono text-foreground font-semibold">{companyCode}</span>

          {division && (
            <>
              <span className="w-1 h-1 rounded-full bg-border" />
              <span className="text-muted-foreground text-[10px] uppercase font-bold">DIV:</span>
              <span className="font-mono text-foreground font-semibold">{division}</span>
            </>
          )}

          <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-border">
            <span className="text-[10px] font-mono font-medium">
              {dbConnected ? (
                <span className="text-emerald-600 dark:text-emerald-400">ONLINE</span>
              ) : (
                <span className="text-rose-600 dark:text-rose-400">ACTION REQ</span>
              )}
            </span>
          </div>
        </button>

        <div className="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary border border-border text-[10px] text-muted-foreground font-mono">
          <ShieldCheck className="w-3 h-3 text-muted-foreground" />
          <span>{domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}</span>
        </div>

        {onOpenClearStagedDialog && dbConnected && (
          <button
            onClick={onOpenClearStagedDialog}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-rose-500/15 border border-border hover:border-rose-500/30 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 text-[11px] font-medium transition-colors"
            title={`Clear all staged records from ${domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]'}`}
          >
            <Trash2 className="w-3 h-3 text-rose-500" />
            <span>Clear Staging</span>
          </button>
        )}

        {domain === 'inventory' && onOpenCleanDialog && dbConnected && (
          <button
            onClick={onOpenCleanDialog}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-destructive/15 border border-border hover:border-destructive/30 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 text-[11px] font-medium transition-colors"
            title="Clean inventory tables scoped by staged warehouses"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clean Tables</span>
          </button>
        )}

        {onDisconnect && dbConnected && (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-rose-500/15 border border-border hover:border-rose-500/30 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 text-[11px] font-medium transition-colors"
            title="Disconnect active SQL Server database connection"
          >
            <Unplug className="w-3 h-3 text-rose-500" />
            <span>Disconnect</span>
          </button>
        )}
      </div>

      {/* Right: Theme Toggle & Window Controls */}
      <div className="flex items-center wails-no-drag -mr-1">
        {onOpenLicenseDialog && (
          <button
            onClick={onOpenLicenseDialog}
            className={`h-7 px-2 mr-2 flex items-center gap-1.5 text-xs border rounded-md transition-colors ${
              licenseStatus?.isActivated
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30'
            }`}
            title={licenseStatus?.isActivated ? `Licensed to ${licenseStatus.clientName}` : 'Device Not Activated'}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium hidden sm:inline">
              {licenseStatus?.isActivated ? 'Licensed' : 'Activate'}
            </span>
          </button>
        )}

        <button
          onClick={toggleTheme}
          className="h-7 px-2 mr-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary border border-border rounded-md transition-colors"
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-3.5 h-3.5 text-foreground" />
              <span className="text-[11px] font-medium hidden sm:inline">Dark</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-medium hidden sm:inline">Light</span>
            </>
          )}
        </button>

        <button
          onClick={() => MinimizeWindow()}
          className="h-8 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors rounded-sm cursor-pointer"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => ToggleMaximizeWindow()}
          className="h-8 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors rounded-sm cursor-pointer"
          title="Maximize / Restore"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => CloseWindow()}
          className="h-8 w-9 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-rose-600 transition-colors rounded-sm cursor-pointer"
          title="Close Application"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

