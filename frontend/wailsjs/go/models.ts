export namespace models {
	
	export class LicenseStatus {
	    isActivated: boolean;
	    machineId: string;
	    clientName?: string;
	    authorizedUser?: string;
	    requiresAuth: boolean;
	    isAuthenticated: boolean;
	    issuedAt?: string;
	    expiresAt?: string;
	    daysRemaining?: number;
	    isExpired?: boolean;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new LicenseStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isActivated = source["isActivated"];
	        this.machineId = source["machineId"];
	        this.clientName = source["clientName"];
	        this.authorizedUser = source["authorizedUser"];
	        this.requiresAuth = source["requiresAuth"];
	        this.isAuthenticated = source["isAuthenticated"];
	        this.issuedAt = source["issuedAt"];
	        this.expiresAt = source["expiresAt"];
	        this.daysRemaining = source["daysRemaining"];
	        this.isExpired = source["isExpired"];
	        this.errorMessage = source["errorMessage"];
	    }
	}
	export class ActivateResult {
	    success: boolean;
	    message: string;
	    status: LicenseStatus;
	
	    static createFrom(source: any = {}) {
	        return new ActivateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.status = this.convertValues(source["status"], LicenseStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CleanBreakdownItem {
	    tableName: string;
	    rowsDeleted: number;
	
	    static createFrom(source: any = {}) {
	        return new CleanBreakdownItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tableName = source["tableName"];
	        this.rowsDeleted = source["rowsDeleted"];
	    }
	}
	export class CleanPreview {
	    warehouses: string[];
	    companyCodes: string[];
	    recordCount: number;
	
	    static createFrom(source: any = {}) {
	        return new CleanPreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.warehouses = source["warehouses"];
	        this.companyCodes = source["companyCodes"];
	        this.recordCount = source["recordCount"];
	    }
	}
	export class CleanTableResult {
	    success: boolean;
	    totalDeleted: number;
	    tableBreakdown: CleanBreakdownItem[];
	    targetWarehouses: string[];
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new CleanTableResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.totalDeleted = source["totalDeleted"];
	        this.tableBreakdown = this.convertValues(source["tableBreakdown"], CleanBreakdownItem);
	        this.targetWarehouses = source["targetWarehouses"];
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ClearResult {
	    success: boolean;
	    deletedRows: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ClearResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.deletedRows = source["deletedRows"];
	        this.message = source["message"];
	    }
	}
	export class ConnectionResult {
	    success: boolean;
	    message: string;
	    latencyMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.latencyMs = source["latencyMs"];
	    }
	}
	export class ConnectionStatus {
	    connected: boolean;
	    host?: string;
	    database?: string;
	    port?: number;
	    user?: string;
	    table?: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.host = source["host"];
	        this.database = source["database"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.table = source["table"];
	        this.message = source["message"];
	    }
	}
	export class DatabaseConfig {
	    profileName: string;
	    host: string;
	    port: number;
	    database: string;
	    user: string;
	    password: string;
	    companyCode: string;
	    division: string;
	    authType: string;
	    encrypt: boolean;
	    trustServerCertificate: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DatabaseConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileName = source["profileName"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.database = source["database"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.companyCode = source["companyCode"];
	        this.division = source["division"];
	        this.authType = source["authType"];
	        this.encrypt = source["encrypt"];
	        this.trustServerCertificate = source["trustServerCertificate"];
	    }
	}
	export class DryRunCounts {
	    total: number;
	    valid: number;
	    errors: number;
	    loaded: number;
	    pending: number;
	
	    static createFrom(source: any = {}) {
	        return new DryRunCounts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.valid = source["valid"];
	        this.errors = source["errors"];
	        this.loaded = source["loaded"];
	        this.pending = source["pending"];
	    }
	}
	export class RuleBreakdownItem {
	    ruleName: string;
	    errorCount: number;
	
	    static createFrom(source: any = {}) {
	        return new RuleBreakdownItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ruleName = source["ruleName"];
	        this.errorCount = source["errorCount"];
	    }
	}
	export class DryRunResult {
	    success: boolean;
	    counts: DryRunCounts;
	    ruleBreakdown?: RuleBreakdownItem[];
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new DryRunResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.counts = this.convertValues(source["counts"], DryRunCounts);
	        this.ruleBreakdown = this.convertValues(source["ruleBreakdown"], RuleBreakdownItem);
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileDialogResult {
	    canceled: boolean;
	    filePath?: string;
	    fileName?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileDialogResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.canceled = source["canceled"];
	        this.filePath = source["filePath"];
	        this.fileName = source["fileName"];
	    }
	}
	export class GridCounts {
	    total: number;
	    valid: number;
	    error: number;
	    loaded: number;
	    failed: number;
	
	    static createFrom(source: any = {}) {
	        return new GridCounts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.valid = source["valid"];
	        this.error = source["error"];
	        this.loaded = source["loaded"];
	        this.failed = source["failed"];
	    }
	}
	export class GridQueryParams {
	    page: number;
	    pageSize: number;
	    statusFilter: string;
	    search: string;
	    domain: string;
	
	    static createFrom(source: any = {}) {
	        return new GridQueryParams(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.statusFilter = source["statusFilter"];
	        this.search = source["search"];
	        this.domain = source["domain"];
	    }
	}
	export class GridQueryResult {
	    rows: any[];
	    total: number;
	    counts: GridCounts;
	    connected: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GridQueryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = source["rows"];
	        this.total = source["total"];
	        this.counts = this.convertValues(source["counts"], GridCounts);
	        this.connected = source["connected"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LicenseFileResult {
	    canceled: boolean;
	    filePath?: string;
	    fileName?: string;
	    fileContent?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new LicenseFileResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.canceled = source["canceled"];
	        this.filePath = source["filePath"];
	        this.fileName = source["fileName"];
	        this.fileContent = source["fileContent"];
	        this.error = source["error"];
	    }
	}
	
	export class LoaderResult {
	    success: boolean;
	    loaded: number;
	    failed: number;
	    batchId: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new LoaderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.loaded = source["loaded"];
	        this.failed = source["failed"];
	        this.batchId = source["batchId"];
	        this.message = source["message"];
	    }
	}
	export class OperatorLoginResult {
	    success: boolean;
	    message: string;
	    status: LicenseStatus;
	
	    static createFrom(source: any = {}) {
	        return new OperatorLoginResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.status = this.convertValues(source["status"], LicenseStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SaveFileResult {
	    success: boolean;
	    filePath?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveFileResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.filePath = source["filePath"];
	        this.error = source["error"];
	    }
	}
	export class TableResult {
	    success: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new TableResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	    }
	}
	export class UploadResult {
	    success: boolean;
	    totalRows: number;
	    message: string;
	    domain: string;
	
	    static createFrom(source: any = {}) {
	        return new UploadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.totalRows = source["totalRows"];
	        this.message = source["message"];
	        this.domain = source["domain"];
	    }
	}

}

export namespace scripts {
	
	export class ScriptSlotInfo {
	    slot: string;
	    domain: string;
	    label: string;
	    description: string;
	    defaultFileName: string;
	    currentFileName: string;
	    filePath?: string;
	    content: string;
	    isCustom: boolean;
	    isLoaded: boolean;
	    lastUpdated?: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptSlotInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slot = source["slot"];
	        this.domain = source["domain"];
	        this.label = source["label"];
	        this.description = source["description"];
	        this.defaultFileName = source["defaultFileName"];
	        this.currentFileName = source["currentFileName"];
	        this.filePath = source["filePath"];
	        this.content = source["content"];
	        this.isCustom = source["isCustom"];
	        this.isLoaded = source["isLoaded"];
	        this.lastUpdated = source["lastUpdated"];
	    }
	}

}

