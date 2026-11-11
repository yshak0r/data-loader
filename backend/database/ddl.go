package database

import (
	"context"
	"fmt"
	"strings"
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

-- Create [FIN].[RS_UOM_CONVERSION] function if it does not exist
IF OBJECT_ID(N'[FIN].[RS_UOM_CONVERSION]', N'FN') IS NULL
BEGIN
    EXEC('
    CREATE FUNCTION [FIN].[RS_UOM_CONVERSION] 
    ( 
       @P_COMPANY_CODE VARCHAR(10), 
       @P_PROCUDT_CODE VARCHAR(15), 
       @P_UOM_FROM VARCHAR(4), 
       @P_UOM_TO VARCHAR(4), 
       @P_SOURCE_QUANTITY NUMERIC(20,8) 
    ) 
    RETURNS NUMERIC(20,8) 
    AS 
    BEGIN 
        DECLARE @RETURNVALUE NUMERIC(20,8); 
        DECLARE @CONVERSIONFACTOR NUMERIC(20,8); 
        DECLARE @CONVERSIONMETHOD VARCHAR(1); 
        SET @RETURNVALUE = -999999; 
         
        IF(@P_UOM_FROM = @P_UOM_TO) 
        BEGIN 
            SELECT @RETURNVALUE = @P_SOURCE_QUANTITY 
        END 
        ELSE 
        BEGIN 
            SELECT  
                @CONVERSIONFACTOR = UOM_CONVERSION_FACTOR, @CONVERSIONMETHOD = SYS_CONV_METHOD 
            FROM  
                PART_UOM_CONVERSIONS   
            WHERE  
                COMPANY_CODE = @P_COMPANY_CODE AND PART_CODE = @P_PROCUDT_CODE 
                AND UNIT_FROM = @P_UOM_FROM AND UNIT_TO = @P_UOM_TO;
     
            IF(@CONVERSIONMETHOD IS NOT NULL) 
            BEGIN 
                SELECT @RETURNVALUE = ( 
                    CASE WHEN @CONVERSIONMETHOD = ''D'' THEN @P_SOURCE_QUANTITY/@CONVERSIONFACTOR 
                         WHEN @CONVERSIONMETHOD = ''M'' THEN @P_SOURCE_QUANTITY*@CONVERSIONFACTOR END);				 
            END 
            ELSE 
            BEGIN 
                SELECT 
                    @CONVERSIONFACTOR = UOM_CONVERSION_FACTOR, @CONVERSIONMETHOD = SYS_CONV_METHOD 
                FROM 
                    PART_UOM_CONVERSIONS   
                WHERE  
                    COMPANY_CODE = @P_COMPANY_CODE AND PART_CODE = @P_PROCUDT_CODE 
                    AND UNIT_FROM = @P_UOM_TO AND UNIT_TO = @P_UOM_FROM;
     
                IF(@CONVERSIONMETHOD IS NOT NULL) 
                BEGIN 
                    SELECT @RETURNVALUE = ( 
                        CASE WHEN @CONVERSIONMETHOD = ''D'' THEN @P_SOURCE_QUANTITY*@CONVERSIONFACTOR   
                             WHEN @CONVERSIONMETHOD = ''M'' THEN @P_SOURCE_QUANTITY/@CONVERSIONFACTOR END); 
                END 
                ELSE 
                BEGIN 
                    SELECT  
                        @CONVERSIONFACTOR = UOM_CONVERSION_FACTOR, @CONVERSIONMETHOD = SYS_CONV_METHOD 
                    FROM 
                        PART_UOM_CONVERSIONS   
                    WHERE 
                        COMPANY_CODE <> @P_COMPANY_CODE AND PART_CODE <> @P_PROCUDT_CODE  
                        AND UNIT_FROM = @P_UOM_FROM AND UNIT_TO = @P_UOM_TO;
     
                    IF(@CONVERSIONMETHOD IS NOT NULL) 
                    BEGIN 
                        SELECT @RETURNVALUE = ( 
                            CASE WHEN @CONVERSIONMETHOD = ''D'' THEN @P_SOURCE_QUANTITY/@CONVERSIONFACTOR 
                                 WHEN @CONVERSIONMETHOD = ''M'' THEN @P_SOURCE_QUANTITY*@CONVERSIONFACTOR END); 
                    END							 
                    ELSE 
                    BEGIN 
                        SELECT  
                            @CONVERSIONFACTOR = UOM_CONVERSION_FACTOR, @CONVERSIONMETHOD = SYS_CONV_METHOD 
                        FROM 
                            PART_UOM_CONVERSIONS   
                        WHERE 
                            COMPANY_CODE <> @P_COMPANY_CODE AND PART_CODE <> @P_PROCUDT_CODE 
                            AND UNIT_FROM = @P_UOM_TO AND UNIT_TO = @P_UOM_FROM;
     
                        IF(@CONVERSIONMETHOD IS NOT NULL) 
                        BEGIN 
                            SELECT @RETURNVALUE = ( 
                                CASE WHEN @CONVERSIONMETHOD = ''D'' THEN @P_SOURCE_QUANTITY*@CONVERSIONFACTOR 
                                     WHEN @CONVERSIONMETHOD = ''M'' THEN @P_SOURCE_QUANTITY/@CONVERSIONFACTOR END); 
                        END; 
                    END; 
                END;													 
            END; 
        END; 
         
        RETURN @RETURNVALUE; 
    END
    ');
END
`

const soLoadsTableDDL = `
/** Object:  Table [FIN].[KAS_SO_LOADS]  Schema & Table Definition **/
-- Ensure schema FIN exists
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'FIN')
BEGIN
    EXEC('CREATE SCHEMA [FIN]')
END
GO
 
-- Create [FIN].[KAS_SO_LOADS] if not exists
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[FIN].[KAS_SO_LOADS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [FIN].[KAS_SO_LOADS](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [COMPANY_CODE] [varchar](10) NOT NULL,          -- no default: the CSV/import must supply it
        [DIVISION] [varchar](2) NOT NULL,               -- no default: the CSV/import must supply it
        [ORDER_NUMBER] [varchar](20) NULL,              -- filled by the loader
        [ORDER_LINE_NUMBER] [int] NULL,                 -- filled by the loader
        [ORDER_DATE] [datetime] NULL,
        [CUSTOMER_NUMBER] [varchar](8) NULL,
        [DELIVERY_ADDRESS_CODE] [varchar](10) NULL,
        [CUSTOMER_REFERENCE] [varchar](25) NULL,
        [SYS_DELIVERY_DATE] [datetime] NULL,
        [WAREHOUSE] [varchar](2) NULL,
        [PART_CODE] [varchar](15) NULL,
        [QUANTITY] [varchar](29) NULL,                  -- validator must check it is numeric before STATUS_FLAG = 'V'
        [SALES_PRICE] [decimal](18, 4) NULL,
        [UNIT_SALES] [varchar](10) NULL,                -- NOTE: the loaders use PRODUCT_MASTER.UNIT_SALES, not this column
        [FREIGHT] [decimal](18, 4) NULL,
        [STATUS_FLAG] [char](1) NULL CONSTRAINT [DF_KAS_SO_LOADS_STATUS_FLAG] DEFAULT ('N'),   -- N new, V validated, P processed
        [RS_MESSAGE_TEXT] [varchar](2000) NULL,
        [CREATED_DATE] [datetime] NULL CONSTRAINT [DF_KAS_SO_LOADS_CREATED_DATE] DEFAULT (getdate()),
        [PROCESSED_DATE] [datetime] NULL,
        [SOURCE_FILE] [varchar](260) NULL,              -- optional: CSV name, to spot a file loaded twice
        CONSTRAINT [PK_KAS_SO_LOADS] PRIMARY KEY CLUSTERED ([ID] ASC)
    );
END
ELSE
BEGIN
    -- Alter existing table to add any missing columns safely
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[FIN].[KAS_SO_LOADS]') AND name = 'SOURCE_FILE')
        ALTER TABLE [FIN].[KAS_SO_LOADS] ADD [SOURCE_FILE] [varchar](260) NULL;
 
    -- Widen RS_MESSAGE_TEXT to varchar(2000)
    IF EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[FIN].[KAS_SO_LOADS]')
          AND name = 'RS_MESSAGE_TEXT'
          AND (max_length < 2000 AND max_length > 0)
    )
        ALTER TABLE [FIN].[KAS_SO_LOADS] ALTER COLUMN [RS_MESSAGE_TEXT] [varchar](2000) NULL;
 
    -- Remove the old COMPANY_CODE / DIVISION defaults ('10' / '01') if they exist.
    -- Delete this block if you want to keep defaults (then use your real values).
    DECLARE @dropSql nvarchar(max) = N'';
    SELECT @dropSql += N'ALTER TABLE [FIN].[KAS_SO_LOADS] DROP CONSTRAINT [' + dc.name + N'];'
    FROM sys.default_constraints dc
    JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'[FIN].[KAS_SO_LOADS]')
      AND c.name IN ('COMPANY_CODE', 'DIVISION');
    IF @dropSql <> N'' EXEC(@dropSql);
