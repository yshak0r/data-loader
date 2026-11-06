package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"dc-loader-wails/backend/csv"
	"dc-loader-wails/backend/database"
	"dc-loader-wails/backend/license"
	"dc-loader-wails/backend/models"
	"dc-loader-wails/backend/scripts"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct manages application state and exposes methods to Wails frontend.
type App struct {
	ctx        context.Context
	dbManager  *database.Manager
	scriptsMgr *scripts.Manager
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{
		dbManager:  database.NewManager(),
		scriptsMgr: scripts.NewManager(),
	}
}

// startup is called when the app starts. The context is saved so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Window Management
func (a *App) MinimizeWindow() {
	runtime.WindowMinimise(a.ctx)
}

func (a *App) ToggleMaximizeWindow() {
	runtime.WindowToggleMaximise(a.ctx)
}

func (a *App) CloseWindow() {
	runtime.Quit(a.ctx)
}

// Database Connection & Profile Bridge
func (a *App) ConnectDatabase(cfg models.DatabaseConfig) models.ConnectionResult {
	ok, msg, latency := a.dbManager.Connect(a.ctx, cfg)
	return models.ConnectionResult{
		Success:   ok,
		Message:   msg,
		LatencyMs: latency,
	}
}

func (a *App) TestDatabaseConnection(cfg models.DatabaseConfig) models.ConnectionResult {
	ok, msg, latency := a.dbManager.TestConnection(a.ctx, cfg)
	return models.ConnectionResult{
		Success:   ok,
		Message:   msg,
		LatencyMs: latency,
	}
}

func (a *App) GetDatabaseStatus() models.ConnectionStatus {
	return a.dbManager.GetStatus()
}

func (a *App) DisconnectDatabase() bool {
	a.dbManager.Disconnect()
	return true
}

func (a *App) EnsureTableExists(domain string) models.TableResult {
	ok, msg := a.dbManager.EnsureTableExists(a.ctx, domain)
	return models.TableResult{
		Success: ok,
		Message: msg,
	}
}

func (a *App) ClearStagedData(domain string) models.ClearResult {
	ok, count, msg := a.dbManager.ClearStagedData(a.ctx, domain)
	return models.ClearResult{
		Success:     ok,
		DeletedRows: count,
		Message:     msg,
	}
}

// CSV Ingestion & Execution Engine
func (a *App) UploadCsv(filePath string, companyCode string, division string, domain string) models.UploadResult {
	db, _, err := a.dbManager.GetDB()
	if err != nil {
		return models.UploadResult{
			Success: false,
			Message: err.Error(),
			Domain:  domain,
		}
	}

	// Automatically ensure the target staging table and schema exist before streaming
	if ok, errMsg := a.dbManager.EnsureTableExists(a.ctx, domain); !ok {
		return models.UploadResult{
			Success: false,
			Message: fmt.Sprintf("Failed to prepare staging table: %s", errMsg),
			Domain:  domain,
		}
	}

	progressCb := func(loaded int) {
		runtime.EventsEmit(a.ctx, "dcload:uploadProgress", map[string]int{"loaded": loaded})
	}

	activeDomain, count, err := csv.UploadCsv(a.ctx, db, filePath, companyCode, division, domain, progressCb)
	if err != nil {
		return models.UploadResult{
			Success: false,
			Message: err.Error(),
			Domain:  activeDomain,
		}
	}
	return models.UploadResult{
		Success:   true,
		TotalRows: count,
		Message:   fmt.Sprintf("Successfully staged %d rows.", count),
		Domain:    activeDomain,
	}
}

func (a *App) ExecuteDryRun(domain string) (*models.DryRunResult, error) {
	return a.dbManager.ExecuteDryRun(a.ctx, domain)
}

func (a *App) ExecuteLoader(domain string) (*models.LoaderResult, error) {
	return a.dbManager.ExecuteLoader(a.ctx, domain)
}

func (a *App) QueryGrid(params models.GridQueryParams) (*models.GridQueryResult, error) {
	return a.dbManager.QueryGrid(a.ctx, params)
}

func (a *App) ExportData(filter string, domain string) (string, error) {
	return a.dbManager.ExportData(a.ctx, filter, domain)
}

func (a *App) CleanInventoryTables() (*models.CleanTableResult, error) {
	script := a.scriptsMgr.GetScriptContent(scripts.SlotCleanTables)
	return a.dbManager.CleanInventoryTablesWithScript(a.ctx, script)
}

func (a *App) GetCleanPreview() (*models.CleanPreview, error) {
	return a.dbManager.GetCleanWarehousesPreview(a.ctx)
}

// Native File Dialogs
func (a *App) OpenFileDialog(title string, filterName string, extensions string) models.FileDialogResult {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{DisplayName: filterName, Pattern: extensions},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return models.FileDialogResult{Canceled: true}
	}
	return models.FileDialogResult{
		Canceled: false,
		FilePath: path,
		FileName: filepath.Base(path),
	}
}

func (a *App) SaveFileDialog(defaultName string, content string) models.SaveFileResult {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Export CSV File",
		Filters: []runtime.FileFilter{
			{DisplayName: "CSV Files (*.csv)", Pattern: "*.csv;*.CSV"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return models.SaveFileResult{Success: false, Error: "Canceled"}
	}

	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return models.SaveFileResult{Success: false, FilePath: path, Error: err.Error()}
	}
	return models.SaveFileResult{Success: true, FilePath: path}
}

func (a *App) OpenLicenseFileDialog() models.LicenseFileResult {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Enterprise Ross License File (*.lic)",
		Filters: []runtime.FileFilter{
			{DisplayName: "Ross License (*.lic;*.json)", Pattern: "*.lic;*.json"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || filePath == "" {
		return models.LicenseFileResult{Canceled: true}
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		return models.LicenseFileResult{Canceled: false, FilePath: filePath, Error: err.Error()}
	}

	return models.LicenseFileResult{
		Canceled:    false,
		FilePath:    filePath,
		FileName:    filepath.Base(filePath),
		FileContent: string(content),
	}
}

func (a *App) ReadFile(filePath string) (string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Hardware Security & Licensing
func (a *App) GetMachineFingerprint() string {
	return license.GetMachineFingerprint()
}

func (a *App) RegenerateMachineFingerprint() string {
	return license.RegenerateMachineFingerprint()
}

func (a *App) GetLicenseStatus() models.LicenseStatus {
	return license.CheckCurrentLicenseStatus()
}

func (a *App) ActivateLicense(licenseJSON string) models.ActivateResult {
	ok, msg, status := license.ActivateLicense(licenseJSON)
	return models.ActivateResult{
		Success: ok,
		Message: msg,
		Status:  status,
	}
}

// SQL Script Customization Slots
func (a *App) GetAllSqlScripts() map[scripts.ScriptSlot]scripts.ScriptSlotInfo {
	return a.scriptsMgr.GetAllScriptsConfig()
}

func (a *App) SetSqlScript(slot scripts.ScriptSlot, name string, filePath string, content string) scripts.ScriptSlotInfo {
	return a.scriptsMgr.SetCustomScript(slot, name, filePath, content)
}

func (a *App) ResetSqlScript(slot scripts.ScriptSlot) scripts.ScriptSlotInfo {
	return a.scriptsMgr.ResetScript(slot)
}

func (a *App) ClearAllSqlScripts() map[scripts.ScriptSlot]scripts.ScriptSlotInfo {
	return a.scriptsMgr.ClearAllScripts()
}
