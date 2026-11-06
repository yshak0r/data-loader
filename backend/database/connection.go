package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	_ "github.com/microsoft/go-mssqldb"
	"dc-loader-wails/backend/models"
)

// Manager handles the lifecycle of the active SQL Server connection pool.
type Manager struct {
	mu           sync.RWMutex
	db           *sql.DB
	activeConfig *models.DatabaseConfig
}

// NewManager creates a thread-safe database connection manager instance.
func NewManager() *Manager {
	return &Manager{}
}

// BuildConnectionString builds a standardized go-mssqldb URL connection string.
func BuildConnectionString(cfg models.DatabaseConfig) string {
	query := url.Values{}
	query.Add("database", cfg.Database)

	// Determine encryption and cert validation
	isCloud := strings.HasSuffix(strings.ToLower(strings.TrimSpace(cfg.Host)), ".database.windows.net")
	encrypt := cfg.Encrypt || isCloud
	trustCert := cfg.TrustServerCertificate

	if isCloud {
		trustCert = false
	}

	if encrypt {
		query.Add("encrypt", "true")
	} else {
		query.Add("encrypt", "disable")
	}

	if trustCert {
		query.Add("TrustServerCertificate", "true")
	} else {
		query.Add("TrustServerCertificate", "false")
	}

	port := cfg.Port
	if port <= 0 {
		port = 1433
	}

	u := &url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(cfg.User, cfg.Password),
		Host:     fmt.Sprintf("%s:%d", cfg.Host, port),
		RawQuery: query.Encode(),
	}

	return u.String()
}

// TestConnection attempts to connect and ping with the given configuration without persisting it.
func (m *Manager) TestConnection(ctx context.Context, cfg models.DatabaseConfig) (bool, string, int64) {
	connStr := BuildConnectionString(cfg)
	start := time.Now()

	db, err := sql.Open("sqlserver", connStr)
	if err != nil {
		return false, fmt.Sprintf("Failed to initialize driver: %v", err), 0
	}
	defer db.Close()

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		return false, fmt.Sprintf("Connection failed: %v", err), 0
	}

	latencyMs := time.Since(start).Milliseconds()
	return true, fmt.Sprintf("Connection successful (Latency: %d ms)", latencyMs), latencyMs
}

// Connect establishes the active SQL Server pool.
func (m *Manager) Connect(ctx context.Context, cfg models.DatabaseConfig) (bool, string, int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Close existing connection if any
	if m.db != nil {
		_ = m.db.Close()
		m.db = nil
	}

	connStr := BuildConnectionString(cfg)
	start := time.Now()

	db, err := sql.Open("sqlserver", connStr)
	if err != nil {
		return false, fmt.Sprintf("Failed to initialize driver: %v", err), 0
	}

	// Configure pool parameters
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(1 * time.Hour)

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return false, fmt.Sprintf("Connection failed: %v", err), 0
	}

	m.db = db
	cfgCopy := cfg
	m.activeConfig = &cfgCopy

	latencyMs := time.Since(start).Milliseconds()
	return true, "Connected to Microsoft SQL Server successfully.", latencyMs
}

// Disconnect closes the active connection pool.
func (m *Manager) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db != nil {
		_ = m.db.Close()
		m.db = nil
	}
	m.activeConfig = nil
}

// IsConnected returns whether the database pool is active and reachable.
func (m *Manager) IsConnected() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return m.db.PingContext(ctx) == nil
}

// GetStatus reports the current connection status.
func (m *Manager) GetStatus() models.ConnectionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil || m.activeConfig == nil {
		return models.ConnectionStatus{
			Connected: false,
			Message:   "Database disconnected.",
		}
	}

	port := m.activeConfig.Port
	if port <= 0 {
		port = 1433
	}

	return models.ConnectionStatus{
		Connected: true,
		Host:      m.activeConfig.Host,
		Database:  m.activeConfig.Database,
		Port:      port,
		User:      m.activeConfig.User,
		Message:   "Connected",
	}
}

// GetDB returns the underlying *sql.DB pool safely.
func (m *Manager) GetDB() (*sql.DB, *models.DatabaseConfig, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil {
		return nil, nil, fmt.Errorf("database connection is not open")
	}
	return m.db, m.activeConfig, nil
}

