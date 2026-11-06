package database

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

var goBatchRegex = regexp.MustCompile(`(?im)^\s*GO\s*(?:--.*)?$`)

// SplitSqlBatches divides a SQL script by standard MSSQL "GO" batch separators.
func SplitSqlBatches(script string) []string {
	parts := goBatchRegex.Split(script, -1)
	var batches []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			batches = append(batches, trimmed)
		}
	}
	return batches
}

// ExecuteSqlBatches executes multiple SQL batches sequentially.
func (m *Manager) ExecuteSqlBatches(ctx context.Context, script string) error {
	db, _, err := m.GetDB()
	if err != nil {
		return err
	}

	batches := SplitSqlBatches(script)
	for i, batch := range batches {
		if _, err := db.ExecContext(ctx, batch); err != nil {
			return fmt.Errorf("error executing batch %d: %w", i+1, err)
		}
	}
	return nil
}

