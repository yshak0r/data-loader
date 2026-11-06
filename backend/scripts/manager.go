package scripts

import (
	"embed"
	"strings"
	"sync"
	"time"
)

//go:embed sql/*.sql
var embeddedSqlFS embed.FS

// ScriptSlot represents one of the customizable SQL script slots.
type ScriptSlot string

const (
	SlotCreateTable ScriptSlot = "create_table"
	SlotDryRun      ScriptSlot = "dry_run"
	SlotLoader      ScriptSlot = "loader"
	SlotCleanTables ScriptSlot = "clean_tables"
)

// ScriptSlotInfo models script metadata and content for frontend display and execution.
type ScriptSlotInfo struct {
	Slot            ScriptSlot `json:"slot"`
	Domain          string     `json:"domain"`
	Label           string     `json:"label"`
	Description     string     `json:"description"`
	DefaultFileName string     `json:"defaultFileName"`
	CurrentFileName string     `json:"currentFileName"`
	FilePath        string     `json:"filePath,omitempty"`
	Content         string     `json:"content"`
	IsCustom        bool       `json:"isCustom"`
	IsLoaded        bool       `json:"isLoaded"`
	LastUpdated     string     `json:"lastUpdated,omitempty"`
}

// Manager manages default and custom SQL scripts for runtime execution across domains.
type Manager struct {
	mu     sync.RWMutex
	custom map[string]ScriptSlotInfo // keyed by "domain:slot"
}

// NewManager initializes the script manager.
func NewManager() *Manager {
	return &Manager{
		custom: make(map[string]ScriptSlotInfo),
	}
}

// getFilenameForSlot returns the .sql filename for a given domain and slot.
func getFilenameForSlot(domain string, slot ScriptSlot) string {
	prefix := ""
	if domain == "sales_orders" {
		prefix = "so_"
	}
	switch slot {
	case SlotCreateTable:
		return prefix + "01_create_table.sql"
	case SlotDryRun:
		return prefix + "02_dry_run_validation.sql"
	case SlotLoader:
		return prefix + "03_execute_loader.sql"
	case SlotCleanTables:
		if domain == "sales_orders" {
			return prefix + "05_clean_tables.sql"
		}
		return "05_clean_inventory_tables.sql"
	}
	return ""
}

// isPlaceholderOnly returns true when the SQL content only contains comments/blanks — no real SQL.
func isPlaceholderOnly(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		return false // found real SQL
	}
	return true
}

// readEmbeddedScript reads an embedded .sql file; returns "" if missing, unreadable, or placeholder-only.
func readEmbeddedScript(filename string) string {
	if filename == "" {
		return ""
	}
	data, err := embeddedSqlFS.ReadFile("sql/" + filename)
	if err != nil {
		return ""
	}
	content := strings.TrimSpace(string(data))
	if isPlaceholderOnly(content) {
		return ""
	}
	return content
}

func normalizeDomain(domain string) string {
	d := strings.ToLower(strings.TrimSpace(domain))
	if d == "sales_orders" || d == "so" {
		return "sales_orders"
	}
	return "inventory"
}

func makeKey(domain string, slot ScriptSlot) string {
	return normalizeDomain(domain) + ":" + string(slot)
}

// GetDefaultScript returns the SQL content for a domain+slot.
// Priority: embedded .sql file (if non-placeholder) → hardcoded Go constant fallback.
func (m *Manager) GetDefaultScript(domain string, slot ScriptSlot) string {
	dom := normalizeDomain(domain)

	// 1. Try the embedded .sql file first
	filename := getFilenameForSlot(dom, slot)
	if embedded := readEmbeddedScript(filename); embedded != "" {
		return embedded
	}

	// 2. Fall back to hardcoded Go string constants
	if dom == "sales_orders" {
		switch slot {
		case SlotCreateTable:
			return strings.TrimSpace(DefaultSoCreateTableSQL)
		case SlotDryRun:
			return strings.TrimSpace(DefaultSoDryRunSQL)
		case SlotLoader:
			return strings.TrimSpace(DefaultSoLoaderSQL)
		case SlotCleanTables:
			return strings.TrimSpace(DefaultSoCleanTablesSQL)
		default:
			return ""
		}
	}

	// DC Inventory Loader
	switch slot {
	case SlotCreateTable:
		return strings.TrimSpace(DefaultDcCreateTableSQL)
	case SlotDryRun:
		return strings.TrimSpace(DefaultDcDryRunSQL)
	case SlotLoader:
		return strings.TrimSpace(DefaultDcLoaderSQL)
	case SlotCleanTables:
		return strings.TrimSpace(DefaultDcCleanTablesSQL)
	default:
		return ""
	}
}

