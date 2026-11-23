package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"

	"dc-loader-wails/backend/models"
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
/** Object: Table [FIN].[KAS_SO_LOADS] **/

SET ANSI_NULLS ON;
GO

SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'[FIN].[KAS_SO_LOADS]', N'U') IS NULL
BEGIN

    CREATE TABLE [FIN].[KAS_SO_LOADS]
    (
        [ID] [int] IDENTITY(1,1) NOT NULL,

        [COMPANY_CODE] [varchar](10) NOT NULL,
        [DIVISION] [varchar](2) NOT NULL,

        [ORDER_NUMBER] [varchar](20) NULL,
        [ORDER_LINE_NUMBER] [int] NULL,
        [ORDER_DATE] [datetime] NULL,

        [CUSTOMER_NUMBER] [varchar](8) NULL,
        [DELIVERY_ADDRESS_CODE] [varchar](10) NULL,
        [CUSTOMER_REFERENCE] [varchar](25) NULL,
		[EDI_ORDER] [char](1) NULL,

        [SYS_DELIVERY_DATE] [datetime] NULL,
        [WAREHOUSE] [varchar](2) NULL,

        [PART_CODE] [varchar](15) NULL,
        [QUANTITY] [decimal](18,4) NULL,

        [SALES_PRICE] [decimal](18,4) NULL,
        [UNIT_SALES] [varchar](10) NULL,
        [FREIGHT] [decimal](18,4) NULL,

        [STATUS_FLAG] [char](1) NULL,
        [RS_MESSAGE_TEXT] [varchar](500) NULL,

        [CREATED_DATE] [datetime] NULL,
        [PROCESSED_DATE] [datetime] NULL,

        CONSTRAINT [PK_KAS_SO_LOADS]
        PRIMARY KEY CLUSTERED
        (
            [ID] ASC
        )
        WITH
        (
            STATISTICS_NORECOMPUTE = OFF,
            IGNORE_DUP_KEY = OFF,
            OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF
        )
        ON [PRIMARY]

    ) ON [PRIMARY];

    PRINT 'Table FIN.KAS_SO_LOADS created successfully.';

END
ELSE
BEGIN

    PRINT 'Table FIN.KAS_SO_LOADS already exists. No changes made.';

END;
GO
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
					InvalidateSchemaCache(domain)
					return true, fmt.Sprintf("Staging table %s initialized using default DDL (custom script had error in batch %d: %v)", tableName, i+1, err)
				}
			}
			return false, fmt.Sprintf("Failed to initialize %s (batch %d): %v", tableName, i+1, err)
		}
	}

	InvalidateSchemaCache(domain)
	return true, fmt.Sprintf("Staging table %s and dependencies verified and ready.", tableName)
}

