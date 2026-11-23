package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

func (a *App) DropStagingTable(domain string) models.TableResult {
	ok, msg := a.dbManager.DropStagingTable(a.ctx, domain)
	if ok {
		runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"domain": domain, "op": "drop_table"})
	}
	return models.TableResult{
		Success: ok,
		Message: msg,
	}
}

func (a *App) EnsureTableExistsWithOptions(domain string, dropFirst bool) models.TableResult {
	if dropFirst {
		if ok, msg := a.dbManager.DropStagingTable(a.ctx, domain); !ok {
			return models.TableResult{
				Success: false,
				Message: fmt.Sprintf("Failed to drop existing table before create: %s", msg),
			}
		}
	}
	script := a.scriptsMgr.GetScriptContent(domain, scripts.SlotCreateTable)
	ok, msg := a.dbManager.EnsureTableExistsWithScript(a.ctx, domain, script)
	if ok {
		runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"domain": domain, "op": "create_table"})
	}
	return models.TableResult{
		Success: ok,
		Message: msg,
	}
}

func (a *App) EnsureTableExists(domain string) models.TableResult {
	return a.EnsureTableExistsWithOptions(domain, false)
}

func (a *App) ClearStagedData(domain string) models.ClearResult {
	ok, count, msg := a.dbManager.ClearStagedData(a.ctx, domain)
	return models.ClearResult{
		Success:     ok,
		DeletedRows: count,
		Message:     msg,
	}
}

func (a *App) ListStagingTables() ([]models.StagingTableInfo, error) {
	return a.dbManager.ListStagingTables(a.ctx)
}

func (a *App) ExecuteCustomDDL(script string) models.TableResult {
	ok, msg := a.dbManager.ExecuteCustomDDL(a.ctx, script)
	if ok {
		runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"op": "custom_ddl"})
	}
	return models.TableResult{
		Success: ok,
		Message: msg,
	}
}

func (a *App) DropCustomTable(targetTable string) models.TableResult {
	ok, msg := a.dbManager.DropTable(a.ctx, targetTable)
	if ok {
		runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"op": "drop_table", "table": targetTable})
	}
	return models.TableResult{
		Success: ok,
		Message: msg,
	}
}

// CSV Ingestion & Execution Engine
func (a *App) UploadCsv(filePath string, companyCode string, division string, domain string) models.UploadResult {
	// Defensive swap if caller inverted division and domain
	if (division == "inventory" || division == "sales_orders" || division == "so") && (domain != "inventory" && domain != "sales_orders" && domain != "so") {
		division, domain = domain, division
	}
	if division == "" {
		division = "1"
	}

	db, _, err := a.dbManager.GetDB()
	if err != nil {
		return models.UploadResult{
			Success: false,
			Message: err.Error(),
			Domain:  domain,
		}
	}

	// Automatically ensure the target staging table and schema exist before streaming
	tableScript := a.scriptsMgr.GetScriptContent(domain, scripts.SlotCreateTable)
	if ok, errMsg := a.dbManager.EnsureTableExistsWithScript(a.ctx, domain, tableScript); !ok {
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

// UploadCsvToTable uploads a CSV into an arbitrary already-existing staging table.
// targetTable must be a fully-qualified name such as "[FIN].[MY_TABLE]" or a bare name
// that ResolveTableName can resolve.  The staging table must already exist in the database.
func (a *App) UploadCsvToTable(filePath string, companyCode string, division string, targetTable string) models.UploadResult {
	if division == "" {
		division = "1"
	}
	if targetTable == "" {
		return models.UploadResult{Success: false, Message: "targetTable must not be empty", Domain: ""}
	}

	db, _, err := a.dbManager.GetDB()
	if err != nil {
		return models.UploadResult{Success: false, Message: err.Error(), Domain: targetTable}
	}

	progressCb := func(loaded int) {
		runtime.EventsEmit(a.ctx, "dcload:uploadProgress", map[string]int{"loaded": loaded})
	}

	// Pass targetTable as the preferredDomain; UploadCsv will route to uploadGenericCsv
	// because it won't match "inventory" or "sales_orders".
	activeDomain, count, err := csv.UploadCsv(a.ctx, db, filePath, companyCode, division, targetTable, progressCb)
	if err != nil {
		return models.UploadResult{Success: false, Message: err.Error(), Domain: activeDomain}
	}
	runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"op": "upload", "table": targetTable})
	return models.UploadResult{
		Success:   true,
		TotalRows: count,
		Message:   fmt.Sprintf("Successfully staged %d rows into %s.", count, targetTable),
		Domain:    activeDomain,
	}
}

