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
 
EXEC sys.sp_addextendedproperty @name=N'MS_Description',
     @value=N'Staging table for Sales Order loads from CSV - separate from KAS_DC_LOADS',
     @level0type=N'SCHEMA', @level0name=N'FIN',
     @level1type=N'TABLE',  @level1name=N'KAS_SO_LOADS'
GO
