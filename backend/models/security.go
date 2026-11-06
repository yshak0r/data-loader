package models

// LicensePayload defines the cryptographically signed license data.
type LicensePayload struct {
	MachineID   string   `json:"machineId"`
	ClientName  string   `json:"clientName"`
	IssuedAt    string   `json:"issuedAt"`
	ExpiresAt   string   `json:"expiresAt"`
	Domains     []string `json:"domains,omitempty"`
	MaxUsers    int      `json:"maxUsers,omitempty"`
}

// LicenseFileContent represents the serialised structure of a *.lic file.
type LicenseFileContent struct {
	Payload   LicensePayload `json:"payload"`
	Signature string         `json:"signature"`
}

// LicenseStatus describes the local machine activation status.
type LicenseStatus struct {
	IsActivated   bool   `json:"isActivated"`
	MachineID     string `json:"machineId"`
	ClientName    string `json:"clientName,omitempty"`
	IssuedAt      string `json:"issuedAt,omitempty"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
	DaysRemaining int    `json:"daysRemaining,omitempty"`
	IsExpired     bool   `json:"isExpired,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}

