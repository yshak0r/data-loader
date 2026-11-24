-- ============================================================================
-- LOAD_SO_COMPLETE.sql
-- ONE sales order loader for every supported product type. Each KAS_SO_LOADS row is
-- classified by its PRODUCT_MASTER.
-- and loaded accordingly:
--
--   SN  single / non-packaged   IC_PRODUCT_UOM_CONTROL = 'S', IC_PACKAGED_PRODUCT = 'N'
--         1 quantity row  : UNIT_SALES = QUANTITY
--   SP  single / packaged       IC_PRODUCT_UOM_CONTROL = 'S', IC_PACKAGED_PRODUCT = 'Y'
--         2 quantity rows : UNIT_SALES (packaging unit) = QUANTITY
--                           IC_UNIT_CAPACITY (inventory unit) =
--                             FIN.RS_UOM_CONVERSION(company, part, UNIT_SALES, IC_UNIT_CAPACITY, QUANTITY)
--   PN  potent / non-packaged   IC_PRODUCT_UOM_CONTROL = 'P', IC_PACKAGED_PRODUCT = 'N'
--         2 quantity rows : UNIT_SALES (e.g. LBS) = QUANTITY
--                           formula unit (e.g. SLBS) = LBS * lot-characteristic default (ACTBRX)
--                                                          / product-characteristic default (STDBRX)
--                           (a sales order has no lot yet, so the product defaults are used;
--                            formula via PART_UOM_CONVERSIONS / SYS_FORMULA_DEFINITIONS /
--                            IC_PRODUCT_CHARACTERISTICS, as in Complete_Loader_Tracked.sql)
--         the staging unit (KAS_SO_LOADS.UNIT_SALES) must equal PRODUCT_MASTER.UNIT_SALES
--   Any other combination (e.g. potent / packaged) is not supported: the validator rejects it,
--   and this loader never loads it.
--   The two quantity rows are written to SALES_ORDER_LINE_QTYS and SALES_ORDER_LINE_DETAIL_QTYS.
--
-- An order may mix SN, SP and PN lines: each line follows the rules of its own category.
--
-- Processes only FIN.KAS_SO_LOADS rows with
--   STATUS_FLAG = 'V' AND RS_MESSAGE_TEXT = 'Validated'
--
-- Tables populated (nothing else is written):
--   SALES_ORDER_HEADERS, SALES_ORDER_LINES, SALES_ORDER_LINE_DETAILS,
--   SALES_ORDER_LINE_QTYS, SALES_ORDER_LINE_DETAIL_QTYS
--   plus, from FIN.KAS_SO_EXPORT_LOADS (section 7, record by record, validated rows only):
--   SOP_ORDER_HEADER_EXP_DETAILS, SALES_ORDER_EXPORT_NOTES
--
-- Behaviour:
--   * One sales order per (COMPANY_CODE, DIVISION, CUSTOMER_NUMBER,
--     CUSTOMER_REFERENCE). WAREHOUSE, delivery address and dates are NOT part
--     of the grouping key.
--   * COMPANY_CODE / DIVISION come from the staging rows (no defaults).
--   * An order group is loaded ONLY when every staging row in the group is
--     validated and of a supported category. Groups with any new / errored /
--     already-processed row are skipped whole, so an order is never created from
--     part of its lines.
--   * ORDER_NUMBER: if the staging rows already carry an ORDER_NUMBER, that number
--     is used for the order (rows with the same provided number and the same
--     customer/reference form one order; different provided numbers = different
--     orders). Rows with no ORDER_NUMBER get a number allocated from
--     FIN.SOP_TRANSACTION_TYPES (TRANSACTION_TYPE = 'SO') under UPDLOCK/HOLDLOCK.
--     Provided numbers do not move the counter.
--     A provided number is SKIPPED (group stays 'V', listed in a result set) when it
--     is longer than 9 characters, already exists on SALES_ORDER_HEADERS, or is used
--     by more than one customer/reference group.
--   * Prices / freight come from the CSV staging values only.
--   * SALES_ORDER_HEADERS.EDI_ORDER (Y/N) is populated from KAS_SO_LOADS.EDI_ORDER.
--   * IC demand / reservations / commitments are NOT written (IC engine owns them).
--   * Serialized with the validator and CLEAR_SO_TABLES by an application lock
--     (session-owned, released at the end).
--   * RESULT IN KAS_SO_LOADS (nothing is left unexplained):
--       loaded  : STATUS_FLAG = 'P', RS_MESSAGE_TEXT = 'Loaded as order number : <n>',
--                 ORDER_NUMBER / ORDER_LINE_NUMBER / PROCESSED_DATE filled
--       failed  : STATUS_FLAG = 'F', RS_MESSAGE_TEXT = 'Failed due to : <reason>' on the
--                 line that failed, and 'Failed because other line of this order failed
--                 loading' on every other line of the same order
--   * HOW FAILURES ARE HANDLED
--       1. Checks that can be tied to a line (bad quantity, unusable provided order
--          number, missing counter row, category-specific unit / conversion problems,
--          missing UOM conversion, weight/volume that cannot be derived, order number
--          collision) fail that order BEFORE anything is written.
--       2. All remaining orders are loaded in ONE transaction inside TRY/CATCH.
--       3. If that batch fails it is rolled back completely and the orders are retried
--          one per transaction (a failed order is rolled back and not loaded further).
--          For a failed order each line is probed in a transaction that is always
--          rolled back, to find the line (and the SQL Server error) that failed.
--       4. Any unexpected error outside the load marks every line of the run as 'F'
--          with the error text.
--     Allocated order numbers are NOT rolled back (counter is advanced in its own short
--     transaction), so a failed order leaves a gap in the numbering.
--
-- Run VALIDATE_KAS_SO_LOADS.sql first.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SO_MODULE VARCHAR(2) = 'SO';
DECLARE @LOCK_RC   INT;

-- IC_APPROX_QTY_FLAG written on the quantity rows, per product category.
-- SN: 'N' (working single loader). SP: 'N' (confirm against a manual packaged order).
-- PN: blank, as on the manually created potent order.
DECLARE @APPROX_SN VARCHAR(1) = 'N';
DECLARE @APPROX_SP VARCHAR(1) = 'N';
DECLARE @APPROX_PN VARCHAR(1) = '';

-- WEIGHT/VOLUME: GEM parameter values (M / D / F confirmed)
DECLARE @MULT CHAR(1) = 'M', @DIV CHAR(1) = 'D', @FORM CHAR(1) = 'F';
-- !! FILL IN: stored values of the IC_WTVOL_* parameters
DECLARE @WV_ACTUAL    VARCHAR(10) = 'A';   -- IC_WTVOL_ACTUAL
DECLARE @WV_FIXED     VARCHAR(10) = 'F';   -- IC_WTVOL_FIXED
DECLARE @WV_INVENTORY VARCHAR(10) = 'I';   -- IC_WTVOL_INVENTORY
DECLARE @WV_PACKAGED  VARCHAR(10) = 'P';   -- IC_WTVOL_PACKAGED
IF @WV_ACTUAL IS NULL OR @WV_FIXED IS NULL OR @WV_INVENTORY IS NULL OR @WV_PACKAGED IS NULL
BEGIN
    RAISERROR('LOAD_SO_COMPLETE: set @WV_ACTUAL / @WV_FIXED / @WV_INVENTORY / @WV_PACKAGED from the IC_WTVOL_* parameters.', 16, 1);
    RETURN;
END

IF OBJECT_ID('tempdb..#ALL_VALID')      IS NOT NULL DROP TABLE #ALL_VALID;
IF OBJECT_ID('tempdb..#BLOCKED_GROUPS') IS NOT NULL DROP TABLE #BLOCKED_GROUPS;
IF OBJECT_ID('tempdb..#ELIGIBLE')       IS NOT NULL DROP TABLE #ELIGIBLE;
IF OBJECT_ID('tempdb..#KAS_VALID')      IS NOT NULL DROP TABLE #KAS_VALID;
IF OBJECT_ID('tempdb..#BAD_PROV')       IS NOT NULL DROP TABLE #BAD_PROV;
IF OBJECT_ID('tempdb..#SO_GROUPS')      IS NOT NULL DROP TABLE #SO_GROUPS;
IF OBJECT_ID('tempdb..#ORD_START')      IS NOT NULL DROP TABLE #ORD_START;
IF OBJECT_ID('tempdb..#SO_ORDERS')      IS NOT NULL DROP TABLE #SO_ORDERS;
IF OBJECT_ID('tempdb..#LINES')          IS NOT NULL DROP TABLE #LINES;
IF OBJECT_ID('tempdb..#CONV_USE')       IS NOT NULL DROP TABLE #CONV_USE;
IF OBJECT_ID('tempdb..#CONV_REQ')       IS NOT NULL DROP TABLE #CONV_REQ;
IF OBJECT_ID('tempdb..#CONV')           IS NOT NULL DROP TABLE #CONV;
IF OBJECT_ID('tempdb..#FAILED')         IS NOT NULL DROP TABLE #FAILED;
IF OBJECT_ID('tempdb..#UNIT')           IS NOT NULL DROP TABLE #UNIT;
IF OBJECT_ID('tempdb..#PROBE')          IS NOT NULL DROP TABLE #PROBE;
IF OBJECT_ID('tempdb..#RUN_LINES')      IS NOT NULL DROP TABLE #RUN_LINES;
IF OBJECT_ID('tempdb..#RUN_ORDERS')     IS NOT NULL DROP TABLE #RUN_ORDERS;

-- Serialize with the validator / other loaders / CLEAR_SO_TABLES.
-- Session-owned lock: it survives the per-order rollbacks below and is released at the end.
EXEC @LOCK_RC = sys.sp_getapplock @Resource = N'KAS_SO_LOADS_PIPELINE',
                                  @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0;
IF @LOCK_RC < 0
BEGIN
    RAISERROR('LOAD_SO_COMPLETE: another validate/load/clear run is in progress. Try again when it finishes.', 16, 1);
    RETURN;
END

-- Failure bookkeeping
CREATE TABLE #FAILED     (ID INT NOT NULL PRIMARY KEY, GROUP_KEY VARCHAR(300) NOT NULL,
                          ROOT BIT NOT NULL, REASON NVARCHAR(2000) NULL);   -- ROOT=1 failed line, 0 = sibling
CREATE TABLE #UNIT       (SEQ INT IDENTITY(1,1) PRIMARY KEY, KIND CHAR(1) NOT NULL,   -- B batch, O order, L line probe, R resolve
                          COMPANY_CODE VARCHAR(10) NULL, DIVISION VARCHAR(2) NULL,
                          ORDER_NUMBER VARCHAR(9) NULL, LINE_ID INT NULL, ERR NVARCHAR(2000) NULL);
CREATE TABLE #PROBE      (ID INT NOT NULL, ERR NVARCHAR(2000) NULL, HDR BIT NOT NULL);
CREATE TABLE #RUN_LINES  (ID INT NOT NULL PRIMARY KEY);
CREATE TABLE #RUN_ORDERS (COMPANY_CODE VARCHAR(10) NOT NULL, DIVISION VARCHAR(2) NOT NULL, ORDER_NUMBER VARCHAR(9) NOT NULL);

BEGIN TRY

