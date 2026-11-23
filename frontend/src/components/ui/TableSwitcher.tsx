import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Boxes,
  ShoppingCart,
  Table2,
  ChevronDown,
  Check,
  Plus,
  Search,
  RefreshCw,
  Database,
} from 'lucide-react';
import { dbClient } from '@/lib/dbClient';
import { LoaderDomain, StagingTableInfo } from '@/types/dcloader';
import { EventsOn, EventsOff } from '@/../wailsjs/runtime/runtime';

interface TableSwitcherProps {
  currentDomain: LoaderDomain;
  activeCustomTable: string | null;
  onSelectStandardDomain: (domain: LoaderDomain) => void;
  onSelectCustomTable: (table: StagingTableInfo) => void;
  onOpenCustomTableDialog: () => void;
  dbConnected: boolean;
}

export const TableSwitcher: React.FC<TableSwitcherProps> = ({
  currentDomain,
  activeCustomTable,
  onSelectStandardDomain,
  onSelectCustomTable,
  onOpenCustomTableDialog,
  dbConnected,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tables, setTables] = useState<StagingTableInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updateCoords = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const popoverWidth = 288; // w-72 = 18rem = 288px
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
      }
      if (left < 12) {
        left = 12;
      }
      setCoords({
        top: rect.bottom + 6,
        left,
      });
    }
  }, []);

  const fetchTables = useCallback(async () => {
    if (!dbConnected) {
      setTables([]);
      return;
    }
    setIsLoading(true);
    try {
      const list = await dbClient.listStagingTables();
      setTables(list || []);
    } catch (err) {
      console.warn('Failed to fetch staging tables:', err);
    } finally {
      setIsLoading(false);
    }
  }, [dbConnected]);

  // Load tables on mount and when db connects
  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  // Refresh tables when counts-updated event fires
  useEffect(() => {
    const cancel = EventsOn('dcload:countsUpdated', () => {
      fetchTables();
    });
    return () => {
      if (cancel) cancel();
      else EventsOff('dcload:countsUpdated');
    };
  }, [fetchTables]);

  // Update coords and listen to resize / scroll when open
  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
      return () => {
        window.removeEventListener('resize', updateCoords);
        window.removeEventListener('scroll', updateCoords, true);
      };
    }
  }, [isOpen, updateCoords]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setFilterSearch('');
    }
  }, [isOpen]);

  const standardTables = useMemo(() => {
    return tables.filter((t) => t.isStandard);
  }, [tables]);

  const customTables = useMemo(() => {
    const customs = tables.filter((t) => !t.isStandard);
    if (!filterSearch.trim()) return customs;
    const q = filterSearch.toLowerCase().trim();
    return customs.filter(
      (t) =>
        t.tableName.toLowerCase().includes(q) ||
        t.fullName.toLowerCase().includes(q) ||
        t.schemaName.toLowerCase().includes(q)
    );
  }, [tables, filterSearch]);

  // Get active label and icon for trigger button
  const activeLabel = useMemo(() => {
    if (activeCustomTable) {
      const found = tables.find((t) => t.fullName === activeCustomTable);
      return found ? found.tableName : activeCustomTable;
    }
    return currentDomain === 'sales_orders' ? 'Sales Orders' : 'DC Inventory';
  }, [activeCustomTable, currentDomain, tables]);

  const activeIcon = useMemo(() => {
    if (activeCustomTable) {
      return <Table2 className="w-3.5 h-3.5 text-indigo-400" />;
    }
    return currentDomain === 'sales_orders' ? (
      <ShoppingCart className="w-3.5 h-3.5 text-amber-500" />
    ) : (
      <Boxes className="w-3.5 h-3.5 text-sky-500" />
    );
  }, [activeCustomTable, currentDomain]);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* Switcher Button Trigger */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => !prev);
          if (!isOpen) fetchTables();
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all border shadow-sm select-none ${
          isOpen
            ? 'bg-secondary text-foreground border-ring/50 ring-1 ring-ring/30'
            : 'bg-secondary/70 hover:bg-secondary text-foreground border-border'
        }`}
        title="Switch Staging Table or Domain"
      >
        {activeIcon}
        <span className="font-semibold max-w-[130px] truncate">{activeLabel}</span>
        {activeCustomTable && (
          <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-mono">
            Custom
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Popover via React Portal to escape any header overflow clipping */}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: '18rem',
              zIndex: 99999,
            }}
            className="rounded-lg bg-popover border border-border shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150 select-none text-foreground"
          >
            {/* Header & Quick Search */}
            <div className="p-2 border-b border-border bg-muted/40">
              <div className="flex items-center justify-between pb-1.5 px-0.5">
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Staging Tables
                </span>
                <button
                  type="button"
                  onClick={fetchTables}
                  className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                  title="Refresh table list"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder="Search tables..."
                  className="w-full pl-7 pr-2 py-1 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-border/50 py-1">
              {/* Standard Domains Section */}
              <div className="px-1 py-1">
                <div className="px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Standard Tables</div>

                {/* DC Inventory */}
                {(() => {
                  const dcMeta = standardTables.find((t) => t.tableName === 'KAS_DC_LOADS');
                  const isSelected = !activeCustomTable && currentDomain === 'inventory';
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectStandardDomain('inventory');
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground hover:bg-secondary/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Boxes className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        <div className="text-left truncate">
                          <div className="font-medium">DC Inventory</div>
                          <div className="text-[10px] text-muted-foreground font-mono">[FIN].[KAS_DC_LOADS]</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {dcMeta && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {dcMeta.rowCount.toLocaleString()}
                          </span>
                        )}
                        {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                      </div>
                    </button>
                  );
                })()}

                {/* Sales Orders */}
                {(() => {
                  const soMeta = standardTables.find((t) => t.tableName === 'KAS_SO_LOADS');
                  const isSelected = !activeCustomTable && currentDomain === 'sales_orders';
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectStandardDomain('sales_orders');
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground hover:bg-secondary/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ShoppingCart className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <div className="text-left truncate">
                          <div className="font-medium">Sales Orders</div>
                          <div className="text-[10px] text-muted-foreground font-mono">[FIN].[KAS_SO_LOADS]</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {soMeta && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {soMeta.rowCount.toLocaleString()}
                          </span>
                        )}
                        {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                      </div>
                    </button>
                  );
                })()}
              </div>

              {/* Custom Tables Section */}
              <div className="px-1 py-1">
                <div className="px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Custom Tables</div>

                {customTables.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                    {filterSearch ? 'No matching custom tables.' : 'No custom staging tables discovered.'}
                  </div>
                ) : (
                  customTables.map((t) => {
                    const isSelected = activeCustomTable === t.fullName;
                    return (
                      <button
                        key={t.fullName}
                        type="button"
                        onClick={() => {
                          onSelectCustomTable(t);
                          setIsOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                          isSelected
                            ? 'bg-indigo-500/10 text-indigo-400 font-medium'
                            : 'text-foreground hover:bg-secondary/70'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Table2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <div className="text-left truncate">
                            <div className="font-medium truncate">{t.tableName}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{t.fullName}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {t.rowCount.toLocaleString()}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Action Footer */}
            <div className="p-1.5 border-t border-border bg-muted/30">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenCustomTableDialog();
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors border border-primary/20 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New / Manage Custom Tables</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
