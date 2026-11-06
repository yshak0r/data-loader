package database

import (
	"context"
	"fmt"
)

const dcLoadsTableDDL = `
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'FIN')
BEGIN
    EXEC('CREATE SCHEMA [FIN]')
END

IF OBJECT_ID(N'[FIN].[KAS_DC_LOADS]', N'U') IS NULL
BEGIN
    CREATE TABLE [FIN].[KAS_DC_LOADS] (
        [GEM_DBKEY] [bigint] IDENTITY(1,1) NOT NULL,
        [COMPANY_CODE] [nvarchar](10) NOT NULL,
        [WAREHOUSE] [nvarchar](20) NOT NULL,
        [PART_CODE] [nvarchar](50) NULL,
        [IC_LOT_NUMBER] [nvarchar](50) NOT NULL,
        [BIN_LOCATION] [nvarchar](30) NOT NULL,
        [IC_STATUS_CODE] [nvarchar](10) NOT NULL,
        [CREATION_DATE] [nvarchar](30) NOT NULL,
        [BATCH_DATE] [nvarchar](30) NULL,
        [DC_LICENSE_PLATE_ID] [nvarchar](50) NOT NULL,
        [DC_PARENT_LICENSE_PLATE_ID] [nvarchar](50) NOT NULL,
        [UOM_1] [nvarchar](10) NULL,
        [QTY_1] [decimal](18, 4) NOT NULL,
        [UOM_2] [nvarchar](10) NULL,
        [QTY_2] [decimal](18, 4) NOT NULL,
        [STATUS_FLAG] [nvarchar](5) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_STATUS] DEFAULT (' '),
        [RS_MESSAGE_TEXT] [nvarchar](500) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_MSG] DEFAULT (''),
        [DC_LICENSE_PLATE_LINE] [int] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_LINE] DEFAULT (1),
        [UNIT_COST] [decimal](18, 4) NULL,
        [IC_VENDOR_LOT_NUMBER] [nvarchar](50) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_VEND_LOT] DEFAULT (''),
        [BEST_BEFORE_DATE] [nvarchar](30) NULL,
        [IC_RETEST_DATE] [nvarchar](30) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_RETEST] DEFAULT (''),
        [DATE_STAGED] [datetime2](7) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_DATE_STAGED] DEFAULT (SYSUTCDATETIME()),
        [BATCH_ID] [nvarchar](50) NULL,
        CONSTRAINT [PK_KAS_DC_LOADS] PRIMARY KEY CLUSTERED ([GEM_DBKEY] ASC)
    );

    CREATE NONCLUSTERED INDEX [IX_KAS_DC_LOADS_STATUS] ON [FIN].[KAS_DC_LOADS] ([STATUS_FLAG] ASC);
    CREATE NONCLUSTERED INDEX [IX_KAS_DC_LOADS_LPN] ON [FIN].[KAS_DC_LOADS] ([DC_LICENSE_PLATE_ID] ASC);
    CREATE NONCLUSTERED INDEX [IX_KAS_DC_LOADS_WH_PART] ON [FIN].[KAS_DC_LOADS] ([WAREHOUSE] ASC, [PART_CODE] ASC);
END
`

