import {
  KasDcLoadRecord,
  KasSoLoadRecord,
  GridCounts,
  DatabaseConfig,
  CleanTableResult,
  CleanPreview,
  RuleBreakdownItem,
  SqlScriptSlot,
  SqlScriptInfo,
  LoaderDomain,
  ColumnDefinition,
} from '@/types/dcloader';
import { LicenseStatus, LicenseFileContent } from '@/types/security';
import * as App from '@/../wailsjs/go/main/App';
import { models } from '@/../wailsjs/go/models';

export interface GridQueryParams {
  page: number;
  pageSize: number;
  statusFilter: string; // 'ALL' | 'V' | 'E' | 'L' | ' '
  search: string;
  domain?: LoaderDomain;
}

export interface GridQueryResult<T = any> {
  rows: T[];
  total: number;
  counts: GridCounts;
  connected: boolean;
  columns?: ColumnDefinition[];
}

export interface DryRunResult {
  success: boolean;
  counts: {
    total: number;
    valid: number;
    errors: number;
    loaded: number;
    pending: number;
  };
  ruleBreakdown?: RuleBreakdownItem[];
  message: string;
}

export interface LoaderResult {
  success: boolean;
  loaded: number;
  failed: number;
  batchId: string;
  message: string;
}

export interface DatabaseStatus {
  connected: boolean;
  host?: string;
  database?: string;
  port?: number;
  user?: string;
  table?: string;
  message?: string;
}

