package license

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"dc-loader-wails/backend/models"
)

const embeddedPublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6JgTxNP7JoM30qOwpKDI/251ovwh36oyFRtdNoWK4+I=
-----END PUBLIC KEY-----`

var (
	licMu                 sync.RWMutex
	authenticatedOperator string
	authTimestamp         time.Time
	failedAttempts        int
	lockoutUntil          time.Time
)

func getLicensePath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("USERPROFILE")
	}
	dir := filepath.Join(appData, "RossDcLoader")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "license.lic")
}

// VerifySignature verifies the Ed25519 cryptographic signature of a payload.
func VerifySignature(payload models.LicensePayload, signatureBase64 string) bool {
	block, _ := pem.Decode([]byte(embeddedPublicKeyPEM))
	if block == nil {
		return false
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return false
	}

	edPub, ok := pub.(ed25519.PublicKey)
	if !ok {
		return false
	}

	sigBytes, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return false
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return false
	}

	return ed25519.Verify(edPub, payloadBytes, sigBytes)
}

// ValidateLicenseObject checks signature, hardware match, and expiration date.
func ValidateLicenseObject(content models.LicenseFileContent) (bool, string, models.LicenseStatus) {
	currentMachineID := GetMachineFingerprint()

	if !VerifySignature(content.Payload, content.Signature) {
		return false, "License signature verification failed. The license file has been altered or tampered with.", models.LicenseStatus{
			IsActivated:  false,
			MachineID:    currentMachineID,
			ErrorMessage: "Invalid signature",
		}
	}

	payload := content.Payload
	if strings.ToUpper(strings.TrimSpace(payload.MachineID)) != strings.ToUpper(strings.TrimSpace(currentMachineID)) {
		return false, fmt.Sprintf("License is locked to a different computer (Authorized: %s, Current: %s).", payload.MachineID, currentMachineID), models.LicenseStatus{
			IsActivated:  false,
			MachineID:    currentMachineID,
			ErrorMessage: "Machine mismatch",
		}
	}

	expiry, err := time.Parse(time.RFC3339, payload.ExpiresAt)
	if err != nil {
		// Try date format without time
		expiry, err = time.Parse("2006-01-02", payload.ExpiresAt)
	}

	now := time.Now()
	daysRemaining := int(expiry.Sub(now).Hours() / 24)
	if daysRemaining < 0 {
		daysRemaining = 0
	}

	if now.After(expiry) {
		return false, fmt.Sprintf("License expired on %s. Please request a renewal.", expiry.Format("2006-01-02")), models.LicenseStatus{
			IsActivated:   false,
			MachineID:     currentMachineID,
			ClientName:    payload.ClientName,
			IssuedAt:      payload.IssuedAt,
			ExpiresAt:     payload.ExpiresAt,
			DaysRemaining: 0,
			IsExpired:     true,
			ErrorMessage:  "License expired",
		}
	}

	requiresAuth := payload.CredentialHash != ""
	isAuthenticated := false
	if !requiresAuth {
		isAuthenticated = true
	} else if authenticatedOperator != "" && strings.EqualFold(authenticatedOperator, payload.AuthorizedUser) {
		isAuthenticated = true
	}

	return true, "", models.LicenseStatus{
		IsActivated:     true,
		MachineID:       currentMachineID,
		ClientName:      payload.ClientName,
		AuthorizedUser:  payload.AuthorizedUser,
		RequiresAuth:    requiresAuth,
		IsAuthenticated: isAuthenticated,
		IssuedAt:        payload.IssuedAt,
		ExpiresAt:       payload.ExpiresAt,
		DaysRemaining:   daysRemaining,
		IsExpired:       false,
	}
}

// CheckCurrentLicenseStatus checks whether a valid license exists on disk.
func CheckCurrentLicenseStatus() models.LicenseStatus {
	licMu.RLock()
	defer licMu.RUnlock()

	return CheckCurrentLicenseStatusUnlocked()
}

// HashOperatorCredential creates a salted SHA-256 hash matching the license authority
func HashOperatorCredential(password, salt string) string {
	combined := fmt.Sprintf("%s:%s", salt, password)
	hash := sha256.Sum256([]byte(combined))
	return hex.EncodeToString(hash[:])
}

// AuthenticateOperator validates the operator password against the signed license.
func AuthenticateOperator(password string) models.OperatorLoginResult {
	licMu.Lock()
	defer licMu.Unlock()

	status := CheckCurrentLicenseStatusUnlocked()
	if !status.IsActivated {
		return models.OperatorLoginResult{
			Success: false,
			Message: "Machine is not activated with a valid license.",
			Status:  status,
		}
	}

	if !status.RequiresAuth {
		return models.OperatorLoginResult{
			Success: true,
			Message: "License does not require operator passcode.",
			Status:  status,
		}
	}

	now := time.Now()
	if now.Before(lockoutUntil) {
		remaining := int(lockoutUntil.Sub(now).Seconds())
		return models.OperatorLoginResult{
			Success: false,
			Message: fmt.Sprintf("Too many failed attempts. Locked out for %d more seconds.", remaining),
			Status:  status,
		}
	}

	licPath := getLicensePath()
	data, err := os.ReadFile(licPath)
	if err != nil {
		return models.OperatorLoginResult{
			Success: false,
			Message: "Unable to read license file.",
			Status:  status,
		}
	}

	var content models.LicenseFileContent
	if err := json.Unmarshal(data, &content); err != nil {
		return models.OperatorLoginResult{
			Success: false,
			Message: "Failed to parse license file.",
			Status:  status,
		}
	}

	computedHash := HashOperatorCredential(strings.TrimSpace(password), content.Payload.CredentialSalt)
	if computedHash != content.Payload.CredentialHash {
		failedAttempts++
		if failedAttempts >= 5 {
			lockoutUntil = now.Add(2 * time.Minute)
			failedAttempts = 0
			return models.OperatorLoginResult{
				Success: false,
				Message: "Invalid passcode. Maximum attempts exceeded. Locked out for 2 minutes.",
				Status:  status,
			}
		}
		return models.OperatorLoginResult{
			Success: false,
			Message: fmt.Sprintf("Incorrect passcode. %d attempt(s) remaining.", 5-failedAttempts),
			Status:  status,
		}
	}

	failedAttempts = 0
	authenticatedOperator = content.Payload.AuthorizedUser
	if authenticatedOperator == "" {
		authenticatedOperator = "authorized_operator"
	}
	authTimestamp = now

	status.IsAuthenticated = true
	return models.OperatorLoginResult{
		Success: true,
		Message: fmt.Sprintf("Welcome, %s!", status.AuthorizedUser),
		Status:  status,
	}
}

// LockOperatorSession clears the current authenticated operator session.
func LockOperatorSession() models.LicenseStatus {
	licMu.Lock()
	defer licMu.Unlock()

	authenticatedOperator = ""
	authTimestamp = time.Time{}
	return CheckCurrentLicenseStatusUnlocked()
}

// IsOperatorAuthorized checks whether the application is fully unlocked.
func IsOperatorAuthorized() bool {
	licMu.RLock()
	defer licMu.RUnlock()

	status := CheckCurrentLicenseStatusUnlocked()
	if !status.IsActivated {
		return false
	}
	if !status.RequiresAuth {
		return true
	}
	return status.IsAuthenticated
}

// CheckCurrentLicenseStatusUnlocked is an internal helper that assumes licMu is already locked.
func CheckCurrentLicenseStatusUnlocked() models.LicenseStatus {
	currentMachineID := GetMachineFingerprint()
	licPath := getLicensePath()

	data, err := os.ReadFile(licPath)
	if err != nil {
		return models.LicenseStatus{
			IsActivated:  false,
			MachineID:    currentMachineID,
			ErrorMessage: "No active license found on this machine.",
		}
	}

	var content models.LicenseFileContent
	if err := json.Unmarshal(data, &content); err != nil {
		return models.LicenseStatus{
			IsActivated:  false,
			MachineID:    currentMachineID,
			ErrorMessage: "Failed to parse license file.",
		}
	}

	valid, reason, status := ValidateLicenseObject(content)
	if !valid {
		status.ErrorMessage = reason
	}
	return status
}

// ActivateLicense writes and activates a valid license on disk.
func ActivateLicense(licenseJSON string) (bool, string, models.LicenseStatus) {
	licMu.Lock()
	defer licMu.Unlock()

	currentMachineID := GetMachineFingerprint()
	var content models.LicenseFileContent
	if err := json.Unmarshal([]byte(strings.TrimSpace(licenseJSON)), &content); err != nil {
		return false, fmt.Sprintf("Invalid license JSON format: %v", err), models.LicenseStatus{
			IsActivated:  false,
			MachineID:    currentMachineID,
			ErrorMessage: "Invalid format",
		}
	}

	valid, reason, status := ValidateLicenseObject(content)
	if !valid {
		return false, reason, status
	}

	licPath := getLicensePath()
	formatted, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return false, err.Error(), status
	}

	if err := os.WriteFile(licPath, formatted, 0644); err != nil {
		return false, fmt.Sprintf("Failed to save license: %v", err), status
	}

	return true, fmt.Sprintf("Successfully activated for %s!", content.Payload.ClientName), status
}

