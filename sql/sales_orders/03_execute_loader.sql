-- ============================================================================
-- LOAD_SO_SINGLE_NON_PACKAGED.sql
-- Scenario: Single non-packaged
--   PRODUCT_MASTER.IC_PRODUCT_UOM_CONTROL = 'S'
--   PRODUCT_MASTER.IC_PACKAGED_PRODUCT    = 'N'
-- 
-- Processes only FIN.KAS_SO_LOADS rows with
--   STATUS_FLAG = 'V' AND RS_MESSAGE_TEXT = 'Validated'
--
--  ables populated (nothing else is written):
--   SALES_ORDER_HEADERS, SALES_ORDER_LINES, SALES_ORDER_LINE_DETAILS,
--   SALES_ORDER_LINE_QTYS, SALES_ORDER_LINE_DETAIL_QTYS
--   SALES_ORDER_HISTORY
--
-- Behaviour:
--   * One sales order per (COMPANY_CODE, DIVISION, CUSTOMER_NUMBER,
--     CUSTOMER_REFERENCE). WAREHOUSE, delivery address and dates are NOT part
--     of the grouping key.
--   * COMPANY_CODE / DIVISION come from the staging rows (no defaults).
--   * An order group is loaded ONLY when every staging row in the group is
--     validated and belongs to this scenario. Groups with any new / errored /
--     already-processed row, or with another scenario, are skipped whole, so an
--     order is never created from part of its lines.
--   * ORDER_NUMBER: if the staging rows already carry an ORDER_NUMBER, that number
--     is used for the order (rows with the same provided number and the same
--     customer/reference form one order; different provided numbers = different
--     orders). Rows with no ORDER_NUMBER get a number allocated from
--     FIN.SOP_TRANSACTION_TYPES (TRANSACTION_TYPE = 'SO') under UPDLOCK/HOLDLOCK,
--     exactly as before. Provided numbers do not move the counter.
--     A provided number is SKIPPED (group stays 'V', listed in a result set) when it
--     is longer than 9 characters, already exists on SALES_ORDER_HEADERS, or is used
--     by more than one customer/reference group.
--   * Prices / freight come from the CSV staging values only.
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
--          number, missing counter row, missing UOM conversion, weight/volume that
--          cannot be derived, order number collision) fail that order BEFORE anything
--          is written. The order is never attempted.
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

