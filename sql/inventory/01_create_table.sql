/****** Object:  Table [FIN].[KAS_DC_LOADS]  Schema & Table Definition ******/
-- Ensure schema FIN exists
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'FIN')
BEGIN
    EXEC('CREATE SCHEMA [FIN]')
END
GO

-- Create [FIN].[KAS_DC_LOADS] if not exists
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [FIN].[KAS_DC_LOADS](
        [GEM_DBKEY] [int] IDENTITY(1,1) NOT NULL,
        [COMPANY_CODE] [varchar](10) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_COMPANY_CODE] DEFAULT (' '),
        [WAREHOUSE] [varchar](2) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_WAREHOUSE] DEFAULT (' '),
        [PART_CODE] [varchar](15) NULL,
        [IC_LOT_NUMBER] [varchar](20) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_IC_LOT_NUMBER] DEFAULT (' '),
        [BIN_LOCATION] [varchar](15) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_BIN_LOCATION] DEFAULT (' '),
        [IC_STATUS_CODE] [varchar](8) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_IC_STATUS_CODE] DEFAULT (' '),
        [CREATION_DATE] [datetime] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_CREATION_DATE] DEFAULT ('17-NOV-1858'),
        [BATCH_DATE] [datetime] NULL,
        [DC_LICENSE_PLATE_ID] [varchar](30) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_DC_LICENSE_PLATE_ID] DEFAULT (' '),
        [DC_PARENT_LICENSE_PLATE_ID] [varchar](30) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_DC_PARENT_LICENSE_PLATE_ID] DEFAULT (' '),
        [UOM_1] [varchar](4) NULL,
        [QTY_1] [numeric](20, 6) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_QTY_1] DEFAULT ((0)),
        [UOM_2] [varchar](4) NULL,
        [QTY_2] [numeric](20, 6) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_QTY_2] DEFAULT ((0)),
        [STATUS_FLAG] [varchar](1) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_STATUS_FLAG] DEFAULT (' '),
        [RS_MESSAGE_TEXT] [varchar](2000) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_RS_MESSAGE_TEXT] DEFAULT (' '),
        [DC_LICENSE_PLATE_LINE] [smallint] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_DC_LICENSE_PLATE_LINE] DEFAULT ((0)),
        [UNIT_COST] [numeric](20, 6) NULL,
        [IC_VENDOR_LOT_NUMBER] [varchar](20) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_IC_VENDOR_LOT_NUMBER] DEFAULT (' '),
        [BEST_BEFORE_DATE] [datetime] NULL,
        [IC_RETEST_DATE] [datetime] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_IC_RETEST_DATE] DEFAULT ('17-NOV-1858'),
        CONSTRAINT [PK_KAS_DC_LOADS] PRIMARY KEY CLUSTERED ([GEM_DBKEY] ASC)
    );

    CREATE NONCLUSTERED INDEX [IX_KAS_DC_LOADS_STATUS] ON [FIN].[KAS_DC_LOADS] ([STATUS_FLAG]) INCLUDE ([GEM_DBKEY], [PART_CODE], [DC_LICENSE_PLATE_ID]);
    CREATE NONCLUSTERED INDEX [IX_KAS_DC_LOADS_LPN] ON [FIN].[KAS_DC_LOADS] ([DC_LICENSE_PLATE_ID]);
    CREATE NONCLUSTERED INDEX [IX_KAS_DC_LOADS_PART_LOT] ON [FIN].[KAS_DC_LOADS] ([PART_CODE], [IC_LOT_NUMBER]);
END
ELSE
BEGIN
    -- Alter existing table to add any missing columns safely
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND name = 'DC_LICENSE_PLATE_LINE')
        ALTER TABLE [FIN].[KAS_DC_LOADS] ADD [DC_LICENSE_PLATE_LINE] [smallint] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_DC_LICENSE_PLATE_LINE] DEFAULT ((0));

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND name = 'UNIT_COST')
        ALTER TABLE [FIN].[KAS_DC_LOADS] ADD [UNIT_COST] [numeric](20, 6) NULL;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND name = 'IC_VENDOR_LOT_NUMBER')
        ALTER TABLE [FIN].[KAS_DC_LOADS] ADD [IC_VENDOR_LOT_NUMBER] [varchar](20) NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_IC_VENDOR_LOT_NUMBER] DEFAULT (' ');

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND name = 'BEST_BEFORE_DATE')
        ALTER TABLE [FIN].[KAS_DC_LOADS] ADD [BEST_BEFORE_DATE] [datetime] NULL;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND name = 'IC_RETEST_DATE')
        ALTER TABLE [FIN].[KAS_DC_LOADS] ADD [IC_RETEST_DATE] [datetime] NOT NULL CONSTRAINT [DF_KAS_DC_LOADS_IC_RETEST_DATE] DEFAULT ('17-NOV-1858');

    -- Ensure RS_MESSAGE_TEXT is varchar(2000) safely without constraint conflicts
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') 
          AND name = 'RS_MESSAGE_TEXT' 
          AND (max_length < 2000 AND max_length > 0)
    )
    BEGIN
        DECLARE @defConstraintName nvarchar(256);
        SELECT @defConstraintName = dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE dc.parent_object_id = OBJECT_ID(N'[FIN].[KAS_DC_LOADS]') AND c.name = 'RS_MESSAGE_TEXT';

        IF @defConstraintName IS NOT NULL
        BEGIN
            EXEC('ALTER TABLE [FIN].[KAS_DC_LOADS] DROP CONSTRAINT [' + @defConstraintName + ']');
        END

        ALTER TABLE [FIN].[KAS_DC_LOADS] ALTER COLUMN [RS_MESSAGE_TEXT] [varchar](2000) NOT NULL;
        ALTER TABLE [FIN].[KAS_DC_LOADS] ADD CONSTRAINT [DF_KAS_DC_LOADS_RS_MESSAGE_TEXT] DEFAULT (' ') FOR [RS_MESSAGE_TEXT];
    END
END
GO

-- Ensure synonym exists so unqualified references to KAS_DC_LOADS resolve properly
IF NOT EXISTS (SELECT * FROM sys.synonyms WHERE name = 'KAS_DC_LOADS')
   AND NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'KAS_DC_LOADS' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    BEGIN TRY
        EXEC('CREATE SYNONYM [dbo].[KAS_DC_LOADS] FOR [FIN].[KAS_DC_LOADS]');
    END TRY
    BEGIN CATCH
    END CATCH
END
GO

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
GO
