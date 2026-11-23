import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Filter, Search, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { dbClient } from '@/lib/dbClient';
import { LoaderDomain } from '@/types/dcloader';

interface ColumnHeaderFilterProps {
  columnName: string;
  columnTitle: string;
  domain?: LoaderDomain | string;
  targetTable?: string;
  activeFilter?: string;
  onFilterChange: (columnName: string, value: string | null) => void;
}

export const ColumnHeaderFilter: React.FC<ColumnHeaderFilterProps> = ({
  columnName,
  columnTitle,
  domain,
  targetTable,
  activeFilter,
  onFilterChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [hasBlanks, setHasBlanks] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isFiltered = Boolean(activeFilter && activeFilter.trim() !== '');

  // Fetch unique distinct values from backend
  const fetchDistinctValues = useCallback(
    async (searchQuery: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await dbClient.getColumnDistinctValues({
          domain: domain || 'inventory',
          targetTable: targetTable || '',
          columnName,
          search: searchQuery,
          limit: 100,
        });
        setValues(res.values || []);
        setHasBlanks(Boolean(res.hasBlanks));
        setIsTruncated(Boolean(res.truncated));
      } catch (err: any) {
        setError('Failed to load values');
      } finally {
        setIsLoading(false);
      }
    },
    [columnName, domain, targetTable]
  );

  // Load distinct values when popover opens
  useEffect(() => {
    if (isOpen) {
      fetchDistinctValues(searchTerm);
      // Auto-focus search input
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, fetchDistinctValues]);

  // Debounced search inside popover
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fetchDistinctValues(searchTerm);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm, isOpen, fetchDistinctValues]);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

  const handleSelectValue = (val: string) => {
    onFilterChange(columnName, val);
    setIsOpen(false);
  };

  const handleClear = () => {
    onFilterChange(columnName, null);
    setCustomValue('');
    setIsOpen(false);
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customValue.trim() !== '') {
      onFilterChange(columnName, customValue.trim());
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center ml-1 text-left font-normal cursor-pointer select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Mini Filter Button on Column Header */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`p-1 rounded transition-colors flex items-center justify-center ${
          isFiltered
            ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950/80 shadow-xs ring-1 ring-sky-400/50'
            : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/80'
        }`}
        title={isFiltered ? `Filtered by "${activeFilter}" — Click to change` : `Filter by ${columnTitle}`}
      >
        <Filter className="w-2.5 h-2.5" />
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 bg-popover text-popover-foreground border border-border rounded-lg shadow-xl p-2.5 space-y-2 text-xs animate-in fade-in-50 zoom-in-95">
          {/* Header */}
          <div className="flex items-center justify-between pb-1.5 border-b border-border/80">
            <span className="font-semibold text-[11px] text-foreground truncate max-w-[180px]">
              Filter: {columnTitle}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search distinct values..."
              className="w-full bg-background border border-border rounded pl-6 pr-6 py-1 text-xs focus:outline-hidden focus:ring-1 focus:ring-sky-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Quick Clear Option */}
          {isFiltered && (
            <button
              type="button"
              onClick={handleClear}
              className="w-full text-left px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded flex items-center justify-between font-medium"
            >
              <span>✕ Clear current filter</span>
              <span className="font-mono text-[10px] opacity-75 truncate max-w-[90px]">({activeFilter})</span>
            </button>
          )}

          {/* Values List */}
          <div className="max-h-48 overflow-y-auto border border-border/60 rounded bg-background/50 divide-y divide-border/40">
            {isLoading ? (
              <div className="py-4 flex flex-col items-center justify-center text-muted-foreground gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                <span className="text-[10px]">Loading unique fields...</span>
              </div>
            ) : error ? (
              <div className="py-3 px-2 text-center text-rose-500 flex items-center justify-center gap-1 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <>
                {/* Special '(All)' selection */}
                <button
                  type="button"
                  onClick={handleClear}
                  className={`w-full text-left px-2 py-1.5 hover:bg-muted/70 flex items-center justify-between text-xs transition-colors ${
                    !isFiltered ? 'font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50' : 'text-foreground'
                  }`}
                >
                  <span>(Show All / No Filter)</span>
                  {!isFiltered && <Check className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />}
                </button>

                {/* Special '(Blanks)' option */}
                {hasBlanks && (
                  <button
                    type="button"
                    onClick={() => handleSelectValue('(Blanks)')}
                    className={`w-full text-left px-2 py-1.5 hover:bg-muted/70 flex items-center justify-between text-xs transition-colors ${
                      activeFilter === '(Blanks)'
                        ? 'font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50'
                        : 'text-muted-foreground italic'
                    }`}
                  >
                    <span>(Blanks / Empty)</span>
                    {activeFilter === '(Blanks)' && <Check className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />}
                  </button>
                )}

                {/* Distinct Values */}
                {values.length === 0 ? (
                  <div className="py-3 px-2 text-center text-muted-foreground/80 text-[11px]">
                    No matching values found
                  </div>
                ) : (
                  values.map((v) => {
                    const isSelected = activeFilter === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => handleSelectValue(v)}
                        className={`w-full text-left px-2 py-1.5 hover:bg-muted/70 flex items-center justify-between text-xs transition-colors font-mono ${
                          isSelected
                            ? 'font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50'
                            : 'text-foreground'
                        }`}
                        title={v}
                      >
                        <span className="truncate pr-2">{v}</span>
                        {isSelected && <Check className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </>
            )}
          </div>

          {/* High Cardinality Notice */}
          {isTruncated && (
            <div className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-1 rounded leading-tight">
              Showing top 100 unique values. Type in the search box above to narrow down.
            </div>
          )}

          {/* Direct Custom Exact Input */}
          <form onSubmit={handleApplyCustom} className="pt-1 flex items-center gap-1 border-t border-border/80">
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="Custom exact value..."
              className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-[11px] font-mono focus:outline-hidden focus:ring-1 focus:ring-sky-500"
            />
            <button
              type="submit"
              disabled={!customValue.trim()}
              className="bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-medium px-2 py-1 rounded text-[11px] shrink-0"
            >
              Apply
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