-- ----------------------------------------------------------------------------
-- 1. Normalize all validated staging rows and flag which ones are this scenario
-- ----------------------------------------------------------------------------
SELECT
       K.ID,
       K.COMPANY_CODE,
       K.DIVISION,
       K.ORDER_DATE,
       K.CUSTOMER_NUMBER,
       K.DELIVERY_ADDRESS_CODE,
       K.CUSTOMER_REFERENCE,
       K.EDI_ORDER,
       K.SYS_DELIVERY_DATE,
       K.WAREHOUSE,
       K.PART_CODE,
       ISNULL(K.QUANTITY, 0)    AS QUANTITY,
       ISNULL(K.SALES_PRICE, 0) AS SALES_PRICE,
       ISNULL(K.FREIGHT, 0)     AS FREIGHT,
       K.UNIT_SALES             AS STG_UNIT_SALES,   -- unit sent on the staging row (checked for PN only)
       PM.UNIT_SALES,
       PM.IC_UNIT_CAPACITY      AS CAP_UOM,          -- inventory (capacity) unit (used by SP)
       PM.UNIT_PRICE,
       PM.PRODUCT_GROUP,
       PM.PRODUCT_TAX_CODE,
       PM.SOP_NOMINATED_UNIT,
       PM.SOP_NOMINATED_PRICE_UNIT,
       -- weight / volume source fields (LB_S_L_WTVOL)
       ISNULL(PM.IC_WEIGHT_FROM_CONTROL, '')    AS WT_CTRL,
       ISNULL(PM.WEIGHT_UOM, '')                AS ITEM_WEIGHT_UOM,
       ISNULL(PM.WEIGHT_GROSS, 0)               AS WT_FIXED,
       ISNULL(PM.IC_UNIT_WEIGHT_FROM, '')       AS WT_FROM_UOM,
       ISNULL(PM.IC_VOLUME_FROM_CONTROL, '')    AS VOL_CTRL,
       ISNULL(PM.CUBIC_SIZE_UOM, '')            AS ITEM_VOLUME_UOM,
       ISNULL(PM.CUBIC_SIZE, 0)                 AS VOL_FIXED,
       ISNULL(PM.IC_UNIT_VOLUME_FROM, '')       AS VOL_FROM_UOM,
       ISNULL(AC.DEFAULT_WEIGHT_UNIT, '')       AS HDR_WEIGHT_UOM,
       ISNULL(AC.DEFAULT_VOLUME_UNIT, '')       AS HDR_VOLUME_UOM,
       CASE WHEN PM.IC_PACKAGED_PRODUCT = 'Y'
            THEN PM.UNIT_SALES ELSE '' END AS IC_PACK_UNIT,
       -- product category, same split as Complete_Loader_Tracked.sql (NULL = not supported)
       CASE WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S' AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'SN'
            WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S' AND PM.IC_PACKAGED_PRODUCT = 'Y' THEN 'SP'
            WHEN PM.IC_PRODUCT_UOM_CONTROL = 'P' AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'PN'
       END AS CAT,
       CASE WHEN (PM.IC_PRODUCT_UOM_CONTROL = 'S' AND PM.IC_PACKAGED_PRODUCT IN ('N','Y'))
              OR (PM.IC_PRODUCT_UOM_CONTROL = 'P' AND PM.IC_PACKAGED_PRODUCT = 'N')
            THEN 1 ELSE 0 END AS IS_TARGET,
       -- order number already provided on the staging row (NULL = allocate one)
       NULLIF(LTRIM(RTRIM(K.ORDER_NUMBER)), '') AS PROV_ORDER,
       -- BASE_KEY must stay identical to GROUP_KEY in VALIDATE_KAS_SO_LOADS.sql
       -- (used for the "never load part of a customer/reference" blocking rule)
       CONCAT(LTRIM(RTRIM(K.COMPANY_CODE)), '|',
              LTRIM(RTRIM(K.DIVISION)), '|',
              LTRIM(RTRIM(K.CUSTOMER_NUMBER)), '|',
              LTRIM(RTRIM(K.CUSTOMER_REFERENCE))) AS BASE_KEY,
       -- GROUP_KEY = one sales order: BASE_KEY + the provided order number (blank = auto)
       CONCAT(LTRIM(RTRIM(K.COMPANY_CODE)), '|',
              LTRIM(RTRIM(K.DIVISION)), '|',
              LTRIM(RTRIM(K.CUSTOMER_NUMBER)), '|',
              LTRIM(RTRIM(K.CUSTOMER_REFERENCE)), '|',
              ISNULL(NULLIF(LTRIM(RTRIM(K.ORDER_NUMBER)), ''), '')) AS GROUP_KEY
INTO #ALL_VALID
FROM FIN.KAS_SO_LOADS K
JOIN FIN.PRODUCT_MASTER PM
  ON PM.COMPANY_CODE = K.COMPANY_CODE
 AND PM.PART_CODE    = K.PART_CODE
LEFT JOIN FIN.AR_CONTROLS AC
  ON AC.COMPANY_CODE = K.COMPANY_CODE
 AND AC.DIVISION     = K.DIVISION        -- confirm AR_CONTROLS key
WHERE K.STATUS_FLAG     = 'V'
  AND K.RS_MESSAGE_TEXT = 'Validated';

-- ----------------------------------------------------------------------------
-- 2. Eligible orders
--    (a) every validated line belongs to this scenario, and
--    (b) the group has NO staging row that is not validated (new / error /
--        already processed) - otherwise the order would be created partially.
-- ----------------------------------------------------------------------------
SELECT DISTINCT
       CONCAT(LTRIM(RTRIM(K.COMPANY_CODE)), '|',
              LTRIM(RTRIM(K.DIVISION)), '|',
              LTRIM(RTRIM(K.CUSTOMER_NUMBER)), '|',
              LTRIM(RTRIM(K.CUSTOMER_REFERENCE))) AS GROUP_KEY
INTO #BLOCKED_GROUPS
FROM FIN.KAS_SO_LOADS K
WHERE ISNULL(K.STATUS_FLAG, 'N') <> 'V'
   OR ISNULL(K.RS_MESSAGE_TEXT, '') <> 'Validated';