func (a *App) ExecuteDryRun(domain string) (*models.DryRunResult, error) {
	script := a.scriptsMgr.GetScriptContent(domain, scripts.SlotDryRun)
	res, err := a.dbManager.ExecuteDryRun(a.ctx, domain, script)
	// Notify frontend so counts refresh immediately regardless of which view is active
	runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"domain": domain, "op": "dryrun"})
	return res, err
}

func (a *App) ExecuteLoader(domain string) (*models.LoaderResult, error) {
	script := a.scriptsMgr.GetScriptContent(domain, scripts.SlotLoader)
	res, err := a.dbManager.ExecuteLoader(a.ctx, domain, script)
	// Notify frontend so counts refresh immediately regardless of which view is active
	runtime.EventsEmit(a.ctx, "dcload:countsUpdated", map[string]string{"domain": domain, "op": "loader"})
	return res, err
}

func (a *App) QueryGrid(params models.GridQueryParams) (*models.GridQueryResult, error) {
	return a.dbManager.QueryGrid(a.ctx, params)
}

func (a *App) GetColumnDistinctValues(params models.DistinctValuesParams) (*models.DistinctValuesResult, error) {
	return a.dbManager.GetColumnDistinctValues(a.ctx, params)
}

func (a *App) ExportData(filter string, domain string) (string, error) {
	return a.dbManager.ExportData(a.ctx, filter, domain)
}

func (a *App) CleanInventoryTables() (*models.CleanTableResult, error) {
	script := a.scriptsMgr.GetScriptContent("inventory", scripts.SlotCleanTables)
	return a.dbManager.CleanInventoryTablesWithScript(a.ctx, script)
}

func (a *App) CleanSalesTables() (*models.CleanTableResult, error) {
	script := a.scriptsMgr.GetScriptContent("sales_orders", scripts.SlotCleanTables)
	return a.dbManager.CleanTablesWithScript(a.ctx, "sales_orders", script)
}

func (a *App) GetCleanPreview(domain string) (*models.CleanPreview, error) {
	if domain == "" {
		domain = "inventory"
	}
	return a.dbManager.GetCleanPreview(a.ctx, domain)
}

// Native File Dialogs
func (a *App) OpenFileDialog(title string, filterName string, extensions string) models.FileDialogResult {
	// Defensive swap if caller inverted filterName and extensions (e.g. pattern passed as filterName)
	if strings.Contains(filterName, "*") && !strings.Contains(extensions, "*") {
		filterName, extensions = extensions, filterName
	}
	if extensions == "" {
		extensions = "*.*"
	}
	if filterName == "" {
		filterName = "Files (" + extensions + ")"
	}

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

// RevokeLicense deletes the active license on disk and resets the session.
func (a *App) RevokeLicense() models.ActivateResult {
	ok, msg, status := license.RevokeCurrentLicense()
	return models.ActivateResult{
		Success: ok,
		Message: msg,
		Status:  status,
	}
}

// AuthenticateOperator validates the operator password against the active license.
func (a *App) AuthenticateOperator(password string) models.OperatorLoginResult {
	return license.AuthenticateOperator(password)
}

// LockOperatorSession clears the current operator session.
func (a *App) LockOperatorSession() models.LicenseStatus {
	return license.LockOperatorSession()
}

// SQL Script Customization Slots
func (a *App) GetAllSqlScripts(domain string) map[scripts.ScriptSlot]scripts.ScriptSlotInfo {
	return a.scriptsMgr.GetAllScriptsConfig(domain)
}

func (a *App) SetSqlScript(domain string, slot scripts.ScriptSlot, name string, filePath string, content string) scripts.ScriptSlotInfo {
	res := a.scriptsMgr.SetCustomScript(domain, slot, name, filePath, content)
	database.InvalidateSchemaCache(domain)
	return res
}

func (a *App) ResetSqlScript(domain string, slot scripts.ScriptSlot) scripts.ScriptSlotInfo {
	res := a.scriptsMgr.ResetScript(domain, slot)
	database.InvalidateSchemaCache(domain)
	return res
}

func (a *App) ClearAllSqlScripts(domain string) map[scripts.ScriptSlot]scripts.ScriptSlotInfo {
	res := a.scriptsMgr.ClearAllScripts(domain)
	database.InvalidateSchemaCache(domain)
	return res
}
