import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  AlertOctagon,
  Download,
  Search,
  ExternalLink,
  CheckCircle2,
  HelpCircle,
  Code,
  FileSpreadsheet,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ProcessedRow, ValidationError } from '../../types/dcloader';

interface ErrorInspectorViewProps {
  rows: ProcessedRow[];
  onExportErrorCsv: () => void;
  onNavigateTab: (tab: any) => void;
}

export const ErrorInspectorView: React.FC<ErrorInspectorViewProps> = ({
  rows,
  onExportErrorCsv,
  onNavigateTab,
}) => {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Filter only failed rows
  const errorRows = useMemo(() => {
    return rows.filter((r) => !r.isValid);
  }, [rows]);

  // Group errors into categories
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    map.set('ALL', errorRows.length);

    errorRows.forEach((r) => {
      r.errors.forEach((e) => {
        let cat = 'Other';
        if (e.code.includes('BIN')) cat = 'Bin Locations';
        else if (e.code.includes('WH')) cat = 'Warehouse Controls';
        else if (e.code.includes('PART')) cat = 'Product Master';
        else if (e.code.includes('UOM') || e.code === 'P_71560') cat = 'Unit of Measure';
        else if (e.code.includes('QTY')) cat = 'Quantities';
        else if (e.code.includes('LOT')) cat = 'Lot & Batches';
        else if (e.code.includes('DATE')) cat = 'Dates & Expiry';
        else if (e.code.includes('LPN')) cat = 'License Plates';

        map.set(cat, (map.get(cat) || 0) + 1);
      });
    });

    return Array.from(map.entries());
  }, [errorRows]);

  const filteredErrorRows = useMemo(() => {
    return errorRows.filter((r) => {
      // Category filter
      if (selectedCategory !== 'ALL') {
        const matchesCat = r.errors.some((e) => {
          if (selectedCategory === 'Bin Locations' && e.code.includes('BIN')) return true;
          if (selectedCategory === 'Warehouse Controls' && e.code.includes('WH')) return true;
          if (selectedCategory === 'Product Master' && e.code.includes('PART')) return true;
          if (selectedCategory === 'Unit of Measure' && (e.code.includes('UOM') || e.code === 'P_71560')) return true;
          if (selectedCategory === 'Quantities' && e.code.includes('QTY')) return true;
          if (selectedCategory === 'Lot & Batches' && e.code.includes('LOT')) return true;
          if (selectedCategory === 'Dates & Expiry' && e.code.includes('DATE')) return true;
          if (selectedCategory === 'License Plates' && e.code.includes('LPN')) return true;
          return false;
        });
        if (!matchesCat) return false;
      }

      // Search query
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.data.partCode.toLowerCase().includes(q) ||
        r.data.lotNumber.toLowerCase().includes(q) ||
        r.data.lpNumber.toLowerCase().includes(q) ||
        r.data.warehouse.toLowerCase().includes(q) ||
        r.errors.some((e) => e.message.toLowerCase().includes(q) || e.code.toLowerCase().includes(q))
      );
    });
  }, [errorRows, selectedCategory, searchQuery]);

  const activeRow = useMemo(() => {
    if (!selectedRowId && filteredErrorRows.length > 0) {
      return filteredErrorRows[0];
    }
    return rows.find((r) => r.id === selectedRowId) || filteredErrorRows[0] || null;
  }, [selectedRowId, filteredErrorRows, rows]);

  if (errorRows.length === 0) {
    return (
      <div className="h-[calc(100vh-2.5rem)] flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">No Errors Found in Dataset</h2>
          <p className="text-xs text-muted-foreground max-w-md">
            All records conform to Ross ERP DCLoader validation specifications. The batch is clean
            and ready to be staged into SQL Server database tables.
          </p>
        </div>
        <Button
          onClick={() => onNavigateTab('execution')}
          className="text-xs font-medium"
        >
          Proceed to Simulation / Execution
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* Top Banner */}
      <div className="p-4 bg-card border-b border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span>Ross DCLoader Error Inspector</span>
              <Badge variant="destructive">{errorRows.length} Quarantine Rows</Badge>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Detailed root cause diagnostics and remediation guides for failed records.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onExportErrorCsv}
            className="text-xs border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
          >
            <Download className="w-4 h-4 mr-1.5" />
            Export Error Datafile (_ERROR_DATALINES.CSV)
          </Button>
        </div>
      </div>

      {/* Main Split View: Left List, Right Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Failed Rows List */}
        <div className="w-1/2 border-r border-border flex flex-col bg-background">
          {/* Category Tabs & Search */}
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Search error rows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-background border-border"
              />
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {categories.map(([catName, count]) => (
                <button
                  key={catName}
                  onClick={() => setSelectedCategory(catName)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                    selectedCategory === catName
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 font-semibold'
                      : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
                  }`}
                >
                  {catName} ({count})
                </button>
              ))}
            </div>
          </div>

          {/* List of Error Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/50">
            {filteredErrorRows.map((r) => {
              const isSelected = activeRow?.id === r.id;
              const primaryError = r.errors[0];

              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedRowId(r.id)}
                  className={`p-3.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-secondary/60 border-l-2 border-l-rose-500'
                      : 'hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-muted-foreground">
                        Line #{r.lineIndex}
                      </span>
                      <span className="font-mono text-xs text-foreground font-semibold">
                        {r.data.partCode}
                      </span>
                      {r.data.lotNumber && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          ({r.data.lotNumber})
                        </span>
                      )}
                    </div>
                    <Badge variant="destructive" className="font-mono text-[10px]">
                      {primaryError?.code || 'ERROR'}
                    </Badge>
                  </div>

                  <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 line-clamp-1 font-medium">
                    {primaryError?.message}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2 font-mono">
                    <span>WH: {r.data.warehouse || '-'}</span>
                    <span>BIN: {r.data.binLocation || '-'}</span>
                    <span className="truncate max-w-[150px]">LPN: {r.data.lpNumber}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Detailed Diagnostic Sheet */}
        <div className="w-1/2 flex flex-col bg-card/40 overflow-y-auto p-6 space-y-6">
          {activeRow ? (
            <>
              {/* Row Header info */}
              <div className="flex items-start justify-between pb-4 border-b border-border">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-foreground font-mono">
                      Line #{activeRow.lineIndex} Details
                    </h3>
                    <Badge variant="destructive">
                      {activeRow.errors.length} {activeRow.errors.length === 1 ? 'Error' : 'Errors'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Product: <span className="text-foreground font-mono font-semibold">{activeRow.data.partCode}</span>
                    {' '}| Warehouse: <span className="text-foreground font-mono">{activeRow.data.warehouse}</span>
                    {' '}| Status: <span className="font-mono font-semibold text-foreground">{activeRow.data.statusCode}</span>
                  </p>
                </div>

                <div className="text-right font-mono text-xs text-muted-foreground">
                  <p className="text-foreground font-semibold">LPN: {activeRow.data.lpNumber}</p>
                  <p>Qty: {activeRow.data.quantity1} {activeRow.data.uom1}</p>
                </div>
              </div>

              {/* Error cards list */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Validation Failures & Corrective Action
                </h4>

                {activeRow.errors.map((err, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                        <span className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                          [{err.code}]
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        Field #{err.fieldIndex || '-'}: {String(err.column).toUpperCase()}
                      </Badge>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-foreground">{err.message}</p>
                      {err.itemValue && (
                        <p className="text-[11px] text-muted-foreground font-mono mt-1">
                          Offending Value: <span className="text-rose-600 dark:text-rose-400 font-semibold font-mono">"{err.itemValue}"</span>
                        </p>
                      )}
                    </div>

                    {/* Remediation Guide */}
                    <div className="p-3 rounded-lg bg-secondary/40 border border-border space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Recommended Resolution:</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed pl-5">
                        {err.remediation}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Raw CSV Data Line representation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Code className="w-4 h-4 text-muted-foreground" />
                    Original CSV Row Representation
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">Exact File Tokens</span>
                </div>
                <div className="p-3 rounded-lg bg-background border border-border font-mono text-xs text-muted-foreground break-all leading-relaxed">
                  {activeRow.raw}
                </div>
              </div>

              {/* Target Ross ERP Table Impact */}
              <div className="p-4 rounded-lg border border-border bg-secondary/20 space-y-2 text-xs">
                <span className="font-semibold text-foreground">Target Staging Impact:</span>
                <p className="text-muted-foreground leading-relaxed">
                  Until corrected, this line will be bypassed by <code className="text-foreground font-mono">DCLOAD_V70.DML</code>.
                  It will not increment stock in <code className="text-foreground font-mono">DC_INCREASE_INVENTORY_LINES</code> nor
                  generate an inventory movement transaction.
                </p>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Select an error row from the left panel to inspect details
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
