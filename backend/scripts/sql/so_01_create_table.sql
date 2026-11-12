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
