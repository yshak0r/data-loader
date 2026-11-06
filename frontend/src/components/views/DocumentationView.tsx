import React from 'react';
import {
  BookOpen,
  FileText,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  CheckCircle2,
  Code,
  Terminal,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

export const DocumentationView: React.FC = () => {
  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* Top Banner */}
      <div className="p-4 bg-card border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-secondary border border-border flex items-center justify-center text-foreground">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span>Ross ERP DC Loader Reference Guide</span>
              <Badge variant="outline">
                v7.0 / v8.0 Enterprise Documentation
              </Badge>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Technical rules, movement codes, valuation methods, and error reference.
            </p>
          </div>
        </div>
      </div>

      {/* Main Documentation Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background text-muted-foreground">
        {/* Section 1: Overview & Routine Call */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              IAF Execution & Facility Requirements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs leading-relaxed">
            <p>
              In Ross ERP, opening inventory balances for Data Capture (DC) warehouses must be loaded
              through the dedicated routine <code className="text-foreground font-mono bg-secondary px-1 py-0.5 rounded">DCLOAD_V70.DML</code>.
              Calling via <code className="text-foreground font-mono bg-secondary px-1 py-0.5 rounded">PERFORM</code> is prevented by the
              <code className="text-foreground font-mono bg-secondary px-1 py-0.5 rounded">CHECK_FACILITY</code> block; it must be invoked via
              facility <code className="text-foreground font-mono bg-secondary px-1 py-0.5 rounded">FIN.APPLICATIONS:DCLOAD</code> using:
            </p>
            <div className="p-3 rounded-lg bg-secondary/50 border border-border font-mono text-emerald-700 dark:text-emerald-400">
              DML Prompt&gt; menu dcload
            </div>
            <p>
              To decrease inventory balances, perform <code className="text-foreground font-mono bg-secondary px-1 py-0.5 rounded">add_dcqoh_movement_codes.dml</code> and execute <code className="text-foreground font-mono bg-secondary px-1 py-0.5 rounded">menu dcsub</code>.
            </p>
          </CardContent>
        </Card>

        {/* Section 2: 17 CSV Columns Definition */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              17 CSV Column Specifications
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Comment lines begin with <code className="text-foreground font-mono">!</code>. Trailing commas are optional.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">1. WAREHOUSE</span>
                <p className="text-muted-foreground font-sans">Warehouse code. Must have Data Capture in use = 'Y'.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">2. PART_CODE</span>
                <p className="text-muted-foreground font-sans">Active in Product Master and Product Warehouse.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">3. IC_LOT_NUMBER</span>
                <p className="text-muted-foreground font-sans">Lot/Batch number (max 15 chars). Mandatory if item is lotted.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">4. BIN_LOCATION</span>
                <p className="text-muted-foreground font-sans">Required if warehouse has Bin Sizing = 'Y'. Must be active.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">5. IC_STATUS_CODE</span>
                <p className="text-muted-foreground font-sans">QOH (Quantity on Hand), QC (Quality Control), or QR (Quarantine).</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">6. MH_NUMBER</span>
                <p className="text-muted-foreground font-sans">Material Handling Number (optional tracking).</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">7. UOM_1</span>
                <p className="text-muted-foreground font-sans">Primary UOM: Pack UOM if packaged, or Capacity UOM.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">8. UOM_2</span>
                <p className="text-muted-foreground font-sans">Secondary UOM: Mandatory for Catchweight (UOM Control = 'C').</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">9. QUANTITY_1</span>
                <p className="text-muted-foreground font-sans">Primary quantity &gt; 0, formatted to UOM precision mask.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">10. QUANTITY_2</span>
                <p className="text-muted-foreground font-sans">Secondary quantity &gt; 0 (Catchweight items only).</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">11. SUPPLIER_LOT</span>
                <p className="text-muted-foreground font-sans">Vendor lot number (max 20 chars, optional).</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">12. UNIT_COST</span>
                <p className="text-muted-foreground font-sans">Required &gt; 0 for LOT, FIFO, LIFO. Blank for STD/WAC.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">13. BEST_BEFORE_DATE</span>
                <p className="text-muted-foreground font-sans">Format DD-MMM-YYYY. Blank if existing lot.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">14. EXPIRY_DATE</span>
                <p className="text-muted-foreground font-sans">Format DD-MMM-YYYY. Blank if existing lot.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">15. RETEST_DATE</span>
                <p className="text-muted-foreground font-sans">Format DD-MMM-YYYY. Blank if existing lot.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                <span className="text-foreground font-bold">16. CREATE_DATE</span>
                <p className="text-muted-foreground font-sans">Format DD-MMM-YYYY. Defaults to %TODAY if blank.</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1 md:col-span-2">
                <span className="text-foreground font-bold">17. LP_NUMBER (License Plate Number)</span>
                <p className="text-muted-foreground font-sans">Mandatory (max 30 chars). Must exist in only one warehouse and one bin. All lines on the LPN must share the same status.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Diagnostic Codes & Troubleshooting */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Ross Error Code Quick Reference
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="space-y-2 font-mono">
              <div className="p-2.5 rounded bg-secondary/30 border border-border">
                <span className="text-rose-700 dark:text-rose-400 font-bold">P_71560:</span>
                <span className="text-muted-foreground ml-2">Unit of Measure 1 must be Pack UOM. (Product has packaged flag 'Y', but CSV passed capacity UOM or invalid pack unit).</span>
              </div>
              <div className="p-2.5 rounded bg-secondary/30 border border-border">
                <span className="text-rose-700 dark:text-rose-400 font-bold">P_10648 / P_42234:</span>
                <span className="text-muted-foreground ml-2">Movement code (BGNQOH, BGNQC, BGNQR) missing in INVENTORY_MOVEMENTS_CONTROL or move type mismatch.</span>
              </div>
              <div className="p-2.5 rounded bg-secondary/30 border border-border">
                <span className="text-amber-700 dark:text-amber-400 font-bold">P_82065:</span>
                <span className="text-muted-foreground ml-2">"Lot is Expired" — Severity downgraded from 2 (fatal) to 0 (info) in dcload_v70_for80.dml to allow historical loading.</span>
              </div>
              <div className="p-2.5 rounded bg-secondary/30 border border-border">
                <span className="text-amber-700 dark:text-amber-400 font-bold">P_13647:</span>
                <span className="text-muted-foreground ml-2">"Quantity has been adjusted" — Severity downgraded to info; occurs when CSV decimal precision differs from UOM mask.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