SELECT V.BASE_KEY
INTO #ELIGIBLE
FROM #ALL_VALID V
WHERE NOT EXISTS (SELECT 1 FROM #BLOCKED_GROUPS B WHERE B.GROUP_KEY = V.BASE_KEY)
GROUP BY V.BASE_KEY
HAVING MIN(V.IS_TARGET) = 1;

SELECT V.*
INTO #KAS_VALID
FROM #ALL_VALID V
JOIN #ELIGIBLE E ON E.BASE_KEY = V.BASE_KEY
WHERE V.IS_TARGET = 1;

DECLARE @SKIPPED INT =
    (SELECT COUNT(DISTINCT V.BASE_KEY)
     FROM #ALL_VALID V
     JOIN #BLOCKED_GROUPS B ON B.GROUP_KEY = V.BASE_KEY
     WHERE V.IS_TARGET = 1);
IF @SKIPPED > 0
    PRINT CONCAT('LOAD_SO_COMPLETE: skipped ', @SKIPPED,
                 ' order group(s) that still contain non-validated or already-processed staging rows.');

-- ----------------------------------------------------------------------------
-- 2b. Provided ORDER_NUMBERs: skip (whole group) any that cannot be used
-- ----------------------------------------------------------------------------
SELECT X.GROUP_KEY, X.COMPANY_CODE, X.DIVISION, X.PROV_ORDER,
       CASE WHEN LEN(X.PROV_ORDER) > 9
                 THEN 'Order number is longer than 9 characters'
            WHEN EXISTS (SELECT 1 FROM FIN.SALES_ORDER_HEADERS H
                         WHERE H.COMPANY_CODE = X.COMPANY_CODE
                           AND H.DIVISION     = X.DIVISION
                           AND H.ORDER_NUMBER = X.PROV_ORDER)
                 THEN 'Order number already exists on SALES_ORDER_HEADERS'
            ELSE 'Same order number is used by more than one customer/reference group'
       END AS REASON
INTO #BAD_PROV
FROM (SELECT G.GROUP_KEY, G.COMPANY_CODE, G.DIVISION, G.PROV_ORDER,
             COUNT(*) OVER (PARTITION BY G.COMPANY_CODE, G.DIVISION, G.PROV_ORDER) AS SAME_NO
      FROM (SELECT GROUP_KEY,
                   MIN(COMPANY_CODE) AS COMPANY_CODE,
                   MIN(DIVISION)     AS DIVISION,
                   MIN(PROV_ORDER)   AS PROV_ORDER
            FROM #KAS_VALID
            WHERE PROV_ORDER IS NOT NULL
            GROUP BY GROUP_KEY) G) X
WHERE LEN(X.PROV_ORDER) > 9
   OR X.SAME_NO > 1
   OR EXISTS (SELECT 1 FROM FIN.SALES_ORDER_HEADERS H
              WHERE H.COMPANY_CODE = X.COMPANY_CODE
                AND H.DIVISION     = X.DIVISION
                AND H.ORDER_NUMBER = X.PROV_ORDER);

IF EXISTS (SELECT 1 FROM #BAD_PROV)
BEGIN
    INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
    SELECT V.ID, V.GROUP_KEY, 1, CONCAT('Provided order number ', B.PROV_ORDER, ': ', B.REASON)
    FROM #KAS_VALID V
    JOIN #BAD_PROV B ON B.GROUP_KEY = V.GROUP_KEY
    WHERE NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);
    DELETE V FROM #KAS_VALID V WHERE EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);
    PRINT CONCAT('LOAD_SO_COMPLETE: ', (SELECT COUNT(*) FROM #BAD_PROV),
                 ' order group(s) failed: unusable provided ORDER_NUMBER (marked F).');
END

-- 2c. Quantity must be a number (the order is failed as a whole, before anything is written)
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT V.ID, V.GROUP_KEY, 1, CONCAT('Quantity is not a valid number: ', V.QUANTITY)
FROM #KAS_VALID V
WHERE TRY_CAST(V.QUANTITY AS DECIMAL(28,10)) IS NULL
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);

INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)      -- sibling lines of those orders
SELECT V.ID, V.GROUP_KEY, 0, NULL
FROM #KAS_VALID V
WHERE EXISTS (SELECT 1 FROM #FAILED F WHERE F.GROUP_KEY = V.GROUP_KEY AND F.ROOT = 1)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F2 WHERE F2.ID = V.ID);
DELETE V FROM #KAS_VALID V WHERE EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);

IF NOT EXISTS (SELECT 1 FROM #KAS_VALID)
    PRINT 'LOAD_SO_COMPLETE: no eligible validated rows left to load (supported categories: SN, SP, PN).';

-- ----------------------------------------------------------------------------
-- 3. Order groups (warehouse excluded)
-- ----------------------------------------------------------------------------
SELECT GROUP_KEY,
       MIN(PROV_ORDER)            AS PROV_ORDER,      -- NULL = allocate from the counter
       MIN(COMPANY_CODE)          AS COMPANY_CODE,
       MIN(DIVISION)              AS DIVISION,
       MIN(CUSTOMER_NUMBER)       AS CUSTOMER_NUMBER,
       MIN(DELIVERY_ADDRESS_CODE) AS DELIVERY_ADDRESS_CODE,
       MIN(CUSTOMER_REFERENCE)    AS CUSTOMER_REFERENCE,
       MIN(EDI_ORDER)             AS EDI_ORDER,
       MIN(ORDER_DATE)            AS ORDER_DATE,
       MIN(SYS_DELIVERY_DATE)     AS SYS_DELIVERY_DATE,
       COALESCE(SUM(QUANTITY * SALES_PRICE), 0) AS LINE_VALUE,
       COALESCE(SUM(FREIGHT), 0) AS FREIGHT_HDR
INTO #SO_GROUPS
FROM #KAS_VALID
GROUP BY GROUP_KEY;

-- ----------------------------------------------------------------------------
-- 4. ORDER_NUMBER: use the provided number; allocate from SOP_TRANSACTION_TYPES
--    only for groups without one
-- ----------------------------------------------------------------------------
-- No counter row for a company/division: those (auto-numbered) orders fail, the rest continue
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT V.ID, V.GROUP_KEY, 1,
       CONCAT('No FIN.SOP_TRANSACTION_TYPES row (TRANSACTION_TYPE=', @SO_MODULE, ') for company ',
              V.COMPANY_CODE, ' division ', V.DIVISION, ': cannot allocate an order number')
FROM #KAS_VALID V
WHERE V.PROV_ORDER IS NULL
  AND NOT EXISTS (SELECT 1 FROM FIN.SOP_TRANSACTION_TYPES T
                  WHERE T.COMPANY_CODE = V.COMPANY_CODE AND T.DIVISION = V.DIVISION
                    AND T.TRANSACTION_TYPE = @SO_MODULE)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);
DELETE V FROM #KAS_VALID V WHERE EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);
DELETE G FROM #SO_GROUPS G WHERE EXISTS (SELECT 1 FROM #FAILED F WHERE F.GROUP_KEY = G.GROUP_KEY);

-- The counter is advanced in its own short transaction (numbers are reserved even if an
-- order later fails, so a failed order leaves a gap but never reuses a number).
BEGIN TRANSACTION;

SELECT T.COMPANY_CODE,
       T.DIVISION,
       T.TRANSACTION_NUMBER AS START_NUMBER,
       C.CNT
INTO #ORD_START
FROM FIN.SOP_TRANSACTION_TYPES T WITH (UPDLOCK, HOLDLOCK)
JOIN (SELECT COMPANY_CODE, DIVISION, COUNT(*) AS CNT
      FROM #SO_GROUPS
      WHERE PROV_ORDER IS NULL
      GROUP BY COMPANY_CODE, DIVISION) C
  ON C.COMPANY_CODE = T.COMPANY_CODE
 AND C.DIVISION     = T.DIVISION
WHERE T.TRANSACTION_TYPE = @SO_MODULE;

UPDATE T
SET TRANSACTION_NUMBER = S.START_NUMBER + S.CNT
FROM FIN.SOP_TRANSACTION_TYPES T
JOIN #ORD_START S
  ON S.COMPANY_CODE = T.COMPANY_CODE
 AND S.DIVISION     = T.DIVISION
WHERE T.TRANSACTION_TYPE = @SO_MODULE;

COMMIT TRANSACTION;

SELECT G.GROUP_KEY,
       G.COMPANY_CODE,
       G.DIVISION,
       G.CUSTOMER_NUMBER,
       G.DELIVERY_ADDRESS_CODE,
       G.CUSTOMER_REFERENCE,
       G.EDI_ORDER,
       G.ORDER_DATE,
       G.SYS_DELIVERY_DATE,
       G.LINE_VALUE,
       G.FREIGHT_HDR,
       CAST(S.START_NUMBER
            + ROW_NUMBER() OVER (PARTITION BY G.COMPANY_CODE, G.DIVISION
                                 ORDER BY G.CUSTOMER_NUMBER, G.CUSTOMER_REFERENCE,
                                          G.ORDER_DATE, G.SYS_DELIVERY_DATE,
                                          G.DELIVERY_ADDRESS_CODE) - 1
            AS VARCHAR(9)) AS ORDER_NUMBER,
       CAST(0 AS BIT) AS IS_PROV
INTO #SO_ORDERS
FROM #SO_GROUPS G
JOIN #ORD_START S
  ON S.COMPANY_CODE = G.COMPANY_CODE
 AND S.DIVISION     = G.DIVISION
WHERE G.PROV_ORDER IS NULL
UNION ALL
SELECT G.GROUP_KEY,
       G.COMPANY_CODE,
       G.DIVISION,
       G.CUSTOMER_NUMBER,
       G.DELIVERY_ADDRESS_CODE,
       G.CUSTOMER_REFERENCE,
       G.EDI_ORDER,
       G.ORDER_DATE,
       G.SYS_DELIVERY_DATE,
       G.LINE_VALUE,
       G.FREIGHT_HDR,
       CAST(G.PROV_ORDER AS VARCHAR(9)) AS ORDER_NUMBER,
       CAST(1 AS BIT) AS IS_PROV
FROM #SO_GROUPS G
WHERE G.PROV_ORDER IS NOT NULL;

-- An allocated number may collide with an existing order or with a provided number
-- (e.g. a provided number inside the counter's range). Those orders fail, the rest continue.
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT V.ID, V.GROUP_KEY, 1,
       CONCAT('Allocated order number ', O.ORDER_NUMBER,
              ' already exists or is duplicated in this run (provided order number inside the counter range?)')
FROM #SO_ORDERS O
JOIN #KAS_VALID V ON V.GROUP_KEY = O.GROUP_KEY
WHERE O.IS_PROV = 0
  AND (EXISTS (SELECT 1 FROM FIN.SALES_ORDER_HEADERS H
               WHERE H.COMPANY_CODE = O.COMPANY_CODE AND H.DIVISION = O.DIVISION
                 AND H.ORDER_NUMBER = O.ORDER_NUMBER)
       OR (SELECT COUNT(*) FROM #SO_ORDERS O2
           WHERE O2.COMPANY_CODE = O.COMPANY_CODE AND O2.DIVISION = O.DIVISION
             AND O2.ORDER_NUMBER = O.ORDER_NUMBER) > 1)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = V.ID);

-- ----------------------------------------------------------------------------
-- 4b. Line numbering (and a completeness check: every staged row gets a line)
-- ----------------------------------------------------------------------------
SELECT K.*,
       O.ORDER_NUMBER,
       ROW_NUMBER() OVER (PARTITION BY O.COMPANY_CODE, O.DIVISION, O.ORDER_NUMBER ORDER BY K.ID) AS LINE_NO
INTO #LINES
FROM #KAS_VALID K
JOIN #SO_ORDERS O ON O.GROUP_KEY = K.GROUP_KEY;

IF (SELECT COUNT(*) FROM #LINES) <> (SELECT COUNT(*) FROM #KAS_VALID)
    THROW 50001, 'LOAD_SO_COMPLETE: line count does not match validated staging rows.', 1;


ALTER TABLE #LINES ADD
    ITEM_WEIGHT DECIMAL(28,10) NULL, ITEM_VOLUME DECIMAL(28,10) NULL,
    WEIGHT_HDR  DECIMAL(28,10) NULL, VOLUME_HDR  DECIMAL(28,10) NULL,
    SEC_UOM     VARCHAR(50)    NULL,                  -- PN: potency unit (e.g. SLBS)
    SEC_QTY     DECIMAL(28,10) NULL,                  -- PN: quantity in the potency unit
    SEC_MATCHES INT            NULL,                  -- PN: number of different formula conversions found
    CAP_QTY     DECIMAL(28,10) NULL,                  -- SP: QUANTITY converted to the inventory (capacity) unit
    CAP_DONE    BIT            NOT NULL DEFAULT 0,    -- SP: conversion attempted for this line
    U2_UOM      VARCHAR(50)    NULL,                  -- second quantity unit of the line (SP / PN), NULL for SN
    U2_QTY      DECIMAL(28,10) NULL,                  -- quantity in the second unit
    WT_UOM      VARCHAR(50)    NULL, WT_QTY  DECIMAL(28,10) NULL,   -- quantity/unit the weight rule uses
    VOL_UOM     VARCHAR(50)    NULL, VOL_QTY DECIMAL(28,10) NULL;   -- quantity/unit the volume rule uses

-- ============================================================================
-- 4b2. Category specific quantity conversions. Lines of category SN need none.
--      Each check fails the line's order BEFORE anything is written.
-- ============================================================================

-- ---- PN: potency conversion (LBS -> SLBS), as Complete_Loader_Tracked.sql (category PN)
--      SLBS = LBS * <lot characteristic default> / <product characteristic default>
--      A sales order line has no lot yet, so the product defaults are used for both.
UPDATE L
SET SEC_MATCHES = F.N_MATCH,
    SEC_UOM     = CASE WHEN F.N_MATCH = 1 THEN F.ACT_UOM END,
    SEC_QTY     = CASE WHEN F.N_MATCH = 1 THEN F.ACT_QTY END
FROM #LINES L
CROSS APPLY (
    SELECT MIN(X.ACT_UOM) AS ACT_UOM, MIN(X.ACT_QTY) AS ACT_QTY,
           COUNT(DISTINCT CONCAT(X.ACT_UOM, '|', X.ACT_QTY)) AS N_MATCH
    FROM (SELECT PUC.UNIT_TO AS ACT_UOM,
                 CAST(L.QUANTITY AS DECIMAL(28,10)) * PCL.IC_DEF_CHAR_NUMERIC
                         / NULLIF(PC.IC_DEF_CHAR_NUMERIC, 0) AS ACT_QTY
          FROM FIN.PART_UOM_CONVERSIONS PUC
          JOIN FIN.SYS_FORMULA_DEFINITIONS FD_LOT
               ON FD_LOT.SYS_FORMULA_CODE = PUC.SYS_FORMULA_CODE AND FD_LOT.SYS_DEFINITION_TYPE = 'L'
          JOIN FIN.SYS_FORMULA_DEFINITIONS FD_PROD
               ON FD_PROD.SYS_FORMULA_CODE = PUC.SYS_FORMULA_CODE AND FD_PROD.SYS_DEFINITION_TYPE = 'P'
          JOIN FIN.IC_PRODUCT_CHARACTERISTICS PCL
               ON PCL.COMPANY_CODE = L.COMPANY_CODE AND PCL.PART_CODE = L.PART_CODE
              AND PCL.CHARACTERISTIC_CODE = FD_LOT.CHARACTERISTIC_CODE
          JOIN FIN.IC_PRODUCT_CHARACTERISTICS PC
               ON PC.COMPANY_CODE = L.COMPANY_CODE AND PC.PART_CODE = L.PART_CODE
              AND PC.CHARACTERISTIC_CODE = FD_PROD.CHARACTERISTIC_CODE
          WHERE PUC.COMPANY_CODE = L.COMPANY_CODE
            AND PUC.PART_CODE    = L.PART_CODE
            AND PUC.UNIT_FROM    = L.UNIT_SALES
            AND PUC.SYS_FORMULA_CODE <> '') X
) F
WHERE L.CAT = 'PN';

INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 1,
       CASE WHEN L.SEC_MATCHES > 1
                 THEN CONCAT('More than one different formula-driven UOM conversion matches part ', L.PART_CODE,
                             ' from unit ', L.UNIT_SALES, ': the potency unit and quantity are ambiguous')
            WHEN L.SEC_UOM = L.UNIT_SALES
                 THEN CONCAT('Potency conversion for part ', L.PART_CODE, ' converts unit ', L.UNIT_SALES, ' to itself')
            ELSE CONCAT('No usable formula-driven UOM conversion for part ', L.PART_CODE, ' from unit ', L.UNIT_SALES,
                        ' (PART_UOM_CONVERSIONS / SYS_FORMULA_DEFINITIONS / IC_PRODUCT_CHARACTERISTICS defaults missing, STDBRX is zero, or sales unit is not the formula source unit)')
       END
FROM #LINES L
WHERE L.CAT = 'PN'
  AND (L.SEC_MATCHES <> 1
       OR NULLIF(LTRIM(RTRIM(L.SEC_UOM)), '') IS NULL
       OR L.SEC_QTY IS NULL
       OR L.SEC_UOM = L.UNIT_SALES)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);

-- ---- PN: the unit on the staging row (KAS_SO_LOADS.UNIT_SALES) must equal PRODUCT_MASTER.UNIT_SALES.
--      The order is always loaded in the product's own sales unit; the staging unit is only checked.
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 1,
       CASE WHEN NULLIF(LTRIM(RTRIM(L.STG_UNIT_SALES)), '') IS NULL
            THEN CONCAT('Staging UNIT_SALES is blank; it must equal the sales unit ', L.UNIT_SALES, ' of part ', L.PART_CODE)
            ELSE CONCAT('Staging UNIT_SALES ', L.STG_UNIT_SALES, ' does not match PRODUCT_MASTER.UNIT_SALES ',
                        L.UNIT_SALES, ' of part ', L.PART_CODE)
       END
FROM #LINES L
WHERE L.CAT = 'PN'
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID)
  AND ISNULL(LTRIM(RTRIM(L.STG_UNIT_SALES)), '') <> ISNULL(LTRIM(RTRIM(L.UNIT_SALES)), '');

-- ---- PN: both units of the potent pair must be defined for the part in IC_PRODUCT_MASTER_UNITS
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 1,
       CASE WHEN NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                             WHERE U.COMPANY_CODE = L.COMPANY_CODE AND U.PART_CODE = L.PART_CODE
                               AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(L.UNIT_SALES)))
            THEN CONCAT('Sales unit ', L.UNIT_SALES, ' is not defined for part ', L.PART_CODE, ' in IC_PRODUCT_MASTER_UNITS')
            ELSE CONCAT('Potency unit ', L.SEC_UOM, ' (from the UOM conversion formula) is not defined for part ',
                        L.PART_CODE, ' in IC_PRODUCT_MASTER_UNITS')
       END
FROM #LINES L
WHERE L.CAT = 'PN'
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID)
  AND (NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                   WHERE U.COMPANY_CODE = L.COMPANY_CODE AND U.PART_CODE = L.PART_CODE
                     AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(L.UNIT_SALES)))
       OR NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                      WHERE U.COMPANY_CODE = L.COMPANY_CODE AND U.PART_CODE = L.PART_CODE
                        AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(L.SEC_UOM))));

-- ---- SP: packaging -> inventory (capacity) unit, as Complete_Loader_Tracked.sql (category SP):
--      CAP_QTY = FIN.RS_UOM_CONVERSION(company, part, UNIT_SALES, IC_UNIT_CAPACITY, QUANTITY)
--      Pre-checks first (clear reasons), then the function is called line by line inside its own
--      TRY/CATCH: one bad line fails its order, never the whole run.
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 1,
       CASE
         WHEN NULLIF(LTRIM(RTRIM(L.CAP_UOM)), '') IS NULL
              THEN CONCAT('Packaged part ', L.PART_CODE, ': PRODUCT_MASTER.IC_UNIT_CAPACITY (inventory unit) is blank')
         WHEN LTRIM(RTRIM(L.CAP_UOM)) = LTRIM(RTRIM(L.UNIT_SALES))
              THEN CONCAT('Packaged part ', L.PART_CODE, ': sales unit ', L.UNIT_SALES,
                          ' is the inventory unit (IC_UNIT_CAPACITY); it must be a packaging unit')
         WHEN NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                          WHERE U.COMPANY_CODE = L.COMPANY_CODE AND U.PART_CODE = L.PART_CODE
                            AND U.IC_PRODUCT_UOM_TYPE = 'P'
                            AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(L.UNIT_SALES)))
              THEN CONCAT('Sales unit ', L.UNIT_SALES, ' is not a packaging unit (IC_PRODUCT_UOM_TYPE = P) of part ',
                          L.PART_CODE, ' in IC_PRODUCT_MASTER_UNITS')
         ELSE CONCAT('Inventory unit ', L.CAP_UOM, ' (IC_UNIT_CAPACITY) is not defined for part ',
                     L.PART_CODE, ' in IC_PRODUCT_MASTER_UNITS')
       END
