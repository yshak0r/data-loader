package scripts

// ============================================================================
// HARDCODED DEFAULT SQL SCRIPTS
// These scripts are embedded in the application binary and are in-use by default.
// Users can override any slot with their custom uploaded script.
// ============================================================================

// ----------------------------------------------------------------------------
// DC INVENTORY LOADER DEFAULT SCRIPTS
// ----------------------------------------------------------------------------

const DefaultDcCreateTableSQL = `
-- Ensure schema FIN exists
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'FIN')
BEGIN
    EXEC('CREATE SCHEMA [FIN]')
END

-- Create [FIN].[KAS_DC_LOADS] if not exists
IF OBJECT_ID(N'[FIN].[KAS_DC_LOADS]', N'U') IS NULL
BEGIN
    CREATE TABLE [FIN].[KAS_DC_LOADS] (
        [GEM_DBKEY] [bigint] IDENTITY(1,1) NOT NULL,
        [COMPANY_CODE] [nvarchar](10) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_CO] DEFAULT ('CORP'),
        [WAREHOUSE] [nvarchar](20) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_WH] DEFAULT (' '),
        [PART_CODE] [nvarchar](50) NULL,
        [IC_LOT_NUMBER] [nvarchar](50) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_LOT] DEFAULT (' '),
        [BIN_LOCATION] [nvarchar](30) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_BIN] DEFAULT (' '),
        [IC_STATUS_CODE] [nvarchar](10) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_STATUS_CODE] DEFAULT (' '),
        [CREATION_DATE] [nvarchar](30) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_CREATE_DT] DEFAULT ('17-NOV-1858'),
        [BATCH_DATE] [nvarchar](30) NULL,
        [DC_LICENSE_PLATE_ID] [nvarchar](50) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_LPN] DEFAULT (' '),
        [DC_PARENT_LICENSE_PLATE_ID] [nvarchar](50) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_PARENT_LPN] DEFAULT (' '),
        [UOM_1] [nvarchar](10) NULL,
        [QTY_1] [decimal](18, 4) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_QTY1] DEFAULT (0),
        [UOM_2] [nvarchar](10) NULL,
        [QTY_2] [decimal](18, 4) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_QTY2] DEFAULT (0),
        [STATUS_FLAG] [nvarchar](5) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_STATUS] DEFAULT (' '),
        [RS_MESSAGE_TEXT] [nvarchar](2000) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_MSG] DEFAULT (''),
        [DC_LICENSE_PLATE_LINE] [int] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_LINE] DEFAULT (1),
        [UNIT_COST] [decimal](18, 4) NULL,
        [IC_VENDOR_LOT_NUMBER] [nvarchar](50) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_VEND_LOT] DEFAULT (''),
        [BEST_BEFORE_DATE] [nvarchar](30) NULL,
        [IC_RETEST_DATE] [nvarchar](30) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_RETEST] DEFAULT ('17-NOV-1858'),
        [DATE_STAGED] [datetime2](7) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_STAGED] DEFAULT (SYSUTCDATETIME()),
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

const DefaultDcDryRunSQL = `
SET NOCOUNT ON;

-- Reset pending and previous error records to valid ('V') before validation
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'V', RS_MESSAGE_TEXT = ''
WHERE STATUS_FLAG IN (' ', 'E', 'F');