-- WEIGHT/VOLUME: GEM parameter values (M / D / F confirmed)
DECLARE @MULT CHAR(1) = 'M', @DIV CHAR(1) = 'D', @FORM CHAR(1) = 'F';
-- !! FILL IN: stored values of the IC_WTVOL_* parameters
DECLARE @WV_ACTUAL    VARCHAR(10) = 'A';   -- IC_WTVOL_ACTUAL
DECLARE @WV_FIXED     VARCHAR(10) = 'F';   -- IC_WTVOL_FIXED
DECLARE @WV_INVENTORY VARCHAR(10) = 'I';   -- IC_WTVOL_INVENTORY
DECLARE @WV_PACKAGED  VARCHAR(10) = 'P';   -- IC_WTVOL_PACKAGED
IF @WV_ACTUAL IS NULL OR @WV_FIXED IS NULL OR @WV_INVENTORY IS NULL OR @WV_PACKAGED IS NULL
BEGIN
    RAISERROR('LOAD_SO_SINGLE_NON_PACKAGED: set @WV_ACTUAL / @WV_FIXED / @WV_INVENTORY / @WV_PACKAGED from the IC_WTVOL_* parameters.', 16, 1);
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
    RAISERROR('LOAD_SO_SINGLE_NON_PACKAGED: another validate/load/clear run is in progress. Try again when it finishes.', 16, 1);
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
       K.SYS_DELIVERY_DATE,
       K.WAREHOUSE,
       K.PART_CODE,
       ISNULL(K.QUANTITY, 0)    AS QUANTITY,
       ISNULL(K.SALES_PRICE, 0) AS SALES_PRICE,
       ISNULL(K.FREIGHT, 0)     AS FREIGHT,
       PM.UNIT_SALES,
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
       CASE WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S'
             AND PM.IC_PACKAGED_PRODUCT    = 'N'
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
    PRINT CONCAT('LOAD_SO_SINGLE_NON_PACKAGED: skipped ', @SKIPPED,
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
    PRINT CONCAT('LOAD_SO_SINGLE_NON_PACKAGED: ', (SELECT COUNT(*) FROM #BAD_PROV),
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
    PRINT 'LOAD_SO_SINGLE_NON_PACKAGED: no eligible validated rows left to load for scenario (S,N).';

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
    THROW 50001, 'LOAD_SO_SINGLE_NON_PACKAGED: line count does not match validated staging rows.', 1;


ALTER TABLE #LINES ADD
    ITEM_WEIGHT DECIMAL(28,10) NULL, ITEM_VOLUME DECIMAL(28,10) NULL,
    WEIGHT_HDR  DECIMAL(28,10) NULL, VOLUME_HDR  DECIMAL(28,10) NULL;

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
-- 4d. Line weight / volume (LB_S_L_WTVOL).  Quantity = staging QUANTITY in
--     UNIT_SALES (= nominated UOM for stock single-UOM lines); 2nd/3rd UOMs
--     are blank for this scenario.  NULL result = DML error (P_90247 / not
--     supported) -> guarded below.
-- ----------------------------------------------------------------------------
UPDATE L
SET ITEM_WEIGHT = CASE
        WHEN L.WT_CTRL = @WV_ACTUAL THEN
             CASE WHEN L.UNIT_SALES = L.ITEM_WEIGHT_UOM THEN CAST(L.QUANTITY AS DECIMAL(28,10))
                  WHEN L.ITEM_WEIGHT_UOM = '' THEN 0 END
        WHEN L.WT_CTRL = @WV_FIXED THEN
             CASE WHEN L.UNIT_SALES = L.WT_FROM_UOM
                       THEN CAST(L.QUANTITY AS DECIMAL(28,10)) * CAST(L.WT_FIXED AS DECIMAL(28,10))
                  WHEN L.WT_FROM_UOM = '' THEN 0 END
        WHEN L.WT_CTRL = @WV_INVENTORY THEN
             CASE WHEN L.UNIT_SALES <> L.WT_FROM_UOM OR L.WT_FROM_UOM = '' THEN NULL
                  WHEN L.WT_FROM_UOM = L.ITEM_WEIGHT_UOM THEN CAST(L.QUANTITY AS DECIMAL(28,10))
                  ELSE ROUND(CASE CW.METHOD
                                 WHEN @MULT THEN CAST(L.QUANTITY AS DECIMAL(28,10)) * CW.FACTOR
                                 WHEN @DIV  THEN CAST(L.QUANTITY AS DECIMAL(28,10)) / NULLIF(CW.FACTOR, 0) END,
                             CW.DP_TO) END
        WHEN L.WT_CTRL = @WV_PACKAGED THEN NULL
        ELSE 0 END,
    ITEM_VOLUME = CASE
        WHEN L.VOL_CTRL = @WV_ACTUAL THEN
             CASE WHEN L.UNIT_SALES = L.ITEM_VOLUME_UOM THEN CAST(L.QUANTITY AS DECIMAL(28,10))
                  WHEN L.ITEM_VOLUME_UOM = '' THEN 0 END
        WHEN L.VOL_CTRL = @WV_FIXED THEN
             CASE WHEN L.UNIT_SALES = L.VOL_FROM_UOM
                       THEN CAST(L.QUANTITY AS DECIMAL(28,10)) * CAST(L.VOL_FIXED AS DECIMAL(28,10))
                  WHEN L.VOL_FROM_UOM = '' THEN 0 END
        WHEN L.VOL_CTRL = @WV_INVENTORY THEN
             CASE WHEN L.UNIT_SALES <> L.VOL_FROM_UOM OR L.VOL_FROM_UOM = '' THEN NULL
                  WHEN L.VOL_FROM_UOM = L.ITEM_VOLUME_UOM THEN CAST(L.QUANTITY AS DECIMAL(28,10))
                  ELSE ROUND(CASE CV.METHOD
                                 WHEN @MULT THEN CAST(L.QUANTITY AS DECIMAL(28,10)) * CV.FACTOR
                                 WHEN @DIV  THEN CAST(L.QUANTITY AS DECIMAL(28,10)) / NULLIF(CV.FACTOR, 0) END,
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
        @ORD_CNT INT, @LINE_CNT INT, @N INT;

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
 BROKER_CODE, LOCATION, SALES_ANALYSIS_GROUP, COST_CENTER)
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
            THEN COALESCE(SOT.COST_CENTER, '') ELSE '' END
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
-- 9. Line quantities 
-- ----------------------------------------------------------------------------
INSERT INTO FIN.SALES_ORDER_LINE_QTYS
(COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, UNIT_OF_MEASURE,
 IC_APPROX_QTY_FLAG, ORDER_QUANTITY, TEMP_ORDER_QUANTITY, IC_QTY_PICKED,
 IC_QTY_IN_DESPATCH, QTY_DESPATCHED, QTY_INVOICED, QTY_RESERVED,
 TEMP_QTY_RESERVED, QUANTITY_PROMISED, IC_QTY_TO_SHIP, IC_QTY_CLOSED)
SELECT
       L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.LINE_NO,
       L.UNIT_SALES, 'N', L.QUANTITY, L.QUANTITY,
       0, 0, 0, 0, 0, 0, 0, 0, 0
FROM #LINES L
JOIN #RUN_LINES RL ON RL.ID = L.ID;
SET @N = @@ROWCOUNT;
        IF @N < @LINE_CNT THROW 50013, 'The sales order line quantity was not created.', 1;

-- ----------------------------------------------------------------------------
-- 10. Line detail quantities SELECT * FROM SALES_ORDER_LINE_DETAIL_QTYS
-- ----------------------------------------------------------------------------
INSERT INTO FIN.SALES_ORDER_LINE_DETAIL_QTYS
(COMPANY_CODE, DIVISION, ORDER_NUMBER, ORDER_LINE_NUMBER, [SEQUENCE],
 UNIT_OF_MEASURE, IC_APPROX_QTY_FLAG, ORDER_QUANTITY, TEMP_ORDER_QUANTITY,
 IC_QTY_PICKED, IC_QTY_IN_DESPATCH, QTY_DESPATCHED, QTY_INVOICED,
 QTY_RESERVED, QUANTITY_PROMISED, WAREHOUSE, PART_CODE, REQUIRED_DATE,
 ORDER_LINE_TYPE, IC_QTY_TO_SHIP, IC_QTY_CLOSED)
SELECT
       L.COMPANY_CODE, L.DIVISION, L.ORDER_NUMBER, L.LINE_NO,
       '001', L.UNIT_SALES, 'N', L.QUANTITY, L.QUANTITY,
       0, 0, 0, 0, 0, 0, L.WAREHOUSE, L.PART_CODE, L.SYS_DELIVERY_DATE,
       'S', 0, 0
FROM #LINES L
JOIN #RUN_LINES RL ON RL.ID = L.ID;
SET @N = @@ROWCOUNT;
        IF @N < @LINE_CNT THROW 50014, 'The sales order line detail quantity was not created.', 1;

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

PRINT CONCAT('LOAD_SO_SINGLE_NON_PACKAGED: loaded ', @LoadedOrders, ' order(s) / ', @LoadedLines,
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

    PRINT CONCAT('LOAD_SO_SINGLE_NON_PACKAGED: unexpected error, run stopped and unloaded lines marked F: ', @FATAL);
END CATCH

EXEC sys.sp_releaseapplock @Resource = N'KAS_SO_LOADS_PIPELINE', @LockOwner = 'Session';
GO