// GetScriptContent returns the active script content (custom if set and non-empty, otherwise hardcoded default).
func (m *Manager) GetScriptContent(domain string, slot ScriptSlot) string {
	key := makeKey(domain, slot)
	m.mu.RLock()
	if c, ok := m.custom[key]; ok && c.IsCustom && strings.TrimSpace(c.Content) != "" {
		m.mu.RUnlock()
		return c.Content
	}
	m.mu.RUnlock()

	return m.GetDefaultScript(domain, slot)
}

// GetAllScriptsConfig returns descriptions and current contents for all slots in a domain.
// By default, hardcoded default scripts are active and in-use.
func (m *Manager) GetAllScriptsConfig(domain string) map[ScriptSlot]ScriptSlotInfo {
	dom := normalizeDomain(domain)

	type slotDef struct {
		slot        ScriptSlot
		label       string
		desc        string
		defaultFile string
	}

	var slots []slotDef
	if dom == "sales_orders" {
		slots = []slotDef{
			{SlotCreateTable, "Create Sales Orders Table", "DDL to initialize [FIN].[KAS_SO_LOADS] and indexes", "01_create_table.sql"},
			{SlotDryRun, "Sales Orders Dry Run Validation", "Validate customer, part, warehouse, quantity and PO references", "02_dry_run_validation.sql"},
			{SlotLoader, "Sales Orders Live Loader Execution", "Commit verified sales orders and assign Ross order numbers", "03_execute_loader.sql"},
			{SlotCleanTables, "Clean Sales Orders Table", "Safely clear staged sales orders from [FIN].[KAS_SO_LOADS]", "05_clean_tables.sql"},
		}
	} else {
		slots = []slotDef{
			{SlotCreateTable, "Create Staging Tables", "DDL to initialize [FIN].[KAS_DC_LOADS] and indexes", "01_create_table.sql"},
			{SlotDryRun, "Dry Run Validation Script", "Set-based validation updating STATUS_FLAG and RS_MESSAGE_TEXT", "02_dry_run_validation.sql"},
			{SlotLoader, "Live Loader Execution Script", "Commit valid records into Ross ERP staging tables", "03_execute_loader.sql"},
			{SlotCleanTables, "Clean Inventory Tables Script", "Safely clean Ross inventory tables scoped to staged warehouses", "05_clean_inventory_tables.sql"},
		}
	}

	result := make(map[ScriptSlot]ScriptSlotInfo)
	for _, s := range slots {
		key := dom + ":" + string(s.slot)
		m.mu.RLock()
		customEntry, hasCustom := m.custom[key]
		m.mu.RUnlock()

		if hasCustom && customEntry.IsCustom && strings.TrimSpace(customEntry.Content) != "" {
			result[s.slot] = customEntry
		} else {
			defContent := m.GetDefaultScript(dom, s.slot)
			result[s.slot] = ScriptSlotInfo{
				Slot:            s.slot,
				Domain:          dom,
				Label:           s.label,
				Description:     s.desc,
				DefaultFileName: s.defaultFile,
				CurrentFileName: s.defaultFile,
				Content:         defContent,
				IsCustom:        false,
				IsLoaded:        true, // Hardcoded default is in-use by default!
			}
		}
	}
	return result
}

// SetCustomScript overrides a slot with custom uploaded/edited content.
func (m *Manager) SetCustomScript(domain string, slot ScriptSlot, name string, filePath string, content string) ScriptSlotInfo {
	dom := normalizeDomain(domain)
	key := makeKey(dom, slot)

	// Fetch base template config WITHOUT holding the write lock to prevent recursive deadlock
	cfg := m.GetAllScriptsConfig(dom)
	info := cfg[slot]
	info.Domain = dom
	info.CurrentFileName = name
	info.FilePath = filePath
	info.Content = content
	info.IsCustom = true
	info.IsLoaded = true
	info.LastUpdated = time.Now().Format(time.RFC3339)

	m.mu.Lock()
	m.custom[key] = info
	m.mu.Unlock()

	return info
}

// ResetScript resets a slot back to its embedded/hardcoded default.
func (m *Manager) ResetScript(domain string, slot ScriptSlot) ScriptSlotInfo {
	dom := normalizeDomain(domain)
	key := makeKey(dom, slot)

	m.mu.Lock()
	delete(m.custom, key)
	m.mu.Unlock()

	cfg := m.GetAllScriptsConfig(dom)
	return cfg[slot]
}

// ClearAllScripts resets all slots for a domain back to embedded defaults.
func (m *Manager) ClearAllScripts(domain string) map[ScriptSlot]ScriptSlotInfo {
	dom := normalizeDomain(domain)

	m.mu.Lock()
	for k := range m.custom {
		if strings.HasPrefix(k, dom+":") {
			delete(m.custom, k)
		}
	}
	m.mu.Unlock()

	return m.GetAllScriptsConfig(dom)
}
