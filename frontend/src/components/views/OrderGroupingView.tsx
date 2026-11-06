import React, { useState, useMemo } from 'react';
import {
  ShoppingCart,
  Search,
  Package,
  Layers,
  Calendar,
  Building2,
  MapPin,
  FileText,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CheckCheck,
  DollarSign,
  Hash,
  Boxes,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../ui/table';
import { KasSoLoadRecord, OrderGroup } from '../../types/dcloader';

interface OrderGroupingViewProps {
  rows: KasSoLoadRecord[];
  totalRows: number;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export const OrderGroupingView: React.FC<OrderGroupingViewProps> = ({
  rows,
  totalRows,
  isLoading,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'V' | 'E' | 'L' | 'PENDING'>('ALL');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  // Group raw rows by Order Header Key
  const orderGroups: OrderGroup[] = useMemo(() => {
    const groupMap = new Map<string, OrderGroup>();

    rows.forEach((r, idx) => {
      const orderKey = `${r.CUSTOMER_NUMBER || 'UNKNOWN'}||${r.DELIVERY_ADDRESS_CODE || '1'}||${r.CUSTOMER_REFERENCE || 'PO'}||${r.ORDER_DATE || ''}||${r.SYS_DELIVERY_DATE || ''}`;

      if (!groupMap.has(orderKey)) {
        groupMap.set(orderKey, {
          orderKey,
          customerReference: r.CUSTOMER_REFERENCE || '(No PO Ref)',
          customerNumber: r.CUSTOMER_NUMBER || 'UNKNOWN',
          deliveryAddressCode: r.DELIVERY_ADDRESS_CODE || '1',
          orderDate: r.ORDER_DATE ? String(r.ORDER_DATE).slice(0, 10) : 'N/A',
          sysDeliveryDate: r.SYS_DELIVERY_DATE ? String(r.SYS_DELIVERY_DATE).slice(0, 10) : 'N/A',
          totalQuantity: 0,
          totalValue: 0,
          totalFreight: 0,
          linesCount: 0,
          hasErrors: false,
          errorCount: 0,
          orderNumber: r.ORDER_NUMBER || undefined,
          status: 'pending',
          lines: [],
        });
      }

      const grp = groupMap.get(orderKey)!;
      const qty = Number(r.QUANTITY_1 || 0);
      const price = Number(r.SALES_PRICE || 0);
      const freight = Number(r.FREIGHT || 0);
      const extended = qty * price;

      grp.totalQuantity += qty;
      grp.totalValue += extended;
      grp.totalFreight += freight;
      grp.linesCount += 1;

      if (r.STATUS_FLAG === 'E') {
        grp.hasErrors = true;
        grp.errorCount += 1;
      }
      if (r.ORDER_NUMBER && !grp.orderNumber) {
        grp.orderNumber = r.ORDER_NUMBER;
      }

      grp.lines.push({
        id: `${r.GEM_DBKEY || idx}`,
        lineNumber: r.ORDER_LINE_NUMBER || grp.linesCount,
        partCode: r.PART_CODE || '',
        warehouse: r.WAREHOUSE || '',
        quantity: qty,
        unitSales: r.UNIT_SALES || 'CS',
        salesPrice: price,
        extendedPrice: extended,
        freight,
        status: r.STATUS_FLAG || ' ',
        message: r.RS_MESSAGE_TEXT || '',
      });
    });

    // Derive overall status per group
    return Array.from(groupMap.values()).map((grp) => {
      const allLoaded = grp.lines.every((l) => l.status === 'L');
      const allValid = grp.lines.every((l) => l.status === 'V');
      const anyError = grp.lines.some((l) => l.status === 'E');

      let status: 'valid' | 'error' | 'loaded' | 'pending' = 'pending';
      if (allLoaded) status = 'loaded';
      else if (anyError) status = 'error';
      else if (allValid) status = 'valid';

      return {
        ...grp,
        status,
      };
    });
  }, [rows]);

  const toggleExpand = (key: string) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    orderGroups.forEach((g) => {
      all[g.orderKey] = true;
    });
    setExpandedOrders(all);
  };

  const collapseAll = () => {
    setExpandedOrders({});
  };

  // Filter groups
  const filteredGroups = useMemo(() => {
    return orderGroups.filter((g) => {
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'V' && g.status !== 'valid') return false;
        if (statusFilter === 'E' && g.status !== 'error') return false;
        if (statusFilter === 'L' && g.status !== 'loaded') return false;
        if (statusFilter === 'PENDING' && g.status !== 'pending') return false;
      }
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        g.customerReference.toLowerCase().includes(q) ||
        g.customerNumber.toLowerCase().includes(q) ||
        g.deliveryAddressCode.toLowerCase().includes(q) ||
        (g.orderNumber && g.orderNumber.toLowerCase().includes(q)) ||
        g.lines.some((l) => l.partCode.toLowerCase().includes(q) || l.warehouse.toLowerCase().includes(q))
      );
    });
  }, [orderGroups, statusFilter, searchQuery]);

  // Aggregate stats
  const totalOrdersCount = orderGroups.length;
  const validOrdersCount = orderGroups.filter((g) => g.status === 'valid').length;
  const errorOrdersCount = orderGroups.filter((g) => g.status === 'error').length;
  const loadedOrdersCount = orderGroups.filter((g) => g.status === 'loaded').length;
  const totalUnits = orderGroups.reduce((acc, g) => acc + g.totalQuantity, 0);
  const totalOrderValue = orderGroups.reduce((acc, g) => acc + g.totalValue, 0);

  const renderStatusBadge = (status: 'valid' | 'error' | 'loaded' | 'pending', errorCount: number) => {
    switch (status) {
      case 'valid':
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 gap-1 text-[10px]">
            <CheckCircle2 className="w-3 h-3" />
            VALIDATED
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <AlertTriangle className="w-3 h-3" />
            {errorCount} {errorCount === 1 ? 'ERROR' : 'ERRORS'}
          </Badge>
        );
      case 'loaded':
        return (
          <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30 gap-1 text-[10px]">
            <CheckCheck className="w-3 h-3" />
            LOADED
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Clock className="w-3 h-3" />
            STAGED
          </Badge>
        );
    }
  };

  const renderLineStatusBadge = (flag: string) => {
    switch (flag) {
      case 'V':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            Valid
          </span>
        );
      case 'E':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" />
            Error
          </span>
        );
      case 'L':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/30">
            <CheckCheck className="w-3 h-3" />
            Loaded
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden bg-background">
      {/* Top Header Bar */}
      <div className="p-4 bg-card border-b border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <ShoppingCart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span>Sales Order Hierarchy & Grouping Explorer</span>
              <Badge variant="outline" className="font-mono text-[11px]">
                {totalOrdersCount} Orders ({totalRows} Lines)
              </Badge>
              {errorOrdersCount > 0 && (
                <Badge variant="destructive" className="font-mono text-[11px]">
                  {errorOrdersCount} Orders with Errors
                </Badge>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              Grouped per Ross ERP SOP facility <code className="font-mono text-foreground font-semibold">SOPC_T_003</code> by Customer Reference, Ship-To, and Requested Dates.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={expandAll} className="text-xs h-8">
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll} className="text-xs h-8">
            Collapse All
          </Button>
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs h-8">
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4 bg-secondary/20 border-b border-border">
        <div className="p-2.5 rounded-lg bg-card border border-border">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Total Orders</p>
          <p className="text-lg font-bold font-mono text-foreground mt-0.5">{totalOrdersCount}</p>
        </div>
        <div className="p-2.5 rounded-lg bg-card border border-border">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Total Order Lines</p>
          <p className="text-lg font-bold font-mono text-foreground mt-0.5">{totalRows}</p>
        </div>
        <div className="p-2.5 rounded-lg bg-card border border-border">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Total Units</p>
          <p className="text-lg font-bold font-mono text-foreground mt-0.5">
            {totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-card border border-border">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Total Order Value</p>
          <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
            ${totalOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-card border border-border">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Valid Orders</p>
          <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
            {validOrdersCount}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-card border border-border">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Error Orders</p>
          <p className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
            {errorOrdersCount}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-3 border-b border-border flex items-center justify-between gap-3 bg-card/60">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Cust PO, Customer, Part Code..."
            className="pl-8 text-xs h-8 bg-background"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              statusFilter === 'ALL'
                ? 'bg-secondary text-foreground border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({orderGroups.length})
          </button>
          <button
            onClick={() => setStatusFilter('V')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              statusFilter === 'V'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                : 'text-muted-foreground hover:text-emerald-600'
            }`}
          >
            Valid ({validOrdersCount})
          </button>
          <button
            onClick={() => setStatusFilter('E')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              statusFilter === 'E'
                ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                : 'text-muted-foreground hover:text-rose-600'
            }`}
          >
            Errors ({errorOrdersCount})
          </button>
          <button
            onClick={() => setStatusFilter('L')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              statusFilter === 'L'
                ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30'
                : 'text-muted-foreground hover:text-sky-600'
            }`}
          >
            Loaded ({loadedOrdersCount})
          </button>
        </div>
      </div>

      {/* Main Order Cards Scroll Area */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {filteredGroups.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center text-muted-foreground">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No Sales Orders Match Filter</p>
              <p className="text-xs text-muted-foreground mt-1">
                {orderGroups.length === 0
                  ? 'No sales order lines currently staged. Import a Sales Order CSV from the Data Grid view.'
                  : 'Try clearing your search query or switching the status filter.'}
              </p>
            </div>
          </div>
        ) : (
          filteredGroups.map((grp) => {
            const isExpanded = Boolean(expandedOrders[grp.orderKey]);

            return (
              <Card
                key={grp.orderKey}
                className={`transition-all border ${
                  grp.hasErrors
                    ? 'border-rose-500/40 bg-rose-500/[0.02]'
                    : grp.status === 'valid'
                    ? 'border-emerald-500/40 bg-emerald-500/[0.01]'
                    : grp.status === 'loaded'
                    ? 'border-sky-500/40 bg-sky-500/[0.01]'
                    : 'border-border bg-card'
                }`}
              >
                {/* Collapsible Order Header Card */}
                <div
                  onClick={() => toggleExpand(grp.orderKey)}
                  className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-secondary text-muted-foreground transition-transform"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-foreground">
                          PO Ref: {grp.customerReference}
                        </span>
                        {grp.orderNumber && (
                          <Badge variant="outline" className="font-mono text-xs font-semibold bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30">
                            Ross Order: {grp.orderNumber}
                          </Badge>
                        )}
                        {renderStatusBadge(grp.status, grp.errorCount)}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>Cust: <strong className="text-foreground font-mono">{grp.customerNumber}</strong></span>
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>Ship-To: <strong className="text-foreground font-mono">{grp.deliveryAddressCode}</strong></span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>Ordered: <strong className="text-foreground font-mono">{grp.orderDate}</strong></span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>Req Delivery: <strong className="text-foreground font-mono">{grp.sysDeliveryDate}</strong></span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Header Stats */}
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase font-sans">Lines</p>
                      <p className="font-bold text-foreground">{grp.linesCount}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase font-sans">Total Units</p>
                      <p className="font-bold text-foreground">
                        {grp.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase font-sans">Order Total</p>
                      <p className="font-bold text-emerald-600 dark:text-emerald-400">
                        ${grp.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Expanded Lines Table */}
                {isExpanded && (
                  <div className="border-t border-border bg-background/50 p-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-border text-[11px]">
                          <TableHead className="w-12 text-center">Line #</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                          <TableHead className="w-16">Wh</TableHead>
                          <TableHead className="w-32">ROSS Part Code</TableHead>
                          <TableHead className="w-24 text-right">Quantity</TableHead>
                          <TableHead className="w-16 text-center">UOM</TableHead>
                          <TableHead className="w-24 text-right">Sales Price</TableHead>
                          <TableHead className="w-28 text-right">Extended Value</TableHead>
                          <TableHead className="w-20 text-right">Freight</TableHead>
                          <TableHead className="min-w-64">Validation / System Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grp.lines.map((line) => {
                          const isError = line.status === 'E';
                          const isValid = line.status === 'V';
                          const isLoaded = line.status === 'L';

                          return (
                            <TableRow
                              key={line.id}
                              className={`text-xs ${
                                isError
                                  ? 'bg-rose-500/5 hover:bg-rose-500/10'
                                  : isValid
                                  ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                                  : isLoaded
                                  ? 'bg-sky-500/5 hover:bg-sky-500/10'
                                  : 'hover:bg-secondary/40'
                              }`}
                            >
                              <TableCell className="text-center font-mono font-bold text-muted-foreground">
                                {line.lineNumber}
                              </TableCell>
                              <TableCell>
                                {renderLineStatusBadge(line.status)}
                              </TableCell>
                              <TableCell className="font-mono font-medium">
                                {line.warehouse}
                              </TableCell>
                              <TableCell className="font-mono font-semibold text-foreground">
                                {line.partCode}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold">
                                {line.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-center font-mono text-[11px] text-muted-foreground">
                                {line.unitSales}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${line.salesPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                ${line.extendedPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {line.freight > 0 ? `$${line.freight.toFixed(2)}` : '—'}
                              </TableCell>
                              <TableCell className="font-mono text-[11px]">
                                <span
                                  className={
                                    isError
                                      ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                      : isValid
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : isLoaded
                                      ? 'text-sky-600 dark:text-sky-400 font-medium'
                                      : 'text-muted-foreground'
                                  }
                                >
                                  {line.message || 'Pending Validation'}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