END
GO
 
-- Indexes (the validator and the loaders filter on STATUS_FLAG)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_KAS_SO_LOADS_STATUS' AND object_id = OBJECT_ID(N'[FIN].[KAS_SO_LOADS]'))
    CREATE NONCLUSTERED INDEX [IX_KAS_SO_LOADS_STATUS] ON [FIN].[KAS_SO_LOADS] ([STATUS_FLAG])
        INCLUDE ([COMPANY_CODE], [DIVISION], [CUSTOMER_NUMBER], [CUSTOMER_REFERENCE]);
GO
 
-- Ensure synonym exists so unqualified references to KAS_SO_LOADS resolve properly
IF NOT EXISTS (SELECT * FROM sys.synonyms WHERE name = 'KAS_SO_LOADS')
   AND NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'KAS_SO_LOADS' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    BEGIN TRY
        EXEC('CREATE SYNONYM [dbo].[KAS_SO_LOADS] FOR [FIN].[KAS_SO_LOADS]');
    END TRY
    BEGIN CATCH
    END CATCH
END
`

// EnsureTableExists ensures the appropriate staging table exists idempotently.
func (m *Manager) EnsureTableExists(ctx context.Context, domain string) (bool, string) {
	return m.EnsureTableExistsWithScript(ctx, domain, "")
}

// EnsureTableExistsWithScript executes custom DDL if provided, or default DDL.
func (m *Manager) EnsureTableExistsWithScript(ctx context.Context, domain string, scriptContent string) (bool, string) {
	db, _, err := m.GetDB()
	if err != nil {
		return false, err.Error()
	}

	tableName := "[FIN].[KAS_DC_LOADS]"
	if domain == "sales_orders" {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	scriptToRun := scriptContent
	if strings.TrimSpace(scriptToRun) == "" {
		if domain == "sales_orders" {
			scriptToRun = soLoadsTableDDL
		} else {
			scriptToRun = dcLoadsTableDDL
		}
	}

	// Execute batches (splitting by GO if any)
	batches := SplitSqlBatches(scriptToRun)
	for i, b := range batches {
		trimmed := strings.TrimSpace(b)
		if trimmed == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, trimmed); err != nil {
			// If custom script failed, try default DDL as safety fallback
			if strings.TrimSpace(scriptContent) != "" {
				defaultDDL := dcLoadsTableDDL
				if domain == "sales_orders" {
					defaultDDL = soLoadsTableDDL
				}
				defaultBatches := SplitSqlBatches(defaultDDL)
				allDefOk := true
				for _, dbatch := range defaultBatches {
					dtrim := strings.TrimSpace(dbatch)
					if dtrim == "" {
						continue
					}
					if _, defErr := db.ExecContext(ctx, dtrim); defErr != nil {
						allDefOk = false
						break
					}
				}
				if allDefOk {
					return true, fmt.Sprintf("Staging table %s initialized using default DDL (custom script had error in batch %d: %v)", tableName, i+1, err)
				}
			}
			return false, fmt.Sprintf("Failed to initialize %s (batch %d): %v", tableName, i+1, err)
		}
	}

	return true, fmt.Sprintf("Staging table %s and dependencies verified and ready.", tableName)
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