class DbClient {
  public async connect(config: DatabaseConfig): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    try {
      const cfg = new models.DatabaseConfig({
        profileName: config.profileName || '',
        host: config.host || '',
        port: config.port || 1433,
        database: config.database || '',
        user: config.user || '',
        password: config.password || '',
        companyCode: config.companyCode || 'CORP',
        division: config.division || '1',
        authType: config.authType || 'sql',
        encrypt: !!config.encrypt,
        trustServerCertificate: !!config.trustServerCertificate,
      });
      const res = await App.ConnectDatabase(cfg);
      return {
        success: res.success,
        message: res.message,
        latencyMs: res.latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to connect to database.',
      };
    }
  }

  public async testConnection(config: DatabaseConfig): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    try {
      const cfg = new models.DatabaseConfig({
        profileName: config.profileName || '',
        host: config.host || '',
        port: config.port || 1433,
        database: config.database || '',
        user: config.user || '',
        password: config.password || '',
        companyCode: config.companyCode || 'CORP',
        division: config.division || '1',
        authType: config.authType || 'sql',
        encrypt: !!config.encrypt,
        trustServerCertificate: !!config.trustServerCertificate,
      });
      const res = await App.TestDatabaseConnection(cfg);
      return {
        success: res.success,
        message: res.message,
        latencyMs: res.latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Database test connection failed.',
      };
    }
  }

  public async getStatus(): Promise<DatabaseStatus> {
    try {
      const s = await App.GetDatabaseStatus();
      return {
        connected: s.connected,
        host: s.host,
        database: s.database,
        port: s.port,
        user: s.user,
        table: s.table,
        message: s.message,
      };
    } catch (err: any) {
      return {
        connected: false,
        message: err.message || 'Disconnected',
      };
    }
  }

  public async disconnect(): Promise<{ success: boolean; message: string }> {
    try {
      await App.DisconnectDatabase();
      return {
        success: true,
        message: 'Disconnected successfully',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Error disconnecting',
      };
    }
  }

  public async uploadCsv(
    filePath: string,
    companyCode: string = 'CORP',
    domain?: LoaderDomain,
    division?: string
  ): Promise<{
    success: boolean;
    totalRows: number;
    error?: string;
    database?: string;
    host?: string;
    table?: string;
    domain?: LoaderDomain;
  }> {
    try {
      const res = await App.UploadCsv(filePath, companyCode, division || '1', domain || 'inventory');
      return {
        success: res.success,
        totalRows: res.totalRows,
        error: res.success ? undefined : res.message,
        domain: (res.domain as LoaderDomain) || domain,
      };
    } catch (err: any) {
      return {
        success: false,
        totalRows: 0,
        error: err.message || 'Failed to upload CSV file.',
      };
    }
  }

  public async executeDryRun(domain?: LoaderDomain): Promise<DryRunResult> {
    try {
      const res = await App.ExecuteDryRun(domain || 'inventory');
      return {
        success: res.success,
        counts: res.counts || { total: 0, valid: 0, errors: 0, loaded: 0, pending: 0 },
        ruleBreakdown: res.ruleBreakdown || [],
        message: res.message,
      };
    } catch (err: any) {
      return {
        success: false,
        counts: { total: 0, valid: 0, errors: 0, loaded: 0, pending: 0 },
        ruleBreakdown: [],
        message: err.message || 'Failed to run dry-run validation.',
      };
    }
  }

  public async executeLoader(domain?: LoaderDomain): Promise<LoaderResult> {
    try {
      const res = await App.ExecuteLoader(domain || 'inventory');
      return {
        success: res.success,
        loaded: res.loaded,
        failed: res.failed,
        batchId: res.batchId,
        message: res.message,
      };
    } catch (err: any) {
      return {
        success: false,
        loaded: 0,
        failed: 0,
        batchId: '',
        message: err.message || 'Failed to execute loader.',
      };
    }
  }

  public async cleanTables(domain: LoaderDomain = 'inventory'): Promise<CleanTableResult> {
    try {
      const res = domain === 'sales_orders'
        ? await App.CleanSalesTables()
        : await App.CleanInventoryTables();
      return {
        success: res.success,
        totalDeleted: res.totalDeleted,
        tableBreakdown: res.tableBreakdown || [],
        targetWarehouses: res.targetWarehouses || [],
        message: res.message,
      };
    } catch (err: any) {
      return {
        success: false,
        totalDeleted: 0,
        tableBreakdown: [],
        targetWarehouses: [],
        message: err.message || 'Clean tables operation failed.',
      };
    }
  }

  public async getCleanPreview(domain: LoaderDomain = 'inventory'): Promise<CleanPreview> {
    try {
      const res = await App.GetCleanPreview(domain);
      return {
        warehouses: res.warehouses || [],
        companyCodes: res.companyCodes || [],
        recordCount: res.recordCount || 0,
      };
    } catch (err) {
      return {
        warehouses: [],
        companyCodes: [],
        recordCount: 0,
      };
    }
  }

  public async queryGrid<T = any>(params: GridQueryParams): Promise<GridQueryResult<T>> {
    try {
      const qp = new models.GridQueryParams({
        page: params.page,
        pageSize: params.pageSize,
        statusFilter: params.statusFilter,
        search: params.search,
        domain: params.domain || 'inventory',
      });
      const res = await App.QueryGrid(qp);
      return {
        rows: (res.rows || []) as T[],
        total: res.total || 0,
        counts: res.counts || { total: 0, valid: 0, error: 0, loaded: 0 },
        connected: res.connected !== false,
      };
    } catch (err: any) {
      return {
        rows: [],
        total: 0,
        counts: { total: 0, valid: 0, error: 0, loaded: 0 },
        connected: false,
      };
    }
  }

  public async exportData(filter: 'all' | 'valid' | 'error' | 'loaded', domain?: LoaderDomain): Promise<string> {
    try {
      return await App.ExportData(filter, domain || 'inventory');
    } catch (err) {
      console.error('Export error:', err);
      return '';
    }
  }

  public async openFileDialog(title: string, filterPattern: string, filterName: string): Promise<{ canceled: boolean; filePath?: string; fileName?: string }> {
    try {
      const res = await App.OpenFileDialog(title, filterName, filterPattern);
      return {
        canceled: res.canceled,
        filePath: res.filePath,
        fileName: res.fileName,
      };
    } catch (err) {
      return { canceled: true };
    }
  }

  public async saveFileDialog(defaultName: string, content: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const res = await App.SaveFileDialog(defaultName, content);
      return {
        success: res.success,
        filePath: res.filePath,
        error: res.error,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public async readFile(filePath: string): Promise<string> {
    return await App.ReadFile(filePath);
  }

  public async openSqlFile(): Promise<{ canceled: boolean; filePath?: string; fileContent?: string; fileName?: string }> {
    const dialog = await App.OpenFileDialog('Select SQL Script File', 'SQL Scripts (*.sql)', '*.sql');
    if (dialog.canceled || !dialog.filePath) {
      return { canceled: true };
    }
    const content = await App.ReadFile(dialog.filePath);
    return {
      canceled: false,
      filePath: dialog.filePath,
      fileName: dialog.fileName,
      fileContent: content,
    };
  }

  public async openXmlFile(): Promise<{ canceled: boolean; filePath?: string; fileContent?: string; fileName?: string; error?: string }> {
    try {
      const dialog = await App.OpenFileDialog('Select Ross Configuration XML', 'Configuration Files (*.xml;*.config;*.txt)', '*.xml;*.config;*.txt');
      if (dialog.canceled || !dialog.filePath) {
        return { canceled: true };
      }
      const content = await App.ReadFile(dialog.filePath);
      return {
        canceled: false,
        filePath: dialog.filePath,
        fileName: dialog.fileName,
        fileContent: content,
      };
    } catch (err: any) {
      return { canceled: true, error: err.message };
    }
  }

  public async getAllSqlScripts(domain?: LoaderDomain): Promise<Record<SqlScriptSlot, SqlScriptInfo>> {
    try {
      const res = await (App as any).GetAllSqlScripts(domain || 'inventory');
      return res as unknown as Record<SqlScriptSlot, SqlScriptInfo>;
    } catch (err) {
      return {} as Record<SqlScriptSlot, SqlScriptInfo>;
    }
  }

  public async setSqlScript(
    slot: SqlScriptSlot,
    data: { name: string; content: string; filePath?: string },
    domain?: LoaderDomain
  ): Promise<SqlScriptInfo> {
    const res = await (App as any).SetSqlScript(
      domain || 'inventory',
      slot as any,
      data.name,
      data.filePath || '',
      data.content
    );
    return res as unknown as SqlScriptInfo;
  }

  public async resetSqlScript(slot: SqlScriptSlot, domain?: LoaderDomain): Promise<SqlScriptInfo> {
    const res = await (App as any).ResetSqlScript(domain || 'inventory', slot as any);
    return res as unknown as SqlScriptInfo;
  }

  public async loadDefaultSqlScript(slot: SqlScriptSlot, domain?: LoaderDomain): Promise<SqlScriptInfo> {
    return await this.resetSqlScript(slot, domain);
  }

  public async loadAllDefaultSqlScripts(domain?: LoaderDomain): Promise<Record<SqlScriptSlot, SqlScriptInfo>> {
    const dom = domain || 'inventory';
    const slots: SqlScriptSlot[] = ['create_table', 'dry_run', 'loader', 'clean_tables'];
    for (const slot of slots) {
      await this.resetSqlScript(slot, dom);
    }
    return await this.getAllSqlScripts(dom);
  }

  public async clearSqlScript(slot: SqlScriptSlot, domain?: LoaderDomain): Promise<SqlScriptInfo> {
    return await this.resetSqlScript(slot, domain);
  }

  public async clearAllSqlScripts(domain?: LoaderDomain): Promise<Record<SqlScriptSlot, SqlScriptInfo>> {
    const res = await (App as any).ClearAllSqlScripts(domain || 'inventory');
    return res as unknown as Record<SqlScriptSlot, SqlScriptInfo>;
  }

  public async executeCreateTable(domain?: LoaderDomain): Promise<{ success: boolean; message: string }> {
    try {
      const res = await App.EnsureTableExists(domain || 'inventory');
      return { success: res.success, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to create table.' };
    }
  }

  public async clearStagedData(domain?: LoaderDomain): Promise<{ success: boolean; deletedRows: number; message: string }> {
    try {
      const res = await App.ClearStagedData(domain || 'inventory');
      return {
        success: res.success,
        deletedRows: res.deletedRows,
        message: res.message,
      };
    } catch (err: any) {
      return { success: false, deletedRows: 0, message: err.message || 'Failed to clear staged data.' };
    }
  }

  // Security & Licensing Client Methods
  public async getMachineFingerprint(): Promise<string> {
    try {
      return await App.GetMachineFingerprint();
    } catch {
      return 'ROSS-UNKNOWN';
    }
  }

  public async regenerateMachineFingerprint(): Promise<string> {
    try {
      return await App.RegenerateMachineFingerprint();
    } catch {
      return 'ROSS-UNKNOWN';
    }
  }

  public async getLicenseStatus(): Promise<LicenseStatus> {
    try {
      const s = await App.GetLicenseStatus();
      return {
        isActivated: s.isActivated,
        machineId: s.machineId,
        clientName: s.clientName,
        authorizedUser: (s as any).authorizedUser,
        requiresAuth: (s as any).requiresAuth,
        isAuthenticated: (s as any).isAuthenticated,
        issuedAt: s.issuedAt,
        expiresAt: s.expiresAt,
        daysRemaining: s.daysRemaining,
        isExpired: s.isExpired,
        errorMessage: s.errorMessage,
      };
    } catch (err: any) {
      return {
        isActivated: false,
        machineId: 'ROSS-UNKNOWN',
        errorMessage: err.message || 'Licensing API unavailable',
      };
    }
  }

  public async authenticateOperator(password: string): Promise<{ success: boolean; message: string; status: LicenseStatus }> {
    try {
      const res = await (App as any).AuthenticateOperator(password);
      return {
        success: res.success,
        message: res.message,
        status: {
          isActivated: res.status.isActivated,
          machineId: res.status.machineId,
          clientName: res.status.clientName,
          authorizedUser: res.status.authorizedUser,
          requiresAuth: res.status.requiresAuth,
          isAuthenticated: res.status.isAuthenticated,
          issuedAt: res.status.issuedAt,
          expiresAt: res.status.expiresAt,
          daysRemaining: res.status.daysRemaining,
          isExpired: res.status.isExpired,
          errorMessage: res.status.errorMessage,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Authentication error',
        status: { isActivated: false, machineId: 'ROSS-UNKNOWN' },
      };
    }
  }

  public async lockOperatorSession(): Promise<LicenseStatus> {
    try {
      const s = await (App as any).LockOperatorSession();
      return {
        isActivated: s.isActivated,
        machineId: s.machineId,
        clientName: s.clientName,
        authorizedUser: s.authorizedUser,
        requiresAuth: s.requiresAuth,
        isAuthenticated: s.isAuthenticated,
        issuedAt: s.issuedAt,
        expiresAt: s.expiresAt,
        daysRemaining: s.daysRemaining,
        isExpired: s.isExpired,
        errorMessage: s.errorMessage,
      };
    } catch {
      return { isActivated: false, machineId: 'ROSS-UNKNOWN' };
    }
  }

  public async activateLicenseFile(jsonContent: string): Promise<{ success: boolean; message: string; status: LicenseStatus }> {
    try {
      const res = await App.ActivateLicense(jsonContent);
      return {
        success: res.success,
        message: res.message,
        status: {
          isActivated: res.status.isActivated,
          machineId: res.status.machineId,
          clientName: res.status.clientName,
          authorizedUser: (res.status as any).authorizedUser,
          requiresAuth: (res.status as any).requiresAuth,
          isAuthenticated: (res.status as any).isAuthenticated,
          issuedAt: res.status.issuedAt,
          expiresAt: res.status.expiresAt,
          daysRemaining: res.status.daysRemaining,
          isExpired: res.status.isExpired,
          errorMessage: res.status.errorMessage,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to activate license',
        status: { isActivated: false, machineId: 'ROSS-UNKNOWN' },
      };
    }
  }

  public async revokeLicense(): Promise<{ success: boolean; message: string; status: LicenseStatus }> {
    try {
      const res = await (App as any).RevokeLicense();
      return {
        success: res.success,
        message: res.message,
        status: {
          isActivated: res.status.isActivated,
          machineId: res.status.machineId,
          clientName: res.status.clientName,
          authorizedUser: res.status.authorizedUser,
          requiresAuth: res.status.requiresAuth,
          isAuthenticated: res.status.isAuthenticated,
          issuedAt: res.status.issuedAt,
          expiresAt: res.status.expiresAt,
          daysRemaining: res.status.daysRemaining,
          isExpired: res.status.isExpired,
          errorMessage: res.status.errorMessage,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to revoke license',
        status: { isActivated: false, machineId: 'ROSS-UNKNOWN' },
      };
    }
  }

  public async openLicenseFileDialog(): Promise<{ canceled: boolean; filePath?: string; fileContent?: string; fileName?: string; error?: string }> {
    try {
      const res = await App.OpenLicenseFileDialog();
      return {
        canceled: res.canceled,
        filePath: res.filePath,
        fileName: res.fileName,
        fileContent: res.fileContent,
        error: res.error,
      };
    } catch (err: any) {
      return { canceled: true, error: err.message };
    }
  }
}

export const dbClient = new DbClient();
