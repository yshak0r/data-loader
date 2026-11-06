import React from 'react';
import {
  LayoutDashboard,
  FileSpreadsheet,
  AlertTriangle,
  Boxes,
  Database,
  PlayCircle,
  BookOpen,
  Settings,
  Sun,
  Moon,
  Unplug,
  ShoppingCart,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/lib/theme';
import { LoaderDomain } from '@/types/dcloader';

export type NavTab =
  | 'dashboard'
  | 'importer'
  | 'errors'
  | 'lpns'
  | 'schema'
  | 'execution'
  | 'scripts'
  | 'docs';

interface NavigationSidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  errorCount: number;
  totalRows: number;
  dbConnected: boolean;
  dbHost: string;
  domain?: LoaderDomain;
  onOpenDbConfig: () => void;
  onDisconnect?: () => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  currentTab,
  onSelectTab,
  errorCount,
  totalRows,
  dbConnected,
  dbHost,
  domain = 'inventory',
  onOpenDbConfig,
  onDisconnect,
}) => {
  const { theme, toggleTheme } = useTheme();

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    badgeVariant?: 'destructive' | 'secondary' | 'outline';
  }> = [
    {
      id: 'dashboard',
      label: 'Overview & Metrics',
      icon: LayoutDashboard,
    },
    {
      id: 'importer',
      label: domain === 'sales_orders' ? 'Orders Grid & Staging' : 'Data Grid & Import',
      icon: FileSpreadsheet,
      badge: totalRows > 0 ? totalRows : undefined,
      badgeVariant: 'secondary',
    },
    {
      id: 'errors',
      label: 'Error Inspector',
      icon: AlertTriangle,
      badge: errorCount > 0 ? errorCount : undefined,
      badgeVariant: errorCount > 0 ? 'destructive' : undefined,
    },
    {
      id: 'lpns',
      label: domain === 'sales_orders' ? 'Order Hierarchy' : 'LPN Tree Inspector',
      icon: domain === 'sales_orders' ? ShoppingCart : Boxes,
    },
    {
      id: 'execution',
      label: 'Simulate & Load',
      icon: PlayCircle,
    },
    {
      id: 'schema',
      label: 'Schema Mapping',
      icon: Layers,
    },
    {
      id: 'scripts',
      label: 'SQL Scripts Config',
      icon: Settings,
    },
    {
      id: 'docs',
      label: 'Documentation & Guide',
      icon: BookOpen,
    },
  ];

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col justify-between p-3 select-none">
      <div className="space-y-6">
        {/* Module Header */}
        <div className="px-2 pt-1.5">
          <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
            {domain === 'sales_orders' ? 'Sales Order Processing' : 'Inventory Control'}
          </p>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
            <span>{domain === 'sales_orders' ? 'Sales Order Loader (SOP)' : 'Data Capture Loader'}</span>
          </h2>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-secondary text-foreground border border-border shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <Badge
                    variant={item.badgeVariant || 'secondary'}
                    className="text-[10px] px-1.5 py-0 h-4 min-w-4 text-center font-mono"
                  >
                    {item.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile / Quick settings */}
      <div className="pt-4 border-t border-border space-y-2">
        {/* Theme Mode Switcher */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-secondary border border-border text-xs">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
            {theme === 'light' ? (
              <Sun className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-foreground" />
            )}
            <span>Theme: <strong className="text-foreground capitalize">{theme}</strong></span>
          </span>
          <button
            onClick={toggleTheme}
            className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-card hover:bg-secondary text-foreground border border-border transition-colors shadow-sm cursor-pointer"
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>

        <button
          onClick={onOpenDbConfig}
          className="w-full flex items-center justify-between p-2.5 rounded-md border border-border bg-secondary/50 hover:bg-secondary text-left transition-all cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-md flex items-center justify-center border ${
                dbConnected
                  ? 'bg-secondary text-foreground border-border'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    dbConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'
                  }`}
                />
                <p className="text-[11px] font-medium text-foreground">
                  {dbConnected ? 'SQL Server' : 'SQL Disconnected'}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[130px]">
                {dbConnected ? dbHost : 'Click to connect'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-mono font-medium ${
                dbConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400 underline'
              }`}
            >
              {dbConnected ? 'ONLINE' : 'CONNECT'}
            </span>
            {dbConnected && onDisconnect && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onDisconnect();
                }}
                className="p-1 rounded hover:bg-rose-500/20 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                title="Disconnect SQL Server"
              >
                <Unplug className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        </button>
      </div>
    </aside>
  );
};

