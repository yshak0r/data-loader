import React from 'react';
import {
  Layers,
  Boxes,
  ShoppingCart,
  Unplug,
  KeyRound,
  Moon,
  Sun,
  Minus,
  Square,
  X,
} from 'lucide-react';
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
  onDisconnect,
  licenseStatus,
  onOpenLicenseDialog,
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-10 bg-card border-b border-border flex items-center justify-between px-3 select-none wails-drag z-50 text-xs shrink-0 overflow-hidden">
      {/* Left: App Identity (shrink-0 so never squeezed) */}
      <div className="flex items-center gap-2 shrink-0 wails-no-drag">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-secondary border border-border text-foreground shadow-sm">
          <Layers className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <span className="tracking-tight font-medium text-xs">ROSS ERP</span>
          <span className="text-muted-foreground text-[10px] font-normal">/</span>
          <span className="text-foreground font-mono text-[11px] font-medium hidden sm:inline">
            {domain === 'sales_orders' ? 'SOP LOADER' : 'DC LOADER'}
          </span>
          <span className="text-[10px] px-1 py-0.5 rounded bg-secondary border border-border text-muted-foreground font-mono hidden md:inline">
            {domain === 'sales_orders' ? 'SOP' : 'STAGING'}
          </span>
        </div>
      </div>

      {/* Middle: Domain Switcher & Compact Database Status (flex-1 min-w-0 for graceful space handling) */}
      <div className="flex items-center justify-center gap-2 flex-1 min-w-0 px-2 wails-no-drag overflow-hidden">
        {/* Domain Mode Switcher Pill */}
        <div className="flex items-center rounded-md bg-secondary p-0.5 border border-border shadow-inner shrink-0">
          <button
            onClick={() => onDomainChange('inventory')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
              domain === 'inventory'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Switch to DC Inventory Loader Mode"
          >
            <Boxes className="w-3 h-3 text-sky-500" />
            <span className="hidden sm:inline">DC Inventory</span>
            <span className="sm:hidden">DC</span>
          </button>
          <button
            onClick={() => onDomainChange('sales_orders')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
              domain === 'sales_orders'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Switch to Sales Order Loader Mode"
          >
            <ShoppingCart className="w-3 h-3 text-amber-500" />
            <span className="hidden sm:inline">Sales Orders</span>
            <span className="sm:hidden">SO</span>
          </button>
        </div>

        {/* Compact, Streamlined Database Status Pill */}
        <div className="flex items-center rounded-md border border-border bg-secondary/50 hover:bg-secondary/80 transition-colors overflow-hidden shrink min-w-0">
          <button
            onClick={onOpenDbConfig}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] min-w-0"
            title={
              dbConnected
                ? `Connected to ${dbHost}${dbDatabase ? ` / [${dbDatabase}]` : ''} (${companyCode}) - Click to configure`
                : 'Click to configure and connect SQL Server'
            }
          >
            {dbConnected ? (
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0 shadow-[0_0_6px_rgba(244,63,94,0.6)]" />
            )}

            <span className="font-mono text-xs truncate max-w-[120px] md:max-w-[180px] font-medium text-foreground">
              {dbConnected ? dbHost : 'SQL Offline'}
            </span>

            {dbConnected && dbDatabase && (
              <span className="font-mono text-[10px] text-muted-foreground hidden lg:inline truncate max-w-[100px]">
                [{dbDatabase}]
              </span>
            )}

            {dbConnected && companyCode && (
              <span className="text-[10px] font-mono text-muted-foreground hidden xl:inline border-l border-border pl-1.5 ml-0.5">
                {companyCode}
              </span>
            )}
          </button>

          {dbConnected && onDisconnect && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDisconnect();
              }}
              className="px-1.5 py-1 text-muted-foreground hover:text-rose-500 border-l border-border hover:bg-rose-500/10 transition-colors"
              title="Disconnect SQL Server"
            >
              <Unplug className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Right: Actions & Window Controls (shrink-0 so NEVER hidden or pushed off) */}
      <div className="flex items-center shrink-0 wails-no-drag">
        {onOpenLicenseDialog && (
          <button
            onClick={onOpenLicenseDialog}
            className={`h-7 px-2 mr-1.5 flex items-center gap-1 text-xs border rounded-md transition-colors ${
              licenseStatus?.isActivated
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30'
            }`}
            title={licenseStatus?.isActivated ? `Licensed: ${licenseStatus.clientName}` : 'Click to Activate'}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium hidden md:inline">
              {licenseStatus?.isActivated ? 'Licensed' : 'Activate'}
            </span>
          </button>
        )}

        <button
          onClick={toggleTheme}
          className="h-7 w-7 mr-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary border border-border rounded-md transition-colors"
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'light' ? (
            <Moon className="w-3.5 h-3.5 text-foreground" />
          ) : (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          )}
        </button>

        {/* Windows Standard Controls */}
        <div className="flex items-center -mr-3 border-l border-border/70 pl-0.5">
          <button
            onClick={() => MinimizeWindow()}
            className="h-10 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => ToggleMaximizeWindow()}
            className="h-10 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
            title="Maximize / Restore"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => CloseWindow()}
            className="h-10 w-11 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-rose-600 transition-colors cursor-pointer"
            title="Close Application"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
