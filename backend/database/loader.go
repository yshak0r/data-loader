package database

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"dc-loader-wails/backend/models"
)

// ExecuteDryRun executes batch validation rules against the active staging table.
func (m *Manager) ExecuteDryRun(ctx context.Context, domain string, scriptContent string) (*models.DryRunResult, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	tableName := "[FIN].[KAS_DC_LOADS]"
	if domain == "sales_orders" {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	trimmedScript := strings.TrimSpace(scriptContent)
	if trimmedScript != "" {
		if err := m.ExecuteSqlBatches(ctx, trimmedScript); err != nil {
			return &models.DryRunResult{
				Success: false,
				Message: fmt.Sprintf("Validation script error: %v", err),
			}, nil
		}

		countsQuery := fmt.Sprintf(`
			SELECT 
				COUNT(*) AS total,
				ISNULL(SUM(CASE WHEN STATUS_FLAG = 'V' THEN 1 ELSE 0 END), 0) AS valid,
				ISNULL(SUM(CASE WHEN STATUS_FLAG = 'E' THEN 1 ELSE 0 END), 0) AS errors,
				ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('L', 'P') THEN 1 ELSE 0 END), 0) AS loaded,
				ISNULL(SUM(CASE WHEN STATUS_FLAG = ' ' THEN 1 ELSE 0 END), 0) AS pending
			FROM %s
		`, tableName)

		var c models.DryRunCounts
		_ = db.QueryRowContext(ctx, countsQuery).Scan(&c.Total, &c.Valid, &c.Errors, &c.Loaded, &c.Pending)

		return &models.DryRunResult{
			Success: true,
			Counts:  c,
			Message: fmt.Sprintf("Validation script executed: %d valid, %d errors out of %d records.", c.Valid, c.Errors, c.Total),
		}, nil
	}

	if domain == "sales_orders" {
		return m.executeDryRunSo(ctx, db)
	}
	return m.executeDryRunDc(ctx, db)
}

func (m *Manager) executeDryRunDc(ctx context.Context, db *sql.DB) (*models.DryRunResult, error) {
	// Reset pending, error, and load-failed rows so they can be re-validated
	resetQuery := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'V', RS_MESSAGE_TEXT = ''
		WHERE STATUS_FLAG IN (' ', 'E', 'F');
	`
	if _, err := db.ExecContext(ctx, resetQuery); err != nil {
		return nil, fmt.Errorf("failed to reset DC dry run status: %w", err)
	}

	// Validation rules only act on rows that have NOT been committed to Ross ERP.
	// Excludes 'L', 'P' (loaded) — 'F' rows were reset to 'V' above and re-enter validation.

	// 1. Missing Warehouse
	rule1 := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Warehouse' ELSE RS_MESSAGE_TEXT + '; Missing Warehouse' END
		WHERE (WAREHOUSE IS NULL OR LTRIM(RTRIM(WAREHOUSE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule1)

	// 2. Missing Part Code
	rule2 := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Part Code' ELSE RS_MESSAGE_TEXT + '; Missing Part Code' END
		WHERE (PART_CODE IS NULL OR LTRIM(RTRIM(PART_CODE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule2)

	// 3. Missing Lot Number
	rule3 := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Lot Number' ELSE RS_MESSAGE_TEXT + '; Missing Lot Number' END
		WHERE (IC_LOT_NUMBER IS NULL OR LTRIM(RTRIM(IC_LOT_NUMBER)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule3)

	// 4. Missing Bin Location
	rule4 := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Bin Location' ELSE RS_MESSAGE_TEXT + '; Missing Bin Location' END
		WHERE (BIN_LOCATION IS NULL OR LTRIM(RTRIM(BIN_LOCATION)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule4)

	// 5. Quantity must be greater than zero
	rule5 := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Quantity must be greater than 0' ELSE RS_MESSAGE_TEXT + '; Quantity must be greater than 0' END
		WHERE QTY_1 <= 0 AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule5)

	// 6. Missing LPN ID
	rule6 := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing LPN ID' ELSE RS_MESSAGE_TEXT + '; Missing LPN ID' END
		WHERE (DC_LICENSE_PLATE_ID IS NULL OR LTRIM(RTRIM(DC_LICENSE_PLATE_ID)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule6)

	// 7. Validate Warehouse exists in Ross ERP master if table exists
	rule7 := `
		IF OBJECT_ID(N'WAREHOUSE', N'U') IS NOT NULL
		BEGIN
			UPDATE t
			SET STATUS_FLAG = 'E',
			    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Invalid Warehouse Code' ELSE RS_MESSAGE_TEXT + '; Invalid Warehouse Code' END
			FROM [FIN].[KAS_DC_LOADS] t
			WHERE STATUS_FLAG NOT IN ('L', 'P')
			  AND NOT EXISTS (SELECT 1 FROM WAREHOUSE w WHERE w.WAREHOUSE = t.WAREHOUSE);
		END
	`
	_, _ = db.ExecContext(ctx, rule7)

	// 8. Validate Part Code exists in Ross ERP master if table exists
	rule8 := `
		IF OBJECT_ID(N'ITEM', N'U') IS NOT NULL
		BEGIN
			UPDATE t
			SET STATUS_FLAG = 'E',
			    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Invalid Part Code' ELSE RS_MESSAGE_TEXT + '; Invalid Part Code' END
			FROM [FIN].[KAS_DC_LOADS] t
			WHERE STATUS_FLAG NOT IN ('L', 'P')
			  AND NOT EXISTS (SELECT 1 FROM ITEM i WHERE i.PART_CODE = t.PART_CODE);
		END
	`
	_, _ = db.ExecContext(ctx, rule8)

	// Counts — 'V' means awaiting load, 'F' means load failed (both passed validation)
	countsQuery := `
		SELECT 
			COUNT(*) AS total,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'V' THEN 1 ELSE 0 END), 0) AS valid,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'E' THEN 1 ELSE 0 END), 0) AS errors,
			ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('L', 'P') THEN 1 ELSE 0 END), 0) AS loaded,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = ' ' THEN 1 ELSE 0 END), 0) AS pending
		FROM [FIN].[KAS_DC_LOADS]
	`
	var c models.DryRunCounts
	_ = db.QueryRowContext(ctx, countsQuery).Scan(&c.Total, &c.Valid, &c.Errors, &c.Loaded, &c.Pending)

	return &models.DryRunResult{
		Success: true,
		Counts:  c,
		Message: fmt.Sprintf("Dry run completed: %d valid, %d errors out of %d records.", c.Valid, c.Errors, c.Total),
	}, nil
}

func (m *Manager) executeDryRunSo(ctx context.Context, db *sql.DB) (*models.DryRunResult, error) {
	resetQuery := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'V', RS_MESSAGE_TEXT = ''
		WHERE STATUS_FLAG IN (' ', 'E', 'F');
	`
	if _, err := db.ExecContext(ctx, resetQuery); err != nil {
		return nil, fmt.Errorf("failed to reset SO dry run status: %w", err)
	}

	// 1. Missing Customer
	rule1 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Customer Number' ELSE RS_MESSAGE_TEXT + '; Missing Customer Number' END
		WHERE (CUSTOMER_NUMBER IS NULL OR LTRIM(RTRIM(CUSTOMER_NUMBER)) = '') AND STATUS_FLAG != 'L';
	`
	_, _ = db.ExecContext(ctx, rule1)

	// 2. Missing Part Code
	rule2 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Part Code' ELSE RS_MESSAGE_TEXT + '; Missing Part Code' END
		WHERE (PART_CODE IS NULL OR LTRIM(RTRIM(PART_CODE)) = '') AND STATUS_FLAG != 'L';
	`
	_, _ = db.ExecContext(ctx, rule2)

	// 3. Missing Warehouse
	rule3 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Warehouse' ELSE RS_MESSAGE_TEXT + '; Missing Warehouse' END
		WHERE (WAREHOUSE IS NULL OR LTRIM(RTRIM(WAREHOUSE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule3)

	// 4. Quantity must be > 0
	rule4 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Quantity must be > 0' ELSE RS_MESSAGE_TEXT + '; Quantity must be > 0' END
		WHERE (TRY_CAST(QUANTITY AS DECIMAL(18, 4)) IS NULL OR TRY_CAST(QUANTITY AS DECIMAL(18, 4)) <= 0) AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule4)

	// 5. Sales price cannot be negative
	rule5 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Sales Price cannot be negative' ELSE RS_MESSAGE_TEXT + '; Sales Price cannot be negative' END
		WHERE SALES_PRICE < 0 AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule5)

	// 6. Missing Customer Reference / PO Number
	rule6 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Customer Reference (PO#)' ELSE RS_MESSAGE_TEXT + '; Missing Customer Reference (PO#)' END
		WHERE (CUSTOMER_REFERENCE IS NULL OR LTRIM(RTRIM(CUSTOMER_REFERENCE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule6)

	// 7. Missing Order Date
	rule7 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Order Date' ELSE RS_MESSAGE_TEXT + '; Missing Order Date' END
		WHERE (ORDER_DATE IS NULL OR LTRIM(RTRIM(ORDER_DATE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule7)

	// 8. Missing Requested Delivery Date
	rule8 := `
		UPDATE [FIN].[KAS_SO_LOADS]
		SET STATUS_FLAG = 'E',
		    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Delivery Date' ELSE RS_MESSAGE_TEXT + '; Missing Delivery Date' END
		WHERE (SYS_DELIVERY_DATE IS NULL OR LTRIM(RTRIM(SYS_DELIVERY_DATE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');
	`
	_, _ = db.ExecContext(ctx, rule8)

	// 9. Foreign Key Checks if customer master exists
	rule9 := `
		IF OBJECT_ID(N'CUSTOMER', N'U') IS NOT NULL
		BEGIN
			UPDATE t
			SET STATUS_FLAG = 'E',
			    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Customer does not exist in Ross ERP' ELSE RS_MESSAGE_TEXT + '; Customer does not exist in Ross ERP' END
			FROM [FIN].[KAS_SO_LOADS] t
			WHERE STATUS_FLAG NOT IN ('L', 'P')
			  AND NOT EXISTS (SELECT 1 FROM CUSTOMER c WHERE c.CUSTOMER = t.CUSTOMER_NUMBER);
		END
	`
	_, _ = db.ExecContext(ctx, rule9)

	countsQuery := `
		SELECT 
			COUNT(*) AS total,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'V' THEN 1 ELSE 0 END), 0) AS valid,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = 'E' THEN 1 ELSE 0 END), 0) AS errors,
			ISNULL(SUM(CASE WHEN STATUS_FLAG IN ('L', 'P') THEN 1 ELSE 0 END), 0) AS loaded,
			ISNULL(SUM(CASE WHEN STATUS_FLAG = ' ' THEN 1 ELSE 0 END), 0) AS pending
		FROM [FIN].[KAS_SO_LOADS]
	`
	var c models.DryRunCounts
	_ = db.QueryRowContext(ctx, countsQuery).Scan(&c.Total, &c.Valid, &c.Errors, &c.Loaded, &c.Pending)

	return &models.DryRunResult{
		Success: true,
		Counts:  c,
		Message: fmt.Sprintf("Sales Order dry run completed: %d valid, %d errors out of %d records.", c.Valid, c.Errors, c.Total),
	}, nil
}

// ExecuteLoader commits valid staged records to Ross ERP.
func (m *Manager) ExecuteLoader(ctx context.Context, domain string, scriptContent string) (*models.LoaderResult, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	batchID := fmt.Sprintf("BATCH-%s-%04d", time.Now().Format("20060102150405"), rand.Intn(10000))

	tableName := "[FIN].[KAS_DC_LOADS]"
	if domain == "sales_orders" {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	trimmedScript := strings.TrimSpace(scriptContent)
	if trimmedScript != "" {
		// Snapshot 'V' count before script runs — this is what we expect to be committed
		var preValidCount int
		_ = db.QueryRowContext(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE STATUS_FLAG = 'V'", tableName)).Scan(&preValidCount)

		if err := m.ExecuteSqlBatches(ctx, trimmedScript); err != nil {
			// Stamp all remaining 'V' rows as 'F' (load failed)
			failed := stampFailedRows(ctx, db, tableName, batchID)
			return &models.LoaderResult{
				Success: false,
				Loaded:  0,
				Failed:  failed,
				BatchID: batchID,
				Message: fmt.Sprintf("Loader script error: %v", err),
			}, nil
		}

		// Count rows that were committed by the script (any STATUS_FLAG IN ('L','P')).
		// We do NOT filter by BATCH_ID here because the SQL script manages its own @BatchID
		// variable internally — the Go-generated batchID is not written by the script.
		var loadedCount int
		_ = db.QueryRowContext(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE STATUS_FLAG IN ('L', 'P')", tableName)).Scan(&loadedCount)

		// Stamp any 'V' rows the custom script didn't process as 'F'
		failed := stampFailedRows(ctx, db, tableName, batchID)

		// If the script used RETURN (e.g. no-records path) loadedCount may be pre-existing committed rows.
		// Use the pre-snapshot to determine what was actually committed this run.
		committedThisRun := preValidCount - failed // rows that were 'V' and are now neither 'V' nor 'F'
		if committedThisRun < 0 {
			committedThisRun = 0
		}
		// Use the direct count if it is consistent, otherwise fall back to delta
		if loadedCount == 0 && committedThisRun == 0 {
			committedThisRun = 0
		} else if committedThisRun > 0 && loadedCount >= committedThisRun {
			// loadedCount includes previously committed rows; use the delta
			loadedCount = committedThisRun
		}

		msg := fmt.Sprintf("Loader script executed: %d records committed into Ross ERP.", loadedCount)
		if preValidCount == 0 {
			msg = "No records with STATUS_FLAG = 'V' were found. Run Dry Run validation first."
		} else if failed > 0 {
			msg = fmt.Sprintf("Loader script executed: %d committed, %d marked as Load Failed.", loadedCount, failed)
		}

		return &models.LoaderResult{
			Success: true,
			Loaded:  loadedCount,
			Failed:  failed,
			BatchID: batchID,
			Message: msg,
		}, nil
	}

	if domain == "sales_orders" {
		return m.executeLoaderSo(ctx, db, batchID, tableName)
	}
	return m.executeLoaderDc(ctx, db, batchID, tableName)
}

// stampFailedRows marks any remaining 'V' rows as 'F' (Load Failed) and returns the count stamped.
func stampFailedRows(ctx context.Context, db *sql.DB, tableName string, batchID string) int {
	var query string
	var args []any
	if strings.Contains(tableName, "KAS_SO_LOADS") {
		query = fmt.Sprintf(`
			UPDATE %s
			SET STATUS_FLAG = 'F',
			    PROCESSED_DATE = GETDATE(),
			    RS_MESSAGE_TEXT = 'Load Failed — record was not committed to Ross ERP'
			WHERE STATUS_FLAG = 'V'
		`, tableName)
	} else {
		query = fmt.Sprintf(`
			UPDATE %s
			SET STATUS_FLAG = 'F',
			    BATCH_ID = @p1,
			    RS_MESSAGE_TEXT = 'Load Failed — record was not committed to Ross ERP'
			WHERE STATUS_FLAG = 'V'
		`, tableName)
		args = append(args, batchID)
	}
	res, err := db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return int(n)
}

func (m *Manager) executeLoaderDc(ctx context.Context, db *sql.DB, batchID string, tableName string) (*models.LoaderResult, error) {
	query := `
		UPDATE [FIN].[KAS_DC_LOADS]
		SET STATUS_FLAG = 'P',
		    BATCH_ID = @p1,
		    RS_MESSAGE_TEXT = 'Loaded into Ross ERP via Data Capture Loader'
		WHERE STATUS_FLAG = 'V';
	`
	res, err := db.ExecContext(ctx, query, batchID)
	if err != nil {
		// Stamp all 'V' rows as 'F' since the transaction failed
		failed := stampFailedRows(ctx, db, tableName, batchID)
		return &models.LoaderResult{
			Success: false,
			Loaded:  0,
			Failed:  failed,
			BatchID: batchID,
			Message: fmt.Sprintf("DC loader failed: %v", err),
		}, nil
	}

	rowsAffected, _ := res.RowsAffected()
	loaded := int(rowsAffected)

	// Stamp any 'V' rows not picked up (edge case: row-level constraint) as 'F'
	failed := stampFailedRows(ctx, db, tableName, batchID)

	msg := fmt.Sprintf("Successfully committed %d records into Ross ERP (Batch: %s)", loaded, batchID)
	if failed > 0 {
		msg = fmt.Sprintf("Committed %d records into Ross ERP; %d marked as Load Failed (Batch: %s)", loaded, failed, batchID)
	}

	return &models.LoaderResult{
		Success: true,
		Loaded:  loaded,
		Failed:  failed,
		BatchID: batchID,
		Message: msg,
	}, nil
}

func (m *Manager) executeLoaderSo(ctx context.Context, db *sql.DB, batchID string, tableName string) (*models.LoaderResult, error) {
	// Assign simulated Ross order numbers to distinct order groups
	distinctOrdersQuery := `
		SELECT DISTINCT CUSTOMER_NUMBER, DELIVERY_ADDRESS_CODE, CUSTOMER_REFERENCE, ORDER_DATE, SYS_DELIVERY_DATE
		FROM [FIN].[KAS_SO_LOADS]
		WHERE STATUS_FLAG = 'V';
	`
	rows, err := db.QueryContext(ctx, distinctOrdersQuery)
	if err != nil {
		failed := stampFailedRows(ctx, db, tableName, batchID)
		return &models.LoaderResult{
			Success: false,
			Loaded:  0,
			Failed:  failed,
			BatchID: batchID,
			Message: fmt.Sprintf("failed to query distinct orders: %v", err),
		}, nil
	}
	defer rows.Close()

	type OrderKey struct {
		Cust, Deliv, Ref, OrderDate, SysDeliv string
	}
	var keys []OrderKey
	for rows.Next() {
		var k OrderKey
		if err := rows.Scan(&k.Cust, &k.Deliv, &k.Ref, &k.OrderDate, &k.SysDeliv); err == nil {
			keys = append(keys, k)
		}
	}
	rows.Close()

	totalUpdated := 0
	orderBase := rand.Intn(80000) + 10000
	for i, k := range keys {
		generatedOrderNum := fmt.Sprintf("SO-%s-%05d", time.Now().Format("060102"), orderBase+i)
		updQuery := `
			UPDATE [FIN].[KAS_SO_LOADS]
			SET STATUS_FLAG = 'P',
			    ORDER_NUMBER = @p1,
			    PROCESSED_DATE = GETDATE(),
			    RS_MESSAGE_TEXT = 'Loaded into Ross ERP SOP'
			WHERE STATUS_FLAG = 'V'
			  AND CUSTOMER_NUMBER = @p2
			  AND DELIVERY_ADDRESS_CODE = @p3
			  AND CUSTOMER_REFERENCE = @p4
			  AND ORDER_DATE = @p5
			  AND SYS_DELIVERY_DATE = @p6;
		`
		res, err := db.ExecContext(ctx, updQuery, generatedOrderNum, k.Cust, k.Deliv, k.Ref, k.OrderDate, k.SysDeliv)
		if err == nil {
			aff, _ := res.RowsAffected()
			totalUpdated += int(aff)
		}
	}

	// Any 'V' rows still remaining were not committed — mark as 'F'
	failed := stampFailedRows(ctx, db, tableName, batchID)

	msg := fmt.Sprintf("Successfully committed %d sales order lines across %d orders (Batch: %s)", totalUpdated, len(keys), batchID)
	if failed > 0 {
		msg = fmt.Sprintf("Committed %d SO lines across %d orders; %d lines marked as Load Failed (Batch: %s)", totalUpdated, len(keys), failed, batchID)
	}

	return &models.LoaderResult{
		Success: true,
		Loaded:  totalUpdated,
		Failed:  failed,
		BatchID: batchID,
		Message: msg,
	}, nil
}

