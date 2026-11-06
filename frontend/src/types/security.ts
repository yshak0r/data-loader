// Security & Licensing Data Contracts
export interface LicensePayload {
  machineId: string;
  clientName: string;
  issuedAt: string;     // ISO String
  expiresAt: string;    // ISO String
  domains?: string[];   // e.g. ['inventory', 'sales_orders']
  maxUsers?: number;
}

export interface LicenseFileContent {
  payload: LicensePayload;
  signature: string;    // base64-encoded Ed25519 signature
}

export interface LicenseStatus {
  isActivated: boolean;
  machineId: string;
  clientName?: string;
  issuedAt?: string;
  expiresAt?: string;
  daysRemaining?: number;
  isExpired?: boolean;
  errorMessage?: string;
}

