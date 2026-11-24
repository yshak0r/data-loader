IF OBJECT_ID(N'FIN.KAS_SO_EXPORT_LOADS', N'U') IS NULL
BEGIN
    CREATE TABLE FIN.KAS_SO_EXPORT_LOADS
    (
        ID                          INT IDENTITY(1,1) PRIMARY KEY,

        COMPANY_CODE                VARCHAR(10)      NULL,
        DIVISION                    VARCHAR(2)       NULL,
        ORDER_NUMBER                VARCHAR(9)       NULL,

        SYS_TRANS_TERM_CODE         VARCHAR(20)      NULL,
        SYS_NBR_OF_CONTAINERS       DECIMAL(10,0)    NULL,
        SYS_CONTAINER_TYPE          VARCHAR(20)      NULL,
        SYS_CONTAINER_SIZE          VARCHAR(20)      NULL,
        SYS_MOT_CODE                VARCHAR(20)      NULL,
        SYS_INCOTERM_CODE           VARCHAR(20)      NULL,
        SYS_INCOTERM_CITY           VARCHAR(60)      NULL,

        SYS_SIGNATORY_NAME          VARCHAR(60)      NULL,
        SYS_LC_NUMBER               VARCHAR(40)      NULL,
        SYS_CARRIER_ADVICE_NUMBER   VARCHAR(40)      NULL,
        SYS_INSPECTION_NUMBER       VARCHAR(40)      NULL,
        SYS_SHIPPING_LINE           VARCHAR(60)      NULL,
        SYS_INSUR_CERT_NUMBER       VARCHAR(40)      NULL,
        SYS_CUSTOMS_REF_STATUS      VARCHAR(40)      NULL,

        SYS_EXPORT_EXIT_PORT        VARCHAR(60)      NULL,
        SYS_EXPORT_DEST_PORT        VARCHAR(60)      NULL,
        SYS_EXPORT_ADDL_INFO_1      VARCHAR(100)     NULL,
        SYS_EXPORT_ADDL_INFO_2      VARCHAR(100)     NULL,

        SYS_FRT_FORWARDER_NBR       VARCHAR(40)      NULL,
        SYS_BOOKING_NUMBER          VARCHAR(40)      NULL,
        SYS_VESSEL_NAME             VARCHAR(60)      NULL,
        SYS_VOYAGE_NUMBER           VARCHAR(40)      NULL,
        SYS_CONTAINER_NUMBER        VARCHAR(40)      NULL,

        SYS_SAIL_DATE               DATETIME         NULL,
        SYS_RAIL_DATE               DATETIME         NULL,
        SYS_CUT_OFF_DATE            DATETIME         NULL,
        SYS_LAYCAN_FROM_DATE        DATETIME         NULL,
        SYS_LAYCAN_TO_DATE          DATETIME         NULL,

        SYS_EXPORT_NOTE_TYPE        VARCHAR(20)      NULL,
        SYS_EXPORT_NOTE_CODE        VARCHAR(20)      NULL,
        SYS_EXPORT_NOTES            VARCHAR(MAX)     NULL,

        -- Result columns (same meaning as on KAS_SO_LOADS)
        STATUS_FLAG                 VARCHAR(1)       NULL,
        RS_MESSAGE_TEXT             VARCHAR(500)     NULL,
        PROCESSED_DATE              DATETIME         NULL
    );
END;
GO