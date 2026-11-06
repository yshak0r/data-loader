import React, { useState } from 'react';
import {
  Boxes,
  Layers,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Search,
  Package,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { LpnGroup, ProcessedRow } from '../../types/dcloader';

interface LpnHierarchyViewProps {
  lpnGroups: LpnGroup[];
  onSelectRow?: (row: ProcessedRow) => void;
}

export const LpnHierarchyView: React.FC<LpnHierarchyViewProps> = ({
  lpnGroups,
  onSelectRow,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLpns, setExpandedLpns] = useState<Record<string, boolean>>({});

  const toggleExpand = (lpn: string) => {
    setExpandedLpns((prev) => ({
      ...prev,
      [lpn]: !prev[lpn],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    lpnGroups.forEach((g) => {
      all[g.lpNumber] = true;
    });
    setExpandedLpns(all);
  };

  const collapseAll = () => {
    setExpandedLpns({});
  };

  const filteredGroups = lpnGroups.filter((g) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      g.lpNumber.toLowerCase().includes(q) ||
      g.warehouse.toLowerCase().includes(q) ||
      g.binLocation.toLowerCase().includes(q) ||
      g.rows.some((r) => r.data.partCode.toLowerCase().includes(q) || r.data.lotNumber.toLowerCase().includes(q))
    );
  });

  const conflictCount = lpnGroups.filter((g) => g.hasConflict).length;

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* Top Header */}
      <div className="p-4 bg-card border-b border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-secondary border border-border flex items-center justify-center text-foreground">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span>License Plate Number (LPN) Tree Explorer</span>
              <Badge variant="outline">{lpnGroups.length} LPN Pallets</Badge>
              {conflictCount > 0 && (
                <Badge variant="destructive">{conflictCount} Multi-Location Conflicts</Badge>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              DC Module pallet hierarchy, container line allocations, and multi-lot consolidation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={expandAll}
            className="h-8 text-xs"
          >
            Expand All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={collapseAll}
            className="h-8 text-xs"
          >
            Collapse All
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="p-3 bg-card/40 border-b border-border flex items-center justify-between gap-4">
        <div className="relative w-80">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search LPN, Part, Lot, or Bin..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs bg-background border-border"
          />
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
          <span>Total Consolidations: {lpnGroups.length}</span>
          <span>Multi-Item Pallets: {lpnGroups.filter((g) => g.linesCount > 1).length}</span>
        </div>
      </div>

      {/* Main LPN Tree Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
        {filteredGroups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground text-xs">
            No License Plates found matching the search criteria
          </div>
        ) : (
          filteredGroups.map((g) => {
            const isExpanded = !!expandedLpns[g.lpNumber];
            const hasMultipleLines = g.linesCount > 1;

            return (
              <div
                key={g.lpNumber}
                className={`rounded-lg border transition-all ${
                  g.hasConflict
                    ? 'border-rose-500/40 bg-rose-500/5'
                    : 'border-border bg-card hover:border-muted-foreground/30'
                }`}
              >
                {/* LPN Card Header */}
                <div
                  onClick={() => toggleExpand(g.lpNumber)}
                  className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <button className="text-muted-foreground hover:text-foreground">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {g.lpNumber}
                      </span>
                      {hasMultipleLines ? (
                        <Badge variant="outline" className="text-[10px]">
                          Multi-Item ({g.linesCount} lines)
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Single Line
                        </Badge>
                      )}
                      {g.hasConflict && (
                        <Badge variant="destructive" className="text-[10px]">
                          ERP Conflict
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Metadata pills */}
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span>WH:</span>
                      <span className="font-semibold text-foreground">{g.warehouse || '-'}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>BIN:</span>
                      <span className="font-semibold text-foreground">
                        {g.binLocation || '(non-binned)'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">STATUS:</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          g.statusCode === 'QOH'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                            : g.statusCode === 'QC'
                            ? 'bg-secondary text-foreground border-border'
                            : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {g.statusCode}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-foreground">
                      <span className="text-muted-foreground">TOTAL:</span>
                      <span className="font-bold">{g.totalQty1.toLocaleString()} {g.uom1}</span>
                    </div>
                  </div>
                </div>

                {/* Conflict warning banner */}
                {g.hasConflict && (
                  <div className="mx-3 mb-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
                    <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                    <span>{g.conflictReason}</span>
                  </div>
                )}

                {/* Expanded Lines Table */}
                {isExpanded && (
                  <div className="p-3 pt-0 border-t border-border bg-background/40">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="text-[11px] text-muted-foreground border-b border-border">
                            <th className="py-2 px-3">LP Line #</th>
                            <th className="py-2 px-3">CSV Line</th>
                            <th className="py-2 px-3">Part Code</th>
                            <th className="py-2 px-3">Lot Number</th>
                            <th className="py-2 px-3 text-right">Primary Qty</th>
                            <th className="py-2 px-3">UOM 1</th>
                            <th className="py-2 px-3 text-right">Secondary Qty</th>
                            <th className="py-2 px-3">UOM 2</th>
                            <th className="py-2 px-3">Vendor Lot</th>
                            <th className="py-2 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60 font-mono">
                          {g.rows.map((row) => (
                            <tr
                              key={row.id}
                              onClick={() => onSelectRow?.(row)}
                              className="hover:bg-muted/40 cursor-pointer"
                            >
                              <td className="py-2 px-3 text-foreground font-bold">
                                #{row.assignedLineNumber || 1}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                Line {row.lineIndex}
                              </td>
                              <td className="py-2 px-3 text-foreground font-semibold">
                                {row.data.partCode}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {row.data.lotNumber || '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-foreground">
                                {row.data.quantity1}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">{row.data.uom1}</td>
                              <td className="py-2 px-3 text-right text-muted-foreground">
                                {row.data.quantity2 || '-'}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {row.data.uom2 || '-'}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {row.data.supplierLot || '-'}
                              </td>
                              <td className="py-2 px-3">
                                {row.isValid ? (
                                  <span className="text-emerald-700 dark:text-emerald-400 font-sans font-semibold text-[11px]">
                                    Valid
                                  </span>
                                ) : (
                                  <span className="text-rose-700 dark:text-rose-400 font-sans font-semibold text-[11px]">
                                    Error
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