FROM #LINES L
WHERE L.CAT = 'SP'
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID)
  AND (NULLIF(LTRIM(RTRIM(L.CAP_UOM)), '') IS NULL
       OR LTRIM(RTRIM(L.CAP_UOM)) = LTRIM(RTRIM(L.UNIT_SALES))
       OR NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                      WHERE U.COMPANY_CODE = L.COMPANY_CODE AND U.PART_CODE = L.PART_CODE
                        AND U.IC_PRODUCT_UOM_TYPE = 'P'
                        AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(L.UNIT_SALES)))
       OR NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                      WHERE U.COMPANY_CODE = L.COMPANY_CODE AND U.PART_CODE = L.PART_CODE
                        AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(L.CAP_UOM))));

DECLARE @CAP_ID INT;
WHILE 1 = 1
BEGIN
    SET @CAP_ID = NULL;
    SELECT TOP (1) @CAP_ID = L.ID
    FROM #LINES L
    WHERE L.CAT = 'SP'
      AND L.CAP_DONE = 0
      AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID)
    ORDER BY L.ID;
    IF @CAP_ID IS NULL BREAK;

    BEGIN TRY
        UPDATE L
        SET CAP_QTY = FIN.RS_UOM_CONVERSION(L.COMPANY_CODE, L.PART_CODE, L.UNIT_SALES, L.CAP_UOM, L.QUANTITY)
        FROM #LINES L
        WHERE L.ID = @CAP_ID;
    END TRY
    BEGIN CATCH
        INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
        SELECT L.ID, L.GROUP_KEY, 1,
               CONCAT('Packaging quantity conversion ', L.UNIT_SALES, ' -> ', L.CAP_UOM, ' failed for part ',
                      L.PART_CODE, ': ', ERROR_MESSAGE())
        FROM #LINES L
        WHERE L.ID = @CAP_ID AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);
    END CATCH;

    UPDATE #LINES SET CAP_DONE = 1 WHERE ID = @CAP_ID;
END;

INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 1,
       CONCAT('Packaging quantity conversion ', L.UNIT_SALES, ' -> ', L.CAP_UOM, ' for part ', L.PART_CODE,
              CASE WHEN L.CAP_QTY IS NULL THEN ' returned NULL (no UOM conversion defined?)'
                   ELSE ' did not return a positive quantity' END)
FROM #LINES L
WHERE L.CAT = 'SP'
  AND (L.CAP_QTY IS NULL OR L.CAP_QTY <= 0)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);

-- ---- second quantity unit of the line: SP = inventory unit, PN = potency unit, SN = none
UPDATE #LINES
SET U2_UOM = CASE CAT WHEN 'SP' THEN CAP_UOM WHEN 'PN' THEN SEC_UOM END,
    U2_QTY = CASE CAT WHEN 'SP' THEN CAP_QTY WHEN 'PN' THEN SEC_QTY END;

-- ----------------------------------------------------------------------------
-- 4c. UOM conversions needed (LB_S_L_DO_UOM_CONVERSIONS), resolved once each
--     Lookup order in PART_UOM_CONVERSIONS (same as the DML):
--       1 company+part  from->to      method as stored (F -> treated as M)
--       2 company+part  to->from      method swapped (M->D, D->M, F->D)
--       3 '*' / 15 x '*' from->to
--       4 '*' / 15 x '*' to->from     method swapped
-- ----------------------------------------------------------------------------
SELECT ID, COMPANY_CODE, PART_CODE, UNIT_FROM, UNIT_TO
INTO #CONV_USE
FROM (
    SELECT ID, COMPANY_CODE, PART_CODE, WT_FROM_UOM  AS UNIT_FROM, ITEM_WEIGHT_UOM AS UNIT_TO
      FROM #LINES WHERE WT_CTRL  = @WV_INVENTORY
    UNION ALL
    SELECT ID, COMPANY_CODE, PART_CODE, VOL_FROM_UOM, ITEM_VOLUME_UOM
      FROM #LINES WHERE VOL_CTRL = @WV_INVENTORY
    UNION ALL   -- line UOM -> header UOM
    SELECT ID, COMPANY_CODE, PART_CODE, ITEM_WEIGHT_UOM, HDR_WEIGHT_UOM
      FROM #LINES WHERE ITEM_WEIGHT_UOM <> '' AND HDR_WEIGHT_UOM <> ''
    UNION ALL
    SELECT ID, COMPANY_CODE, PART_CODE, ITEM_VOLUME_UOM, HDR_VOLUME_UOM
      FROM #LINES WHERE ITEM_VOLUME_UOM <> '' AND HDR_VOLUME_UOM <> ''
) X;

SELECT DISTINCT COMPANY_CODE, PART_CODE, UNIT_FROM, UNIT_TO
INTO #CONV_REQ
FROM #CONV_USE;

SELECT R.COMPANY_CODE, R.PART_CODE, R.UNIT_FROM, R.UNIT_TO,
       C.METHOD, C.FACTOR, C.IS_FORMULA, C.FORMULA_CODE,
       CAST(NULL AS INT) AS DP_TO,
       CAST(0 AS BIT)    AS FROM_UNIT_OK,
       CAST(0 AS BIT)    AS TO_UNIT_OK
INTO #CONV
FROM #CONV_REQ R
OUTER APPLY (
    SELECT TOP 1 Q.METHOD, Q.FACTOR, Q.IS_FORMULA, Q.FORMULA_CODE
    FROM (
        SELECT 1 AS PRI,
               CASE WHEN U.SYS_CONV_METHOD = @FORM THEN @MULT ELSE U.SYS_CONV_METHOD END AS METHOD,
               U.UOM_CONVERSION_FACTOR AS FACTOR,
               CASE WHEN U.SYS_CONV_METHOD = @FORM THEN 1 ELSE 0 END AS IS_FORMULA,
               U.SYS_FORMULA_CODE AS FORMULA_CODE
        FROM FIN.PART_UOM_CONVERSIONS U
        WHERE U.COMPANY_CODE = R.COMPANY_CODE AND U.PART_CODE = R.PART_CODE
          AND U.UNIT_FROM = R.UNIT_FROM AND U.UNIT_TO = R.UNIT_TO
        UNION ALL
        SELECT 2,
               CASE U.SYS_CONV_METHOD WHEN @MULT THEN @DIV WHEN @DIV THEN @MULT WHEN @FORM THEN @DIV END,
               U.UOM_CONVERSION_FACTOR,
               CASE WHEN U.SYS_CONV_METHOD = @FORM THEN 1 ELSE 0 END,
               U.SYS_FORMULA_CODE
        FROM FIN.PART_UOM_CONVERSIONS U
        WHERE U.COMPANY_CODE = R.COMPANY_CODE AND U.PART_CODE = R.PART_CODE
          AND U.UNIT_FROM = R.UNIT_TO AND U.UNIT_TO = R.UNIT_FROM
        UNION ALL
        SELECT 3,
               CASE WHEN U.SYS_CONV_METHOD = @FORM THEN @MULT ELSE U.SYS_CONV_METHOD END,
               U.UOM_CONVERSION_FACTOR,
               CASE WHEN U.SYS_CONV_METHOD = @FORM THEN 1 ELSE 0 END,
               U.SYS_FORMULA_CODE
        FROM FIN.PART_UOM_CONVERSIONS U
        WHERE U.COMPANY_CODE = '*' AND U.PART_CODE = '***************'
          AND U.UNIT_FROM = R.UNIT_FROM AND U.UNIT_TO = R.UNIT_TO
        UNION ALL
        SELECT 4,
               CASE U.SYS_CONV_METHOD WHEN @MULT THEN @DIV WHEN @DIV THEN @MULT WHEN @FORM THEN @DIV END,
               U.UOM_CONVERSION_FACTOR,
               CASE WHEN U.SYS_CONV_METHOD = @FORM THEN 1 ELSE 0 END,
               U.SYS_FORMULA_CODE
        FROM FIN.PART_UOM_CONVERSIONS U
        WHERE U.COMPANY_CODE = '*' AND U.PART_CODE = '***************'
          AND U.UNIT_FROM = R.UNIT_TO AND U.UNIT_TO = R.UNIT_FROM
    ) Q
    ORDER BY Q.PRI
) C;

-- Decimals of the TO unit: IC_PRODUCT_MASTER_UNITS (mask <> '') else UNITS_OF_MEASURE;
-- blank decimals = 0. Both units must exist (DML error P_62355 otherwise).
UPDATE C
SET DP_TO = ISNULL(TRY_CONVERT(INT, NULLIF(CAST(
              CASE WHEN PT.UOM IS NOT NULL THEN PT.DEC ELSE UT.DEC END AS VARCHAR(10)), '')), 0),
    TO_UNIT_OK   = CASE WHEN PT.UOM IS NOT NULL OR UT.UOM IS NOT NULL THEN 1 ELSE 0 END,
    FROM_UNIT_OK = CASE WHEN PF.UOM IS NOT NULL OR UF.UOM IS NOT NULL THEN 1 ELSE 0 END
FROM #CONV C
OUTER APPLY (SELECT TOP 1 P.UNIT_OF_MEASURE AS UOM, P.IC_DECIMALS AS DEC
             FROM FIN.IC_PRODUCT_MASTER_UNITS P
             WHERE P.COMPANY_CODE = C.COMPANY_CODE AND P.PART_CODE = C.PART_CODE
               AND P.UNIT_OF_MEASURE = C.UNIT_TO AND ISNULL(P.IC_QUANTITY_MASK, '') <> '') PT
OUTER APPLY (SELECT TOP 1 W.UNIT_OF_MEASURE AS UOM, W.IC_DECIMALS AS DEC
             FROM FIN.UNITS_OF_MEASURE W WHERE W.UNIT_OF_MEASURE = C.UNIT_TO) UT
OUTER APPLY (SELECT TOP 1 P.UNIT_OF_MEASURE AS UOM
             FROM FIN.IC_PRODUCT_MASTER_UNITS P
             WHERE P.COMPANY_CODE = C.COMPANY_CODE AND P.PART_CODE = C.PART_CODE
               AND P.UNIT_OF_MEASURE = C.UNIT_FROM AND ISNULL(P.IC_QUANTITY_MASK, '') <> '') PF
OUTER APPLY (SELECT TOP 1 W.UNIT_OF_MEASURE AS UOM
             FROM FIN.UNITS_OF_MEASURE W WHERE W.UNIT_OF_MEASURE = C.UNIT_FROM) UF;

-- Lines whose UOM conversion is missing / invalid fail (the DML would show an error)
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT U.ID, MIN(L.GROUP_KEY), 1,
       MIN(CONCAT('UOM conversion problem for part ', U.PART_CODE, ' (', U.UNIT_FROM, ' -> ', U.UNIT_TO, '): ',
           CASE WHEN C.FROM_UNIT_OK = 0 THEN CONCAT('unit ', U.UNIT_FROM, ' not found')
                WHEN C.TO_UNIT_OK   = 0 THEN CONCAT('unit ', U.UNIT_TO, ' not found')
                WHEN C.IS_FORMULA   = 1 THEN CONCAT('formula conversion (', C.FORMULA_CODE, ') is not supported by this loader')
                WHEN C.METHOD IS NULL   THEN 'no PART_UOM_CONVERSIONS row'
                ELSE 'conversion factor is zero' END))
FROM #CONV C
JOIN #CONV_USE U ON U.COMPANY_CODE = C.COMPANY_CODE AND U.PART_CODE = C.PART_CODE
                AND U.UNIT_FROM = C.UNIT_FROM AND U.UNIT_TO = C.UNIT_TO
JOIN #LINES L ON L.ID = U.ID
WHERE (C.FROM_UNIT_OK = 0 OR C.TO_UNIT_OK = 0
       OR (C.UNIT_FROM <> C.UNIT_TO AND (C.METHOD IS NULL OR C.IS_FORMULA = 1
           OR (C.METHOD = @DIV AND ISNULL(C.FACTOR, 0) = 0))))
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = U.ID)
GROUP BY U.ID;