const soLoadsTableDDL = `
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'FIN')
BEGIN
    EXEC('CREATE SCHEMA [FIN]')
END

IF OBJECT_ID(N'[FIN].[KAS_SO_LOADS]', N'U') IS NULL
BEGIN
    CREATE TABLE [FIN].[KAS_SO_LOADS] (
        [GEM_DBKEY] [bigint] IDENTITY(1,1) NOT NULL,
        [COMPANY_CODE] [nvarchar](10) NOT NULL,
        [DIVISION] [nvarchar](10) NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_DIV] DEFAULT ('1'),
        [ORDER_DATE] [nvarchar](30) NOT NULL,
        [CUSTOMER_NUMBER] [nvarchar](30) NOT NULL,
        [DELIVERY_ADDRESS_CODE] [nvarchar](30) NOT NULL,
        [CUSTOMER_REFERENCE] [nvarchar](50) NOT NULL,
        [SYS_DELIVERY_DATE] [nvarchar](30) NOT NULL,
        [WAREHOUSE] [nvarchar](20) NOT NULL,
        [PART_CODE] [nvarchar](50) NOT NULL,
        [QUANTITY_1] [decimal](18, 4) NOT NULL,
        [UNIT_SALES] [nvarchar](10) NULL,
        [SALES_PRICE] [decimal](18, 4) NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_PRICE] DEFAULT (0),
        [FREIGHT] [decimal](18, 4) NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_FREIGHT] DEFAULT (0),
        [ORDER_LINE_NUMBER] [int] NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_LINE] DEFAULT (1),
        [ORDER_NUMBER] [nvarchar](30) NULL,
        [STATUS_FLAG] [nvarchar](5) NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_STATUS] DEFAULT (' '),
        [RS_MESSAGE_TEXT] [nvarchar](500) NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_MSG] DEFAULT (''),
        [DATE_STAGED] [datetime2](7) NOT NULL CONSTRAINT [DF_KAS_SO_LOADS_STAGED] DEFAULT (SYSUTCDATETIME()),
        [BATCH_ID] [nvarchar](50) NULL,
        CONSTRAINT [PK_KAS_SO_LOADS] PRIMARY KEY CLUSTERED ([GEM_DBKEY] ASC)
    );

    CREATE NONCLUSTERED INDEX [IX_KAS_SO_LOADS_STATUS] ON [FIN].[KAS_SO_LOADS] ([STATUS_FLAG] ASC);
    CREATE NONCLUSTERED INDEX [IX_KAS_SO_LOADS_CUST] ON [FIN].[KAS_SO_LOADS] ([CUSTOMER_NUMBER] ASC);
    CREATE NONCLUSTERED INDEX [IX_KAS_SO_LOADS_PO] ON [FIN].[KAS_SO_LOADS] ([CUSTOMER_REFERENCE] ASC);
    CREATE NONCLUSTERED INDEX [IX_KAS_SO_LOADS_WH_PART] ON [FIN].[KAS_SO_LOADS] ([WAREHOUSE] ASC, [PART_CODE] ASC);
END
`

// EnsureTableExists ensures the appropriate staging table exists idempotently.
func (m *Manager) EnsureTableExists(ctx context.Context, domain string) (bool, string) {
	db, _, err := m.GetDB()
	if err != nil {
		return false, err.Error()
	}

	ddl := dcLoadsTableDDL
	tableName := "[FIN].[KAS_DC_LOADS]"
	if domain == "sales_orders" {
		ddl = soLoadsTableDDL
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	if _, err := db.ExecContext(ctx, ddl); err != nil {
		return false, fmt.Sprintf("Failed to initialize staging table %s: %v", tableName, err)
	}

	return true, fmt.Sprintf("Staging table %s verified and ready.", tableName)
}

// ClearStagedData truncates the active staging table and reports count deleted.
func (m *Manager) ClearStagedData(ctx context.Context, domain string) (bool, int, string) {
	db, _, err := m.GetDB()
	if err != nil {
		return false, 0, err.Error()
	}

	tableName := "[FIN].[KAS_DC_LOADS]"
	if domain == "sales_orders" {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	// First count existing rows
	var count int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s", tableName)
	if err := db.QueryRowContext(ctx, countQuery).Scan(&count); err != nil {
		return false, 0, fmt.Sprintf("Failed to count rows before clearing: %v", err)
	}

	truncateQuery := fmt.Sprintf("TRUNCATE TABLE %s", tableName)
	if _, err := db.ExecContext(ctx, truncateQuery); err != nil {
		// Fallback to DELETE if TRUNCATE has permission restrictions
		deleteQuery := fmt.Sprintf("DELETE FROM %s", tableName)
		if _, delErr := db.ExecContext(ctx, deleteQuery); delErr != nil {
			return false, 0, fmt.Sprintf("Failed to clear staged table %s: %v", tableName, delErr)
		}
	}

	return true, count, fmt.Sprintf("Cleared %d staged records from %s", count, tableName)
}

