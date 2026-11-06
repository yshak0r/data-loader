package scripts

import (
	"embed"
	"fmt"
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
	SlotLoader       ScriptSlot = "loader"
	SlotCleanTables ScriptSlot = "clean_tables"
)

// ScriptSlotInfo models script metadata and content for frontend display.
type ScriptSlotInfo struct {
	Slot            ScriptSlot `json:"slot"`
	Label           string     `json:"label"`
	Description     string     `json:"description"`
	DefaultFileName string     `json:"defaultFileName"`
	CurrentFileName string     `json:"currentFileName"`
	FilePath        string     `json:"filePath,omitempty"`
	Content         string     `json:"content"`
	IsCustom        bool       `json:"isCustom"`
	LastUpdated     string     `json:"lastUpdated,omitempty"`
}

// Manager manages default and custom SQL scripts for runtime execution.
type Manager struct {
	mu     sync.RWMutex
	custom map[ScriptSlot]ScriptSlotInfo
}

// NewManager initializes the script manager.
func NewManager() *Manager {
	return &Manager{
		custom: make(map[ScriptSlot]ScriptSlotInfo),
	}
}

// GetDefaultScript returns the embedded default SQL content for a slot.
func (m *Manager) GetDefaultScript(slot ScriptSlot) (string, error) {
	var fileName string
	switch slot {
	case SlotCreateTable:
		fileName = "sql/01_create_table.sql"
	case SlotDryRun:
		fileName = "sql/02_dry_run_validation.sql"
	case SlotLoader:
		fileName = "sql/03_execute_loader.sql"
	case SlotCleanTables:
		fileName = "sql/05_clean_inventory_tables.sql"
	default:
		return "", fmt.Errorf("unknown script slot: %s", slot)
	}

	data, err := embeddedSqlFS.ReadFile(fileName)
	if err != nil {
		return "", fmt.Errorf("failed to read embedded script %s: %w", fileName, err)
	}
	return string(data), nil
}

// GetScriptContent returns the active script content (custom if set, otherwise embedded default).
func (m *Manager) GetScriptContent(slot ScriptSlot) string {
	m.mu.RLock()
	if c, ok := m.custom[slot]; ok && c.IsCustom && c.Content != "" {
		defer m.mu.RUnlock()
		return c.Content
	}
	m.mu.RUnlock()

	def, err := m.GetDefaultScript(slot)
	if err != nil {
		return ""
	}
	return def
}

// GetAllScriptsConfig returns descriptions and current contents for all slots.
func (m *Manager) GetAllScriptsConfig() map[ScriptSlot]ScriptSlotInfo {
	slots := []struct {
		slot        ScriptSlot
		label       string
		desc        string
		defaultFile string
	}{
		{SlotCreateTable, "Create Staging Tables", "DDL to initialize [FIN].[KAS_DC_LOADS] and indexes", "01_create_table.sql"},
		{SlotDryRun, "Dry Run Validation Script", "9-rule validation updating STATUS_FLAG and RS_MESSAGE_TEXT", "02_dry_run_validation.sql"},
		{SlotLoader, "Live Loader Execution Script", "Commit valid records into Ross ERP staging tables", "03_execute_loader.sql"},
		{SlotCleanTables, "Clean Inventory Tables Script", "Safely clean Ross inventory tables scoped to staged warehouses", "05_clean_inventory_tables.sql"},
	}

	result := make(map[ScriptSlot]ScriptSlotInfo)
	for _, s := range slots {
		m.mu.RLock()
		customEntry, hasCustom := m.custom[s.slot]
		m.mu.RUnlock()

		if hasCustom && customEntry.IsCustom {
			result[s.slot] = customEntry
		} else {
			defContent, _ := m.GetDefaultScript(s.slot)
			result[s.slot] = ScriptSlotInfo{
				Slot:            s.slot,
				Label:           s.label,
				Description:     s.desc,
				DefaultFileName: s.defaultFile,
				CurrentFileName: s.defaultFile,
				Content:         defContent,
				IsCustom:        false,
			}
		}
	}
	return result
}

// SetCustomScript overrides a slot with custom content.
func (m *Manager) SetCustomScript(slot ScriptSlot, name string, filePath string, content string) ScriptSlotInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	cfg := m.GetAllScriptsConfig()
	info := cfg[slot]
	info.CurrentFileName = name
	info.FilePath = filePath
	info.Content = content
	info.IsCustom = true
	info.LastUpdated = time.Now().Format(time.RFC3339)

	m.custom[slot] = info
	return info
}

// ResetScript resets a slot back to its embedded default.
func (m *Manager) ResetScript(slot ScriptSlot) ScriptSlotInfo {
	m.mu.Lock()
	delete(m.custom, slot)
	m.mu.Unlock()

	cfg := m.GetAllScriptsConfig()
	return cfg[slot]
}

// ClearAllScripts resets all slots to embedded defaults.
func (m *Manager) ClearAllScripts() map[ScriptSlot]ScriptSlotInfo {
	m.mu.Lock()
	m.custom = make(map[ScriptSlot]ScriptSlotInfo)
	m.mu.Unlock()

	return m.GetAllScriptsConfig()
}