-- ----------------------------------------------------------------------------
-- 4d. Line weight / volume (LB_S_L_WTVOL).  A line has its quantity in UNIT_SALES (QUANTITY) and,
--     for SP / PN, in a second unit (U2_UOM / U2_QTY).  The weight / volume rule works from the
--     unit it names (the weight UOM for ACTUAL, the from-UOM for FIXED / INVENTORY), so the
--     quantity expressed in THAT unit is used; if neither unit matches, the sales-unit quantity
--     is used and the rule yields NULL as before.  NULL result = DML error (P_90247 / not
--     supported) -> guarded below.
-- ----------------------------------------------------------------------------
UPDATE L
SET WT_UOM  = CASE WHEN T.WT_TGT <> '' AND T.WT_TGT = L.UNIT_SALES THEN L.UNIT_SALES
                   WHEN T.WT_TGT <> '' AND T.WT_TGT = L.U2_UOM     THEN L.U2_UOM
                   ELSE L.UNIT_SALES END,
    WT_QTY  = CASE WHEN T.WT_TGT <> '' AND T.WT_TGT = L.UNIT_SALES THEN CAST(L.QUANTITY AS DECIMAL(28,10))
                   WHEN T.WT_TGT <> '' AND T.WT_TGT = L.U2_UOM     THEN L.U2_QTY
                   ELSE CAST(L.QUANTITY AS DECIMAL(28,10)) END,
    VOL_UOM = CASE WHEN T.VOL_TGT <> '' AND T.VOL_TGT = L.UNIT_SALES THEN L.UNIT_SALES
                   WHEN T.VOL_TGT <> '' AND T.VOL_TGT = L.U2_UOM     THEN L.U2_UOM
                   ELSE L.UNIT_SALES END,
    VOL_QTY = CASE WHEN T.VOL_TGT <> '' AND T.VOL_TGT = L.UNIT_SALES THEN CAST(L.QUANTITY AS DECIMAL(28,10))
                   WHEN T.VOL_TGT <> '' AND T.VOL_TGT = L.U2_UOM     THEN L.U2_QTY
                   ELSE CAST(L.QUANTITY AS DECIMAL(28,10)) END
FROM #LINES L
CROSS APPLY (SELECT CASE WHEN L.WT_CTRL  = @WV_ACTUAL THEN L.ITEM_WEIGHT_UOM ELSE L.WT_FROM_UOM END AS WT_TGT,
                    CASE WHEN L.VOL_CTRL = @WV_ACTUAL THEN L.ITEM_VOLUME_UOM ELSE L.VOL_FROM_UOM END AS VOL_TGT) T;

UPDATE L
SET ITEM_WEIGHT = CASE
        WHEN L.WT_CTRL = @WV_ACTUAL THEN
             CASE WHEN L.WT_UOM = L.ITEM_WEIGHT_UOM THEN L.WT_QTY
                  WHEN L.ITEM_WEIGHT_UOM = '' THEN 0 END
        WHEN L.WT_CTRL = @WV_FIXED THEN
             CASE WHEN L.WT_UOM = L.WT_FROM_UOM
                       THEN L.WT_QTY * CAST(L.WT_FIXED AS DECIMAL(28,10))
                  WHEN L.WT_FROM_UOM = '' THEN 0 END
        WHEN L.WT_CTRL = @WV_INVENTORY THEN
             CASE WHEN L.WT_UOM <> L.WT_FROM_UOM OR L.WT_FROM_UOM = '' THEN NULL
                  WHEN L.WT_FROM_UOM = L.ITEM_WEIGHT_UOM THEN L.WT_QTY
                  ELSE ROUND(CASE CW.METHOD
                                 WHEN @MULT THEN L.WT_QTY * CW.FACTOR
                                 WHEN @DIV  THEN L.WT_QTY / NULLIF(CW.FACTOR, 0) END,
                             CW.DP_TO) END
        WHEN L.WT_CTRL = @WV_PACKAGED THEN NULL
        ELSE 0 END,
    ITEM_VOLUME = CASE
        WHEN L.VOL_CTRL = @WV_ACTUAL THEN
             CASE WHEN L.VOL_UOM = L.ITEM_VOLUME_UOM THEN L.VOL_QTY
                  WHEN L.ITEM_VOLUME_UOM = '' THEN 0 END
        WHEN L.VOL_CTRL = @WV_FIXED THEN
             CASE WHEN L.VOL_UOM = L.VOL_FROM_UOM
                       THEN L.VOL_QTY * CAST(L.VOL_FIXED AS DECIMAL(28,10))
                  WHEN L.VOL_FROM_UOM = '' THEN 0 END
        WHEN L.VOL_CTRL = @WV_INVENTORY THEN
             CASE WHEN L.VOL_UOM <> L.VOL_FROM_UOM OR L.VOL_FROM_UOM = '' THEN NULL
                  WHEN L.VOL_FROM_UOM = L.ITEM_VOLUME_UOM THEN L.VOL_QTY
                  ELSE ROUND(CASE CV.METHOD
                                 WHEN @MULT THEN L.VOL_QTY * CV.FACTOR
                                 WHEN @DIV  THEN L.VOL_QTY / NULLIF(CV.FACTOR, 0) END,
                             CV.DP_TO) END
        WHEN L.VOL_CTRL = @WV_PACKAGED THEN NULL
        ELSE 0 END
FROM #LINES L
LEFT JOIN #CONV CW ON CW.COMPANY_CODE = L.COMPANY_CODE AND CW.PART_CODE = L.PART_CODE
                  AND CW.UNIT_FROM = L.WT_FROM_UOM  AND CW.UNIT_TO = L.ITEM_WEIGHT_UOM
LEFT JOIN #CONV CV ON CV.COMPANY_CODE = L.COMPANY_CODE AND CV.PART_CODE = L.PART_CODE
                  AND CV.UNIT_FROM = L.VOL_FROM_UOM AND CV.UNIT_TO = L.ITEM_VOLUME_UOM;

-- Weight / volume that cannot be derived (DML P_90247) fails the line
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 1,
       CONCAT('Weight/volume cannot be derived for part ', L.PART_CODE, ': sales unit ', L.UNIT_SALES,
              ' / second unit ', ISNULL(L.U2_UOM, ''),
              ' does not match the product weight/volume units (weight control ', L.WT_CTRL,
              ', weight UOM ', L.ITEM_WEIGHT_UOM, ', weight-from UOM ', L.WT_FROM_UOM,
              '; volume control ', L.VOL_CTRL, ', volume UOM ', L.ITEM_VOLUME_UOM,
              ', volume-from UOM ', L.VOL_FROM_UOM, ') or the control is PACKAGED (not supported here)')
FROM #LINES L
WHERE (L.ITEM_WEIGHT IS NULL OR L.ITEM_VOLUME IS NULL)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);

-- ADJUST_WV_TO_CORRECT_DPS: weight and volume rounded to 4 dp
UPDATE #LINES SET ITEM_WEIGHT = ROUND(ITEM_WEIGHT, 4), ITEM_VOLUME = ROUND(ITEM_VOLUME, 4)
WHERE ITEM_WEIGHT IS NOT NULL AND ITEM_VOLUME IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4e. Line -> header UOM (header total = sum of converted line values, as in
--     the DML WEIGHT_CORRECTION / VOLUME_CORRECTION blocks)
-- ----------------------------------------------------------------------------
UPDATE L
SET WEIGHT_HDR = CASE
        WHEN L.ITEM_WEIGHT_UOM = '' OR L.HDR_WEIGHT_UOM = '' THEN 0
        WHEN L.ITEM_WEIGHT_UOM = L.HDR_WEIGHT_UOM THEN L.ITEM_WEIGHT
        ELSE ROUND(CASE HW.METHOD
                       WHEN @MULT THEN L.ITEM_WEIGHT * HW.FACTOR
                       WHEN @DIV  THEN L.ITEM_WEIGHT / NULLIF(HW.FACTOR, 0) END, HW.DP_TO) END,
    VOLUME_HDR = CASE
        WHEN L.ITEM_VOLUME_UOM = '' OR L.HDR_VOLUME_UOM = '' THEN 0
        WHEN L.ITEM_VOLUME_UOM = L.HDR_VOLUME_UOM THEN L.ITEM_VOLUME
        ELSE ROUND(CASE HV.METHOD
                       WHEN @MULT THEN L.ITEM_VOLUME * HV.FACTOR
                       WHEN @DIV  THEN L.ITEM_VOLUME / NULLIF(HV.FACTOR, 0) END, HV.DP_TO) END
FROM #LINES L
LEFT JOIN #CONV HW ON HW.COMPANY_CODE = L.COMPANY_CODE AND HW.PART_CODE = L.PART_CODE
                  AND HW.UNIT_FROM = L.ITEM_WEIGHT_UOM AND HW.UNIT_TO = L.HDR_WEIGHT_UOM
LEFT JOIN #CONV HV ON HV.COMPANY_CODE = L.COMPANY_CODE AND HV.PART_CODE = L.PART_CODE
                  AND HV.UNIT_FROM = L.ITEM_VOLUME_UOM AND HV.UNIT_TO = L.HDR_VOLUME_UOM;

