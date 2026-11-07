import React, { useState, useEffect, useCallback } from 'react';
import { TitleBar } from '@/components/layout/TitleBar';
import { NavigationSidebar, NavTab } from '@/components/layout/NavigationSidebar';
import { DashboardView } from '@/components/views/DashboardView';
import { ImportAndGridView } from '@/components/views/ImportAndGridView';
import { LpnHierarchyView } from '@/components/views/LpnHierarchyView';
import { OrderGroupingView } from '@/components/views/OrderGroupingView';
import { ExecutionView } from '@/components/views/ExecutionView';
import { DocumentationView } from '@/components/views/DocumentationView';
import { SqlScriptsView } from '@/components/views/SqlScriptsView';
import { ConnectionDialog } from '@/components/modals/ConnectionDialog';
import { CleanDatabaseDialog } from '@/components/modals/CleanDatabaseDialog';
import { ClearStagedDataDialog } from '@/components/modals/ClearStagedDataDialog';
import { ActivationModal } from '@/components/modals/ActivationModal';
import { GridCounts, DatabaseConfig, LoaderDomain } from '@/types/dcloader';
import { LicenseStatus } from '@/types/security';
import { dbClient } from '@/lib/dbClient';
import { EventsOn, EventsOff } from '@/../wailsjs/runtime/runtime';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [fileName, setFileName] = useState<string>('');
  const [domain, setDomain] = useState<LoaderDomain>('inventory');

  // SQL Server Grid & Table State — holds either DC or SO rows depending on domain
  const [gridRows, setGridRows] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [counts, setCounts] = useState<GridCounts>({
    total: 0,
    valid: 0,
    error: 0,
    loaded: 0,
    failed: 0,
  });

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [lastStagedInfo, setLastStagedInfo] = useState<string | null>(null);

  // Database Connection Profile State - Disconnected by default until confirmed
  const [isDbConfigOpen, setIsDbConfigOpen] = useState(false);
  const [isCleanDialogOpen, setIsCleanDialogOpen] = useState(false);
  const [isClearStagedDialogOpen, setIsClearStagedDialogOpen] = useState(false);
  const [isActivationOpen, setIsActivationOpen] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>({
    isActivated: false,
    machineId: '',
  });
  const [dbConnected, setDbConnected] = useState(false);
  const [dbConfig, setDbConfig] = useState<DatabaseConfig>(() => {
    try {
      const stored = localStorage.getItem('dc_loader_last_active_config');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (_) {}
    return {
      profileName: 'Primary SQL Server',
      host: 'localhost',
      port: 1433,
      database: 'fin_demo',
      user: 'fin_demo',
      password: '',
      companyCode: 'CORP',
      authType: 'sql',
      encrypt: false,
      trustServerCertificate: true,
      division: '1',
    };
  });

  // Query staging table directly from SQL Server (domain-aware)
  const refreshGridData = useCallback(async (
    page = currentPage,
    size = pageSize,
    filter = statusFilter,
    search = searchQuery
  ) => {
    setIsLoading(true);
    try {
      const res = await dbClient.queryGrid({
        page,
        pageSize: size,
        statusFilter: filter,
        search,
        domain,
      });
      setDbConnected(res.connected);
      setGridRows(res.rows || []);
      setTotalRows(res.total || 0);
      setCounts(res.counts || { total: 0, valid: 0, error: 0, loaded: 0, failed: 0 });
    } catch (err) {
      console.warn('Grid query notice:', err);
      // Verify actual connectivity so a staging table or grid query issue does not falsely mark DB as offline
      try {
        const s = await dbClient.getStatus();
        setDbConnected(s.connected);
      } catch (_) {
        setDbConnected(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, statusFilter, searchQuery, domain]);

  // Check hardware licensing status on initial launch
  useEffect(() => {
    const checkLicense = async () => {
      try {
        const status = await dbClient.getLicenseStatus();
        setLicenseStatus(status);
        if (!status.isActivated) {
          setIsActivationOpen(true);
        }
      } catch (err) {
        console.error('Error checking license status:', err);
      }
    };
    checkLicense();
  }, []);

  // Restore any previously uploaded custom scripts to backend manager on mount
  useEffect(() => {
    try {
      const domains: LoaderDomain[] = ['inventory', 'sales_orders'];
      for (const d of domains) {
        const stored = JSON.parse(localStorage.getItem(`custom_sql_scripts_${d}`) || '{}');
        for (const slot of Object.keys(stored)) {
          if (stored[slot]) {
            dbClient.setSqlScript(slot as any, stored[slot], d);
          }
        }
      }
      // Also check legacy custom_sql_scripts key for backward compatibility
      const legacy = JSON.parse(localStorage.getItem('custom_sql_scripts') || '{}');
      for (const slot of Object.keys(legacy)) {
        if (legacy[slot]) {
          dbClient.setSqlScript(slot as any, legacy[slot], 'inventory');
        }
      }
    } catch (_) {}
  }, []);

  // Auto-connect to the last active database configuration on application launch
  useEffect(() => {
    const autoConnect = async () => {
      try {
        const stored = localStorage.getItem('dc_loader_last_active_config');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.host && parsed.database) {
            const res = await dbClient.connect(parsed);
            if (res.success) {
              setDbConnected(true);
              await refreshGridData();
            }
          }
        }
      } catch (err) {
        console.warn('Auto-connection on startup skipped or failed:', err);
      }
    };
    autoConnect();
  }, []);

  // Listen to Wails streaming upload progress event
  useEffect(() => {
    const cancelProgress = EventsOn('dcload:uploadProgress', (p: { loaded: number }) => {
      if (p && typeof p.loaded === 'number') {
        setUploadProgress(p.loaded);
      }
    });

    return () => {
      if (cancelProgress) {
        cancelProgress();
      } else {
        EventsOff('dcload:uploadProgress');
      }
    };
  }, []);

  // Open native file dialog and stream CSV directly into the active staging table
  const handleOpenFilePicker = async () => {
    if (!dbConnected) {
      setIsDbConfigOpen(true);
      return;
    }

    const res = await dbClient.openFileDialog('Select CSV File', '*.csv;*.CSV;*.txt;*.dat', 'CSV Files (*.csv;*.txt)');
    if (!res.canceled && res.filePath && res.fileName) {
      setFileName(res.fileName);
      setIsUploading(true);
      setUploadProgress(0);
      setLastStagedInfo(null);

      const uploadRes = await dbClient.uploadCsv(res.filePath, dbConfig.companyCode, domain, dbConfig.division);
      setIsUploading(false);

      if (uploadRes.success) {
        // Auto-switch domain if the CSV was detected as a different type
        const detectedDomain = (uploadRes as any).domain as LoaderDomain | undefined;
        if (detectedDomain && detectedDomain !== domain) {
          setDomain(detectedDomain);
        }
        const activeDomain = detectedDomain ?? domain;
        const tableName = activeDomain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]';
        setLastStagedInfo(
          `Staged ${uploadRes.totalRows.toLocaleString()} rows into SQL Server [${dbConfig.database}].${tableName} at ${dbConfig.host}`
        );
        setCurrentPage(1);
        setStatusFilter('ALL');
        await refreshGridData(1, pageSize, 'ALL', searchQuery);
        setCurrentTab('importer');
      } else {
        alert(`CSV Bulk Insert to SQL Server failed: ${uploadRes.error}`);
      }
    }
  };

  // Run dry run validation SQL script against the active staging table
  const handleRunDryRun = async () => {
    if (!dbConnected) {
      setIsDbConfigOpen(true);
      return;
    }

    setIsLoading(true);
    try {
      const res = await dbClient.executeDryRun(domain);
      const tableName = domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]';
      if (res.success) {
        setLastStagedInfo(
          `Dry Run Completed: ${res.counts.valid} valid, ${res.counts.errors} errors in ${tableName}`
        );
      } else {
        alert(res.message);
      }
      await refreshGridData(currentPage, pageSize, statusFilter, searchQuery);
    } finally {
      setIsLoading(false);
    }
  };

  // Run live loader SQL script against the active staging table
  const handleExecuteLoader = async () => {
    if (!dbConnected) {
      setIsDbConfigOpen(true);
      return;
    }

    setIsLoading(true);
    try {
      const res = await dbClient.executeLoader(domain);
      if (res.success) {
        if (res.failed > 0) {
          setLastStagedInfo(
            `Batch Committed: ${res.loaded} records loaded into Ross ERP, ${res.failed} failed/uncommitted (Batch ${res.batchId})`
          );
        } else {
          setLastStagedInfo(
            `Batch Committed: ${res.loaded} records loaded into Ross ERP (Batch ${res.batchId})`
          );
        }
      } else {
        alert(res.message);
      }
      await refreshGridData(currentPage, pageSize, statusFilter, searchQuery);
    } finally {
      setIsLoading(false);
    }
  };

  // Load sample dataset into the active staging table
  const handleLoadSampleCsv = async (type: 'valid' | 'errors') => {
    if (!dbConnected) {
      setIsDbConfigOpen(true);
      return;
    }

    let defaultName: string;
    let refPath: string;

    if (domain === 'sales_orders') {
      defaultName = 'order_from_csv_sample.csv';
      refPath = `reference/Fw__sample_files_for_upload_inventory_and_so/${defaultName}`;
    } else {
      defaultName = type === 'valid' ? 'dcload_test.csv' : 'dcload_test_errors.csv';
      refPath = `reference/New_81/${defaultName}`;
    }

    setFileName(defaultName);
    setIsLoading(true);

    try {
      const uploadRes = await dbClient.uploadCsv(refPath, dbConfig.companyCode, domain, dbConfig.division);
      const tableName = domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]';
      if (uploadRes.success) {
        setLastStagedInfo(
          `Staged test suite (${defaultName}): ${uploadRes.totalRows} rows in ${tableName}`
        );
        setCurrentPage(1);
        setStatusFilter('ALL');
        await refreshGridData(1, pageSize, 'ALL', '');
        setCurrentTab('importer');
      } else {
        alert(`Failed to load dataset: ${uploadRes.error}`);
      }
    } catch (err: any) {
      console.error('Error loading sample dataset:', err);
      alert(`Error loading sample dataset: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Clear staged records from the active staging table
  const handleClearStagedComplete = async (deletedRows: number) => {
    const tableName = domain === 'sales_orders' ? '[FIN].[KAS_SO_LOADS]' : '[FIN].[KAS_DC_LOADS]';
    setFileName('');
    setLastStagedInfo(
      `Staged data cleared — ${deletedRows.toLocaleString()} row(s) removed from [${dbConfig.database}].${tableName}`
    );
    setCurrentPage(1);
    await refreshGridData(1, pageSize, statusFilter, searchQuery);
  };

  // Export filtered CSV from the active staging table
  const handleExportData = async (filter: 'all' | 'valid' | 'error' | 'loaded') => {
    if (!dbConnected) {
      setIsDbConfigOpen(true);
      return;
    }

    const csvContent = await dbClient.exportData(filter, domain);
    const suffix = filter === 'valid' ? '_VALID' : filter === 'error' ? '_ERRORS' : '_ALL';
    const prefix = domain === 'sales_orders' ? 'soload' : 'dcload';
    const defaultName = (fileName ? fileName.replace('.csv', '') : prefix) + `${suffix}.CSV`;

    await dbClient.saveFileDialog(defaultName, csvContent);
  };

  // Handle sidebar navigation
  const handleSelectNavTab = (tab: NavTab) => {
    if (tab === 'errors') {
      setStatusFilter('E');
      setCurrentPage(1);
      refreshGridData(1, pageSize, 'E', searchQuery);
      setCurrentTab('importer');
    } else {
      setCurrentTab(tab);
    }
  };

  // Handle database disconnect
  const handleDisconnect = async () => {
    try {
      await dbClient.disconnect();
      setDbConnected(false);
      setLastStagedInfo('Database connection disconnected.');
    } catch (err: any) {
      console.error('Failed to disconnect database:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground select-none">
      {/* Frameless Modern Titlebar */}
      <TitleBar
        domain={domain}
        division={dbConfig.division || '1'}
        onDomainChange={(d) => {
          setDomain(d);
          setGridRows([]);
          setTotalRows(0);
          setCounts({ total: 0, valid: 0, error: 0, loaded: 0, failed: 0 });
          setCurrentPage(1);
          setStatusFilter('ALL');
          setSearchQuery('');
          setFileName('');
          setLastStagedInfo(null);
        }}
        companyCode={dbConfig.companyCode}
        dbConnected={dbConnected}
        dbHost={dbConfig.host}
        dbDatabase={dbConfig.database}
        onOpenDbConfig={() => setIsDbConfigOpen(true)}
        onOpenCleanDialog={() => setIsCleanDialogOpen(true)}
        onOpenClearStagedDialog={() => setIsClearStagedDialogOpen(true)}
        onDisconnect={handleDisconnect}
        licenseStatus={licenseStatus}
        onOpenLicenseDialog={() => setIsActivationOpen(true)}
      />

      {/* Main App Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <NavigationSidebar
          domain={domain}
          currentTab={currentTab}
          onSelectTab={handleSelectNavTab}
          errorCount={counts.error}
          totalRows={counts.total}
          dbConnected={dbConnected}
          dbHost={dbConfig.host}
          onOpenDbConfig={() => setIsDbConfigOpen(true)}
          onDisconnect={handleDisconnect}
        />

        {/* View Port Container */}
        <main className="flex-1 overflow-hidden bg-background">
          {currentTab === 'dashboard' && (
            <DashboardView
              domain={domain}
              counts={counts}
              fileName={fileName}
              dbConnected={dbConnected}
              dbHost={dbConfig.host}
              dbDatabase={dbConfig.database}
              onNavigateTab={(tab, filter) => {
                if (filter) {
                  setStatusFilter(filter);
                  refreshGridData(1, pageSize, filter, searchQuery);
                }
                setCurrentTab(tab);
              }}
              onOpenFilePicker={handleOpenFilePicker}
              onRunDryRun={handleRunDryRun}
              onExecuteLoader={handleExecuteLoader}
              onLoadSampleCsv={handleLoadSampleCsv}
              onOpenDbConfig={() => setIsDbConfigOpen(true)}
              onOpenCleanDialog={() => setIsCleanDialogOpen(true)}
              onOpenClearStagedDialog={() => setIsClearStagedDialogOpen(true)}
            />
          )}

          {currentTab === 'importer' && (
            <ImportAndGridView
              domain={domain}
              rows={gridRows}
              totalRows={totalRows}
              counts={counts}
              fileName={fileName}
              currentPage={currentPage}
              pageSize={pageSize}
              statusFilter={statusFilter}
              searchQuery={searchQuery}
              isLoading={isLoading}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              dbConnected={dbConnected}
              dbHost={dbConfig.host}
              dbDatabase={dbConfig.database}
              lastStagedInfo={lastStagedInfo}
              onPageChange={(p) => {
                setCurrentPage(p);
                refreshGridData(p, pageSize, statusFilter, searchQuery);
              }}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setCurrentPage(1);
                refreshGridData(1, s, statusFilter, searchQuery);
              }}
              onStatusFilterChange={(f) => {
                setStatusFilter(f);
                setCurrentPage(1);
                refreshGridData(1, pageSize, f, searchQuery);
              }}
              onSearchChange={(q) => {
                setSearchQuery(q);
                setCurrentPage(1);
                refreshGridData(1, pageSize, statusFilter, q);
              }}
              onOpenFilePicker={handleOpenFilePicker}
              onRunDryRun={handleRunDryRun}
              onRefresh={() => refreshGridData()}
              onExportValid={() => handleExportData('valid')}
              onExportErrors={() => handleExportData('error')}
              onExportAll={() => handleExportData('all')}
              onOpenDbConfig={() => setIsDbConfigOpen(true)}
              onOpenClearStagedDialog={() => setIsClearStagedDialogOpen(true)}
            />
          )}

          {currentTab === 'lpns' && domain === 'inventory' && (
            <LpnHierarchyView lpnGroups={[]} />
          )}

          {currentTab === 'lpns' && domain === 'sales_orders' && (
            <OrderGroupingView
              rows={gridRows}
              totalRows={totalRows}
              isLoading={isLoading}
              onRefresh={() => refreshGridData()}
            />
          )}

          {currentTab === 'execution' && (
            <ExecutionView
              domain={domain}
              counts={counts}
              fileName={fileName}
              companyCode={dbConfig.companyCode}
              dbConnected={dbConnected}
              dbHost={dbConfig.host}
              dbDatabase={dbConfig.database}
              onRefreshData={() => refreshGridData()}
              onNavigateToGrid={(filter) => {
                if (filter) {
                  setStatusFilter(filter);
                  refreshGridData(1, pageSize, filter, searchQuery);
                }
                setCurrentTab('importer');
              }}
              onOpenDbConfig={() => setIsDbConfigOpen(true)}
              onOpenCleanDialog={() => setIsCleanDialogOpen(true)}
              onOpenClearStagedDialog={() => setIsClearStagedDialogOpen(true)}
            />
          )}

          {currentTab === 'scripts' && (
            <SqlScriptsView
              domain={domain}
              dbConnected={dbConnected}
              dbHost={dbConfig.host}
              dbDatabase={dbConfig.database}
              onRefreshData={() => refreshGridData()}
              onOpenDbConfig={() => setIsDbConfigOpen(true)}
              onDomainChange={(d) => setDomain(d)}
            />
          )}
          {currentTab === 'docs' && <DocumentationView />}
        </main>
      </div>

      {/* Database Connection Modal */}
      <ConnectionDialog
        open={isDbConfigOpen}
        onOpenChange={setIsDbConfigOpen}
        config={dbConfig}
        domain={domain}
        onSaveConfig={async (cfg) => {
          const res = await dbClient.connect(cfg);
          if (res.success) {
            setDbConfig(cfg);
            try {
              localStorage.setItem('dc_loader_last_active_config', JSON.stringify(cfg));
            } catch (_) {}
            setDbConnected(true);
            refreshGridData().catch((err) => console.warn('Grid refresh notice:', err));
            return { success: true };
          } else {
            setDbConnected(false);
            return { success: false, message: res.message };
          }
        }}
        onConnectionStatusChange={(status) => setDbConnected(status)}
        dbConnected={dbConnected}
        onDisconnect={handleDisconnect}
      />

      {/* Clean Inventory Tables Modal */}
      <CleanDatabaseDialog
        open={isCleanDialogOpen}
        onOpenChange={setIsCleanDialogOpen}
        dbConnected={dbConnected}
        dbHost={dbConfig.host}
        dbDatabase={dbConfig.database}
        onCleanComplete={async () => {
          await refreshGridData();
          setLastStagedInfo('Inventory tables cleaned successfully.');
        }}
      />

      {/* Clear Staged Data Modal */}
      <ClearStagedDataDialog
        domain={domain}
        open={isClearStagedDialogOpen}
        onOpenChange={setIsClearStagedDialogOpen}
        dbConnected={dbConnected}
        dbHost={dbConfig.host}
        dbDatabase={dbConfig.database}
        stagedRowsCount={counts.total}
        onClearComplete={handleClearStagedComplete}
      />

      {/* Hardware Authorization & Activation Modal */}
      <ActivationModal
        open={isActivationOpen}
        onOpenChange={setIsActivationOpen}
        status={licenseStatus}
        canDismiss={licenseStatus.isActivated}
        onActivationSuccess={(newStatus) => {
          setLicenseStatus(newStatus);
          setIsActivationOpen(false);
        }}
      />
    </div>
  );
};
