# Ross DC & Sales Order Loader (Wails v2 + Go + React)

A modern, enterprise-grade desktop application for **Ross ERP Data Capture (DC)** and **Sales Order Processing (SOP)** staging, validation, simulation, and automated batch loading.

Migrated from Electron to **Wails v2 (Go backend + React frontend + shadcn/ui)** for native performance, zero-overhead memory footprint, and a clean monochromatic design system.

---

## 🚀 Key Improvements Over Electron

| Metric / Aspect | Electron Legacy | Modern Wails v2 |
|---|---|---|
| **Binary Size** | ~180 MB | **~14.6 MB** (-92%) |
| **Idle Memory (RAM)** | ~180 - 250 MB | **~25 - 45 MB** (-80%) |
| **Database Driver** | Node.js `mssql` / `tedious` (JS) | **Native Go `database/sql` + `go-mssqldb`** (compiled, zero GC pauses) |
| **Large CSV Ingestion** | Chunked JS string manipulation | **Streaming `bufio.Reader`** with direct SQL Server bulk batch insert |
| **Licensing Integrity** | Node.js subprocess child process | **Native Go CIM + Registry SHA256 hardware fingerprint + Ed25519 signature verification** |
| **Window Frame** | Basic titlebar | **Frameless modern titlebar** with integrated domain selector, DB status indicator, light/dark switcher, and window controls |
| **UI Components** | Ad-hoc Tailwind utility classes | **shadcn/ui** with unified Zinc monochromatic tokens |

---

## 🛠️ Architecture

```
d:\work\ross\New_81\dc-loader-wails
├── backend/
│   ├── csv/             # Streaming CSV parser, header sniffing & auto-domain detection
│   ├── database/        # Thread-safe MSSQL pool manager, DDL, pagination, dry-run & loader logic
│   ├── license/         # Hardware fingerprinting (CIM/Registry) & Ed25519 license verification
│   ├── models/          # Strongly-typed Go contracts for DC inventory, sales orders & licensing
│   └── scripts/         # Embedded default SQL scripts (embed.FS) & custom script overrides
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/  # Frameless TitleBar, NavigationSidebar
│   │   │   ├── modals/  # ConnectionDialog, CleanDatabaseDialog, ClearStagedDataDialog, ActivationModal
│   │   │   ├── ui/      # shadcn/ui primitives (Button, Card, Dialog, Table, Badge, Tabs, etc.)
│   │   │   └── views/   # Dashboard, Importer & Grid, Errors, LPN Hierarchy, Execution, Schema, SQL Scripts, Docs
│   │   ├── lib/         # IAF XML parser, Ross validator, dbClient bridge, theme provider
│   │   └── types/       # TypeScript interfaces for DC & SO domains and security
│   └── wailsjs/         # Auto-generated TypeScript bindings to Go backend methods
├── main.go              # Wails application entrypoint, window options & lifecycle
├── app.go               # Wails bridge exposing DB, CSV, Licensing, Dialogs, and Window controls
└── wails.json           # Wails configuration manifest
```

---

## ⚙️ Prerequisites

1. **Go**: `1.24+` or `1.27+` (`go version`)
2. **Wails v2 CLI**: `v2.17.1+` (`wails version`)
3. **Node.js**: `v20.x` or `v22.x` with `npm`
4. **Microsoft Edge WebView2**: Pre-installed on Windows 10/11

---

## 📦 Building and Running

### Development Mode (with Live Hot-Reload)
```bash
npm run dev
# or: wails dev -m -skipbindings
```

### Production Build
```bash
npm run build
```
The compiled, standalone executable is placed in:
```
build/bin/Ross DC Loader.exe
```

---

## 🔐 Hardware Authorization & Licensing

The application is secured via hardware-bound licensing:
1. Generates a machine code using Motherboard Serial Number, BIOS Serial Number, CPU Processor ID, and OS Machine GUID salted with HMAC-SHA256.
2. Verified against an Ed25519 digital signature.
3. Automatically cached in `%APPDATA%\RossDcLoader\license.lic`.
4. Fully compatible with license keys generated for the previous release.

---

## 📊 Dual Domain Support

Seamlessly switch between:
- **DC Inventory Loader (`[FIN].[KAS_DC_LOADS]` / `dcload_v70_for80.dml`)**: Supports Single/Packaged (SN/SP), Potent (PN/PP), and Catchweight (CN/CP) products, LPN hierarchies, and warehouse-scoped table cleaning.
- **Sales Order Loader (`[FIN].[KAS_SO_LOADS]` / `SOPC_T_003`)**: Supports customer reference grouping, multi-line order grouping, freight calculations, and automatic order number assignment.
