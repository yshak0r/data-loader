package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"dc-loader-wails/backend/models"
)

var (
	schemaCacheMu sync.RWMutex
	schemaCache   = make(map[string]cachedTableSchema)
)

type cachedTableSchema struct {
	columns  []models.ColumnDefinition
	colMap   map[string]models.ColumnDefinition
	cachedAt time.Time
}

// InvalidateSchemaCache clears cached columns for a given domain or all domains.
func InvalidateSchemaCache(domain string) {
	schemaCacheMu.Lock()
	defer schemaCacheMu.Unlock()
	if domain == "" {
		schemaCache = make(map[string]cachedTableSchema)
	} else {
		delete(schemaCache, domain)
	}
}

// QueryTableSchema introspects physical columns of the staging table from SQL Server using an active *sql.DB.
func QueryTableSchema(ctx context.Context, db *sql.DB, domain string) ([]models.ColumnDefinition, map[string]models.ColumnDefinition, error) {
	schemaCacheMu.RLock()
	if cached, ok := schemaCache[domain]; ok && time.Since(cached.cachedAt) < 2*time.Minute {
		schemaCacheMu.RUnlock()
		return cached.columns, cached.colMap, nil
	}
	schemaCacheMu.RUnlock()

	tableName := "KAS_DC_LOADS"
	if domain == "sales_orders" {
		tableName = "KAS_SO_LOADS"
	}

	query := `
		SELECT 
			c.name AS column_name,
			t.name AS data_type,
			c.max_length,
			c.is_nullable,
			c.is_identity
		FROM sys.columns c
		JOIN sys.types t ON c.user_type_id = t.user_type_id
		WHERE c.object_id = OBJECT_ID(CONCAT('[FIN].[', @p1, ']'))
		ORDER BY c.column_id ASC;
	`

	rows, err := db.QueryContext(ctx, query, tableName)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to query table schema for [FIN].[%s]: %w", tableName, err)
	}
	defer rows.Close()

	var cols []models.ColumnDefinition
	colMap := make(map[string]models.ColumnDefinition)

	for rows.Next() {
		var col models.ColumnDefinition
		var maxLen int16
		var isNullable bool
		var isIdentity bool
		if err := rows.Scan(&col.Name, &col.DataType, &maxLen, &isNullable, &isIdentity); err != nil {
			return nil, nil, fmt.Errorf("failed to scan column schema: %w", err)
		}
		col.MaxLength = int(maxLen)
		col.IsNullable = isNullable
		col.IsIdentity = isIdentity
		cols = append(cols, col)
		colMap[strings.ToUpper(col.Name)] = col
	}

	if len(cols) > 0 {
		schemaCacheMu.Lock()
		schemaCache[domain] = cachedTableSchema{
			columns:  cols,
			colMap:   colMap,
			cachedAt: time.Now(),
		}
		schemaCacheMu.Unlock()
	}

	return cols, colMap, nil
}

// GetTableSchema introspects the physical columns of the staging table from SQL Server.
func (m *Manager) GetTableSchema(ctx context.Context, domain string) ([]models.ColumnDefinition, map[string]models.ColumnDefinition, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, nil, err
	}
	return QueryTableSchema(ctx, db, domain)
}