-- Rule 1: Missing Warehouse
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Warehouse' ELSE RS_MESSAGE_TEXT + '; Missing Warehouse' END
WHERE (WAREHOUSE IS NULL OR LTRIM(RTRIM(WAREHOUSE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- Rule 2: Missing Part Code
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Part Code' ELSE RS_MESSAGE_TEXT + '; Missing Part Code' END
WHERE (PART_CODE IS NULL OR LTRIM(RTRIM(PART_CODE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- Rule 3: Missing Lot Number
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Lot Number' ELSE RS_MESSAGE_TEXT + '; Missing Lot Number' END
WHERE (IC_LOT_NUMBER IS NULL OR LTRIM(RTRIM(IC_LOT_NUMBER)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- Rule 4: Missing Bin Location
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Bin Location' ELSE RS_MESSAGE_TEXT + '; Missing Bin Location' END
WHERE (BIN_LOCATION IS NULL OR LTRIM(RTRIM(BIN_LOCATION)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- Rule 5: Quantity must be greater than zero
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Quantity must be greater than 0' ELSE RS_MESSAGE_TEXT + '; Quantity must be greater than 0' END
WHERE QTY_1 <= 0 AND STATUS_FLAG NOT IN ('L', 'P');

-- Rule 6: Missing LPN ID
UPDATE [FIN].[KAS_DC_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing LPN ID' ELSE RS_MESSAGE_TEXT + '; Missing LPN ID' END
WHERE (DC_LICENSE_PLATE_ID IS NULL OR LTRIM(RTRIM(DC_LICENSE_PLATE_ID)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- Rule 7: Validate Warehouse against Ross ERP WAREHOUSE master if available
IF OBJECT_ID(N'WAREHOUSE', N'U') IS NOT NULL
BEGIN
    UPDATE t
    SET STATUS_FLAG = 'E',
        RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Invalid Warehouse Code' ELSE RS_MESSAGE_TEXT + '; Invalid Warehouse Code' END
    FROM [FIN].[KAS_DC_LOADS] t
    WHERE STATUS_FLAG NOT IN ('L', 'P')
      AND NOT EXISTS (SELECT 1 FROM WAREHOUSE w WHERE w.WAREHOUSE = t.WAREHOUSE);
END;

-- Rule 8: Validate Part Code against Ross ERP ITEM master if available
IF OBJECT_ID(N'ITEM', N'U') IS NOT NULL
BEGIN
    UPDATE t
    SET STATUS_FLAG = 'E',
        RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Invalid Part Code' ELSE RS_MESSAGE_TEXT + '; Invalid Part Code' END
    FROM [FIN].[KAS_DC_LOADS] t
    WHERE STATUS_FLAG NOT IN ('L', 'P')
      AND NOT EXISTS (SELECT 1 FROM ITEM i WHERE i.PART_CODE = t.PART_CODE);
END;
`

const DefaultDcLoaderSQL = `
SET NOCOUNT ON;

DECLARE @ValidCount INT;
SELECT @ValidCount = COUNT(*) FROM [FIN].[KAS_DC_LOADS] WHERE [STATUS_FLAG] = 'V';

IF @ValidCount = 0
BEGIN
    SELECT 
        0 AS [LoadedRecords],
        0 AS [FailedRecords],
        'NO_RECORDS' AS [BatchID],
        'No verified records with STATUS_FLAG = ''V'' ready for loading. Run Dry Run validation first.' AS [Message];
    RETURN;
END;

DECLARE @BatchID VARCHAR(30) = 'TX-' + FORMAT(GETDATE(), 'yyyyMMdd-HHmmss');
DECLARE @LoadedCount INT = 0;

BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE [FIN].[KAS_DC_LOADS]
    SET [STATUS_FLAG] = 'P',
        [BATCH_ID] = @BatchID,
        [BATCH_DATE] = FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss'),
        [RS_MESSAGE_TEXT] = 'Loaded into Ross ERP via Data Capture Loader (Batch ' + @BatchID + ')'
    WHERE [STATUS_FLAG] = 'V';

    SET @LoadedCount = @@ROWCOUNT;

    COMMIT TRANSACTION;

    SELECT
        @LoadedCount AS [LoadedRecords],
        0 AS [FailedRecords],
        @BatchID AS [BatchID],
        'Batch committed successfully: ' + CAST(@LoadedCount AS VARCHAR) + ' records loaded.' AS [Message];

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@ErrMsg, 16, 1);
END CATCH;
`

const DefaultDcCleanTablesSQL = `
-- Safely clean Ross ERP inventory records scoped to staged warehouses
IF OBJECT_ID(N'[FIN].[KAS_DC_LOADS]', N'U') IS NOT NULL
BEGIN
    DELETE FROM [FIN].[KAS_DC_LOADS];
END;
`

// ----------------------------------------------------------------------------
// SALES ORDERS LOADER DEFAULT SCRIPTS
// ----------------------------------------------------------------------------

const DefaultSoCreateTableSQL = `
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
GO
 
IF NOT EXISTS (
    SELECT 1 FROM sys.fn_listextendedproperty(N'MS_Description', N'SCHEMA', N'FIN', N'TABLE', N'KAS_SO_LOADS', NULL, NULL)
)
BEGIN
    EXEC sys.sp_addextendedproperty @name=N'MS_Description',
         @value=N'Staging table for Sales Order loads from CSV - separate from KAS_DC_LOADS',
         @level0type=N'SCHEMA', @level0name=N'FIN',
         @level1type=N'TABLE',  @level1name=N'KAS_SO_LOADS';
END
GO
`

const DefaultSoDryRunSQL = `
SET NOCOUNT ON;

-- 1. Reset pending and previous error records to valid ('V') before validation
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'V', RS_MESSAGE_TEXT = ''
WHERE STATUS_FLAG IN (' ', 'E', 'F');

-- 2. Validate Customer Number
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Customer Number' ELSE RS_MESSAGE_TEXT + '; Missing Customer Number' END
WHERE (CUSTOMER_NUMBER IS NULL OR LTRIM(RTRIM(CUSTOMER_NUMBER)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- 3. Validate Part Code
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Part Code' ELSE RS_MESSAGE_TEXT + '; Missing Part Code' END
WHERE (PART_CODE IS NULL OR LTRIM(RTRIM(PART_CODE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- 4. Validate Warehouse
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Warehouse' ELSE RS_MESSAGE_TEXT + '; Missing Warehouse' END
WHERE (WAREHOUSE IS NULL OR LTRIM(RTRIM(WAREHOUSE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- 5. Validate Quantity
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Quantity must be > 0' ELSE RS_MESSAGE_TEXT + '; Quantity must be > 0' END
WHERE (TRY_CAST(QUANTITY AS DECIMAL(18, 4)) IS NULL OR TRY_CAST(QUANTITY AS DECIMAL(18, 4)) <= 0) AND STATUS_FLAG NOT IN ('L', 'P');

-- 6. Validate Sales Price
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Sales Price cannot be negative' ELSE RS_MESSAGE_TEXT + '; Sales Price cannot be negative' END
WHERE SALES_PRICE < 0 AND STATUS_FLAG NOT IN ('L', 'P');

-- 7. Validate Customer Reference (PO#)
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Customer Reference (PO#)' ELSE RS_MESSAGE_TEXT + '; Missing Customer Reference (PO#)' END
WHERE (CUSTOMER_REFERENCE IS NULL OR LTRIM(RTRIM(CUSTOMER_REFERENCE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- 8. Validate Order Date
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Order Date' ELSE RS_MESSAGE_TEXT + '; Missing Order Date' END
WHERE (ORDER_DATE IS NULL OR LTRIM(RTRIM(ORDER_DATE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- 9. Validate Requested Delivery Date
UPDATE [FIN].[KAS_SO_LOADS]
SET STATUS_FLAG = 'E',
    RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Missing Delivery Date' ELSE RS_MESSAGE_TEXT + '; Missing Delivery Date' END
WHERE (SYS_DELIVERY_DATE IS NULL OR LTRIM(RTRIM(SYS_DELIVERY_DATE)) = '') AND STATUS_FLAG NOT IN ('L', 'P');

-- 10. Ross ERP Customer master check (if CUSTOMER table exists)
IF OBJECT_ID(N'CUSTOMER', N'U') IS NOT NULL
BEGIN
    UPDATE t
    SET STATUS_FLAG = 'E',
        RS_MESSAGE_TEXT = CASE WHEN RS_MESSAGE_TEXT = '' THEN 'Customer does not exist in Ross ERP' ELSE RS_MESSAGE_TEXT + '; Customer does not exist in Ross ERP' END
    FROM [FIN].[KAS_SO_LOADS] t
    WHERE STATUS_FLAG NOT IN ('L', 'P')
      AND NOT EXISTS (SELECT 1 FROM CUSTOMER c WHERE c.CUSTOMER = t.CUSTOMER_NUMBER);
END;
`

const DefaultSoLoaderSQL = `
SET NOCOUNT ON;

DECLARE @ValidCount INT;
SELECT @ValidCount = COUNT(*) FROM [FIN].[KAS_SO_LOADS] WHERE [STATUS_FLAG] = 'V';

IF @ValidCount = 0
BEGIN
    SELECT 
        0 AS [LoadedRecords],
        0 AS [FailedRecords],
        'NO_RECORDS' AS [BatchID],
        'No verified records with STATUS_FLAG = ''V'' ready for loading. Run Dry Run validation first.' AS [Message];
    RETURN;
END;

DECLARE @BatchID VARCHAR(30) = 'SO-TX-' + FORMAT(GETDATE(), 'yyyyMMdd-HHmmss');
DECLARE @LoadedCount INT = 0;

BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE [FIN].[KAS_SO_LOADS]
    SET [STATUS_FLAG] = 'P',
        [PROCESSED_DATE] = GETDATE(),
        [ORDER_NUMBER] = ISNULL(NULLIF(ORDER_NUMBER, ''), 'SO-' + FORMAT(GETDATE(), 'yyMMdd') + '-' + RIGHT('0000' + CAST(ID AS VARCHAR(10)), 5)),
        [RS_MESSAGE_TEXT] = 'Loaded into Ross ERP SOP (Batch ' + @BatchID + ')'
    WHERE [STATUS_FLAG] = 'V';

    SET @LoadedCount = @@ROWCOUNT;

    COMMIT TRANSACTION;

    SELECT
        @LoadedCount AS [LoadedRecords],
        0 AS [FailedRecords],
        @BatchID AS [BatchID],
        'Batch committed successfully: ' + CAST(@LoadedCount AS VARCHAR) + ' sales order records loaded.' AS [Message];

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@ErrMsg, 16, 1);
END CATCH;
`

const DefaultSoCleanTablesSQL = `
-- Safely clean staged sales orders from [FIN].[KAS_SO_LOADS]
IF OBJECT_ID(N'[FIN].[KAS_SO_LOADS]', N'U') IS NOT NULL
BEGIN
    DELETE FROM [FIN].[KAS_SO_LOADS];
END;
`