-- Every other line of an order that has a failed line also fails (the order is not loaded)
INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
SELECT L.ID, L.GROUP_KEY, 0, NULL
FROM #LINES L
WHERE EXISTS (SELECT 1 FROM #FAILED F WHERE F.GROUP_KEY = L.GROUP_KEY AND F.ROOT = 1)
  AND NOT EXISTS (SELECT 1 FROM #FAILED F2 WHERE F2.ID = L.ID);

-- ----------------------------------------------------------------------------
-- 5. LOAD. One code path serves every unit of work:
--      B = all remaining orders in one transaction (the "whole batch")
--      O = one order per transaction (retry after a failed batch)
--      L = probe of one line of a failed order (header + that line, ALWAYS rolled back)
--      R = resolve a failed order: decide which line failed and why
--    A failed unit is rolled back completely; nothing it wrote survives.
-- ----------------------------------------------------------------------------
DECLARE @SEQ INT = 0, @NEXT INT, @KIND CHAR(1), @UC VARCHAR(10), @UD VARCHAR(2), @UO VARCHAR(9),
        @UL INT, @UERR NVARCHAR(2000), @STAGE CHAR(1), @ERRMSG NVARCHAR(2000),
        @ORD_CNT INT, @LINE_CNT INT, @QTY_CNT INT, @N INT;

IF EXISTS (SELECT 1 FROM #LINES L WHERE NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID))
    INSERT INTO #UNIT (KIND) VALUES ('B');

WHILE 1 = 1
BEGIN
    SELECT @NEXT = MIN(SEQ) FROM #UNIT WHERE SEQ > @SEQ;
    IF @NEXT IS NULL BREAK;
    SET @SEQ = @NEXT;
    SELECT @KIND = KIND, @UC = COMPANY_CODE, @UD = DIVISION, @UO = ORDER_NUMBER,
           @UL = LINE_ID, @UERR = ERR
    FROM #UNIT WHERE SEQ = @SEQ;

    IF @KIND = 'R'
    BEGIN
        -- lines whose own probe failed are the failed lines
        INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
        SELECT L.ID, L.GROUP_KEY, 1, P.ERR
        FROM #LINES L
        JOIN #PROBE P ON P.ID = L.ID
        WHERE L.COMPANY_CODE = @UC AND L.DIVISION = @UD AND L.ORDER_NUMBER = @UO
          AND P.ERR IS NOT NULL AND P.HDR = 0
          AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);

        -- header-level error, or no single line to blame: the first line carries the reason
        IF NOT EXISTS (SELECT 1 FROM #FAILED F JOIN #LINES L ON L.ID = F.ID
                       WHERE L.COMPANY_CODE = @UC AND L.DIVISION = @UD AND L.ORDER_NUMBER = @UO AND F.ROOT = 1)
            INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
            SELECT TOP 1 L.ID, L.GROUP_KEY, 1,
                   COALESCE((SELECT TOP 1 P.ERR FROM #PROBE P JOIN #LINES L2 ON L2.ID = P.ID
                             WHERE L2.COMPANY_CODE = @UC AND L2.DIVISION = @UD AND L2.ORDER_NUMBER = @UO
                               AND P.HDR = 1 AND P.ERR IS NOT NULL), @UERR)
            FROM #LINES L
            WHERE L.COMPANY_CODE = @UC AND L.DIVISION = @UD AND L.ORDER_NUMBER = @UO
            ORDER BY L.LINE_NO;

        -- every other line of the order
        INSERT INTO #FAILED (ID, GROUP_KEY, ROOT, REASON)
        SELECT L.ID, L.GROUP_KEY, 0, NULL
        FROM #LINES L
        WHERE L.COMPANY_CODE = @UC AND L.DIVISION = @UD AND L.ORDER_NUMBER = @UO
          AND NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);
        CONTINUE;
    END

    TRUNCATE TABLE #RUN_LINES;
    TRUNCATE TABLE #RUN_ORDERS;
    IF @KIND = 'B'
        INSERT INTO #RUN_LINES (ID)
        SELECT L.ID FROM #LINES L WHERE NOT EXISTS (SELECT 1 FROM #FAILED F WHERE F.ID = L.ID);
    ELSE IF @KIND = 'O'
        INSERT INTO #RUN_LINES (ID)
        SELECT L.ID FROM #LINES L
        WHERE L.COMPANY_CODE = @UC AND L.DIVISION = @UD AND L.ORDER_NUMBER = @UO;
    ELSE
        INSERT INTO #RUN_LINES (ID) SELECT L.ID FROM #LINES L WHERE L.ID = @UL;

    INSERT INTO #RUN_ORDERS (COMPANY_CODE, DIVISION, ORDER_NUMBER)
    SELECT DISTINCT L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER
    FROM #LINES L JOIN #RUN_LINES R ON R.ID = L.ID;
    SELECT @ORD_CNT = COUNT(*) FROM #RUN_ORDERS;
    SELECT @LINE_CNT = COUNT(*) FROM #RUN_LINES;
    IF @LINE_CNT = 0 CONTINUE;
    -- quantity rows expected: 1 per SN line, 2 per SP / PN line
    SELECT @QTY_CNT = COUNT(*) + SUM(CASE WHEN L.CAT <> 'SN' THEN 1 ELSE 0 END)
    FROM #LINES L JOIN #RUN_LINES RL ON RL.ID = L.ID;

    SET @STAGE = 'H';
    SET @ERRMSG = NULL;
    BEGIN TRY
        BEGIN TRANSACTION;

INSERT INTO FIN.SALES_ORDER_HEADERS
(COMPANY_CODE, DIVISION, ORDER_NUMBER, CUSTOMER_NUMBER, INVOICE_ADDRESS_CODE,
 DELIVERY_ADDRESS_CODE, FINAL_ADDRESS_CODE, ORDER_DATE, SALESPERSON_CODE, SALES_COMMISSION_CODE,
 CREDIT_TERMS_CODE, CUSTOMER_REFERENCE,CUSTOMER_CONTACT,  ORDER_DISCOUNT_GROUP,ORDER_DISCOUNT, ORDER_DISCOUNT_PERCENT, LINE_TAX,
 LINE_DISCOUNT, LINE_TAXABLE_VALUE, LINE_VALUE_DISCOUNTED, LINE_TAX_DISCOUNTED,
 FREIGHT, TAX_ON_FREIGHT, MISCELLANEOUS, TAX_ON_MISCELLANEOUS, TOTAL_TAX,WEIGHT, WEIGHT_UOM, VOLUME, VOLUME_UOM,
 STATUS_FLAG, CUSTOMER_TAX_CODE, CREDIT_STATUS_CODE, SYS_PRINT_PART_DETAIL,
 USERNAME, SALES_ORDER_TYPE, PRICING_METHOD, ORDER_CYCLE,
 HOLD_STATUS_CODE, SYSTEM_DATE, SOP_ORDER_TOTAL_CURRENCY, SOP_ORDER_TOTAL_BASE,
 SYS_CURRENCY_CODE, SYS_CURRENCY_RATE, SYS_CURRENCY_RATIO_INDIC,
 SYS_CURRENCY_FIXED_FLAG, SYS_BASE_CURRENCY, SYS_CURRENCY_DATE,
 DELIVERY_INSTRUCTIONS, SHIP_METHOD, SYS_DELIVERY_DATE, SYS_SHIPPING_DATE,
 SOP_SHIPPING_TERMS_CODE, MP_SHIPPING_CUSTOMER, MP_INVOICE_CUSTOMER,
 BROKER_CODE, LOCATION, SALES_ANALYSIS_GROUP, COST_CENTER, EDI_ORDER)
SELECT
       O.COMPANY_CODE,
       O.DIVISION,
       O.ORDER_NUMBER,
       O.CUSTOMER_NUMBER,
       C.DEFAULT_ADDR,
       O.DELIVERY_ADDRESS_CODE,
       O.DELIVERY_ADDRESS_CODE,
       ISNULL(O.ORDER_DATE, GETDATE()),
       CA.SALESPERSON_CODE,
       '' AS SALES_COMMISSION_CODE,
       C.CREDIT_TERMS_CODE,
       O.CUSTOMER_REFERENCE,
       '' AS CUSTOMER_CONTACT,
       C.ORDER_DISCOUNT_GROUP,
       0 AS ORDER_DISCOUNT,
       0 AS ORDER_DISCOUNT_PERCENT,
       0, 0,
       O.LINE_VALUE,
       O.LINE_VALUE,
       0,
       O.FREIGHT_HDR,
       0, 0, 0, 0,
       LW.WEIGHT_TOTAL AS WEIGHT,
       LW.HDR_WEIGHT_UOM AS WEIGHT_UOM,
       LW.VOLUME_TOTAL AS VOLUME,
       LW.HDR_VOLUME_UOM AS VOLUME_UOM,
       'A',
       CA.TAX_CODE,
       '',
       'N',
       SUSER_NAME(),
       C.SALES_ORDER_TYPE,
       1,
       'B',
       '',
       GETDATE(),
       O.LINE_VALUE,
       O.LINE_VALUE,
       C.SYS_CURRENCY_CODE,
       1,
       'M',
       'N',
       C.SYS_CURRENCY_CODE,
       ISNULL(O.ORDER_DATE, GETDATE()),
       CA.DELIVERY_INSTRUCTIONS,
       CA.SHIP_METHOD,
       O.SYS_DELIVERY_DATE,
       O.SYS_DELIVERY_DATE,
       COALESCE(CA.SOP_SHIPPING_TERMS_CODE, C.SOP_SHIPPING_TERMS_CODE),
       C.MP_SHIPPING_CUSTOMER,
       C.MP_INVOICE_CUSTOMER,
       COALESCE(CA.BROKER_CODE, C.BROKER_CODE),
       CA.LOCATION,
       CA.CUSTOMER_GROUP,
       CASE WHEN ISNULL(CC.COST_CENTER_ON_ORDER_TYPE, 'N') = 'Y'
            THEN COALESCE(SOT.COST_CENTER, '') ELSE '' END,
       O.EDI_ORDER
FROM #SO_ORDERS O
JOIN #RUN_ORDERS RO
  ON RO.COMPANY_CODE = O.COMPANY_CODE AND RO.DIVISION = O.DIVISION AND RO.ORDER_NUMBER = O.ORDER_NUMBER
JOIN (SELECT COMPANY_CODE, DIVISION, ORDER_NUMBER,
             SUM(WEIGHT_HDR)     AS WEIGHT_TOTAL,
             SUM(VOLUME_HDR)     AS VOLUME_TOTAL,
             MAX(HDR_WEIGHT_UOM) AS HDR_WEIGHT_UOM,
             MAX(HDR_VOLUME_UOM) AS HDR_VOLUME_UOM
      FROM #LINES
      GROUP BY COMPANY_CODE, DIVISION, ORDER_NUMBER) LW
  ON LW.COMPANY_CODE = O.COMPANY_CODE
 AND LW.DIVISION     = O.DIVISION
 AND LW.ORDER_NUMBER = O.ORDER_NUMBER
LEFT JOIN FIN.CUSTOMERS C
  ON C.COMPANY_CODE    = O.COMPANY_CODE
 AND C.DIVISION        = O.DIVISION
 AND C.CUSTOMER_NUMBER = O.CUSTOMER_NUMBER
LEFT JOIN FIN.CUSTOMER_ADDRESSES CA
  ON CA.COMPANY_CODE    = O.COMPANY_CODE
 AND CA.DIVISION        = O.DIVISION
 AND CA.CUSTOMER_NUMBER = O.CUSTOMER_NUMBER
 AND CA.ADDRESS_CODE    = O.DELIVERY_ADDRESS_CODE
LEFT JOIN FIN.SALES_ORDER_TYPES SOT
  ON SOT.COMPANY_CODE      = O.COMPANY_CODE
 AND SOT.SALES_ORDER_TYPE  = C.SALES_ORDER_TYPE
LEFT JOIN FIN.COMPANY_CONTROLS CC
  ON CC.COMPANY_CODE = O.COMPANY_CODE;
SET @N = @@ROWCOUNT;
        IF @N <> @ORD_CNT THROW 50010, 'The sales order header was not created.', 1;

        SET @STAGE = 'D';
INSERT INTO FIN.SALES_ORDER_LINES
(COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, ORDER_LINE_TYPE,
 PRODUCT_GROUP, PART_CODE, WAREHOUSE, ORDER_LINE_REFERENCE, SOP_NOMINATED_UNIT,
 SOP_NOMINATED_PRICE_UNIT, IC_PACK_UNIT, UNIT_SALES, UNIT_PRICE, SALES_PRICE,
 UNIT_COST, LINE_TAX, LINE_DISCOUNT, DELIVERY_ADDRESS_CODE, CUSTOMER_TAX_CODE,
 PRODUCT_TAX_CODE, SALESPERSON_CODE, LOCATION, SALES_ANALYSIS_GROUP,WEIGHT, WEIGHT_UOM, 
 VOLUME,VOLUME_UOM, COST_CENTER,
 CUSTOMER_NUMBER,MP_SHIPPING_CUSTOMER, STATUS_FLAG, ORDER_CYCLE, USERNAME, SYSTEM_DATE,
 SYS_CURRENCY_CODE, SYS_CURRENCY_RATE, SYS_CURRENCY_RATIO_INDIC,
 SYS_CURRENCY_FIXED_FLAG, SYS_BASE_CURRENCY, SYS_CURRENCY_DATE,
 DELIVERY_INSTRUCTIONS, SHIP_METHOD, CREDIT_TERMS_CODE, SYS_DELIVERY_DATE,
 SYS_SHIPPING_DATE, SOP_SHIPPING_TERMS_CODE,FINAL_ADDRESS_CODE, SOP_ORDER_TOTAL_CURRENCY,
 SOP_ORDER_TOTAL_BASE)
SELECT
       L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.LINE_NO,
       'S',
       L.PRODUCT_GROUP,
       L.PART_CODE,
       L.WAREHOUSE,
       '',
       L.SOP_NOMINATED_UNIT,
       L.SOP_NOMINATED_PRICE_UNIT,
       L.IC_PACK_UNIT,
       L.UNIT_SALES,
       L.UNIT_PRICE,
       L.SALES_PRICE,   
       0, 0, 0,
       L.DELIVERY_ADDRESS_CODE,
       CA.TAX_CODE,
       L.PRODUCT_TAX_CODE,
       CA.SALESPERSON_CODE,
       CA.LOCATION,
       CA.CUSTOMER_GROUP,
       L.ITEM_WEIGHT AS WEIGHT,
       L.ITEM_WEIGHT_UOM AS WEIGHT_UOM,
       L.ITEM_VOLUME AS VOLUME,
       L.ITEM_VOLUME_UOM AS VOLUME_UOM,
       CASE WHEN ISNULL(CC.COST_CENTER_ON_ORDER_TYPE, 'N') = 'Y'
            THEN COALESCE(SOT.COST_CENTER, '') ELSE '' END,
       L.CUSTOMER_NUMBER,
       L.CUSTOMER_NUMBER,
       'A',
       'B',
       SUSER_NAME(),
       GETDATE(),
       C.SYS_CURRENCY_CODE,
       1,
       'M',
       'N',
       C.SYS_CURRENCY_CODE,
       ISNULL(L.ORDER_DATE, GETDATE()),
       CA.DELIVERY_INSTRUCTIONS,
       CA.SHIP_METHOD,
       C.CREDIT_TERMS_CODE,
       L.SYS_DELIVERY_DATE,
       L.SYS_DELIVERY_DATE,
        COALESCE(CA.SOP_SHIPPING_TERMS_CODE, C.SOP_SHIPPING_TERMS_CODE),
       L.DELIVERY_ADDRESS_CODE,
       L.QUANTITY * L.SALES_PRICE,
       L.QUANTITY * L.SALES_PRICE
FROM #LINES L
JOIN #RUN_LINES RL ON RL.ID = L.ID
LEFT JOIN FIN.CUSTOMERS C
  ON C.COMPANY_CODE    = L.COMPANY_CODE
 AND C.DIVISION        = L.DIVISION
 AND C.CUSTOMER_NUMBER = L.CUSTOMER_NUMBER
LEFT JOIN FIN.CUSTOMER_ADDRESSES CA
  ON CA.COMPANY_CODE    = L.COMPANY_CODE
 AND CA.DIVISION        = L.DIVISION
 AND CA.CUSTOMER_NUMBER = L.CUSTOMER_NUMBER
 AND CA.ADDRESS_CODE    = L.DELIVERY_ADDRESS_CODE
LEFT JOIN FIN.SALES_ORDER_TYPES SOT
  ON SOT.COMPANY_CODE      = L.COMPANY_CODE
 AND SOT.SALES_ORDER_TYPE  = C.SALES_ORDER_TYPE
LEFT JOIN FIN.COMPANY_CONTROLS CC
  ON CC.COMPANY_CODE = L.COMPANY_CODE;
SET @N = @@ROWCOUNT;
        IF @N <> @LINE_CNT THROW 50011, 'The sales order line was not created.', 1;

INSERT INTO FIN.SALES_ORDER_LINE_DETAILS
(COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, [SEQUENCE],
 ORDER_LINE_REF, REQUIRED_DATE, ORDER_HORIZON, ORDER_DATE, STATUS_FLAG,
 ORDER_LINE_STATUS, QUANTITY_PROMISED, IC_LOT_NUMBER, SYS_SHIPPING_DATE,
 SYS_DELIVERY_DATE, IC_ATP_QTY_PROMISED, WAREHOUSE, ORIGINAL_SEQUENCE,
 SYS_FREIGHT_CHARGE_BASE, SOP_WTVOL_FREIGHT_ALLOC, SOP_FREIGHT_ALLOCATED,
 TM_LOAD_PLANNING)
SELECT
       L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.LINE_NO,
       '001', '', L.SYS_DELIVERY_DATE, 'C', ISNULL(L.ORDER_DATE, GETDATE()),
       'A', '', 0, '', L.SYS_DELIVERY_DATE, L.SYS_DELIVERY_DATE, 0,
       L.WAREHOUSE, '1', 0, 0, 0, ISNULL(WC.TM_LOAD_PLANNING, 'N')
FROM #LINES L
JOIN #RUN_LINES RL ON RL.ID = L.ID
LEFT JOIN FIN.WAREHOUSE_CONTROLS WC
  ON WC.COMPANY_CODE = L.COMPANY_CODE
 AND WC.WAREHOUSE    = L.WAREHOUSE;
SET @N = @@ROWCOUNT;
        IF @N <> @LINE_CNT THROW 50012, 'The sales order line detail was not created.', 1;

-- ----------------------------------------------------------------------------
-- 9. Line quantities - 1 row per SN line, 2 rows per SP / PN line (sales unit + second unit)
-- ----------------------------------------------------------------------------
INSERT INTO FIN.SALES_ORDER_LINE_QTYS
(COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, UNIT_OF_MEASURE,
 IC_APPROX_QTY_FLAG, ORDER_QUANTITY, TEMP_ORDER_QUANTITY, IC_QTY_PICKED,
 IC_QTY_IN_DESPATCH, QTY_DESPATCHED, QTY_INVOICED, QTY_RESERVED,
 TEMP_QTY_RESERVED, QUANTITY_PROMISED, IC_QTY_TO_SHIP, IC_QTY_CLOSED)
SELECT
       L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.LINE_NO,
       Q.UOM, CASE L.CAT WHEN 'SP' THEN @APPROX_SP WHEN 'PN' THEN @APPROX_PN ELSE @APPROX_SN END,
       Q.QTY, Q.QTY,
       0, 0, 0, 0, 0, 0, 0, 0, 0
FROM #LINES L
JOIN #RUN_LINES RL ON RL.ID = L.ID
CROSS APPLY (VALUES (1, L.UNIT_SALES, CAST(L.QUANTITY AS DECIMAL(28,10))),
                    (2, L.U2_UOM,     L.U2_QTY)) Q (SEQ, UOM, QTY)
WHERE Q.SEQ = 1 OR L.CAT <> 'SN';
SET @N = @@ROWCOUNT;
        IF @N <> @QTY_CNT THROW 50013, 'The sales order line quantities were not created as expected (1 row per SN line, 2 per SP / PN line).', 1;

-- ----------------------------------------------------------------------------
-- 10. Line detail quantities - 1 row per SN line, 2 rows per SP / PN line
-- ----------------------------------------------------------------------------
INSERT INTO FIN.SALES_ORDER_LINE_DETAIL_QTYS
(COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, [SEQUENCE],
 UNIT_OF_MEASURE, IC_APPROX_QTY_FLAG, ORDER_QUANTITY, TEMP_ORDER_QUANTITY,
 IC_QTY_PICKED, IC_QTY_IN_DESPATCH, QTY_DESPATCHED, QTY_INVOICED,
 QTY_RESERVED, QUANTITY_PROMISED, WAREHOUSE, PART_CODE, REQUIRED_DATE,
 ORDER_LINE_TYPE, IC_QTY_TO_SHIP, IC_QTY_CLOSED)
SELECT
       L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.LINE_NO,
       '001', Q.UOM, CASE L.CAT WHEN 'SP' THEN @APPROX_SP WHEN 'PN' THEN @APPROX_PN ELSE @APPROX_SN END,
       Q.QTY, Q.QTY,
       0, 0, 0, 0, 0, 0, L.WAREHOUSE, L.PART_CODE, L.SYS_DELIVERY_DATE,
       'S', 0, 0
FROM #LINES L
JOIN #RUN_LINES RL ON RL.ID = L.ID
CROSS APPLY (VALUES (1, L.UNIT_SALES, CAST(L.QUANTITY AS DECIMAL(28,10))),
                    (2, L.U2_UOM,     L.U2_QTY)) Q (SEQ, UOM, QTY)
WHERE Q.SEQ = 1 OR L.CAT <> 'SN';
SET @N = @@ROWCOUNT;
        IF @N <> @QTY_CNT THROW 50014, 'The sales order line detail quantities were not created as expected (1 row per SN line, 2 per SP / PN line).', 1;

        IF @KIND IN ('B', 'O')
        BEGIN
            -- Loaded: record order number / line number on the staging rows
            UPDATE K
            SET STATUS_FLAG       = 'P',
                PROCESSED_DATE    = GETDATE(),
                ORDER_NUMBER      = L.ORDER_NUMBER,
                ORDER_LINE_NUMBER = L.LINE_NO,
                RS_MESSAGE_TEXT   = CONCAT('Loaded as order number : ', L.ORDER_NUMBER)
            FROM FIN.KAS_SO_LOADS K
            JOIN #LINES L ON L.ID = K.ID
            JOIN #RUN_LINES RL ON RL.ID = L.ID;
            SET @N = @@ROWCOUNT;
            IF @N <> @LINE_CNT THROW 50015, 'Staging rows marked processed do not match the loaded lines.', 1;
            COMMIT TRANSACTION;
        END
        ELSE
        BEGIN
            ROLLBACK TRANSACTION;                       -- probe: never keep anything
            INSERT INTO #PROBE (ID, ERR, HDR) VALUES (@UL, NULL, 0);
        END
    END TRY
    BEGIN CATCH
        SET @ERRMSG = ERROR_MESSAGE();
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

        IF @KIND = 'B'
        BEGIN
            -- whole batch rolled back: retry order by order
            INSERT INTO #UNIT (KIND, COMPANY_CODE, DIVISION, ORDER_NUMBER)
            SELECT 'O', COMPANY_CODE, DIVISION, ORDER_NUMBER
            FROM #RUN_ORDERS ORDER BY COMPANY_CODE, DIVISION, ORDER_NUMBER;
        END
        ELSE IF @KIND = 'O'
        BEGIN
            -- order rolled back and not loaded further: find the failing line, then resolve
            INSERT INTO #UNIT (KIND, COMPANY_CODE, DIVISION, ORDER_NUMBER, LINE_ID)
            SELECT 'L', L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.ID
            FROM #LINES L JOIN #RUN_LINES R ON R.ID = L.ID ORDER BY L.LINE_NO;
            INSERT INTO #UNIT (KIND, COMPANY_CODE, DIVISION, ORDER_NUMBER, ERR)
            VALUES ('R', @UC, @UD, @UO, @ERRMSG);
        END
        ELSE
        BEGIN
            INSERT INTO #PROBE (ID, ERR, HDR) VALUES (@UL, @ERRMSG, CASE WHEN @STAGE = 'H' THEN 1 ELSE 0 END);
        END
    END CATCH
END

-- ----------------------------------------------------------------------------
-- 6. Record the failures on the staging rows
-- ----------------------------------------------------------------------------
UPDATE K
SET STATUS_FLAG     = 'F',
    RS_MESSAGE_TEXT = CASE WHEN F.ROOT = 1
                           THEN LEFT(CONCAT('Failed due to : ', ISNULL(F.REASON, 'unknown error')), 500)
                           ELSE 'Failed because other line of this order failed loading' END
FROM FIN.KAS_SO_LOADS K
JOIN #FAILED F ON F.ID = K.ID
WHERE K.STATUS_FLAG = 'V';

DECLARE @LoadedLines INT, @LoadedOrders INT, @FailedLines INT;
SELECT @LoadedLines = COUNT(*), @LoadedOrders = COUNT(DISTINCT L.ORDER_NUMBER)
FROM #LINES L JOIN FIN.KAS_SO_LOADS K ON K.ID = L.ID WHERE K.STATUS_FLAG = 'P';
SELECT @FailedLines = COUNT(*) FROM #FAILED;

PRINT CONCAT('LOAD_SO_COMPLETE: loaded ', @LoadedOrders, ' order(s) / ', @LoadedLines,
             ' line(s); ', @FailedLines, ' line(s) marked F (see KAS_SO_LOADS.RS_MESSAGE_TEXT).');

END TRY
BEGIN CATCH
    -- Unexpected error outside the per-order handling: nothing half-written survives
    DECLARE @FATAL NVARCHAR(2000) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

    IF OBJECT_ID('tempdb..#FAILED') IS NOT NULL
        UPDATE K
        SET STATUS_FLAG     = 'F',
            RS_MESSAGE_TEXT = CASE WHEN F.ROOT = 1
                                   THEN LEFT(CONCAT('Failed due to : ', ISNULL(F.REASON, 'unknown error')), 500)
                                   ELSE 'Failed because other line of this order failed loading' END
        FROM FIN.KAS_SO_LOADS K
        JOIN #FAILED F ON F.ID = K.ID
        WHERE K.STATUS_FLAG = 'V';

    IF OBJECT_ID('tempdb..#KAS_VALID') IS NOT NULL
        UPDATE K
        SET STATUS_FLAG     = 'F',
            RS_MESSAGE_TEXT = LEFT(CONCAT('Failed due to : ', @FATAL), 500)
        FROM FIN.KAS_SO_LOADS K
        JOIN #KAS_VALID V ON V.ID = K.ID
        WHERE K.STATUS_FLAG = 'V';

    PRINT CONCAT('LOAD_SO_COMPLETE: unexpected error, run stopped and unloaded lines marked F: ', @FATAL);
END CATCH

-- ============================================================================
-- 7. EXPORT DETAILS / EXPORT NOTES  (FIN.KAS_SO_EXPORT_LOADS ->
--      FIN.SOP_ORDER_HEADER_EXP_DETAILS + FIN.SALES_ORDER_EXPORT_NOTES)
--
--    NO VALIDATION HERE: every business check is in VALIDATION_SO_LOAD.sql (rules E1-E7).
--    This section only loads rows that validation marked STATUS_FLAG = 'V' / 'Validated'.
--    Run it after the sales orders exist (same script run is fine: orders loaded above are visible).
--
--    Record by record: every staging row is its own transaction.
--      * SOP_ORDER_HEADER_EXP_DETAILS - ONE row per order, written by the first row of the order.
--        SYS_TRANS_TERM_CODE, SYS_MOT_CODE, SYS_INCOTERM_CITY, SYS_EXPORT_EXIT_PORT and
--        SYS_EXPORT_DEST_PORT: CSV value, else the default from CUSTOMER_ADDRESSES of the order's
--        delivery address (what ADD_EXPORT_DETAILS copies). Everything else comes from the CSV.
--      * SALES_ORDER_EXPORT_NOTES - MANY rows per order (key order + note type + note code).
--        When the details row is created, the delivery address notes (CUSTOMER_ADDRESS_EXP_NOTES)
--        are copied first (what INITIAL_ORDER_EXPORT_NOTES does; switch @X_COPY_ADDR_NOTES).
--        Then the note of the CSV row is added; a note whose type + code already exists on the
--        order updates its text. Blank text keeps the existing text, else takes the standard
--        text of the code (SYS_EXPORT_NOTE_CODES), as the maintenance form does.
--    A database error on any step ROLLS BACK that row (neither table keeps anything from it) and
--    the staging row gets STATUS_FLAG = 'F', RS_MESSAGE_TEXT = 'Failed due to : <step>: <SQL error>'.
--    Loaded rows get STATUS_FLAG = 'P', PROCESSED_DATE and 'Loaded export data for order number : <n>'.
-- ============================================================================
BEGIN TRY

IF OBJECT_ID('tempdb..#EXP_ROWS') IS NOT NULL DROP TABLE #EXP_ROWS;

DECLARE @X_COPY_ADDR_NOTES BIT = 1;   -- 1 = copy the delivery address export notes onto the order

SELECT E.ID,
       LTRIM(RTRIM(E.COMPANY_CODE)) AS COMPANY_CODE,
       LTRIM(RTRIM(E.DIVISION))     AS DIVISION,
       LTRIM(RTRIM(E.ORDER_NUMBER)) AS ORDER_NUMBER
INTO #EXP_ROWS
FROM FIN.KAS_SO_EXPORT_LOADS E
WHERE E.STATUS_FLAG     = 'V'
  AND E.RS_MESSAGE_TEXT = 'Validated';

DECLARE @X_ID INT, @X_CO VARCHAR(10), @X_DIV VARCHAR(2), @X_ORD VARCHAR(9),
        @X_STAGE VARCHAR(60), @X_ERR NVARCHAR(2000),
        @X_NTYPE VARCHAR(50), @X_NCODE VARCHAR(50), @X_NTEXT VARCHAR(MAX),
        @X_LOADED INT = 0, @X_FAILED INT = 0;

WHILE 1 = 1
BEGIN
    SET @X_ID = NULL;
    SELECT TOP (1) @X_ID = ID, @X_CO = COMPANY_CODE, @X_DIV = DIVISION, @X_ORD = ORDER_NUMBER
    FROM #EXP_ROWS ORDER BY ID;
    IF @X_ID IS NULL BREAK;
    DELETE FROM #EXP_ROWS WHERE ID = @X_ID;

    SET @X_STAGE = 'SOP_ORDER_HEADER_EXP_DETAILS';
    SET @X_ERR = NULL;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ---------------------------------------------------------------- header export details
        -- one row per order: written by the first row of the order, later rows skip it
        IF NOT EXISTS (SELECT 1 FROM FIN.SOP_ORDER_HEADER_EXP_DETAILS D
                       WHERE D.COMPANY_CODE = @X_CO AND D.DIVISION = @X_DIV AND D.ORDER_NUMBER = @X_ORD)
        BEGIN
            INSERT INTO FIN.SOP_ORDER_HEADER_EXP_DETAILS
            (COMPANY_CODE, DIVISION, ORDER_NUMBER, SYS_TRANS_TERM_CODE, SYS_NBR_OF_CONTAINERS,
             SYS_CONTAINER_TYPE, SYS_CONTAINER_SIZE, SYS_MOT_CODE, SYS_INCOTERM_CODE, SYS_INCOTERM_CITY,
             SYS_SIGNATORY_NAME, SYS_LC_NUMBER, SYS_CARRIER_ADVICE_NUMBER, SYS_INSPECTION_NUMBER,
             SYS_SHIPPING_LINE, SYS_INSUR_CERT_NUMBER, SYS_CUSTOMS_REF_STATUS, SYS_EXPORT_EXIT_PORT,
             SYS_EXPORT_DEST_PORT, SYS_EXPORT_ADDL_INFO_1, SYS_EXPORT_ADDL_INFO_2, SYS_FRT_FORWARDER_NBR,
             SYS_BOOKING_NUMBER, SYS_VESSEL_NAME, SYS_VOYAGE_NUMBER, SYS_CONTAINER_NUMBER,
             SYS_SAIL_DATE, SYS_RAIL_DATE, SYS_CUT_OFF_DATE, SYS_LAYCAN_FROM_DATE, SYS_LAYCAN_TO_DATE)
            SELECT @X_CO, @X_DIV, @X_ORD,
                   COALESCE(NULLIF(LTRIM(RTRIM(E.SYS_TRANS_TERM_CODE)), ''), CA.SYS_TRANS_TERM_CODE, ''),
                   ISNULL(E.SYS_NBR_OF_CONTAINERS, 0),
                   ISNULL(LTRIM(RTRIM(E.SYS_CONTAINER_TYPE)), ''),
                   ISNULL(LTRIM(RTRIM(E.SYS_CONTAINER_SIZE)), ''),
                   COALESCE(NULLIF(LTRIM(RTRIM(E.SYS_MOT_CODE)), ''), CA.SYS_MOT_CODE, ''),
                   ISNULL(LTRIM(RTRIM(E.SYS_INCOTERM_CODE)), ''),
                   COALESCE(NULLIF(LTRIM(RTRIM(E.SYS_INCOTERM_CITY)), ''), CA.SYS_INCOTERM_CITY, ''),
                   ISNULL(LTRIM(RTRIM(E.SYS_SIGNATORY_NAME)), ''),
                   ISNULL(E.SYS_LC_NUMBER, ''), ISNULL(E.SYS_CARRIER_ADVICE_NUMBER, ''),
                   ISNULL(E.SYS_INSPECTION_NUMBER, ''),
                   ISNULL(LTRIM(RTRIM(E.SYS_SHIPPING_LINE)), ''),
                   ISNULL(E.SYS_INSUR_CERT_NUMBER, ''), ISNULL(E.SYS_CUSTOMS_REF_STATUS, ''),
                   COALESCE(NULLIF(LTRIM(RTRIM(E.SYS_EXPORT_EXIT_PORT)), ''), CA.SYS_EXPORT_EXIT_PORT, ''),
                   COALESCE(NULLIF(LTRIM(RTRIM(E.SYS_EXPORT_DEST_PORT)), ''), CA.SYS_EXPORT_DEST_PORT, ''),
                   ISNULL(E.SYS_EXPORT_ADDL_INFO_1, ''), ISNULL(E.SYS_EXPORT_ADDL_INFO_2, ''),
                   ISNULL(E.SYS_FRT_FORWARDER_NBR, ''), ISNULL(E.SYS_BOOKING_NUMBER, ''),
                   ISNULL(E.SYS_VESSEL_NAME, ''), ISNULL(E.SYS_VOYAGE_NUMBER, ''),
                   ISNULL(E.SYS_CONTAINER_NUMBER, ''),
                   -- GEM stores an empty date as 1858-11-17 (see the existing export rows)
                   ISNULL(E.SYS_SAIL_DATE, '18581117'), ISNULL(E.SYS_RAIL_DATE, '18581117'),
                   ISNULL(E.SYS_CUT_OFF_DATE, '18581117'),
                   ISNULL(E.SYS_LAYCAN_FROM_DATE, '18581117'), ISNULL(E.SYS_LAYCAN_TO_DATE, '18581117')
            FROM FIN.KAS_SO_EXPORT_LOADS E
            JOIN FIN.SALES_ORDER_HEADERS H
              ON H.COMPANY_CODE = @X_CO AND H.DIVISION = @X_DIV AND H.ORDER_NUMBER = @X_ORD
            JOIN FIN.CUSTOMER_ADDRESSES CA
              ON CA.COMPANY_CODE = H.COMPANY_CODE AND CA.DIVISION = H.DIVISION
             AND CA.CUSTOMER_NUMBER = H.CUSTOMER_NUMBER AND CA.ADDRESS_CODE = H.DELIVERY_ADDRESS_CODE
            WHERE E.ID = @X_ID;
            IF @@ROWCOUNT <> 1
                THROW 50023, 'The export details row was not created (order or delivery address not found)', 1;

            -- default export notes of the delivery address (INITIAL_ORDER_EXPORT_NOTES)
            IF @X_COPY_ADDR_NOTES = 1
            BEGIN
                SET @X_STAGE = 'SALES_ORDER_EXPORT_NOTES (delivery address notes)';
                INSERT INTO FIN.SALES_ORDER_EXPORT_NOTES
                (COMPANY_CODE, DIVISION, ORDER_NUMBER, SYS_EXPORT_NOTE_TYPE, SYS_EXPORT_NOTE_CODE, SYS_EXPORT_NOTES)
                SELECT @X_CO, @X_DIV, @X_ORD, N.SYS_EXPORT_NOTE_TYPE, N.SYS_EXPORT_NOTE_CODE, N.SYS_EXPORT_NOTES
                FROM FIN.SALES_ORDER_HEADERS H
                JOIN FIN.CUSTOMER_ADDRESS_EXP_NOTES N
                  ON N.COMPANY_CODE = H.COMPANY_CODE AND N.DIVISION = H.DIVISION
                 AND N.CUSTOMER_NUMBER = H.CUSTOMER_NUMBER AND N.ADDRESS_CODE = H.DELIVERY_ADDRESS_CODE
                WHERE H.COMPANY_CODE = @X_CO AND H.DIVISION = @X_DIV AND H.ORDER_NUMBER = @X_ORD;
            END
        END

        -- ---------------------------------------------------------------- the note of this row
        SET @X_STAGE = 'SALES_ORDER_EXPORT_NOTES';
        SELECT @X_NTYPE = LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_NOTE_TYPE, ''))),
               @X_NCODE = LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_NOTE_CODE, ''))),
               @X_NTEXT = NULLIF(LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_NOTES, ''))), '')
        FROM FIN.KAS_SO_EXPORT_LOADS E WHERE E.ID = @X_ID;

        IF @X_NTYPE <> '' AND @X_NCODE <> ''
        BEGIN
            IF EXISTS (SELECT 1 FROM FIN.SALES_ORDER_EXPORT_NOTES N
                       WHERE N.COMPANY_CODE = @X_CO AND N.DIVISION = @X_DIV AND N.ORDER_NUMBER = @X_ORD
                         AND N.SYS_EXPORT_NOTE_TYPE = @X_NTYPE AND N.SYS_EXPORT_NOTE_CODE = @X_NCODE)
            BEGIN
                IF @X_NTEXT IS NOT NULL                       -- blank text keeps the existing text
                    UPDATE FIN.SALES_ORDER_EXPORT_NOTES
                    SET SYS_EXPORT_NOTES = @X_NTEXT
                    WHERE COMPANY_CODE = @X_CO AND DIVISION = @X_DIV AND ORDER_NUMBER = @X_ORD
                      AND SYS_EXPORT_NOTE_TYPE = @X_NTYPE AND SYS_EXPORT_NOTE_CODE = @X_NCODE;
            END
            ELSE
            BEGIN
                IF @X_NTEXT IS NULL                           -- standard text of the note code
                    SELECT @X_NTEXT = C.SYS_EXPORT_NOTES
                    FROM FIN.SYS_EXPORT_NOTE_CODES C WHERE C.SYS_EXPORT_NOTE_CODE = @X_NCODE;
                INSERT INTO FIN.SALES_ORDER_EXPORT_NOTES
                (COMPANY_CODE, DIVISION, ORDER_NUMBER, SYS_EXPORT_NOTE_TYPE, SYS_EXPORT_NOTE_CODE, SYS_EXPORT_NOTES)
                VALUES (@X_CO, @X_DIV, @X_ORD, @X_NTYPE, @X_NCODE, ISNULL(@X_NTEXT, ''));
            END
        END

        -- everything succeeded: mark the staging row and commit together
        UPDATE FIN.KAS_SO_EXPORT_LOADS
        SET STATUS_FLAG     = 'P',
            PROCESSED_DATE  = GETDATE(),
            RS_MESSAGE_TEXT = CONCAT('Loaded export data for order number : ', @X_ORD)
        WHERE ID = @X_ID;

        COMMIT TRANSACTION;
        SET @X_LOADED += 1;
    END TRY
    BEGIN CATCH
        SET @X_ERR = ERROR_MESSAGE();
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;      -- nothing from this row survives

        UPDATE FIN.KAS_SO_EXPORT_LOADS                 -- recorded AFTER the rollback so it is kept
        SET STATUS_FLAG     = 'F',
            RS_MESSAGE_TEXT = LEFT(CONCAT('Failed due to : ', @X_STAGE, ': ', ISNULL(@X_ERR, 'unknown error')), 500)
        WHERE ID = @X_ID;
        SET @X_FAILED += 1;
    END CATCH
END

PRINT CONCAT('LOAD_SO_COMPLETE (export): ', @X_LOADED, ' staging row(s) loaded, ',
             @X_FAILED, ' marked F (see KAS_SO_EXPORT_LOADS.RS_MESSAGE_TEXT).');

END TRY
BEGIN CATCH
    DECLARE @X_FATAL NVARCHAR(2000) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT CONCAT('LOAD_SO_COMPLETE (export): unexpected error, export load stopped: ', @X_FATAL);
END CATCH

EXEC sys.sp_releaseapplock @Resource = N'KAS_SO_LOADS_PIPELINE', @LockOwner = 'Session';
GO