// DropStagingTable drops the physical staging table and invalidates the cached schema.
func (m *Manager) DropStagingTable(ctx context.Context, domain string) (bool, string) {
	db, _, err := m.GetDB()
	if err != nil {
		return false, err.Error()
	}

	tableName := "[FIN].[KAS_DC_LOADS]"
	if domain == "sales_orders" {
		tableName = "[FIN].[KAS_SO_LOADS]"
	}

	dropSQL := fmt.Sprintf("IF OBJECT_ID('%s', 'U') IS NOT NULL DROP TABLE %s;", tableName, tableName)
	if _, err := db.ExecContext(ctx, dropSQL); err != nil {
		return false, fmt.Sprintf("Failed to drop table %s: %v", tableName, err)
	}

	InvalidateSchemaCache(domain)
	return true, fmt.Sprintf("Staging table %s dropped successfully.", tableName)
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

// ListStagingTables returns all staging and custom user tables from SQL Server.
func (m *Manager) ListStagingTables(ctx context.Context) ([]models.StagingTableInfo, error) {
	db, _, err := m.GetDB()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT 
			s.name AS schema_name, 
			t.name AS table_name,
			QUOTENAME(s.name) + '.' + QUOTENAME(t.name) AS full_name,
			CAST(ISNULL(p.rows, 0) AS BIGINT) AS row_count,
			CONVERT(VARCHAR(19), t.create_date, 120) AS create_date,
			CASE WHEN col_status.column_id IS NOT NULL THEN 1 ELSE 0 END AS has_status_flag
		FROM (
			SELECT object_id, schema_id, name, create_date, 'U' AS type, is_ms_shipped FROM sys.tables
			UNION ALL
			SELECT object_id, schema_id, name, create_date, 'V' AS type, is_ms_shipped FROM sys.views
		) t
		JOIN sys.schemas s ON t.schema_id = s.schema_id
		LEFT JOIN (
			SELECT object_id, SUM(CAST(rows AS BIGINT)) AS rows 
			FROM sys.partitions 
			WHERE index_id IN (0, 1) 
			GROUP BY object_id
		) p ON t.object_id = p.object_id
		LEFT JOIN sys.columns col_status ON t.object_id = col_status.object_id AND col_status.name = 'STATUS_FLAG'
		WHERE (t.is_ms_shipped = 0 OR s.name NOT IN ('sys', 'INFORMATION_SCHEMA'))
		  AND t.name NOT IN ('sysdiagrams', 'syssegments', 'sysconstraints')
		  AND s.name NOT IN (
			'sys', 'INFORMATION_SCHEMA', 'guest', 'cdc',
			'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
			'db_backupoperator', 'db_datareader', 'db_datawriter',
			'db_denydatareader', 'db_denydatawriter'
		  )
		ORDER BY 
			CASE 
				WHEN t.name = 'KAS_DC_LOADS' THEN 1
				WHEN t.name = 'KAS_SO_LOADS' THEN 2
				ELSE 3
			END ASC,
			s.name ASC, 
			t.name ASC;
	`

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query staging tables: %w", err)
	}
	defer rows.Close()

	var tables []models.StagingTableInfo
	foundDc := false
	foundSo := false

	for rows.Next() {
		var (
			schemaName string
			tableName  string
			fullName   sql.NullString
			rowCount   sql.NullInt64
			createDate sql.NullString
			hasStatus  sql.NullInt64
		)
		if err := rows.Scan(&schemaName, &tableName, &fullName, &rowCount, &createDate, &hasStatus); err != nil {
			log.Printf("[ListStagingTables] scan warning for row: %v", err)
			continue
		}

		resolvedFullName := fullName.String
		if resolvedFullName == "" {
			resolvedFullName = fmt.Sprintf("[%s].[%s]", schemaName, tableName)
		}

		item := models.StagingTableInfo{
			SchemaName:    schemaName,
			TableName:     tableName,
			FullName:      resolvedFullName,
			RowCount:      int(rowCount.Int64),
			CreateDate:    createDate.String,
			HasStatusFlag: (hasStatus.Int64 == 1),
		}

		if strings.EqualFold(item.TableName, "KAS_DC_LOADS") {
			item.IsStandard = true
			foundDc = true
		} else if strings.EqualFold(item.TableName, "KAS_SO_LOADS") {
			item.IsStandard = true
			foundSo = true
		} else {
			item.IsStandard = false
		}

		tables = append(tables, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("[ListStagingTables] rows iteration error: %v", err)
		return nil, fmt.Errorf("error reading staging tables: %w", err)
	}

	// Always ensure standard staging tables are present in the catalog
	if !foundDc {
		tables = append([]models.StagingTableInfo{{
			SchemaName:    "FIN",
			TableName:     "KAS_DC_LOADS",
			FullName:      "[FIN].[KAS_DC_LOADS]",
			RowCount:      0,
			IsStandard:    true,
			HasStatusFlag: true,
			CreateDate:    "",
		}}, tables...)
	}
	if !foundSo {
		insertIdx := 0
		if len(tables) > 0 && tables[0].TableName == "KAS_DC_LOADS" {
			insertIdx = 1
		}
		tables = append(tables[:insertIdx], append([]models.StagingTableInfo{{
			SchemaName:    "FIN",
			TableName:     "KAS_SO_LOADS",
			FullName:      "[FIN].[KAS_SO_LOADS]",
			RowCount:      0,
			IsStandard:    true,
			HasStatusFlag: true,
			CreateDate:    "",
		}}, tables[insertIdx:]...)...)
	}

	return tables, nil
}

// ExecuteCustomDDL executes an arbitrary custom DDL SQL script (e.g. creating tables/indexes/triggers).
func (m *Manager) ExecuteCustomDDL(ctx context.Context, script string) (bool, string) {
	db, _, err := m.GetDB()
	if err != nil {
		return false, err.Error()
	}

	if strings.TrimSpace(script) == "" {
		return false, "Script content is empty."
	}

	batches := SplitSqlBatches(script)
	for i, b := range batches {
		trimmed := strings.TrimSpace(b)
		if trimmed == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, trimmed); err != nil {
			return false, fmt.Sprintf("Execution failed at batch %d: %v", i+1, err)
		}
	}

	InvalidateSchemaCache("")
	return true, "SQL script executed successfully."
}

// DropTable drops any staging or custom table safely.
func (m *Manager) DropTable(ctx context.Context, targetTable string) (bool, string) {
	db, _, err := m.GetDB()
	if err != nil {
		return false, err.Error()
	}

	fullName, _ := ResolveTableName("", targetTable)
	dropSQL := fmt.Sprintf("IF OBJECT_ID('%s', 'U') IS NOT NULL DROP TABLE %s;", fullName, fullName)
	if _, err := db.ExecContext(ctx, dropSQL); err != nil {
		return false, fmt.Sprintf("Failed to drop table %s: %v", fullName, err)
	}

	InvalidateSchemaCache("")
	return true, fmt.Sprintf("Table %s dropped successfully.", fullName)
}

