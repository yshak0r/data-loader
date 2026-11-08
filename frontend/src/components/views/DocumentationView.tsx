import React, { useState } from 'react';
import {
  BookOpen,
  FileSpreadsheet,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Layers,
  Settings,
  HelpCircle,
  ShieldCheck,
  Terminal,
  ArrowRight,
  RefreshCw,
  FileDown,
  Info,
  ListOrdered,
  Sparkles,
  Workflow,
  Filter,
  Trash2,
  Boxes,
  ShoppingCart,
  ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

export const DocumentationView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('guide');

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden bg-background">
      {/* Top Banner */}
      <div className="p-4 bg-card border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Ross ERP Data Loader — User Guide & Operations Manual
              </h2>
              <Badge variant="outline" className="text-[11px] font-mono border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                v7.0 / v8.0 Enterprise
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Comprehensive end-to-end walkthrough, pipeline lifecycle, domain capabilities, and troubleshooting.
            </p>
          </div>
        </div>

        {/* Quick Nav Tabs Controller */}
        <div className="flex items-center">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-secondary/60 border border-border/80">
              <TabsTrigger value="guide" className="gap-1.5 text-xs">
                <Workflow className="w-3.5 h-3.5" />
                Step-by-Step Guide
              </TabsTrigger>
              <TabsTrigger value="lifecycle" className="gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5" />
                Status Lifecycle
              </TabsTrigger>
              <TabsTrigger value="domains" className="gap-1.5 text-xs">
                <Layers className="w-3.5 h-3.5" />
                Domains
              </TabsTrigger>
              <TabsTrigger value="scripts" className="gap-1.5 text-xs">
                <Settings className="w-3.5 h-3.5" />
                SQL Scripts
              </TabsTrigger>
              <TabsTrigger value="faq" className="gap-1.5 text-xs">
                <HelpCircle className="w-3.5 h-3.5" />
                FAQ & Diagnostics
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* TAB 1: STEP-BY-STEP USER WALKTHROUGH */}
          <TabsContent value="guide" className="m-0 space-y-6">
            {/* Quick Summary Card */}
            <Card className="bg-gradient-to-r from-card to-secondary/30 border-border">
              <CardContent className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <h3 className="text-sm font-semibold text-foreground">Welcome to Ross ERP Desktop Data Loader</h3>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                    Designed for automated, high-speed ingestion of opening inventory balances and sales orders into Ross ERP.
                    Follow the 6 stages below to connect, stage, validate, simulate, and commit your batches safely.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs px-2.5 py-1">
                    Zero-Footprint Execution
                  </Badge>
                  <Badge variant="secondary" className="text-xs px-2.5 py-1">
                    Direct SQL Server Staging
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* 6-Step Workflow Process */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Step 1 */}
              <Card className="bg-card border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      STAGE 01
                    </Badge>
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                      <Database className="w-4 h-4" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground mt-2">
                    Connect to SQL Server
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Link directly to your Ross ERP database instance.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2 pt-0">
                  <p>
                    Click the <strong>Database Status</strong> pill in the top header to configure your target SQL Server connection:
                  </p>
                  <ul className="list-disc list-inside space-y-1 font-mono text-[11px] text-foreground/80 pl-1">
                    <li>Host / Instance & Port (default: 1433)</li>
                    <li>Database Catalog (e.g., <code className="text-primary font-bold">fin_demo</code>)</li>
                    <li>Authentication (SQL or Windows)</li>
                    <li>Company Code (<code className="text-primary font-bold">CORP</code>) & Division</li>
                  </ul>
                  <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                    The tool automatically verifies and creates the required <code className="font-mono text-foreground font-semibold">FIN</code> staging schema if missing.
                  </p>
                </CardContent>
              </Card>

              {/* Step 2 */}
              <Card className="bg-card border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      STAGE 02
                    </Badge>
                    <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                      <Layers className="w-4 h-4" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground mt-2">
                    Choose Loader Domain
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Select Inventory or Sales Orders.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2 pt-0">
                  <p>
                    Use the domain switcher dropdown in the top header to toggle between:
                  </p>
                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded bg-secondary/40 border border-border/60">
                      <span className="font-medium text-foreground flex items-center gap-1.5">
                        <Boxes className="w-3.5 h-3.5 text-blue-500" /> DC Inventory
                      </span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Opening stock balances, LPN pallets, lot tracking, and warehouse initialization.
                      </p>
                    </div>
                    <div className="p-2 rounded bg-secondary/40 border border-border/60">
                      <span className="font-medium text-foreground flex items-center gap-1.5">
                        <ShoppingCart className="w-3.5 h-3.5 text-emerald-500" /> Sales Orders
                      </span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Customer orders, header terms, shipping details, and detail order line items.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Step 3 */}
              <Card className="bg-card border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      STAGE 03
                    </Badge>
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground mt-2">
                    Stage Data via CSV Upload
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Stream file rows into SQL Server staging tables.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2 pt-0">
                  <p>
                    In <strong>Data Grid & Import</strong>, click <strong>Select CSV File</strong> or drop your file.
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-muted-foreground pl-1">
                    <li><strong className="text-foreground">Header-Agnostic:</strong> Handles spaces, underscores, and casing automatically (e.g. <code className="font-mono text-foreground">UOM 1</code> = <code className="font-mono text-foreground">UOM_1</code>).</li>
                    <li><strong className="text-foreground">Comments Supported:</strong> Lines starting with <code className="font-mono text-foreground">!</code> are safely skipped.</li>
                    <li><strong className="text-foreground">High-Speed Streaming:</strong> Data is ingested in optimized SQL Server batches with live progress indicators.</li>
                  </ul>
                  <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                    Rows enter the pipeline with initial status <Badge variant="outline" className="font-mono text-[10px] px-1 py-0">Pending</Badge>.
                  </p>
                </CardContent>
              </Card>

              {/* Step 4 */}
              <Card className="bg-card border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      STAGE 04
                    </Badge>
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground mt-2">
                    Run Dry Run Validation
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Execute pre-load business and master data checks.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2 pt-0">
                  <p>
                    Click <strong>Run Dry Run</strong> from the top bar or grid toolbar.
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    Set-based SQL validation tests your staged records against Ross ERP tables without touching live transactions:
                  </p>
                  <div className="p-2 rounded bg-secondary/40 border border-border/60 text-[11px] space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Pass: Stamped as 'V' (Validated)
                    </div>
                    <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" /> Fail: Stamped as 'E' (Quarantined)
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Use <strong>Error Inspector</strong> to inspect quarantined error rules and diagnostic messages.
                  </p>
                </CardContent>
              </Card>

              {/* Step 5 */}
              <Card className="bg-card border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      STAGE 05
                    </Badge>
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <PlayCircle className="w-4 h-4" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground mt-2">
                    Execute Ross ERP Loader
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Simulate and commit validated records.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2 pt-0">
                  <p>
                    Navigate to <strong>Simulate & Load</strong> to execute the Ross ERP loading process:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-muted-foreground pl-1">
                    <li>Only validated records (<code className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">STATUS_FLAG = 'V'</code>) are processed.</li>
                    <li>Quarantined rows remain safely isolated.</li>
                    <li>Live loader commits transactions to Ross ERP and marks them <Badge variant="outline" className="font-mono text-[10px] px-1 text-emerald-600">P / L</Badge>.</li>
                    <li>Any load execution failure is flagged as <Badge variant="outline" className="font-mono text-[10px] px-1 text-amber-600">F (Failed)</Badge> with detailed message logs.</li>
                  </ul>
                </CardContent>
              </Card>

              {/* Step 6 */}
              <Card className="bg-card border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      STAGE 06
                    </Badge>
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                      <FileDown className="w-4 h-4" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground mt-2">
                    Filter, Export & Reconcile
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Audit results and export error batches.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2 pt-0">
                  <p>
                    Back in <strong>Data Grid & Import</strong>, use the 5 status ribbons to filter:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                    <span className="p-1.5 rounded bg-secondary/50 border border-border/50 text-foreground">Total Staged</span>
                    <span className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">Validated</span>
                    <span className="p-1.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">Quarantine</span>
                    <span className="p-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">Committed</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Click <strong>Export Data</strong> to export specific CSV files (e.g. Export Quarantine for client corrections, or Export All for reconciliation).
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Quick Action Hints */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-500" />
                  Key Operational Shortcuts & Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" /> Clear Staged Data
                  </span>
                  <p className="text-[11px]">
                    Use the trash icon in the header toolbar anytime you want to clear your current staging batch and upload a fresh CSV. Does not alter ERP master tables.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" /> Dynamic Re-Validation
                  </span>
                  <p className="text-[11px]">
                    If master data in Ross ERP was updated by another user (e.g. product enabled, bin created), simply re-click <strong>Run Dry Run</strong> to re-evaluate all rows.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Boxes className="w-3.5 h-3.5 text-muted-foreground" /> Order Grouping & Hierarchy
                  </span>
                  <p className="text-[11px]">
                    Switch to <strong>Order Hierarchy</strong> when working in Sales Orders to inspect consolidated customer headers, detail line items, and totals visually.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: STATUS LIFECYCLE & PIPELINE */}
          <TabsContent value="lifecycle" className="m-0 space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Filter className="w-4 h-4 text-primary" />
                  Staging Record Status Lifecycle & Transitions
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Every row in the SQL Server staging table maintains a single-character <code className="font-mono text-foreground font-semibold">STATUS_FLAG</code> that dictates its eligibility and pipeline state.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Visual Pipeline Banner */}
                <div className="p-4 rounded-xl bg-secondary/30 border border-border flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 rounded-lg bg-secondary border border-border text-foreground font-bold">
                      ' ' (Blank)
                    </div>
                    <span className="text-muted-foreground font-sans text-xs">Staged / Pending</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground hidden md:block" />
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold">
                      'V'
                    </div>
                    <span className="text-muted-foreground font-sans text-xs">Validated</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground hidden md:block" />
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold">
                      'P' / 'L'
                    </div>
                    <span className="text-muted-foreground font-sans text-xs">Committed</span>
                  </div>
                  <span className="text-muted-foreground font-sans text-[11px] italic">or</span>
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold">
                      'F'
                    </div>
                    <span className="text-muted-foreground font-sans text-xs">Load Failed</span>
                  </div>
                </div>

                {/* Status Detail Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Status ' ' */}
                  <div className="p-4 rounded-lg bg-card border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-bold">
                          ' ' (Space / Blank)
                        </Badge>
                        <span className="text-xs font-semibold text-foreground">Pending / Staged</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">Initial State</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Assigned when rows are initially inserted into the SQL Server staging table from the uploaded CSV file.
                      Rows in this state have not yet undergone Dry Run validation and cannot be processed by the loader.
                    </p>
                  </div>

                  {/* Status 'V' */}
                  <div className="p-4 rounded-lg bg-card border border-emerald-500/30 space-y-2 bg-emerald-500/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
                          'V'
                        </Badge>
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Validation Passed</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600">Eligible to Load</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Assigned when a record passes all Dry Run validation rules (active part, valid warehouse, matching UOM, valid customer, valid dates).
                      Only rows with status <code className="font-mono text-foreground font-semibold">'V'</code> will be submitted to the Ross ERP loader routine.
                    </p>
                  </div>

                  {/* Status 'E' */}
                  <div className="p-4 rounded-lg bg-card border border-rose-500/30 space-y-2 bg-rose-500/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400 border-rose-500/40">
                          'E'
                        </Badge>
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Quarantined Error</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-rose-500/30 text-rose-600">Blocked</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Assigned when a record violates one or more business rules. The failure reason and diagnostic code are stored in <code className="font-mono text-foreground font-semibold">RS_MESSAGE_TEXT</code>.
                      Quarantined rows are blocked from loading to prevent polluting Ross ERP operational tables.
                    </p>
                  </div>

                  {/* Status 'P' and 'L' */}
                  <div className="p-4 rounded-lg bg-card border border-blue-500/30 space-y-2 bg-blue-500/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 border-blue-500/40">
                          'P' / 'L'
                        </Badge>
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Processed / Loaded</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-600">ERP Committed</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Assigned by the Ross ERP loader execution procedure when records are successfully loaded into live transaction tables.
                      The batch run ID and timestamp are updated on the row. These records are finalized in the ERP ledger.
                    </p>
                  </div>

                  {/* Status 'F' */}
                  <div className="p-4 rounded-lg bg-card border border-amber-500/30 space-y-2 bg-amber-500/5 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 border-amber-500/40">
                          'F'
                        </Badge>
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Load Execution Failed</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600">Runtime Exception</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Differentiates runtime loader failures from validation errors: records that passed Dry Run validation (<code className="font-mono text-foreground font-semibold">'V'</code>) but could not be committed by the ERP loader routine during live execution are automatically stamped as <code className="font-mono text-amber-600 font-bold">'F'</code>.
                      The exact ERP engine failure explanation is stored in <code className="font-mono text-foreground font-semibold">RS_MESSAGE_TEXT</code>.
                    </p>
                  </div>
                </div>

                {/* Status Counting Logic Explanation */}
                <div className="p-4 rounded-lg bg-secondary/20 border border-border space-y-2 text-xs">
                  <h4 className="font-semibold text-foreground flex items-center gap-2">
                    <Info className="w-4 h-4 text-primary" />
                    How Metrics & Counts Are Computed
                  </h4>
                  <p className="text-muted-foreground leading-relaxed">
                    The 5 metrics ribbons reflect the true pipeline status of your dataset:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
                    <div className="p-2 rounded bg-secondary/40 border border-border/60">
                      <strong className="text-foreground">Validation Passed:</strong>
                      <p className="text-muted-foreground font-sans mt-0.5">Rows with status in <code className="text-primary font-bold">V, F, P, L</code> (all rows that cleared pre-validation).</p>
                    </div>
                    <div className="p-2 rounded bg-secondary/40 border border-border/60">
                      <strong className="text-foreground">Quarantined Errors:</strong>
                      <p className="text-muted-foreground font-sans mt-0.5">Rows with status <code className="text-rose-600 font-bold">E</code> that failed business rules.</p>
                    </div>
                    <div className="p-2 rounded bg-secondary/40 border border-border/60">
                      <strong className="text-foreground">Committed to Ross:</strong>
                      <p className="text-muted-foreground font-sans mt-0.5">Rows with status in <code className="text-blue-600 font-bold">P, L</code> successfully written to ERP.</p>
                    </div>
                    <div className="p-2 rounded bg-secondary/40 border border-border/60">
                      <strong className="text-foreground">Load Execution Failed:</strong>
                      <p className="text-muted-foreground font-sans mt-0.5">Rows with status <code className="text-amber-600 font-bold">F</code> that failed live loader execution.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: DOMAINS (DC INVENTORY VS SALES ORDERS) */}
          <TabsContent value="domains" className="m-0 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* DC Inventory Card */}
              <Card className="bg-card border-border space-y-4">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/10">
                      Domain A
                    </Badge>
                    <Boxes className="w-5 h-5 text-blue-500" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground">
                    Data Capture (DC) Inventory Loader
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Staging table: <code className="font-mono text-foreground font-semibold">FIN.KAS_DC_LOADS</code>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs text-muted-foreground pt-0">
                  <p>
                    The DC Inventory loader is used for opening balances, stock takes, and bulk inventory staging into Ross ERP warehouses governed by Data Capture.
                  </p>
                  <div className="space-y-2">
                    <h5 className="font-semibold text-foreground text-xs uppercase tracking-wide">Key Capabilities:</h5>
                    <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-2">
                      <div>
                        <strong className="text-foreground block">License Plate Numbers (LPN Tracking):</strong>
                        <span>Maintains unique Pallet/LPN identifiers per warehouse and bin, with full line numbering and batch integrity.</span>
                      </div>
                      <div>
                        <strong className="text-foreground block">Catchweight & Dual UOM:</strong>
                        <span>Supports dual quantity and UOM tracking (<code className="font-mono">QUANTITY_1</code>, <code className="font-mono">QUANTITY_2</code>, <code className="font-mono">UOM_1</code>, <code className="font-mono">UOM_2</code>) for catchweight products.</span>
                      </div>
                      <div>
                        <strong className="text-foreground block">Lot Life & Expiration Handling:</strong>
                        <span>Preserves supplier lot, best before date, expiry date, and retest dates with automatic historical loading tolerances.</span>
                      </div>
                      <div>
                        <strong className="text-foreground block">Inventory Status Codes:</strong>
                        <span>Supports Quantity on Hand (<code className="font-mono">QOH</code>), Quality Control (<code className="font-mono">QC</code>), and Quarantine (<code className="font-mono">QR</code>) lines.</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sales Orders Card */}
              <Card className="bg-card border-border space-y-4">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                      Domain B
                    </Badge>
                    <ShoppingCart className="w-5 h-5 text-emerald-500" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground">
                    Sales Orders Loader
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Staging table: <code className="font-mono text-foreground font-semibold">FIN.KAS_SO_LOADS</code>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs text-muted-foreground pt-0">
                  <p>
                    The Sales Orders loader enables rapid mass staging and validation of customer orders, EDI feeds, and eCommerce transactions.
                  </p>
                  <div className="space-y-2">
                    <h5 className="font-semibold text-foreground text-xs uppercase tracking-wide">Key Capabilities:</h5>
                    <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-2">
                      <div>
                        <strong className="text-foreground block">Order Grouping & Line Assembly:</strong>
                        <span>Aggregates order header fields (Customer, PO Number, Order Date) with multiple line items in the <strong>Order Hierarchy</strong> view.</span>
                      </div>
                      <div>
                        <strong className="text-foreground block">Customer Master & Financial Checks:</strong>
                        <span>Validates customer existence, credit status, customer shipping locations, and active status in Ross ERP.</span>
                      </div>
                      <div>
                        <strong className="text-foreground block">Payment Terms & Currency:</strong>
                        <span>Verifies payment terms, trade discounts, order currencies, and tax codes before releasing to the order desk.</span>
                      </div>
                      <div>
                        <strong className="text-foreground block">Pricing & Quantity Validation:</strong>
                        <span>Checks unit prices, requested ship dates, and ordered quantities with automated line numbering.</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 4: SQL SCRIPTS CONFIG */}
          <TabsContent value="scripts" className="m-0 space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  SQL Scripts Engine & Customization Guide
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  How to manage, inspect, customize, and execute SQL Server routines using the <strong>SQL Scripts Config</strong> view.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <p>
                  The Ross DC Loader is powered by a set-based SQL engine organized into 4 standardized execution scripts per domain:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
                  <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">01_create_table.sql</span>
                      <Badge variant="outline" className="text-[10px]">DDL</Badge>
                    </div>
                    <p className="text-muted-foreground font-sans">
                      Ensures the <code className="text-foreground font-mono">FIN</code> schema exists and creates the target staging table with full column indexes for high-throughput streaming.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">02_dry_run_validation.sql</span>
                      <Badge variant="outline" className="text-[10px]">Validation</Badge>
                    </div>
                    <p className="text-muted-foreground font-sans">
                      Executes pre-flight business rules against Ross master tables, stamping rows with <code className="text-emerald-600 font-mono font-bold">'V'</code> or <code className="text-rose-600 font-mono font-bold">'E'</code>.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">03_execute_loader.sql</span>
                      <Badge variant="outline" className="text-[10px]">Execution</Badge>
                    </div>
                    <p className="text-muted-foreground font-sans">
                      Invokes Ross ERP staging procedures, transfers validated rows to live tables, stamps <code className="text-blue-600 font-mono font-bold">'P' / 'L'</code> on success, and stamps <code className="text-amber-600 font-mono font-bold">'F'</code> on error.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">04_clean_table.sql</span>
                      <Badge variant="outline" className="text-[10px]">Maintenance</Badge>
                    </div>
                    <p className="text-muted-foreground font-sans">
                      Safely truncates the staging table to prepare for fresh file uploads without dropping table structure or affecting live transactions.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-secondary/20 border border-border space-y-2 mt-2">
                  <h4 className="font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    Built-in Defaults vs. Custom Uploaded Scripts
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs pl-1">
                    <li><strong className="text-foreground">Default Scripts:</strong> Pre-packaged and compiled directly into the executable. Guaranteed to align with Ross ERP standard specifications.</li>
                    <li><strong className="text-foreground">Custom Script Upload:</strong> In the SQL Scripts Config view, click <strong>Upload Custom Script</strong> to provide your own tailored SQL file.</li>
                    <li><strong className="text-foreground">Live SQL Execution:</strong> Use the <strong>Execute Script</strong> button on any script to execute DDL or maintenance operations directly on the connected database.</li>
                    <li><strong className="text-foreground">1-Click Reset:</strong> Click <strong>Restore Default</strong> anytime to discard custom modifications and restore factory defaults.</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 5: FAQ & DIAGNOSTICS */}
          <TabsContent value="faq" className="m-0 space-y-6">
            {/* FAQ Accordion-like cards */}
            <div className="space-y-3">
              <Card className="bg-card border-border">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-primary" />
                    How do I inspect and fix Quarantined ('E') rows?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0 px-4 pb-3 leading-relaxed">
                  Navigate to the <strong>Error Inspector</strong> tab or click the red <strong>Quarantined Errors</strong> filter badge on the Data Grid.
                  Inspect the <code className="font-mono text-foreground font-semibold">RS_MESSAGE_TEXT</code> column to see the exact validation rule failed.
                  You can click <strong>Export Quarantined Errors</strong> from the export menu, adjust the CSV in Excel or your ERP source, and re-import.
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-primary" />
                    What is the difference between Quarantined Error ('E') and Load Failed ('F')?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0 px-4 pb-3 leading-relaxed">
                  <strong>'E' (Quarantined Error)</strong> occurs during the pre-flight <strong>Dry Run Validation</strong> step (e.g. part code inactive, bin location not found). These rows never touch the ERP loader.
                  <br />
                  <strong>'F' (Load Execution Failed)</strong> occurs during live execution when a record that passed validation encounters a runtime conflict during ERP insertion (e.g. database deadlock, negative stock constraint, or batch concurrency limit).
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-primary" />
                    Will re-uploading a CSV overwrite existing live Ross ERP inventory?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0 px-4 pb-3 leading-relaxed">
                  No. Staging rows only reside in <code className="font-mono text-foreground font-semibold">FIN.KAS_DC_LOADS</code> or <code className="font-mono text-foreground font-semibold">FIN.KAS_SO_LOADS</code>.
                  Live Ross ERP operational tables are only modified when you explicitly run <strong>Execute Loader</strong> in the <strong>Simulate & Load</strong> view on rows that have passed validation.
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-primary" />
                    Can my CSV contain comments or custom column names?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0 px-4 pb-3 leading-relaxed">
                  Yes. Lines starting with <code className="font-mono text-foreground font-semibold">!</code> (standard IAF comment markers) are ignored.
                  Column headers are automatically normalized, meaning headers like <code className="font-mono text-foreground">Quantity 1</code>, <code className="font-mono text-foreground">QUANTITY_1</code>, <code className="font-mono text-foreground">uom 1</code>, and <code className="font-mono text-foreground">Best Before Date</code> are automatically recognized.
                </CardContent>
              </Card>
            </div>

            {/* Diagnostic Codes Reference */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Ross Error Diagnostic Code Reference
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Common Ross ERP diagnostic message codes encountered during Dry Run validation:
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 font-mono text-[11px]">
                  <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-rose-600 dark:text-rose-400 font-bold">P_71560:</span>
                      <span className="text-foreground font-sans font-medium">Pack UOM Mismatch</span>
                    </div>
                    <p className="text-muted-foreground font-sans text-xs mt-1">
                      Product has Packaged flag = 'Y' in Product Master, but CSV supplied capacity UOM or invalid packaging unit.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-rose-600 dark:text-rose-400 font-bold">P_10648 / P_42234:</span>
                      <span className="text-foreground font-sans font-medium">Movement Code Missing</span>
                    </div>
                    <p className="text-muted-foreground font-sans text-xs mt-1">
                      Movement code (<code className="text-foreground">BGNQOH</code>, <code className="text-foreground">BGNQC</code>, <code className="text-foreground">BGNQR</code>) is not defined in <code className="text-foreground">INVENTORY_MOVEMENTS_CONTROL</code>.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">P_82065:</span>
                      <span className="text-foreground font-sans font-medium">Expired Lot Warning</span>
                    </div>
                    <p className="text-muted-foreground font-sans text-xs mt-1">
                      Severity downgraded to informational in dcload routines to allow historical balance imports.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">P_13647:</span>
                      <span className="text-foreground font-sans font-medium">Quantity Precision Adjusted</span>
                    </div>
                    <p className="text-muted-foreground font-sans text-xs mt-1">
                      Informational warning indicating decimal quantity precision was adjusted to match the UOM precision mask.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
