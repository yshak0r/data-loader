/* ============================================================================
   COMPLETE LOADER - RECORD-LEVEL TRACKING, PER-RECORD TRANSACTIONS
   ----------------------------------------------------------------------------
   Source : KAS_DC_LOADS rows with STATUS_FLAG = 'V' in DATA_CAPTURE_IN_USE warehouses
   Tracker: #LOAD_TRACK (temp table, one row per source record, one column per
            target table). Column values:
              NOT_REQUIRED  table does not apply to this record
              PENDING       required, not finished yet
              SUCCESS       inserted/updated and verified, record committed
              FAILED        this is the insert/update that raised the error
              ROLLED_BACK   succeeded inside the transaction, then undone
              NOT_ATTEMPTED required, but never reached (earlier step failed)

   Each source record is processed in its OWN transaction (TRY/CATCH):
     - all target tables succeed + verification passes -> KAS_DC_LOADS 'P' / 'Populated'
     - any failure -> ROLLBACK of that record only -> 'F' / 'Failed to populate due to: ...'
   Records are processed one at a time, so a failure never touches other records.

   This is ONE batch on purpose (no GO): variables and the table variable that
   survives ROLLBACK must live across the whole run.
   ========================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- ---------------------------------------------------------------------------
-- 0. Assign unique line numbers per plate in the staging table
--    (offset by the lines the plate already has, so a re-run after a partial load cannot collide)
-- ---------------------------------------------------------------------------
WITH N AS (
    SELECT s.DC_LICENSE_PLATE_LINE,
           ROW_NUMBER() OVER (
               PARTITION BY s.COMPANY_CODE, s.DC_LICENSE_PLATE_ID
               ORDER BY s.GEM_DBKEY
           )
           -- continue after the lines this plate already has (e.g. populated by an earlier run),
           -- so re-loading only the failed rows never reuses a line number
           + ISNULL((SELECT MAX(L.DC_LICENSE_PLATE_LINE)
                     FROM DC_LICENSE_PLATE_LINES L
                     WHERE L.COMPANY_CODE = s.COMPANY_CODE
                       AND L.DC_LICENSE_PLATE_ID = s.DC_LICENSE_PLATE_ID), 0) AS rn
    FROM KAS_DC_LOADS s
    WHERE s.STATUS_FLAG = 'V'
      AND s.WAREHOUSE IN (SELECT WC.WAREHOUSE
                          FROM WAREHOUSE_CONTROLS WC
                          WHERE WC.DATA_CAPTURE_IN_USE = 'Y')
)
UPDATE N SET DC_LICENSE_PLATE_LINE = rn;

-- ---------------------------------------------------------------------------
-- 1. Constants / variables
-- ---------------------------------------------------------------------------
DECLARE @Q_SOURCE_MODULE   VARCHAR(10) = 'IC';   
DECLARE @Q_LINE_TYPE       VARCHAR(10) = 'R';
DECLARE @Q_RECORD_TYPE     VARCHAR(10) = 'R';
DECLARE @Q_ADJ_TYPE        VARCHAR(10) = 'R';
DECLARE @Q_ALL_WAREHOUSES  VARCHAR(50) = '**';

DECLARE @Q_COMPANY_CODE  VARCHAR(50);
DECLARE @Q_STATUS_CODE   VARCHAR(10);
DECLARE @Q_PART_CODE     VARCHAR(100);
DECLARE @Q_LOT_NUMBER    VARCHAR(100);
DECLARE @Q_TTYPE         VARCHAR(50);
DECLARE @Q_COUNTER       BIGINT;
DECLARE @Q_CANDIDATE     VARCHAR(100);
DECLARE @Q_MANUAL_FLAG   VARCHAR(20);
DECLARE @Q_ROW_COUNT     INT;
DECLARE @Q_ATTEMPTS      INT;
DECLARE @Q_DOC_NBR       VARCHAR(100);
DECLARE @Q_LINE_NBR      INT;
DECLARE @Q_FIRST_LINE    INT;
DECLARE @Q_NEW_DOC       BIT;
DECLARE @Q_NEW_LINE      BIT;
-- FIX 1: ONE derivation of the original-document reference, used by all three tables
DECLARE @Q_ORIG_DOC_NBR  VARCHAR(30);          -- ORIGINAL_DOCUMENT_NUMBER (same value in header, plate line, plate line detail)
DECLARE @Q_ORIG_DOC_LINE VARCHAR(30);          -- ORIGINAL_DOCUMENT_LINE
DECLARE @Q_ORIG_DOC_SEQ  INT = 0;              -- ORIGINAL_DOCUMENT_SEQUENCE
-- FIX 2: tolerance for quantity comparisons (rounding to the column scale)
DECLARE @QtyTol          DECIMAL(28,10) = 0.0001;

DECLARE @Cat          VARCHAR(2);
DECLARE @HasBin       BIT;
DECLARE @HasLot       BIT;
DECLARE @NeedQuality  BIT;
DECLARE @Step         SYSNAME;
DECLARE @FailStep     SYSNAME;
DECLARE @Bad          SYSNAME;
DECLARE @Committed    BIT;
DECLARE @ErrNum       INT;
DECLARE @ErrLine      INT;
DECLARE @ErrMsg       NVARCHAR(4000);
DECLARE @FullMsg      NVARCHAR(4000);
DECLARE @VMsg         NVARCHAR(2048);
DECLARE @MsgMax       INT;
DECLARE @Seq          INT = 0;     -- position of the record being processed
DECLARE @NextSeq      INT;

-- Survive ROLLBACK (unlike temp tables): in-flight progress of the current record
DECLARE @Steps TABLE (TBL SYSNAME NOT NULL PRIMARY KEY);
DECLARE @Chk   TABLE (TBL SYSNAME NOT NULL PRIMARY KEY, FOUND BIT NOT NULL);

-- Respect the real size of KAS_DC_LOADS.RS_MESSAGE_TEXT (full text also kept in #LOAD_TRACK)
SELECT @MsgMax = CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'KAS_DC_LOADS' AND COLUMN_NAME = 'RS_MESSAGE_TEXT';
IF @MsgMax IS NULL OR @MsgMax = -1 OR @MsgMax > 4000 SET @MsgMax = 4000;

-- ---------------------------------------------------------------------------
-- 2. Tracking table  (types of key columns are cloned from the source table)
-- ---------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#LOAD_TRACK') IS NOT NULL DROP TABLE #LOAD_TRACK;

SELECT TOP (0)
       ISNULL(K.GEM_DBKEY, K.GEM_DBKEY) AS GEM_DBKEY,   -- ISNULL() so an IDENTITY property is not copied
       K.COMPANY_CODE, K.DC_LICENSE_PLATE_ID, K.DC_LICENSE_PLATE_LINE,
       K.WAREHOUSE, K.PART_CODE, K.IC_LOT_NUMBER, K.IC_STATUS_CODE
INTO #LOAD_TRACK
FROM KAS_DC_LOADS K;

ALTER TABLE #LOAD_TRACK ADD
    SEQ              INT NULL,            -- processing order (set below)
    PRODUCT_CATEGORY VARCHAR(2) NULL,     -- SN = standard/non-packaged, SP = standard/packaged, PN = potency/non-packaged
    DC_LICENSE_PLATES VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    DC_LICENSE_PLATE_LINES VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    IC_BIN_DETAIL_STATUS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    IC_LOT_STATUS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    IC_PRODUCT_STATUS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    PART_BATCHES VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    BIN_LOCATION_DETAILS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    DC_LICENSE_PLATE_LINE_DETAILS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    IC_QUALITY_DOCS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    IC_QUALITY_DOC_LINES VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    IC_QUALITY_DOC_LINE_DETAILS VARCHAR(15) NOT NULL DEFAULT 'NOT_REQUIRED',
    FINAL_STATUS     VARCHAR(1)    NULL,  -- 'P' / 'F'
    FAIL_TABLE       SYSNAME       NULL,
    ERROR_NUMBER     INT           NULL,
    ERROR_LINE       INT           NULL,
    ERROR_MESSAGE    NVARCHAR(4000) NULL,
    PROCESSED_AT     DATETIME2     NULL;

INSERT INTO #LOAD_TRACK
    (GEM_DBKEY, COMPANY_CODE, DC_LICENSE_PLATE_ID, DC_LICENSE_PLATE_LINE, WAREHOUSE,
     PART_CODE, IC_LOT_NUMBER, IC_STATUS_CODE, PRODUCT_CATEGORY, DC_LICENSE_PLATES, DC_LICENSE_PLATE_LINES, IC_BIN_DETAIL_STATUS, IC_LOT_STATUS, IC_PRODUCT_STATUS, PART_BATCHES, BIN_LOCATION_DETAILS, DC_LICENSE_PLATE_LINE_DETAILS, IC_QUALITY_DOCS, IC_QUALITY_DOC_LINES, IC_QUALITY_DOC_LINE_DETAILS)
SELECT K.GEM_DBKEY, K.COMPANY_CODE, K.DC_LICENSE_PLATE_ID, K.DC_LICENSE_PLATE_LINE, K.WAREHOUSE,
       K.PART_CODE, K.IC_LOT_NUMBER, K.IC_STATUS_CODE, X.CAT,
       CASE WHEN X.CAT IS NULL THEN 'NOT_ATTEMPTED' ELSE 'PENDING' END,                                   -- DC_LICENSE_PLATES
       CASE WHEN X.CAT IS NULL THEN 'NOT_ATTEMPTED' ELSE 'PENDING' END,                                   -- DC_LICENSE_PLATE_LINES
       CASE WHEN X.CAT IS NOT NULL AND ISNULL(K.BIN_LOCATION,'')   <> '' THEN 'PENDING' ELSE 'NOT_REQUIRED' END,  -- IC_BIN_DETAIL_STATUS
       CASE WHEN X.CAT IS NOT NULL AND ISNULL(K.IC_LOT_NUMBER,'')  <> '' THEN 'PENDING' ELSE 'NOT_REQUIRED' END,  -- IC_LOT_STATUS
       CASE WHEN X.CAT IS NOT NULL THEN 'PENDING' ELSE 'NOT_REQUIRED' END,                                -- IC_PRODUCT_STATUS
       CASE WHEN X.CAT IS NOT NULL AND ISNULL(K.IC_LOT_NUMBER,'')  <> '' THEN 'PENDING' ELSE 'NOT_REQUIRED' END,  -- PART_BATCHES
       CASE WHEN X.CAT IS NOT NULL AND ISNULL(K.BIN_LOCATION,'')   <> '' THEN 'PENDING' ELSE 'NOT_REQUIRED' END,  -- BIN_LOCATION_DETAILS
       Q.QREQ, Q.QREQ, Q.QREQ, Q.QREQ   -- DC_LICENSE_PLATE_LINE_DETAILS, IC_QUALITY_DOCS, IC_QUALITY_DOC_LINES, IC_QUALITY_DOC_LINE_DETAILS
FROM KAS_DC_LOADS K
LEFT JOIN PRODUCT_MASTER PM ON PM.PART_CODE = K.PART_CODE
CROSS APPLY (SELECT CASE WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S' AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'SN'
                         WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S' AND PM.IC_PACKAGED_PRODUCT = 'Y' THEN 'SP'
                         WHEN PM.IC_PRODUCT_UOM_CONTROL = 'P' AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'PN'
                    END AS CAT) X
CROSS APPLY (SELECT CASE WHEN X.CAT IS NOT NULL
                          AND K.IC_STATUS_CODE IN ('QC','QR','CQC')
                          AND NOT EXISTS (SELECT 1 FROM DC_LICENSE_PLATE_LINE_DETAILS d
                                          WHERE d.COMPANY_CODE = K.COMPANY_CODE
                                            AND d.DC_LICENSE_PLATE_ID = K.DC_LICENSE_PLATE_ID
                                            AND d.DC_LICENSE_PLATE_LINE = K.DC_LICENSE_PLATE_LINE)
                         THEN 'PENDING' ELSE 'NOT_REQUIRED' END AS QREQ) Q
WHERE K.STATUS_FLAG = 'V'
  AND K.WAREHOUSE IN (SELECT WC.WAREHOUSE FROM WAREHOUSE_CONTROLS WC WHERE WC.DATA_CAPTURE_IN_USE = 'Y');

-- GEM_DBKEY identifies each record everywhere below: it must exist and be unique
IF EXISTS (SELECT 1 FROM #LOAD_TRACK WHERE GEM_DBKEY IS NULL)
    THROW 51050, 'KAS_DC_LOADS has rows with a NULL GEM_DBKEY. The loader identifies records by GEM_DBKEY, so fix those rows first.', 1;
IF EXISTS (SELECT 1 FROM #LOAD_TRACK GROUP BY GEM_DBKEY HAVING COUNT(*) > 1)
    THROW 51051, 'KAS_DC_LOADS has duplicate GEM_DBKEY values. The loader identifies records by GEM_DBKEY, so it must be unique.', 1;

-- Fix the processing order once, so the loop walks the records instead of re-sorting them every time
;WITH S AS (SELECT SEQ, ROW_NUMBER() OVER (ORDER BY COMPANY_CODE, DC_LICENSE_PLATE_ID,
                                                    DC_LICENSE_PLATE_LINE, GEM_DBKEY) AS rn
            FROM #LOAD_TRACK)
UPDATE S SET SEQ = rn;
CREATE UNIQUE CLUSTERED INDEX IX_LT_SEQ ON #LOAD_TRACK (SEQ);
CREATE UNIQUE INDEX IX_LT_KEY ON #LOAD_TRACK (GEM_DBKEY);

-- Records the loader has no population path for are failed up front (never silently skipped)
UPDATE #LOAD_TRACK
SET FINAL_STATUS  = 'F',
    FAIL_TABLE    = 'PRE-PROCESSING',
    ERROR_MESSAGE = N'Part not found in PRODUCT_MASTER or unsupported IC_PRODUCT_UOM_CONTROL / IC_PACKAGED_PRODUCT combination (loader handles S/N, S/Y and P/N only)',
    PROCESSED_AT  = SYSDATETIME()
WHERE PRODUCT_CATEGORY IS NULL;

UPDATE K
SET K.STATUS_FLAG     = 'F',
    K.RS_MESSAGE_TEXT = LEFT('Failed to populate due to: ' + T.ERROR_MESSAGE, @MsgMax)
FROM KAS_DC_LOADS K
JOIN #LOAD_TRACK T ON T.GEM_DBKEY = K.GEM_DBKEY
WHERE T.FINAL_STATUS = 'F' AND K.STATUS_FLAG = 'V';

-- ---------------------------------------------------------------------------
-- 3. Work tables (all clones/typed from the source so no type guessing)
-- ---------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#R')         IS NOT NULL DROP TABLE #R;
IF OBJECT_ID('tempdb..#RU')        IS NOT NULL DROP TABLE #RU;
IF OBJECT_ID('tempdb..#QDOC_MAP')  IS NOT NULL DROP TABLE #QDOC_MAP;
IF OBJECT_ID('tempdb..#QLINE_MAP') IS NOT NULL DROP TABLE #QLINE_MAP;
IF OBJECT_ID('tempdb..#RUN_BATCH') IS NOT NULL DROP TABLE #RUN_BATCH;
IF OBJECT_ID('tempdb..#RUN_ROWS')  IS NOT NULL DROP TABLE #RUN_ROWS;
IF OBJECT_ID('tempdb..#PS_BEFORE') IS NOT NULL DROP TABLE #PS_BEFORE;
IF OBJECT_ID('tempdb..#BL_BEFORE') IS NOT NULL DROP TABLE #BL_BEFORE;

-- #R : the single source record currently being processed
SELECT TOP (0)
       ISNULL(K.GEM_DBKEY, K.GEM_DBKEY) AS GEM_DBKEY,
       K.COMPANY_CODE, K.WAREHOUSE, K.BIN_LOCATION, K.DC_LICENSE_PLATE_ID, K.DC_LICENSE_PLATE_LINE,
       K.DC_PARENT_LICENSE_PLATE_ID, K.PART_CODE, K.IC_LOT_NUMBER, K.IC_STATUS_CODE,
       K.QTY_1, K.UOM_1, K.QTY_2, K.UOM_2, K.UNIT_COST, K.BATCH_DATE, K.BEST_BEFORE_DATE, K.CREATION_DATE
INTO #R
FROM KAS_DC_LOADS K;
ALTER TABLE #R ADD CAT VARCHAR(2) NULL, IC_RETEST_DAYS INT NULL, DIVISION VARCHAR(100) NULL,
                   INV_UOM VARCHAR(50) NULL, INV_QTY DECIMAL(28,10) NULL, CONV_MATCHES INT NULL;

-- #RU : unit-of-measure rows of the current record (what feeds the three inventory-status tables)
CREATE TABLE #RU (UOM VARCHAR(50) NOT NULL, UOM_TYPE VARCHAR(10) NOT NULL, QTY DECIMAL(28,10) NULL);

-- Quality-doc bookkeeping (temp-table changes are rolled back together with the record)
CREATE TABLE #QDOC_MAP  (COMPANY_CODE VARCHAR(50) NOT NULL, PART_CODE VARCHAR(100) NOT NULL,
                         IC_LOT_NUMBER VARCHAR(100) NOT NULL, IC_STATUS_CODE VARCHAR(10) NOT NULL,
                         QUALITY_DOC_NBR VARCHAR(100) NOT NULL);
CREATE TABLE #QLINE_MAP (COMPANY_CODE VARCHAR(50) NOT NULL, QUALITY_DOC_NBR VARCHAR(100) NOT NULL,
                         WAREHOUSE VARCHAR(50) NOT NULL, BIN_LOCATION VARCHAR(100) NULL,
                         QUALITY_DOC_LINE_NBR INT NOT NULL);
-- PART_BATCHES rows created earlier in THIS run (only those get QTY_RECEIVED accumulated)
CREATE TABLE #RUN_BATCH (COMPANY_CODE VARCHAR(50) NOT NULL, PART_CODE VARCHAR(100) NOT NULL,
                         WAREHOUSE VARCHAR(50) NOT NULL, IC_LOT_NUMBER VARCHAR(100) NOT NULL);

-- keys of inventory rows created earlier in THIS run (lets several source records of one key add up,
-- while a row that pre-existed the run is reported as a duplicate)
CREATE TABLE #RUN_ROWS (TBL SYSNAME NOT NULL, KEYTEXT NVARCHAR(900) NOT NULL);

-- FIX 2: quantity of each inventory-status key BEFORE the record's steps (OLD_QTY NULL = row did not exist)
CREATE TABLE #PS_BEFORE (UOM VARCHAR(50) NOT NULL, UOM_TYPE VARCHAR(10) NOT NULL,
                         OLD_QTY DECIMAL(28,10) NULL, REC_QTY DECIMAL(28,10) NOT NULL);
CREATE TABLE #BL_BEFORE (TBL SYSNAME NOT NULL, UOM VARCHAR(50) NOT NULL, UOM_TYPE VARCHAR(10) NOT NULL,
                         OLD_QTY DECIMAL(28,10) NULL, REC_QTY DECIMAL(28,10) NOT NULL);

-- ---------------------------------------------------------------------------
-- 4. Process ONE SOURCE RECORD AT A TIME
-- ---------------------------------------------------------------------------
WHILE 1 = 1
BEGIN
    -- 4a. pick the next unprocessed record by position (always moves forward, so it cannot loop on one record)
    SET @NextSeq = NULL;
    SELECT TOP (1) @NextSeq = T.SEQ
    FROM #LOAD_TRACK T
    WHERE T.SEQ > @Seq AND T.FINAL_STATUS IS NULL
    ORDER BY T.SEQ;
    IF @NextSeq IS NULL BREAK;                  -- nothing left
    SET @Seq = @NextSeq;

    DELETE FROM #R;
    INSERT INTO #R
        (GEM_DBKEY, COMPANY_CODE, WAREHOUSE, BIN_LOCATION, DC_LICENSE_PLATE_ID, DC_LICENSE_PLATE_LINE,
         DC_PARENT_LICENSE_PLATE_ID, PART_CODE, IC_LOT_NUMBER, IC_STATUS_CODE, QTY_1, UOM_1, QTY_2, UOM_2,
         UNIT_COST, BATCH_DATE, BEST_BEFORE_DATE, CREATION_DATE, CAT, IC_RETEST_DAYS, DIVISION)
    SELECT K.GEM_DBKEY, K.COMPANY_CODE, K.WAREHOUSE, ISNULL(K.BIN_LOCATION,''), K.DC_LICENSE_PLATE_ID,
           K.DC_LICENSE_PLATE_LINE, ISNULL(K.DC_PARENT_LICENSE_PLATE_ID,''), K.PART_CODE,
           ISNULL(K.IC_LOT_NUMBER,''), K.IC_STATUS_CODE, K.QTY_1, K.UOM_1, K.QTY_2, K.UOM_2,
           K.UNIT_COST, K.BATCH_DATE, K.BEST_BEFORE_DATE, K.CREATION_DATE,
           T.PRODUCT_CATEGORY, PM.IC_RETEST_DAYS, WC.DIVISION
    FROM #LOAD_TRACK T
    JOIN KAS_DC_LOADS K        ON K.GEM_DBKEY = T.GEM_DBKEY
    LEFT JOIN PRODUCT_MASTER PM ON PM.PART_CODE = K.PART_CODE
    LEFT JOIN WAREHOUSE_CONTROLS WC ON WC.COMPANY_CODE = K.COMPANY_CODE AND WC.WAREHOUSE = K.WAREHOUSE
    WHERE T.SEQ = @Seq;

    IF NOT EXISTS (SELECT 1 FROM #R) CONTINUE;  -- source row vanished; stays unprocessed (visible in the summary)

    DELETE FROM @Steps;
    DELETE FROM @Chk;
    SET @Step = N'PRE-PROCESSING';
    SET @FailStep = NULL;
    SET @Committed = 0;
    SET @Q_DOC_NBR = NULL;
    SET @Q_ORIG_DOC_NBR = NULL;
    SET @Q_ORIG_DOC_LINE = NULL;

    BEGIN TRY
        -- 4b. record preparation (conversions) - outside the transaction, but inside TRY
        SELECT @Cat = CAT FROM #R;
        SELECT @HasBin = CASE WHEN BIN_LOCATION   <> '' THEN 1 ELSE 0 END,
               @HasLot = CASE WHEN IC_LOT_NUMBER  <> '' THEN 1 ELSE 0 END FROM #R;
        SELECT @NeedQuality = CASE WHEN T.IC_QUALITY_DOCS = 'PENDING' THEN 1 ELSE 0 END
        FROM #LOAD_TRACK T JOIN #R r ON r.GEM_DBKEY = T.GEM_DBKEY;

        IF @Cat = 'SN'
            UPDATE #R SET INV_QTY = 0;                       -- not packaged: no separate capacity quantity

        IF @Cat = 'SP'                                       -- packaging qty converted to the inventory (capacity) unit
            UPDATE r
            SET r.INV_UOM = PM.IC_UNIT_CAPACITY,
                r.INV_QTY = FIN.RS_UOM_CONVERSION(r.COMPANY_CODE, r.PART_CODE, r.UOM_1, PM.IC_UNIT_CAPACITY, r.QTY_1)
            FROM #R r JOIN PRODUCT_MASTER PM ON PM.PART_CODE = r.PART_CODE;

        IF @Cat = 'SP' AND EXISTS (SELECT 1 FROM #R
                                   WHERE NULLIF(LTRIM(RTRIM(INV_UOM)), '') IS NULL OR INV_QTY IS NULL)
            THROW 51031, 'Packaged part: IC_UNIT_CAPACITY is blank or the UOM conversion returned NULL.', 1;

        IF @Cat = 'PN'                                       -- SLBS = LBS * ACTBRX / STDBRX (Brix formula)
        BEGIN
            UPDATE r
            SET r.CONV_MATCHES = F.N_MATCH,
                r.INV_UOM = CASE WHEN F.N_MATCH = 1 THEN F.ACT_UOM END,
                r.INV_QTY = CASE WHEN F.N_MATCH = 1 THEN F.ACT_QTY END
            FROM #R r
            CROSS APPLY (
                SELECT MIN(X.ACT_UOM) AS ACT_UOM, MIN(X.ACT_QTY) AS ACT_QTY,
                       COUNT(DISTINCT CONCAT(X.ACT_UOM, '|', X.ACT_QTY)) AS N_MATCH
                FROM (SELECT puc.UNIT_TO AS ACT_UOM,
                             -- actual value of the lot if it has one, otherwise the product default (new lot)
                             r.QTY_1 * COALESCE(LC.CHARACTERISTIC_NUMERIC, PCL.IC_DEF_CHAR_NUMERIC)
                                     / NULLIF(PC.IC_DEF_CHAR_NUMERIC, 0) AS ACT_QTY
                      FROM PART_UOM_CONVERSIONS puc
                      JOIN SYS_FORMULA_DEFINITIONS fd_lot
                           ON fd_lot.SYS_FORMULA_CODE = puc.SYS_FORMULA_CODE AND fd_lot.SYS_DEFINITION_TYPE = 'L'
                      JOIN SYS_FORMULA_DEFINITIONS fd_prod
                           ON fd_prod.SYS_FORMULA_CODE = puc.SYS_FORMULA_CODE AND fd_prod.SYS_DEFINITION_TYPE = 'P'
                      JOIN IC_PRODUCT_CHARACTERISTICS PCL
                           ON PCL.COMPANY_CODE = r.COMPANY_CODE AND PCL.PART_CODE = r.PART_CODE
                          AND PCL.CHARACTERISTIC_CODE = fd_lot.CHARACTERISTIC_CODE
                      LEFT JOIN IC_LOT_CHARACTERISTICS LC
                           ON LC.COMPANY_CODE = r.COMPANY_CODE AND LC.WAREHOUSE = r.WAREHOUSE
                          AND LC.PART_CODE = r.PART_CODE AND LC.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                          AND LC.CHARACTERISTIC_CODE = fd_lot.CHARACTERISTIC_CODE
                      JOIN IC_PRODUCT_CHARACTERISTICS PC
                           ON PC.COMPANY_CODE = r.COMPANY_CODE AND PC.PART_CODE = r.PART_CODE
                          AND PC.CHARACTERISTIC_CODE = fd_prod.CHARACTERISTIC_CODE
                      WHERE puc.PART_CODE = r.PART_CODE
                        AND puc.UNIT_FROM = r.UOM_1
                        AND puc.SYS_FORMULA_CODE <> '') X
            ) F;

            IF EXISTS (SELECT 1 FROM #R WHERE CONV_MATCHES > 1)
                THROW 51034, 'More than one different formula-driven UOM conversion matches this part/lot/UOM; the target unit and quantity are ambiguous.', 1;

            IF EXISTS (SELECT 1 FROM #R WHERE INV_UOM IS NULL OR INV_QTY IS NULL)
                THROW 51030, 'No usable formula-driven UOM conversion (PART_UOM_CONVERSIONS / SYS_FORMULA_DEFINITIONS / IC_PRODUCT_CHARACTERISTICS default or IC_LOT_CHARACTERISTICS value; STDBRX must be non-zero) for this part/lot/UOM.', 1;
        END;

        -- UOM rows feeding bin / lot / product status:
        --   SN: ('I', UOM_1) ; SP: ('P', UOM_1) + ('I', capacity UOM) ; PN: ('I', LBS) + ('I', SLBS)
        DELETE FROM #RU;
        INSERT INTO #RU (UOM, UOM_TYPE, QTY)
        SELECT V.UOM, V.UOM_TYPE, SUM(V.QTY)
        FROM #R r
        CROSS APPLY (VALUES (1, CASE WHEN r.CAT = 'SP' THEN 'P' ELSE 'I' END, ISNULL(r.UOM_1,''), ISNULL(r.QTY_1,0)),
                            (2, 'I', r.INV_UOM, r.INV_QTY)) V (SEQ, UOM_TYPE, UOM, QTY)
        WHERE (V.SEQ = 1 AND r.CAT = 'SN')
           OR NULLIF(LTRIM(RTRIM(V.UOM)), '') IS NOT NULL
        GROUP BY V.UOM, V.UOM_TYPE;

        -- ================= TRANSACTION FOR THIS SOURCE RECORD =================
        BEGIN TRANSACTION;

        -- ---- DC_LICENSE_PLATE_LINES ------------------------------------------
        SET @Step = N'DC_LICENSE_PLATE_LINES';
        IF EXISTS (SELECT 1 FROM DC_LICENSE_PLATE_LINES T JOIN #R r
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.DC_LICENSE_PLATE_ID = r.DC_LICENSE_PLATE_ID
                  AND T.DC_LICENSE_PLATE_LINE = r.DC_LICENSE_PLATE_LINE)
            THROW 51040, 'Duplicate key: DC_LICENSE_PLATE_LINES already contains this company/plate/line.', 1;
INSERT INTO DC_LICENSE_PLATE_LINES
(
    COMPANY_CODE,
    DC_LICENSE_PLATE_ID,
    DC_LICENSE_PLATE_LINE,
    PART_CODE,
    IC_LOT_NUMBER,
    MH_NUMBER,
    IC_STATUS_CODE,
    QUANTITY_1,
    UOM_1,
    QUANTITY_2,
    UOM_2,
    DOC_REFERENCE,
    DOC_LINE,
    PHYS_COUNT_NUMBER,
    COUNT_SEQ_NUMBER,
    DC_TARE_WEIGHT_1,
    DC_TARE_WEIGHT_2,
    DC_TARE_UNIT,
    AR_DIVISION,
    DESPATCH_NOTE,
    DESPATCH_LINE,
    AP_DIVISION,
    GRN_NUMBER,
    GRN_LINE_NUMBER,
    FACTORY,
    JOB_NUMBER,
    PROCESS_STAGE,
    COUNT_SEQ,
    SOURCE_MODULE,
    CREDIT_NOTE_NUMBER,
    CREDIT_NOTE_LINE_NUMBER,
    ORIG_BIN_LOCATION,
    ORIG_SOURCE_MODULE,
    ORIGINAL_DOCUMENT_NUMBER,
    ORIGINAL_DOCUMENT_LINE,
    ORIGINAL_DOCUMENT_SEQUENCE,
    COUNT_QUANTITY_1,
    COUNT_QUANTITY_2,
    COUNT_WAREHOUSE,
    WOM_WO_ID,
    WOL_WO_LN_NUM,
    EQM_EQP_ID,
    CAM_ACCT_ID,
    DIFFERENCE_QUANTITY_1,
    DIFFERENCE_QUANTITY_2,
    INVOICE_NUMBER,
    INVOICE_LINE_NUMBER,
    INVOICE_SEQUENCE,
    DC_CASE_SERIAL_NUMBER,
    EAN_NUMBER
)
SELECT
    s.COMPANY_CODE,
    s.DC_LICENSE_PLATE_ID,
    s.DC_LICENSE_PLATE_LINE,
    s.PART_CODE,
    ISNULL(s.IC_LOT_NUMBER, '') AS IC_LOT_NUMBER,
    0 AS MH_NUMBER,
    s.IC_STATUS_CODE,
    ISNULL(s.QTY_1, 0) AS QUANTITY_1,
    ISNULL(s.UOM_1, '') AS UOM_1,
    ISNULL(s.QTY_2, 0) AS QUANTITY_2,
    ISNULL(s.UOM_2, '') AS UOM_2,
    '' AS DOC_REFERENCE,
    1 AS DOC_LINE,
    0 AS PHYS_COUNT_NUMBER,
    0 AS COUNT_SEQ_NUMBER,
    0.0000 AS DC_TARE_WEIGHT_1,
    0.0000 AS DC_TARE_WEIGHT_2,
    '' AS DC_TARE_UNIT,
    '' AS AR_DIVISION,
    0 AS DESPATCH_NOTE,
    '' AS DESPATCH_LINE,
    '' AS AP_DIVISION,
    '' AS GRN_NUMBER,
    '' AS GRN_LINE_NUMBER,
    '' AS FACTORY,
    '' AS JOB_NUMBER,
    '' AS PROCESS_STAGE,
    0 AS COUNT_SEQ,
    'IC' AS SOURCE_MODULE,
    0 AS CREDIT_NOTE_NUMBER,
    0 AS CREDIT_NOTE_LINE_NUMBER,
    '' AS ORIG_BIN_LOCATION,
    '' AS ORIG_SOURCE_MODULE,
    '' AS ORIGINAL_DOCUMENT_NUMBER,
    '' AS ORIGINAL_DOCUMENT_LINE,
    0 AS ORIGINAL_DOCUMENT_SEQUENCE,
    0.000000 AS COUNT_QUANTITY_1,
    0.000000 AS COUNT_QUANTITY_2,
    '' AS COUNT_WAREHOUSE,
    0 AS WOM_WO_ID,
    0 AS WOL_WO_LN_NUM,
    '' AS EQM_EQP_ID,
    '' AS CAM_ACCT_ID,
    0.000000 AS DIFFERENCE_QUANTITY_1,
    0.000000 AS DIFFERENCE_QUANTITY_2,
    '' AS INVOICE_NUMBER,
    '' AS INVOICE_LINE_NUMBER,
    '' AS INVOICE_SEQUENCE,
    '' AS DC_CASE_SERIAL_NUMBER,
    '' AS EAN_NUMBER
        FROM #R s;
        INSERT INTO @Steps (TBL) VALUES (N'DC_LICENSE_PLATE_LINES');

        -- ---- DC_LICENSE_PLATES (header, once per plate) ----------------------
        SET @Step = N'DC_LICENSE_PLATES';
INSERT INTO DC_LICENSE_PLATES
(
    COMPANY_CODE,
    DC_LICENSE_PLATE_ID,
    WAREHOUSE,
    BIN_LOCATION,
    DC_EQUIPMENT_TARE_WEIGHT,
    DC_EQUIPMENT_TARE_UNIT,
    DC_LICENSE_PLATE_STATUS,
    DC_PARENT_LICENSE_PLATE_ID,
    DC_ASN_LOAD_CARRIER_TYPE,
    WH_XFER_DOC_REFERENCE,
    SOURCE_WAREHOUSE
)
SELECT
    s.COMPANY_CODE,
    s.DC_LICENSE_PLATE_ID,
    s.WAREHOUSE,
    ISNULL(s.BIN_LOCATION, '') AS BIN_LOCATION,
    0 AS DC_EQUIPMENT_TARE_WEIGHT,
    '' AS DC_EQUIPMENT_TARE_UNIT,
    'ACTIVE' AS DC_LICENSE_PLATE_STATUS,
    ISNULL(s.DC_PARENT_LICENSE_PLATE_ID, '') AS DC_PARENT_LICENSE_PLATE_ID,
    '' AS DC_ASN_LOAD_CARRIER_TYPE,
    '' AS WH_XFER_DOC_REFERENCE,
    '' AS SOURCE_WAREHOUSE
        FROM #R s
        WHERE NOT EXISTS (SELECT 1 FROM DC_LICENSE_PLATES p
                          WHERE p.COMPANY_CODE = s.COMPANY_CODE
                            AND p.DC_LICENSE_PLATE_ID = s.DC_LICENSE_PLATE_ID);
        INSERT INTO @Steps (TBL) VALUES (N'DC_LICENSE_PLATES');

        -- ---- FIX 2: remember bin / lot quantities before they change (used by the end-of-record check) ----
        DELETE FROM #BL_BEFORE;
        IF @HasBin = 1
            INSERT INTO #BL_BEFORE (TBL, UOM, UOM_TYPE, OLD_QTY, REC_QTY)
            SELECT N'IC_BIN_DETAIL_STATUS', X.UOM, X.UOM_TYPE, T.IC_QUANTITY, ISNULL(X.QTY, 0)
            FROM #R r CROSS JOIN #RU X
            LEFT JOIN IC_BIN_DETAIL_STATUS T WITH (UPDLOCK, HOLDLOCK)
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                  AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                  AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER AND T.IC_LOT_SEQUENCE = 0
                  AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
                  AND T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE;
        IF @HasLot = 1
            INSERT INTO #BL_BEFORE (TBL, UOM, UOM_TYPE, OLD_QTY, REC_QTY)
            SELECT N'IC_LOT_STATUS', X.UOM, X.UOM_TYPE, T.IC_QUANTITY, ISNULL(X.QTY, 0)
            FROM #R r CROSS JOIN #RU X
            LEFT JOIN IC_LOT_STATUS T WITH (UPDLOCK, HOLDLOCK)
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                  AND T.PART_CODE = r.PART_CODE AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                  AND T.IC_STATUS_CODE = r.IC_STATUS_CODE AND T.IC_LOT_SEQUENCE = 0
                  AND T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE;

        -- ---- IC_BIN_DETAIL_STATUS --------------------------------------------
        IF @HasBin = 1
        BEGIN
            SET @Step = N'IC_BIN_DETAIL_STATUS';
            -- 1) DUPLICATE CHECK (same behaviour as the original plain INSERT): a row that already exists
            --    and was NOT created earlier in this run is an error, never silently skipped or added to.
            IF EXISTS (SELECT 1 FROM IC_BIN_DETAIL_STATUS T
                       JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                      AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                      AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER AND T.IC_LOT_SEQUENCE = 0
                      AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
            JOIN #RU X ON T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE
                       WHERE NOT EXISTS (SELECT 1 FROM #RUN_ROWS RR
                                         WHERE RR.TBL = N'IC_BIN_DETAIL_STATUS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE)))
                THROW 51041, 'Duplicate key: IC_BIN_DETAIL_STATUS already contains a row for this company/warehouse/bin/part/lot/status/UOM.', 1;

            -- 2) rows created earlier in this run by another source record of the same key: add the quantity
            UPDATE T SET T.IC_QUANTITY = T.IC_QUANTITY + X.QTY
            FROM IC_BIN_DETAIL_STATUS T
            JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                      AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                      AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER AND T.IC_LOT_SEQUENCE = 0
                      AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
            JOIN #RU X ON T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE
            JOIN #RUN_ROWS RR ON RR.TBL = N'IC_BIN_DETAIL_STATUS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE);

            -- 3) insert what does not exist yet
            INSERT INTO IC_BIN_DETAIL_STATUS
            (COMPANY_CODE, WAREHOUSE, BIN_LOCATION, PART_CODE, IC_LOT_NUMBER, IC_LOT_SEQUENCE, IC_STATUS_CODE,
             MH_NUMBER, UNIT_OF_MEASURE, IC_PRODUCT_UOM_TYPE, IC_QUANTITY, IC_QTY_PICKED, IC_QTY_IN_DESPATCH,
             IC_QTY_AWAITING_CONFIRM_OUT, GEM_ARCHIVE_FLAG)
            SELECT r.COMPANY_CODE, r.WAREHOUSE, r.BIN_LOCATION, r.PART_CODE, r.IC_LOT_NUMBER, 0, r.IC_STATUS_CODE,
                   '', X.UOM, X.UOM_TYPE, X.QTY, 0, 0, 0, ''
            FROM #R r CROSS JOIN #RU X
            WHERE NOT EXISTS (SELECT 1 FROM IC_BIN_DETAIL_STATUS T
                              WHERE T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                                AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                                AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER AND T.IC_LOT_SEQUENCE = 0
                                AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
                                AND T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE);
            
            -- 4) remember the keys created in this run (rolled back together with the record)
            INSERT INTO #RUN_ROWS (TBL, KEYTEXT)
            SELECT N'IC_BIN_DETAIL_STATUS', CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE)
            FROM #R r CROSS JOIN #RU X
            WHERE NOT EXISTS (SELECT 1 FROM #RUN_ROWS RR WHERE RR.TBL = N'IC_BIN_DETAIL_STATUS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE));
            INSERT INTO @Steps (TBL) VALUES (N'IC_BIN_DETAIL_STATUS');
        END;

        -- ---- IC_LOT_STATUS ---------------------------------------------------
        IF @HasLot = 1
        BEGIN
            SET @Step = N'IC_LOT_STATUS';
            -- 1) DUPLICATE CHECK (same behaviour as the original plain INSERT): a row that already exists
            --    and was NOT created earlier in this run is an error, never silently skipped or added to.
            IF EXISTS (SELECT 1 FROM IC_LOT_STATUS T
                       JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                      AND T.PART_CODE = r.PART_CODE AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                      AND T.IC_STATUS_CODE = r.IC_STATUS_CODE AND T.IC_LOT_SEQUENCE = 0
            JOIN #RU X ON T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE
                       WHERE NOT EXISTS (SELECT 1 FROM #RUN_ROWS RR
                                         WHERE RR.TBL = N'IC_LOT_STATUS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE)))
                THROW 51042, 'Duplicate key: IC_LOT_STATUS already contains a row for this company/warehouse/part/lot/status/UOM.', 1;

            -- 2) rows created earlier in this run by another source record of the same key: add the quantity
            UPDATE T SET T.IC_QUANTITY = T.IC_QUANTITY + X.QTY
            FROM IC_LOT_STATUS T
            JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                      AND T.PART_CODE = r.PART_CODE AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                      AND T.IC_STATUS_CODE = r.IC_STATUS_CODE AND T.IC_LOT_SEQUENCE = 0
            JOIN #RU X ON T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE
            JOIN #RUN_ROWS RR ON RR.TBL = N'IC_LOT_STATUS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE);

            -- 3) insert what does not exist yet
            INSERT INTO IC_LOT_STATUS
            (COMPANY_CODE, WAREHOUSE, PART_CODE, IC_LOT_NUMBER, IC_STATUS_CODE, IC_LOT_SEQUENCE, UNIT_OF_MEASURE,
             IC_PRODUCT_UOM_TYPE, IC_QUANTITY, IC_QTY_PICKED, IC_QTY_IN_DESPATCH, IC_QTY_RESERVED,
             IC_QTY_AWAITING_CONFIRM_OUT, GEM_ARCHIVE_FLAG)
            SELECT r.COMPANY_CODE, r.WAREHOUSE, r.PART_CODE, r.IC_LOT_NUMBER, r.IC_STATUS_CODE, 0, X.UOM,
                   X.UOM_TYPE, X.QTY, 0, 0, 0, 0, ''
            FROM #R r CROSS JOIN #RU X
            WHERE NOT EXISTS (SELECT 1 FROM IC_LOT_STATUS T
                              WHERE T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                                AND T.PART_CODE = r.PART_CODE AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                                AND T.IC_STATUS_CODE = r.IC_STATUS_CODE AND T.IC_LOT_SEQUENCE = 0
                                AND T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE);
            
            -- 4) remember the keys created in this run (rolled back together with the record)
            INSERT INTO #RUN_ROWS (TBL, KEYTEXT)
            SELECT N'IC_LOT_STATUS', CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE)
            FROM #R r CROSS JOIN #RU X
            WHERE NOT EXISTS (SELECT 1 FROM #RUN_ROWS RR WHERE RR.TBL = N'IC_LOT_STATUS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER,'|',r.IC_STATUS_CODE,'|',X.UOM,'|',X.UOM_TYPE));
            INSERT INTO @Steps (TBL) VALUES (N'IC_LOT_STATUS');
        END;

        -- ---- IC_PRODUCT_STATUS -----------------------------------------------
        -- FIX 2: the key (company/warehouse/part/status/UOM/UOM type) has no lot or bin, so the row very often
        -- exists already. The record's quantity is ALWAYS added to an existing row (no #RUN_ROWS join), and only
        -- keys that do not exist are inserted. UPDATE runs before INSERT so a new row is not added to twice.
        SET @Step = N'IC_PRODUCT_STATUS';

        -- 1) capture the quantity of every key before this step (NULL = row does not exist yet)
        DELETE FROM #PS_BEFORE;
        INSERT INTO #PS_BEFORE (UOM, UOM_TYPE, OLD_QTY, REC_QTY)
        SELECT X.UOM, X.UOM_TYPE, T.IC_QUANTITY, ISNULL(X.QTY, 0)
        FROM #R r CROSS JOIN #RU X
        LEFT JOIN IC_PRODUCT_STATUS T WITH (UPDLOCK, HOLDLOCK)
               ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
              AND T.PART_CODE = r.PART_CODE AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
              AND T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE;

        -- 2) add the record's quantity to the rows that already exist (every UOM / UOM type row on its own key)
        UPDATE T SET T.IC_QUANTITY = T.IC_QUANTITY + ISNULL(X.QTY, 0)
        FROM IC_PRODUCT_STATUS T
        JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                 AND T.PART_CODE = r.PART_CODE AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
        JOIN #RU X ON T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE;

        -- 3) insert only the keys that do not exist
        INSERT INTO IC_PRODUCT_STATUS
        (COMPANY_CODE, WAREHOUSE, PART_CODE, IC_STATUS_CODE, UNIT_OF_MEASURE, IC_PRODUCT_UOM_TYPE, IC_QUANTITY,
         IC_QTY_PICKED, IC_QTY_IN_DESPATCH, IC_QTY_RESERVED, IC_QTY_AWAITING_CONFIRM_OUT)
        SELECT r.COMPANY_CODE, r.WAREHOUSE, r.PART_CODE, r.IC_STATUS_CODE, X.UOM, X.UOM_TYPE, ISNULL(X.QTY, 0), 0, 0, 0, 0
        FROM #R r CROSS JOIN #RU X
        WHERE NOT EXISTS (SELECT 1 FROM IC_PRODUCT_STATUS T
                          WHERE T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                            AND T.PART_CODE = r.PART_CODE AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
                            AND T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE);
        -- (no #RUN_ROWS bookkeeping for this table any more; the quantity check is in the final validation)
        INSERT INTO @Steps (TBL) VALUES (N'IC_PRODUCT_STATUS');

        -- ---- PART_BATCHES ----------------------------------------------------
        IF @HasLot = 1
        BEGIN
            SET @Step = N'PART_BATCHES';
            -- a batch created earlier in this run by another record of the same lot: add this record's receipt
            UPDATE B SET B.QTY_RECEIVED = B.QTY_RECEIVED + r.QTY_1
            FROM PART_BATCHES B
            JOIN #R r ON B.COMPANY_CODE = r.COMPANY_CODE AND B.PART_CODE = r.PART_CODE
                     AND B.WAREHOUSE = r.WAREHOUSE AND B.IC_LOT_NUMBER = r.IC_LOT_NUMBER
            JOIN #RUN_BATCH RB ON RB.COMPANY_CODE = r.COMPANY_CODE AND RB.PART_CODE = r.PART_CODE
                              AND RB.WAREHOUSE = r.WAREHOUSE AND RB.IC_LOT_NUMBER = r.IC_LOT_NUMBER;

            INSERT INTO PART_BATCHES
            (COMPANY_CODE, PART_CODE, WAREHOUSE, BATCH_TYPE, QTY_COMMITTED_CURRENT, QTY_COMMITTED_FORWARD,
             QTY_COMMITTED_BACK, QTY_ORDERED_CURRENT, QTY_ORDERED_FORWARD, QTY_ORDERED_BACK, BATCH_DATE, UNIT_COST,
             CREATION_DATE, STATUS_FLAG, PHYS_COUNT_NUMBER, COUNT_SEQ_NUMBER, QTY_RECEIVED, USERNAME, QTY_TRANSIT_IN,
             QTY_TRANSIT_OUT, BEST_BEFORE_DATE, RECEIVED_DATE, RELEASE_DATE, IC_LOT_NUMBER, IC_VENDOR_LOT_NUMBER,
             IC_RETEST_DATE, IC_LAST_MOVEMENT_DATE, IC_CATCHWEIGHT_AVERAGE, IC_LAST_SPOT_COUNT_DATE,
             IC_LAST_CYCLE_COUNT_DATE, IC_LAST_PHYSICAL_COUNT_DATE, LAST_COUNT_DATE, RCS_CONVERSION_STATUS,
             PA_PROJECT_CODE, PA_WBS_NUMBER, MANUFACTURING_DATE, REWORK_FACTORY, REWORK_JOB, WITHDRAW_STATUS,
             TRACE_UNIT_COST)
            SELECT r.COMPANY_CODE, r.PART_CODE, r.WAREHOUSE, 'R',
                   0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
                   ISNULL(r.BATCH_DATE, ''),
                   ISNULL(r.UNIT_COST, 0),
                   GETDATE(), '', 0, 0,
                   r.QTY_1,
                   '', 0.000000, 0.000000,
                   -- date defaults differ per product category exactly as in the original three loaders
                   CASE r.CAT WHEN 'SN' THEN ISNULL(r.BEST_BEFORE_DATE, '1858-11-17')
                              WHEN 'SP' THEN ISNULL(r.BEST_BEFORE_DATE, '')
                              ELSE r.CREATION_DATE END,
                   GETDATE(), GETDATE(), r.IC_LOT_NUMBER, '',
                   CASE r.CAT WHEN 'SN' THEN ISNULL(DATEADD(DAY, r.IC_RETEST_DAYS, r.CREATION_DATE), '1858-11-17')
                              ELSE DATEADD(DAY, r.IC_RETEST_DAYS, r.CREATION_DATE) END,
                   '18581117', 0.000000, '18581117', '18581117', '18581117', '18581117', '',
                   '', '',
                   CASE r.CAT WHEN 'SN' THEN ISNULL(r.CREATION_DATE, '1858-11-17')
                              WHEN 'SP' THEN ISNULL(r.CREATION_DATE, '')
                              ELSE r.CREATION_DATE END,
                   '', '', '', 0
            FROM #R r
            WHERE NOT EXISTS (SELECT 1 FROM PART_BATCHES B
                              WHERE B.COMPANY_CODE = r.COMPANY_CODE AND B.PART_CODE = r.PART_CODE
                                AND B.WAREHOUSE = r.WAREHOUSE AND B.IC_LOT_NUMBER = r.IC_LOT_NUMBER);

            IF @@ROWCOUNT > 0
                INSERT INTO #RUN_BATCH (COMPANY_CODE, PART_CODE, WAREHOUSE, IC_LOT_NUMBER)
                SELECT COMPANY_CODE, PART_CODE, WAREHOUSE, IC_LOT_NUMBER FROM #R;

            -- potency lots: give the lot its characteristic rows from the product defaults (as new lots get them),
            -- so the actual value used for the conversion is stored with the lot. Existing rows are never changed.
            IF @Cat = 'PN'
                INSERT INTO IC_LOT_CHARACTERISTICS
                (COMPANY_CODE, WAREHOUSE, PART_CODE, IC_LOT_NUMBER, CHARACTERISTIC_CODE,
                 CHARACTERISTIC_NUMERIC, CHARACTERISTIC_TEXT, IC_DATATYPE_INDICATOR)
                SELECT r.COMPANY_CODE, r.WAREHOUSE, r.PART_CODE, r.IC_LOT_NUMBER, PC.CHARACTERISTIC_CODE,
                       ISNULL(PC.IC_DEF_CHAR_NUMERIC, 0), ISNULL(PC.IC_DEF_CHAR_TEXT, ''), ISNULL(PC.IC_DATATYPE_INDICATOR, '')
                FROM #R r
                JOIN IC_PRODUCT_CHARACTERISTICS PC ON PC.COMPANY_CODE = r.COMPANY_CODE AND PC.PART_CODE = r.PART_CODE
                WHERE ( PC.IC_CHARACTERISTIC_TYPE = '0'          -- characteristics copied to each lot
                        OR EXISTS (SELECT 1                     -- plus whatever the conversion formula reads from the lot
                                   FROM PART_UOM_CONVERSIONS puc
                                   JOIN SYS_FORMULA_DEFINITIONS fd
                                        ON fd.SYS_FORMULA_CODE = puc.SYS_FORMULA_CODE AND fd.SYS_DEFINITION_TYPE = 'L'
                                   WHERE puc.PART_CODE = r.PART_CODE AND puc.UNIT_FROM = r.UOM_1
                                     AND puc.SYS_FORMULA_CODE <> '' AND fd.CHARACTERISTIC_CODE = PC.CHARACTERISTIC_CODE) )
                  AND NOT EXISTS (SELECT 1 FROM IC_LOT_CHARACTERISTICS LC
                                  WHERE LC.COMPANY_CODE = r.COMPANY_CODE AND LC.WAREHOUSE = r.WAREHOUSE
                                    AND LC.PART_CODE = r.PART_CODE AND LC.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                                    AND LC.CHARACTERISTIC_CODE = PC.CHARACTERISTIC_CODE);

            INSERT INTO @Steps (TBL) VALUES (N'PART_BATCHES');
        END;

        -- ---- BIN_LOCATION_DETAILS --------------------------------------------
        IF @HasBin = 1
        BEGIN
            SET @Step = N'BIN_LOCATION_DETAILS';
            -- 1) DUPLICATE CHECK (same behaviour as the original plain INSERT): a row that already exists
            --    and was NOT created earlier in this run is an error, never silently skipped or added to.
            IF EXISTS (SELECT 1 FROM BIN_LOCATION_DETAILS T
                       JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                      AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                      AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER
                       WHERE NOT EXISTS (SELECT 1 FROM #RUN_ROWS RR
                                         WHERE RR.TBL = N'BIN_LOCATION_DETAILS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER)))
                THROW 51044, 'Duplicate key: BIN_LOCATION_DETAILS already contains a row for this company/warehouse/bin/part/lot.', 1;

            -- 2) rows created earlier in this run by another source record of the same key: add the quantity
            UPDATE T SET T.QTY_IN_BIN = T.QTY_IN_BIN + ISNULL(r.QTY_1, 0)
            FROM BIN_LOCATION_DETAILS T
            JOIN #R r ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                      AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                      AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER
            JOIN #RUN_ROWS RR ON RR.TBL = N'BIN_LOCATION_DETAILS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER);

            -- 3) insert what does not exist yet
            INSERT INTO BIN_LOCATION_DETAILS
            (COMPANY_CODE, WAREHOUSE, BIN_LOCATION, PART_CODE, MH_NUMBER, PHYS_COUNT_NUMBER, COUNT_SEQ_NUMBER,
             LAST_COUNT_DATE, CUBIC_SIZE, WEIGHT_GROSS, LAST_MODIFIED_DATE, RECEIVED_DATE, BEST_BEFORE_DATE,
             SYSTEM_DATE, BATCH_DATE, MH_UNIT, MH_CONVERSION_FACTOR, USERNAME, IC_LOT_NUMBER, QTY_IN_BIN,
             IC_LOT_SEQUENCE, IC_LAST_SPOT_COUNT_DATE, IC_LAST_CYCLE_COUNT_DATE, IC_LAST_PHYSICAL_COUNT_DATE)
            SELECT r.COMPANY_CODE, r.WAREHOUSE, r.BIN_LOCATION, r.PART_CODE, 0, 0, 0,
                   '1858-11-17', 0, 0, GETDATE(),
                   ISNULL(PB.RECEIVED_DATE, ''),
                   CASE r.CAT WHEN 'SN' THEN ISNULL(PB.BEST_BEFORE_DATE, '1858-11-17')
                              WHEN 'SP' THEN ISNULL(PB.BEST_BEFORE_DATE, '')
                              ELSE PB.BEST_BEFORE_DATE END,
                   GETDATE(), ISNULL(PB.BATCH_DATE, ''), '', 0, '', r.IC_LOT_NUMBER, ISNULL(r.QTY_1, 0),
                   0, '18581117', '18581117', '18581117'
            FROM #R r
            OUTER APPLY (SELECT MIN(B.RECEIVED_DATE) AS RECEIVED_DATE, MIN(B.BEST_BEFORE_DATE) AS BEST_BEFORE_DATE,
                                MIN(B.BATCH_DATE) AS BATCH_DATE
                         FROM PART_BATCHES B
                         WHERE B.COMPANY_CODE = r.COMPANY_CODE AND B.WAREHOUSE = r.WAREHOUSE
                           AND B.PART_CODE = r.PART_CODE AND B.IC_LOT_NUMBER = r.IC_LOT_NUMBER) PB
            WHERE NOT EXISTS (SELECT 1 FROM BIN_LOCATION_DETAILS D
                              WHERE D.COMPANY_CODE = r.COMPANY_CODE AND D.WAREHOUSE = r.WAREHOUSE
                                AND D.BIN_LOCATION = r.BIN_LOCATION AND D.PART_CODE = r.PART_CODE
                                AND ISNULL(D.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER);
            
            -- 4) remember the keys created in this run (rolled back together with the record)
            INSERT INTO #RUN_ROWS (TBL, KEYTEXT)
            SELECT N'BIN_LOCATION_DETAILS', CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER)
            FROM #R r
            WHERE NOT EXISTS (SELECT 1 FROM #RUN_ROWS RR WHERE RR.TBL = N'BIN_LOCATION_DETAILS' AND RR.KEYTEXT = CONCAT(r.COMPANY_CODE,'|',r.WAREHOUSE,'|',r.BIN_LOCATION,'|',r.PART_CODE,'|',r.IC_LOT_NUMBER));
            INSERT INTO @Steps (TBL) VALUES (N'BIN_LOCATION_DETAILS');
        END;

        -- ---- QUALITY DOCUMENTS (QC / QR / CQC only) --------------------------
        IF @NeedQuality = 1
        BEGIN
            SET @Step = N'IC_QUALITY_DOCS';
            SELECT @Q_COMPANY_CODE = CONVERT(VARCHAR(50), COMPANY_CODE),
                   @Q_STATUS_CODE  = CONVERT(VARCHAR(10), IC_STATUS_CODE),
                   @Q_PART_CODE    = CONVERT(VARCHAR(100), PART_CODE),
                   @Q_LOT_NUMBER   = CONVERT(VARCHAR(100), IC_LOT_NUMBER)
            FROM #R;

            -- one quality doc per company + part + lot + status (re-used by later records of the same combination)
            SELECT @Q_DOC_NBR = QUALITY_DOC_NBR FROM #QDOC_MAP
            WHERE COMPANY_CODE = @Q_COMPANY_CODE AND PART_CODE = @Q_PART_CODE
              AND IC_LOT_NUMBER = @Q_LOT_NUMBER AND IC_STATUS_CODE = @Q_STATUS_CODE;
            SET @Q_NEW_DOC = CASE WHEN @Q_DOC_NBR IS NULL THEN 1 ELSE 0 END;

            IF @Q_NEW_DOC = 1
            BEGIN
                -- ROSS GET_NEW_NBR numbering (unchanged); counter bump is rolled back with the record on failure
                SET @Q_TTYPE = @Q_STATUS_CODE;
                SET @Q_ATTEMPTS = 0;
                SET @Q_CANDIDATE = NULL;

                WHILE @Q_CANDIDATE IS NULL
                BEGIN
                    SET @Q_ATTEMPTS += 1;
                    IF @Q_ATTEMPTS > 1000
                        THROW 51001, 'Unable to find an unused ROSS quality document number after 1000 attempts.', 1;

                    SET @Q_COUNTER = NULL;
                    SET @Q_MANUAL_FLAG = NULL;

                    SELECT @Q_COUNTER = TRY_CONVERT(BIGINT, TRANSACTION_NUMBER),
                           @Q_MANUAL_FLAG = UPPER(LTRIM(RTRIM(CONVERT(VARCHAR(20), MANUAL_NUMBER))))
                    FROM IC_TRANSACTION_TYPES WITH (UPDLOCK, HOLDLOCK)
                    WHERE COMPANY_CODE = @Q_COMPANY_CODE
                      AND WAREHOUSE = @Q_ALL_WAREHOUSES
                      AND TRANSACTION_TYPE = @Q_TTYPE;

                    SET @Q_ROW_COUNT = @@ROWCOUNT;
                    IF @Q_ROW_COUNT <> 1
                        THROW 51002, 'Expected exactly one IC_TRANSACTION_TYPES row for company, all-warehouses value, and QC/QR transaction type. Verify @Q_ALL_WAREHOUSES and the counter setup.', 1;
                    IF @Q_COUNTER IS NULL
                        THROW 51003, 'IC_TRANSACTION_TYPES.TRANSACTION_NUMBER is not a valid integer.', 1;
                    IF @Q_MANUAL_FLAG IS NULL OR @Q_MANUAL_FLAG NOT IN ('N', 'NO', '0', 'FALSE', '#NO')
                        THROW 51004, 'The selected IC_TRANSACTION_TYPES row is marked manual or has an unrecognized MANUAL_NUMBER value. Automatic SQL numbering was stopped.', 1;

                    SET @Q_CANDIDATE = CONCAT(@Q_SOURCE_MODULE, CONVERT(VARCHAR(30), @Q_COUNTER));

                    UPDATE IC_TRANSACTION_TYPES
                    SET TRANSACTION_NUMBER = @Q_COUNTER + 1
                    WHERE COMPANY_CODE = @Q_COMPANY_CODE
                      AND WAREHOUSE = @Q_ALL_WAREHOUSES
                      AND TRANSACTION_TYPE = @Q_TTYPE;
                    IF @@ROWCOUNT <> 1
                        THROW 51005, 'Failed to increment exactly one IC_TRANSACTION_TYPES counter row.', 1;

                    IF EXISTS (SELECT 1 FROM IC_QUALITY_DOCS WITH (UPDLOCK, HOLDLOCK)
                               WHERE COMPANY_CODE = @Q_COMPANY_CODE
                                 AND IC_STATUS_CODE = @Q_STATUS_CODE
                                 AND QUALITY_DOC_NBR = @Q_CANDIDATE)
                        SET @Q_CANDIDATE = NULL;   -- retry with the next counter value
                END;

                SET @Q_DOC_NBR = @Q_CANDIDATE;
                INSERT INTO #QDOC_MAP (COMPANY_CODE, PART_CODE, IC_LOT_NUMBER, IC_STATUS_CODE, QUALITY_DOC_NBR)
                VALUES (@Q_COMPANY_CODE, @Q_PART_CODE, @Q_LOT_NUMBER, @Q_STATUS_CODE, @Q_DOC_NBR);
            END;

            -- one doc line per quality doc + warehouse + bin
            SET @Q_LINE_NBR = NULL;
            SELECT @Q_LINE_NBR = M.QUALITY_DOC_LINE_NBR
            FROM #QLINE_MAP M JOIN #R r
              ON r.COMPANY_CODE = M.COMPANY_CODE AND r.WAREHOUSE = M.WAREHOUSE
             AND ISNULL(r.BIN_LOCATION,'') = ISNULL(M.BIN_LOCATION,'')
            WHERE M.QUALITY_DOC_NBR = @Q_DOC_NBR;
            SET @Q_NEW_LINE = CASE WHEN @Q_LINE_NBR IS NULL THEN 1 ELSE 0 END;

            IF @Q_NEW_LINE = 1
            BEGIN
                SELECT @Q_LINE_NBR = ISNULL(MAX(QUALITY_DOC_LINE_NBR), 0) + 1
                FROM #QLINE_MAP WHERE COMPANY_CODE = @Q_COMPANY_CODE AND QUALITY_DOC_NBR = @Q_DOC_NBR;
                INSERT INTO #QLINE_MAP (COMPANY_CODE, QUALITY_DOC_NBR, WAREHOUSE, BIN_LOCATION, QUALITY_DOC_LINE_NBR)
                SELECT r.COMPANY_CODE, @Q_DOC_NBR, r.WAREHOUSE, r.BIN_LOCATION, @Q_LINE_NBR FROM #R r;
            END;
            SELECT @Q_FIRST_LINE = MIN(QUALITY_DOC_LINE_NBR) FROM #QLINE_MAP
            WHERE COMPANY_CODE = @Q_COMPANY_CODE AND QUALITY_DOC_NBR = @Q_DOC_NBR;

            -- FIX 1: the ONE place where the original-document reference is derived. The header is one row per
            -- quality doc, so the value is per DOC (not per bin line); the plate line, the plate line detail and
            -- the header all take exactly these three variables.
            -- the @Q_ORIG_DOC_LINE line below if the application uses a different value (e.g. '0').
            SET @Q_ORIG_DOC_NBR  = SUBSTRING(CAST(@Q_DOC_NBR AS VARCHAR(100)), LEN(@Q_SOURCE_MODULE) + 1, 30);
            SET @Q_ORIG_DOC_LINE = CONVERT(VARCHAR(30), @Q_FIRST_LINE);
            SET @Q_ORIG_DOC_SEQ  = 0;

            IF EXISTS (SELECT 1 FROM #R WHERE NULLIF(LTRIM(RTRIM(DIVISION)), '') IS NULL)
                THROW 51032, 'DIVISION is blank or missing in WAREHOUSE_CONTROLS for this warehouse.', 1;

            -- ---- DC_LICENSE_PLATE_LINE_DETAILS (+ link back to DC_LICENSE_PLATE_LINES) ----
            SET @Step = N'DC_LICENSE_PLATE_LINE_DETAILS';
            INSERT INTO DC_LICENSE_PLATE_LINE_DETAILS
            (COMPANY_CODE, DC_LICENSE_PLATE_ID, DC_LICENSE_PLATE_LINE, ORIG_SOURCE_MODULE, ORIGINAL_DOCUMENT_NUMBER,
             ORIGINAL_DOCUMENT_LINE, ORIGINAL_DOCUMENT_SEQUENCE, PART_CODE, IC_LOT_NUMBER, IC_STATUS_CODE,
             QUANTITY_1, UOM_1, QUANTITY_2, UOM_2, FACTORY)
            SELECT r.COMPANY_CODE, r.DC_LICENSE_PLATE_ID, r.DC_LICENSE_PLATE_LINE, @Q_SOURCE_MODULE,
                   @Q_ORIG_DOC_NBR,
                   @Q_ORIG_DOC_LINE, @Q_ORIG_DOC_SEQ, r.PART_CODE, r.IC_LOT_NUMBER, r.IC_STATUS_CODE,
                   ISNULL(r.QTY_1, 0), ISNULL(r.UOM_1, ''), ISNULL(r.QTY_2, 0), ISNULL(r.UOM_2, ''), ''
            FROM #R r;

            UPDATE DCL
            SET DCL.ORIG_SOURCE_MODULE         = @Q_SOURCE_MODULE,
                DCL.ORIGINAL_DOCUMENT_NUMBER   = @Q_ORIG_DOC_NBR,
                DCL.ORIGINAL_DOCUMENT_LINE     = @Q_ORIG_DOC_LINE,
                DCL.ORIGINAL_DOCUMENT_SEQUENCE = @Q_ORIG_DOC_SEQ
            FROM DC_LICENSE_PLATE_LINES DCL
            JOIN #R r ON r.COMPANY_CODE = DCL.COMPANY_CODE AND r.DC_LICENSE_PLATE_ID = DCL.DC_LICENSE_PLATE_ID
                     AND r.DC_LICENSE_PLATE_LINE = DCL.DC_LICENSE_PLATE_LINE;
            INSERT INTO @Steps (TBL) VALUES (N'DC_LICENSE_PLATE_LINE_DETAILS');

            -- ---- IC_QUALITY_DOCS (header, once per doc) --------------------------
            SET @Step = N'IC_QUALITY_DOCS';
            IF @Q_NEW_DOC = 1
                INSERT INTO IC_QUALITY_DOCS
                (COMPANY_CODE, QUALITY_DOC_NBR, SOURCE_MODULE, IC_STATUS_CODE, SYSTEM_DATE, USERNAME, DIVISION,
                 FACTORY, ORIGINAL_DOCUMENT_NUMBER, ORIGINAL_DOCUMENT_LINE, ORIGINAL_DOCUMENT_SEQUENCE,
                 SYS_CURRENCY_RATE, MOVEMENT_CODE, COST_CENTER, PART_CODE, IC_LOT_NUMBER, IC_LOT_SEQUENCE,
                 IC_PACK_OR_CAP_UNIT, IC_NOT_CAP_UNIT, IC_CAP_IF_PACKED_UNIT, QUALITY_CODE, STATUS_FLAG,
                 SYS_CURRENCY_RATIO_INDIC, QC_RESULTS_STATUS, PM_EXEC_APPROVAL_STATUS, PM_MFG_APPROVAL_STATUS,
                 PM_SHIP_APPROVAL_STATUS, RCS_CONVERSION_STATUS, ATP_STATUS_START_DATE)
                SELECT r.COMPANY_CODE, @Q_DOC_NBR, @Q_SOURCE_MODULE, r.IC_STATUS_CODE, GETDATE(), '', r.DIVISION,
                       '', '', '', 0,
                       1, '', '', r.PART_CODE, r.IC_LOT_NUMBER, 0,
                       ISNULL(r.UOM_1, ''), '', '', '', '',
                       '', '', '', '',
                       '', '', GETDATE()
                FROM #R r;

            -- header reference = the same three variables the plate line and plate line detail received
            UPDATE QD
            SET QD.ORIGINAL_DOCUMENT_NUMBER   = @Q_ORIG_DOC_NBR,
                QD.ORIGINAL_DOCUMENT_LINE     = @Q_ORIG_DOC_LINE,
                QD.ORIGINAL_DOCUMENT_SEQUENCE = @Q_ORIG_DOC_SEQ
            FROM IC_QUALITY_DOCS QD
            WHERE QD.COMPANY_CODE = @Q_COMPANY_CODE
              AND QD.QUALITY_DOC_NBR = @Q_DOC_NBR
              AND QD.IC_STATUS_CODE = @Q_STATUS_CODE;
            INSERT INTO @Steps (TBL) VALUES (N'IC_QUALITY_DOCS');

            -- ---- IC_QUALITY_DOC_LINES (new line, or add to the existing warehouse+bin line) ----
            SET @Step = N'IC_QUALITY_DOC_LINES';
            IF @Q_NEW_LINE = 1
                INSERT INTO IC_QUALITY_DOC_LINES
                (COMPANY_CODE, QUALITY_DOC_NBR, QUALITY_DOC_LINE_NBR, SOURCE_MODULE, IC_STATUS_CODE, BIN_LOCATION,
                 MH_NUMBER, LINE_TYPE, RECEIVED_DETAIL_DESCRIPTION, QUALITY_DOC_RECORD_TYPE,
                 ORIGINAL_PACK_OR_CAP_QTY, ORIGINAL_NOT_CAP_QTY, ORIGINAL_CAP_IF_PACKED_QTY,
                 CURRENT_PACK_OR_CAP_QTY, CURRENT_NOT_CAP_QTY, CURRENT_CAP_IF_PACKED_QTY,
                 WAREHOUSE, UNIT_COST, GEM_TRANSACTION_ID)
                SELECT r.COMPANY_CODE, @Q_DOC_NBR, @Q_LINE_NBR, @Q_SOURCE_MODULE, r.IC_STATUS_CODE, r.BIN_LOCATION,
                       0, @Q_LINE_TYPE, '', @Q_RECORD_TYPE,
                       ISNULL(r.QTY_1, 0), 0, ISNULL(r.INV_QTY, 0),
                       ISNULL(r.QTY_1, 0), 0, ISNULL(r.INV_QTY, 0),
                       r.WAREHOUSE, r.UNIT_COST, 0
                FROM #R r;
            ELSE
                UPDATE L
                SET L.ORIGINAL_PACK_OR_CAP_QTY    = L.ORIGINAL_PACK_OR_CAP_QTY    + ISNULL(r.QTY_1, 0),
                    L.ORIGINAL_CAP_IF_PACKED_QTY  = L.ORIGINAL_CAP_IF_PACKED_QTY  + ISNULL(r.INV_QTY, 0),
                    L.CURRENT_PACK_OR_CAP_QTY     = L.CURRENT_PACK_OR_CAP_QTY     + ISNULL(r.QTY_1, 0),
                    L.CURRENT_CAP_IF_PACKED_QTY   = L.CURRENT_CAP_IF_PACKED_QTY   + ISNULL(r.INV_QTY, 0)
                FROM IC_QUALITY_DOC_LINES L CROSS JOIN #R r
                WHERE L.COMPANY_CODE = @Q_COMPANY_CODE AND L.QUALITY_DOC_NBR = @Q_DOC_NBR
                  AND L.QUALITY_DOC_LINE_NBR = @Q_LINE_NBR;
            INSERT INTO @Steps (TBL) VALUES (N'IC_QUALITY_DOC_LINES');

            -- ---- IC_QUALITY_DOC_LINE_DETAILS ---------------------------------------
            SET @Step = N'IC_QUALITY_DOC_LINE_DETAILS';
            IF @Q_NEW_LINE = 1
                INSERT INTO IC_QUALITY_DOC_LINE_DETAILS
                (COMPANY_CODE, QUALITY_DOC_NBR, QUALITY_DOC_LINE_NBR, SOURCE_MODULE, IC_STATUS_CODE, SYSTEM_DATE,
                 USERNAME, IC_QUALITY_ADJ_TYPE, IC_PACK_OR_CAP_QTY, IC_NOT_CAP_QTY, IC_CAP_IF_PACKED_QTY, UNIT_COST,
                 NEW_WAREHOUSE, NEW_QUALITY_DOC_NBR, NEW_QUALITY_DOC_LINE_NBR, NEW_LOT_NUMBER, GEM_TRANSACTION_ID,
                 DOCUMENT_LINE_NUMBER, DOCUMENT_REF)
                SELECT r.COMPANY_CODE, @Q_DOC_NBR, @Q_LINE_NBR, @Q_SOURCE_MODULE, r.IC_STATUS_CODE, GETDATE(),
                       '', @Q_ADJ_TYPE, ISNULL(r.QTY_1, 0), 0, ISNULL(r.INV_QTY, 0), r.UNIT_COST,
                       '', 0, 0, '', 0,
                       0, ''
                FROM #R r;
            ELSE
                UPDATE LD
                SET LD.IC_PACK_OR_CAP_QTY     = LD.IC_PACK_OR_CAP_QTY     + ISNULL(r.QTY_1, 0),
                    LD.IC_CAP_IF_PACKED_QTY   = LD.IC_CAP_IF_PACKED_QTY   + ISNULL(r.INV_QTY, 0)
                FROM IC_QUALITY_DOC_LINE_DETAILS LD CROSS JOIN #R r
                WHERE LD.COMPANY_CODE = @Q_COMPANY_CODE AND LD.QUALITY_DOC_NBR = @Q_DOC_NBR
                  AND LD.QUALITY_DOC_LINE_NBR = @Q_LINE_NBR;
            INSERT INTO @Steps (TBL) VALUES (N'IC_QUALITY_DOC_LINE_DETAILS');
        END;

        -- ---- FINAL STATUS VALIDATION ------------------------------------------------
        -- Every table marked PENDING for this record must (a) have completed its step and
        -- (b) really have the row(s) in place. Only then may the record be marked 'P'.
        SET @Step = N'VALIDATION';
        INSERT INTO @Chk (TBL, FOUND)
        SELECT N'DC_LICENSE_PLATES', CASE WHEN EXISTS (SELECT 1 FROM DC_LICENSE_PLATES T JOIN #R r
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.DC_LICENSE_PLATE_ID = r.DC_LICENSE_PLATE_ID
                  AND T.WAREHOUSE = r.WAREHOUSE) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'DC_LICENSE_PLATE_LINES', CASE WHEN EXISTS (SELECT 1 FROM DC_LICENSE_PLATE_LINES T JOIN #R r
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.DC_LICENSE_PLATE_ID = r.DC_LICENSE_PLATE_ID
                  AND T.DC_LICENSE_PLATE_LINE = r.DC_LICENSE_PLATE_LINE) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'IC_BIN_DETAIL_STATUS', CASE WHEN EXISTS (SELECT 1 FROM #RU) AND NOT EXISTS (
                   SELECT 1 FROM #RU X WHERE NOT EXISTS (SELECT 1 FROM IC_BIN_DETAIL_STATUS T JOIN #R r
                       ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE AND T.BIN_LOCATION = r.BIN_LOCATION
                      AND T.PART_CODE = r.PART_CODE AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER
                      AND T.IC_LOT_SEQUENCE = 0 AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
                      WHERE T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE)) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'IC_LOT_STATUS', CASE WHEN EXISTS (SELECT 1 FROM #RU) AND NOT EXISTS (
                   SELECT 1 FROM #RU X WHERE NOT EXISTS (SELECT 1 FROM IC_LOT_STATUS T JOIN #R r
                       ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE AND T.PART_CODE = r.PART_CODE
                      AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER AND T.IC_STATUS_CODE = r.IC_STATUS_CODE AND T.IC_LOT_SEQUENCE = 0
                      WHERE T.UNIT_OF_MEASURE = X.UOM AND T.IC_PRODUCT_UOM_TYPE = X.UOM_TYPE)) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'IC_PRODUCT_STATUS', CASE WHEN EXISTS (SELECT 1 FROM #PS_BEFORE)
                   AND (SELECT COUNT(*) FROM #PS_BEFORE) = (SELECT COUNT(*) FROM #RU)
                   AND NOT EXISTS (
                   -- FIX 2: quantity-aware check: new qty = old qty + record qty (= record qty for a new row)
                   SELECT 1 FROM #PS_BEFORE B CROSS JOIN #R r
                   LEFT JOIN IC_PRODUCT_STATUS T
                          ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE AND T.PART_CODE = r.PART_CODE
                         AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
                         AND T.UNIT_OF_MEASURE = B.UOM AND T.IC_PRODUCT_UOM_TYPE = B.UOM_TYPE
                   WHERE T.IC_QUANTITY IS NULL
                      OR ABS(T.IC_QUANTITY - (ISNULL(B.OLD_QTY, 0) + B.REC_QTY)) > @QtyTol) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'PART_BATCHES', CASE WHEN EXISTS (SELECT 1 FROM PART_BATCHES T JOIN #R r
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.PART_CODE = r.PART_CODE AND T.WAREHOUSE = r.WAREHOUSE
                  AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'BIN_LOCATION_DETAILS', CASE WHEN EXISTS (SELECT 1 FROM BIN_LOCATION_DETAILS T JOIN #R r
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE AND T.BIN_LOCATION = r.BIN_LOCATION
                  AND T.PART_CODE = r.PART_CODE AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'DC_LICENSE_PLATE_LINE_DETAILS', CASE WHEN EXISTS (SELECT 1 FROM DC_LICENSE_PLATE_LINE_DETAILS T JOIN #R r
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.DC_LICENSE_PLATE_ID = r.DC_LICENSE_PLATE_ID
                  AND T.DC_LICENSE_PLATE_LINE = r.DC_LICENSE_PLATE_LINE) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'IC_QUALITY_DOCS', CASE WHEN EXISTS (SELECT 1 FROM IC_QUALITY_DOCS T
                   WHERE T.COMPANY_CODE = @Q_COMPANY_CODE AND T.QUALITY_DOC_NBR = @Q_DOC_NBR
                     AND T.IC_STATUS_CODE = @Q_STATUS_CODE) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'IC_QUALITY_DOC_LINES', CASE WHEN EXISTS (SELECT 1 FROM IC_QUALITY_DOC_LINES T
                   WHERE T.COMPANY_CODE = @Q_COMPANY_CODE AND T.QUALITY_DOC_NBR = @Q_DOC_NBR
                     AND T.QUALITY_DOC_LINE_NBR = @Q_LINE_NBR) THEN 1 ELSE 0 END
        UNION ALL
        SELECT N'IC_QUALITY_DOC_LINE_DETAILS', CASE WHEN EXISTS (SELECT 1 FROM IC_QUALITY_DOC_LINE_DETAILS T
                   WHERE T.COMPANY_CODE = @Q_COMPANY_CODE AND T.QUALITY_DOC_NBR = @Q_DOC_NBR
                     AND T.QUALITY_DOC_LINE_NBR = @Q_LINE_NBR) THEN 1 ELSE 0 END;

        SET @Bad = NULL;
        SELECT TOP (1) @Bad = V.TBL
        FROM #LOAD_TRACK T
        JOIN #R r ON r.GEM_DBKEY = T.GEM_DBKEY
        CROSS APPLY (VALUES
                    ('DC_LICENSE_PLATES', T.DC_LICENSE_PLATES),
                    ('DC_LICENSE_PLATE_LINES', T.DC_LICENSE_PLATE_LINES),
                    ('IC_BIN_DETAIL_STATUS', T.IC_BIN_DETAIL_STATUS),
                    ('IC_LOT_STATUS', T.IC_LOT_STATUS),
                    ('IC_PRODUCT_STATUS', T.IC_PRODUCT_STATUS),
                    ('PART_BATCHES', T.PART_BATCHES),
                    ('BIN_LOCATION_DETAILS', T.BIN_LOCATION_DETAILS),
                    ('DC_LICENSE_PLATE_LINE_DETAILS', T.DC_LICENSE_PLATE_LINE_DETAILS),
                    ('IC_QUALITY_DOCS', T.IC_QUALITY_DOCS),
                    ('IC_QUALITY_DOC_LINES', T.IC_QUALITY_DOC_LINES),
                    ('IC_QUALITY_DOC_LINE_DETAILS', T.IC_QUALITY_DOC_LINE_DETAILS)
                    ) V (TBL, ST)
        WHERE V.ST = 'PENDING'
          AND (NOT EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = V.TBL)
               OR NOT EXISTS (SELECT 1 FROM @Chk C WHERE C.TBL = V.TBL AND C.FOUND = 1));

        IF @Bad IS NOT NULL
        BEGIN
            SET @Step = @Bad;
            SET @VMsg = N'Final validation failed: record was not confirmed in required table ' + @Bad;
            THROW 51020, @VMsg, 1;
        END;

        -- ---- FIX 1: ORIGINAL_DOCUMENT_* must be identical in all three tables for this record ----
        -- (exact comparison of the stored value as text, so a padding / blank-vs-0 / varchar-vs-int difference fails too)
        IF @NeedQuality = 1
        BEGIN
            SET @Bad = NULL;
            SELECT TOP (1) @Bad = Z.TBL
            FROM (
                SELECT 1 AS ORD, N'DC_LICENSE_PLATE_LINE_DETAILS' AS TBL
                WHERE NOT EXISTS (SELECT 1 FROM DC_LICENSE_PLATE_LINE_DETAILS T JOIN #R r
                           ON T.COMPANY_CODE = r.COMPANY_CODE AND T.DC_LICENSE_PLATE_ID = r.DC_LICENSE_PLATE_ID
                          AND T.DC_LICENSE_PLATE_LINE = r.DC_LICENSE_PLATE_LINE
                          WHERE CONVERT(VARCHAR(30), T.ORIG_SOURCE_MODULE)         = @Q_SOURCE_MODULE
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_NUMBER)   = @Q_ORIG_DOC_NBR
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_LINE)     = @Q_ORIG_DOC_LINE
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_SEQUENCE) = CONVERT(VARCHAR(30), @Q_ORIG_DOC_SEQ))
                UNION ALL
                SELECT 2, N'DC_LICENSE_PLATE_LINES'
                WHERE NOT EXISTS (SELECT 1 FROM DC_LICENSE_PLATE_LINES T JOIN #R r
                           ON T.COMPANY_CODE = r.COMPANY_CODE AND T.DC_LICENSE_PLATE_ID = r.DC_LICENSE_PLATE_ID
                          AND T.DC_LICENSE_PLATE_LINE = r.DC_LICENSE_PLATE_LINE
                          WHERE CONVERT(VARCHAR(30), T.ORIG_SOURCE_MODULE)         = @Q_SOURCE_MODULE
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_NUMBER)   = @Q_ORIG_DOC_NBR
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_LINE)     = @Q_ORIG_DOC_LINE
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_SEQUENCE) = CONVERT(VARCHAR(30), @Q_ORIG_DOC_SEQ))
                UNION ALL
                SELECT 3, N'IC_QUALITY_DOCS'
                WHERE NOT EXISTS (SELECT 1 FROM IC_QUALITY_DOCS T
                          WHERE T.COMPANY_CODE = @Q_COMPANY_CODE AND T.QUALITY_DOC_NBR = @Q_DOC_NBR
                            AND T.IC_STATUS_CODE = @Q_STATUS_CODE
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_NUMBER)   = @Q_ORIG_DOC_NBR
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_LINE)     = @Q_ORIG_DOC_LINE
                            AND CONVERT(VARCHAR(30), T.ORIGINAL_DOCUMENT_SEQUENCE) = CONVERT(VARCHAR(30), @Q_ORIG_DOC_SEQ))
            ) Z
            ORDER BY Z.ORD;

            IF @Bad IS NOT NULL
            BEGIN
                SET @Step = @Bad;
                SET @VMsg = CONCAT(N'ORIGINAL_DOCUMENT_* consistency check failed: ', @Bad,
                                   N' does not hold the expected number/line/sequence (',
                                   @Q_ORIG_DOC_NBR, N' / ', @Q_ORIG_DOC_LINE, N' / ', CONVERT(VARCHAR(30), @Q_ORIG_DOC_SEQ),
                                   N') shared by IC_QUALITY_DOCS, DC_LICENSE_PLATE_LINES and DC_LICENSE_PLATE_LINE_DETAILS');
                THROW 51022, @VMsg, 1;
            END;
        END;

        -- ---- FIX 2 (extra check): the same amount must have been added to IC_BIN_DETAIL_STATUS and IC_LOT_STATUS ----
        SET @Bad = NULL;
        SELECT TOP (1) @Bad = Z.TBL
        FROM (
            SELECT B.TBL
            FROM #BL_BEFORE B CROSS JOIN #R r
            LEFT JOIN IC_BIN_DETAIL_STATUS T
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                  AND T.BIN_LOCATION = r.BIN_LOCATION AND T.PART_CODE = r.PART_CODE
                  AND ISNULL(T.IC_LOT_NUMBER,'') = r.IC_LOT_NUMBER AND T.IC_LOT_SEQUENCE = 0
                  AND T.IC_STATUS_CODE = r.IC_STATUS_CODE
                  AND T.UNIT_OF_MEASURE = B.UOM AND T.IC_PRODUCT_UOM_TYPE = B.UOM_TYPE
            WHERE B.TBL = N'IC_BIN_DETAIL_STATUS'
              AND (T.IC_QUANTITY IS NULL OR ABS(T.IC_QUANTITY - (ISNULL(B.OLD_QTY, 0) + B.REC_QTY)) > @QtyTol)
            UNION ALL
            SELECT B.TBL
            FROM #BL_BEFORE B CROSS JOIN #R r
            LEFT JOIN IC_LOT_STATUS T
                   ON T.COMPANY_CODE = r.COMPANY_CODE AND T.WAREHOUSE = r.WAREHOUSE
                  AND T.PART_CODE = r.PART_CODE AND T.IC_LOT_NUMBER = r.IC_LOT_NUMBER
                  AND T.IC_STATUS_CODE = r.IC_STATUS_CODE AND T.IC_LOT_SEQUENCE = 0
                  AND T.UNIT_OF_MEASURE = B.UOM AND T.IC_PRODUCT_UOM_TYPE = B.UOM_TYPE
            WHERE B.TBL = N'IC_LOT_STATUS'
              AND (T.IC_QUANTITY IS NULL OR ABS(T.IC_QUANTITY - (ISNULL(B.OLD_QTY, 0) + B.REC_QTY)) > @QtyTol)
        ) Z;

        IF @Bad IS NOT NULL
        BEGIN
            SET @Step = @Bad;
            SET @VMsg = CONCAT(N'Quantity check failed: ', @Bad,
                               N' did not increase by the record quantity, which IC_PRODUCT_STATUS received');
            THROW 51023, @VMsg, 1;
        END;

        -- ---- all required tables confirmed: mark the source record populated -------
        SET @Step = N'KAS_DC_LOADS';
        UPDATE K
        SET K.STATUS_FLAG = 'P', K.RS_MESSAGE_TEXT = 'Populated'
        FROM KAS_DC_LOADS K JOIN #R r ON r.GEM_DBKEY = K.GEM_DBKEY
        WHERE K.STATUS_FLAG = 'V';
        IF @@ROWCOUNT <> 1
            THROW 51021, 'Source record in KAS_DC_LOADS was not found in status V (changed by another process?).', 1;

        COMMIT TRANSACTION;
        SET @Committed = 1;

        UPDATE T
        SET DC_LICENSE_PLATES = CASE WHEN DC_LICENSE_PLATES = 'PENDING' THEN 'SUCCESS' ELSE DC_LICENSE_PLATES END,
        DC_LICENSE_PLATE_LINES = CASE WHEN DC_LICENSE_PLATE_LINES = 'PENDING' THEN 'SUCCESS' ELSE DC_LICENSE_PLATE_LINES END,
        IC_BIN_DETAIL_STATUS = CASE WHEN IC_BIN_DETAIL_STATUS = 'PENDING' THEN 'SUCCESS' ELSE IC_BIN_DETAIL_STATUS END,
        IC_LOT_STATUS = CASE WHEN IC_LOT_STATUS = 'PENDING' THEN 'SUCCESS' ELSE IC_LOT_STATUS END,
        IC_PRODUCT_STATUS = CASE WHEN IC_PRODUCT_STATUS = 'PENDING' THEN 'SUCCESS' ELSE IC_PRODUCT_STATUS END,
        PART_BATCHES = CASE WHEN PART_BATCHES = 'PENDING' THEN 'SUCCESS' ELSE PART_BATCHES END,
        BIN_LOCATION_DETAILS = CASE WHEN BIN_LOCATION_DETAILS = 'PENDING' THEN 'SUCCESS' ELSE BIN_LOCATION_DETAILS END,
        DC_LICENSE_PLATE_LINE_DETAILS = CASE WHEN DC_LICENSE_PLATE_LINE_DETAILS = 'PENDING' THEN 'SUCCESS' ELSE DC_LICENSE_PLATE_LINE_DETAILS END,
        IC_QUALITY_DOCS = CASE WHEN IC_QUALITY_DOCS = 'PENDING' THEN 'SUCCESS' ELSE IC_QUALITY_DOCS END,
        IC_QUALITY_DOC_LINES = CASE WHEN IC_QUALITY_DOC_LINES = 'PENDING' THEN 'SUCCESS' ELSE IC_QUALITY_DOC_LINES END,
        IC_QUALITY_DOC_LINE_DETAILS = CASE WHEN IC_QUALITY_DOC_LINE_DETAILS = 'PENDING' THEN 'SUCCESS' ELSE IC_QUALITY_DOC_LINE_DETAILS END,
            T.FINAL_STATUS = 'P', T.PROCESSED_AT = SYSDATETIME()
        FROM #LOAD_TRACK T JOIN #R r ON r.GEM_DBKEY = T.GEM_DBKEY;
    END TRY
    BEGIN CATCH
        SET @ErrNum  = ERROR_NUMBER();
        SET @ErrLine = ERROR_LINE();
        SET @ErrMsg  = ERROR_MESSAGE();

        -- undo EVERYTHING done for this one source record (all target tables, counters, temp maps)
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

        IF @Committed = 1
        BEGIN
            -- data was already committed as populated; only the tracker bookkeeping failed
            PRINT 'WARNING: record committed but tracker update failed: ' + @ErrMsg;
            UPDATE #LOAD_TRACK SET FINAL_STATUS = 'P', PROCESSED_AT = SYSDATETIME()
            WHERE GEM_DBKEY IN (SELECT GEM_DBKEY FROM #R);
        END
        ELSE
        BEGIN
            SET @FailStep = @Step;
            SET @FullMsg  = N'[' + ISNULL(@FailStep, N'?') + N'] ' + @ErrMsg
                          + N' (SQL error ' + CONVERT(NVARCHAR(12), @ErrNum) + N', line ' + CONVERT(NVARCHAR(12), @ErrLine) + N')';

            -- tracker (temp-table edits made inside the transaction were rolled back, so write it now)
            UPDATE T
            SET DC_LICENSE_PLATES = CASE WHEN DC_LICENSE_PLATES <> 'PENDING' THEN DC_LICENSE_PLATES
                 WHEN @FailStep = 'DC_LICENSE_PLATES' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'DC_LICENSE_PLATES') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        DC_LICENSE_PLATE_LINES = CASE WHEN DC_LICENSE_PLATE_LINES <> 'PENDING' THEN DC_LICENSE_PLATE_LINES
                 WHEN @FailStep = 'DC_LICENSE_PLATE_LINES' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'DC_LICENSE_PLATE_LINES') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        IC_BIN_DETAIL_STATUS = CASE WHEN IC_BIN_DETAIL_STATUS <> 'PENDING' THEN IC_BIN_DETAIL_STATUS
                 WHEN @FailStep = 'IC_BIN_DETAIL_STATUS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'IC_BIN_DETAIL_STATUS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        IC_LOT_STATUS = CASE WHEN IC_LOT_STATUS <> 'PENDING' THEN IC_LOT_STATUS
                 WHEN @FailStep = 'IC_LOT_STATUS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'IC_LOT_STATUS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        IC_PRODUCT_STATUS = CASE WHEN IC_PRODUCT_STATUS <> 'PENDING' THEN IC_PRODUCT_STATUS
                 WHEN @FailStep = 'IC_PRODUCT_STATUS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'IC_PRODUCT_STATUS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        PART_BATCHES = CASE WHEN PART_BATCHES <> 'PENDING' THEN PART_BATCHES
                 WHEN @FailStep = 'PART_BATCHES' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'PART_BATCHES') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        BIN_LOCATION_DETAILS = CASE WHEN BIN_LOCATION_DETAILS <> 'PENDING' THEN BIN_LOCATION_DETAILS
                 WHEN @FailStep = 'BIN_LOCATION_DETAILS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'BIN_LOCATION_DETAILS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        DC_LICENSE_PLATE_LINE_DETAILS = CASE WHEN DC_LICENSE_PLATE_LINE_DETAILS <> 'PENDING' THEN DC_LICENSE_PLATE_LINE_DETAILS
                 WHEN @FailStep = 'DC_LICENSE_PLATE_LINE_DETAILS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'DC_LICENSE_PLATE_LINE_DETAILS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        IC_QUALITY_DOCS = CASE WHEN IC_QUALITY_DOCS <> 'PENDING' THEN IC_QUALITY_DOCS
                 WHEN @FailStep = 'IC_QUALITY_DOCS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'IC_QUALITY_DOCS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        IC_QUALITY_DOC_LINES = CASE WHEN IC_QUALITY_DOC_LINES <> 'PENDING' THEN IC_QUALITY_DOC_LINES
                 WHEN @FailStep = 'IC_QUALITY_DOC_LINES' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'IC_QUALITY_DOC_LINES') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
        IC_QUALITY_DOC_LINE_DETAILS = CASE WHEN IC_QUALITY_DOC_LINE_DETAILS <> 'PENDING' THEN IC_QUALITY_DOC_LINE_DETAILS
                 WHEN @FailStep = 'IC_QUALITY_DOC_LINE_DETAILS' THEN 'FAILED'
                 WHEN EXISTS (SELECT 1 FROM @Steps S WHERE S.TBL = 'IC_QUALITY_DOC_LINE_DETAILS') THEN 'ROLLED_BACK'
                 ELSE 'NOT_ATTEMPTED' END,
                T.FINAL_STATUS = 'F', T.FAIL_TABLE = @FailStep, T.ERROR_NUMBER = @ErrNum,
                T.ERROR_LINE = @ErrLine, T.ERROR_MESSAGE = @FullMsg, T.PROCESSED_AT = SYSDATETIME()
            FROM #LOAD_TRACK T JOIN #R r ON r.GEM_DBKEY = T.GEM_DBKEY;

            UPDATE K
            SET K.STATUS_FLAG = 'F',
                K.RS_MESSAGE_TEXT = LEFT(N'Failed to populate due to: ' + @FullMsg, @MsgMax)
            FROM KAS_DC_LOADS K JOIN #R r ON r.GEM_DBKEY = K.GEM_DBKEY
            WHERE K.STATUS_FLAG = 'V';
        END;
    END CATCH;
END;

-- ---------------------------------------------------------------------------
-- 5. Run summary (the tracker #LOAD_TRACK stays available in this session)
-- ---------------------------------------------------------------------------
SELECT FINAL_STATUS, COUNT(*) AS RECORDS FROM #LOAD_TRACK GROUP BY FINAL_STATUS;

SELECT * FROM #LOAD_TRACK WHERE FINAL_STATUS = 'F' ORDER BY COMPANY_CODE, DC_LICENSE_PLATE_ID, DC_LICENSE_PLATE_LINE;
