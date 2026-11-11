-- ============================================================================
-- VALIDATION: FIN.KAS_SO_LOADS
-- Set-based, re-runnable, keyed on ID
--
--   * warehouse / customer / delivery address / product existence and status
--   * product-warehouse active + sales-order flag
--   * supported product scenario and no mixed scenarios in one order group
--   * sales/price UOM checks
--   * QUANTITY  / price / freight / date sanity
--   * duplicate staging lines
--   * order groups that already contain processed rows
--   * company exists and has an SO numbering row (SOP_TRANSACTION_TYPES)
--   * order-level result: if any line of an order group fails, every line of
--     that group is marked as an error (an order is only ever loaded whole)
--
-- COMPANY_CODE / DIVISION come from the staging rows; there are no defaults.
-- Rows already processed (STATUS_FLAG = 'P') are never re-validated.
-- Takes the same application lock as the loaders and CLEAR_SO_TABLES.
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ACTIVE         VARCHAR(10) = 'A';   -- ACTIVATION_STATUS = active
DECLARE @CLEAN_FLAG     VARCHAR(10) = 'V';
DECLARE @IC_PACKAGED_UOM VARCHAR(10) = 'P';  -- IC_PRODUCT_MASTER_UNITS.IC_PRODUCT_UOM_TYPE for packaged sales UOM
DECLARE @SO_MODULE      VARCHAR(2)  = 'SO';  -- SOP_TRANSACTION_TYPES.TRANSACTION_TYPE used by the loaders
DECLARE @LOCK_RC        INT;
DECLARE @MSG_MAX INT = (SELECT ISNULL(
    COLUMNPROPERTY(OBJECT_ID('FIN.KAS_SO_LOADS'), 'RS_MESSAGE_TEXT', 'charmaxlen'), -1));
IF @MSG_MAX < 1 SET @MSG_MAX = 4000;

IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;

BEGIN TRANSACTION;

-- Serialize with the loaders / CLEAR_SO_TABLES / another validation run
EXEC @LOCK_RC = sys.sp_getapplock @Resource = N'KAS_SO_LOADS_PIPELINE',
                                  @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
IF @LOCK_RC < 0
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('VALIDATE_KAS_SO_LOADS: another validate/load/clear run is in progress. Try again when it finishes.', 16, 1);
    RETURN;
END

-- ---- Compute all rule messages once, one row per non-processed KAS_SO_LOADS row
;WITH BASE AS (
    SELECT K.*,
           PM.PART_CODE                AS PM_PART_CODE,
           PM.ACTIVATION_STATUS        AS PM_ACTIVATION_STATUS,
           PM.WAREHOUSED_FLAG,
           PM.UNIT_SALES               AS PM_UNIT_SALES,
           PM.UNIT_PRICE               AS PM_UNIT_PRICE,
           PM.IC_PRODUCT_UOM_CONTROL,
           PM.IC_PACKAGED_PRODUCT,
           PM.IC_UNIT_CAPACITY,
           CASE
             WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S'  AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'SINGLE_NON_PACKAGED'
             WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S'  AND PM.IC_PACKAGED_PRODUCT = 'Y' THEN 'SINGLE_PACKAGED'
             WHEN PM.IC_PRODUCT_UOM_CONTROL = 'P' AND PM.IC_PACKAGED_PRODUCT = 'Y' THEN 'POTENT_PACKAGED'
             ELSE 'UNSUPPORTED'
           END AS SCENARIO,
           -- must stay identical to GROUP_KEY in the LOAD_SO_*.sql scripts
           CONCAT(
             LTRIM(RTRIM(K.COMPANY_CODE)), '|',
             LTRIM(RTRIM(K.DIVISION)), '|',
             LTRIM(RTRIM(K.CUSTOMER_NUMBER)), '|',
             LTRIM(RTRIM(K.CUSTOMER_REFERENCE))
           ) AS GROUP_KEY
    FROM FIN.KAS_SO_LOADS K
    LEFT JOIN FIN.PRODUCT_MASTER PM
      ON PM.COMPANY_CODE = K.COMPANY_CODE
     AND PM.PART_CODE    = K.PART_CODE
),
K0 AS (
    SELECT B.*,
           COUNT(*) OVER (
               PARTITION BY B.COMPANY_CODE, B.DIVISION, B.CUSTOMER_NUMBER,
                            B.DELIVERY_ADDRESS_CODE, B.CUSTOMER_REFERENCE,
                            B.ORDER_DATE, B.SYS_DELIVERY_DATE, B.WAREHOUSE,
                            B.PART_CODE, B.QUANTITY , B.SALES_PRICE, B.FREIGHT
           ) AS DupCnt,
           -- UNSUPPORTED / unknown parts are reported on their own row (R5a / R7a);
           -- they must not make the good lines look like a "mixed" order
           MIN(CASE WHEN B.SCENARIO <> 'UNSUPPORTED' THEN B.SCENARIO END) OVER (PARTITION BY B.GROUP_KEY) AS GrpScenarioMin,
           MAX(CASE WHEN B.SCENARIO <> 'UNSUPPORTED' THEN B.SCENARIO END) OVER (PARTITION BY B.GROUP_KEY) AS GrpScenarioMax
    FROM BASE B
    WHERE ISNULL(B.STATUS_FLAG, 'N') <> 'P'
),
PROCGRP AS (
    SELECT B.GROUP_KEY, COUNT(*) AS ProcCnt
    FROM BASE B
    WHERE B.STATUS_FLAG = 'P'
    GROUP BY B.GROUP_KEY
)
SELECT
    K.ID,
    K.GROUP_KEY,
    NULLIF(STUFF(CONCAT(
        X.R1a_msg, X.R1b_msg, X.R1c_msg, X.R1d_msg, X.R1e_msg, X.R1f_msg,
        X.R1g_msg, X.R1h_msg, X.R1i_msg, X.R1j_msg, X.R1k_msg,
        X.R2_msg, X.R2b_msg, X.R2c_msg,
        X.R3a_msg, X.R3b_msg, X.R3c_msg, X.R3d_msg, X.R3e_msg, X.R3f_msg,
        X.R3g_msg, X.R3h_msg, X.R3i_msg, X.R3j_msg, X.R3k_msg,
        X.R4a_msg, X.R4b_msg,
        X.R5a_msg, X.R5b_msg,
        X.R6a_msg, X.R6b_msg, X.R6c_msg,
        X.R7a_msg, X.R7b_msg,
        X.R8a_msg, X.R8b_msg, X.R8c_msg,
        X.R8d_msg, X.R8e_msg,
        X.R9a_msg, X.R9b_msg, X.R9c_msg,
        X.R10_msg,
        X.R11_msg,
        X.R12_msg
    ), 1, 2, ''), '') AS MSG,
    -- one flag per rule, so the summary does not depend on message text
    CASE WHEN CONCAT(X.R1a_msg, X.R1b_msg, X.R1c_msg, X.R1d_msg, X.R1e_msg, X.R1f_msg,
                     X.R1g_msg, X.R1h_msg, X.R1i_msg, X.R1j_msg, X.R1k_msg) <> '' THEN 1 ELSE 0 END AS F1,
    CASE WHEN CONCAT(X.R2_msg, X.R2b_msg, X.R2c_msg) <> '' THEN 1 ELSE 0 END AS F2,
    CASE WHEN CONCAT(X.R3a_msg, X.R3b_msg, X.R3c_msg, X.R3d_msg, X.R3e_msg, X.R3f_msg,
                     X.R3g_msg, X.R3h_msg, X.R3i_msg, X.R3j_msg, X.R3k_msg) <> '' THEN 1 ELSE 0 END AS F3,
    CASE WHEN CONCAT(X.R4a_msg, X.R4b_msg) <> '' THEN 1 ELSE 0 END AS F4,
    CASE WHEN CONCAT(X.R5a_msg, X.R5b_msg) <> '' THEN 1 ELSE 0 END AS F5,
    CASE WHEN CONCAT(X.R6a_msg, X.R6b_msg, X.R6c_msg) <> '' THEN 1 ELSE 0 END AS F6,
    CASE WHEN CONCAT(X.R7a_msg, X.R7b_msg) <> '' THEN 1 ELSE 0 END AS F7,
    CASE WHEN CONCAT(X.R8a_msg, X.R8b_msg, X.R8c_msg, X.R8d_msg, X.R8e_msg) <> '' THEN 1 ELSE 0 END AS F8,
    CASE WHEN CONCAT(X.R9a_msg, X.R9b_msg, X.R9c_msg) <> '' THEN 1 ELSE 0 END AS F9,
    CASE WHEN X.R10_msg <> '' THEN 1 ELSE 0 END AS F10,
    CASE WHEN X.R11_msg <> '' THEN 1 ELSE 0 END AS F11,
    CASE WHEN X.R12_msg <> '' THEN 1 ELSE 0 END AS F12,
    CAST(0 AS INT) AS F13
INTO #R
FROM K0 K
LEFT JOIN FIN.WAREHOUSE_CONTROLS WC
  ON WC.COMPANY_CODE = K.COMPANY_CODE
 AND WC.WAREHOUSE    = K.WAREHOUSE
LEFT JOIN FIN.CUSTOMERS C
  ON C.COMPANY_CODE    = K.COMPANY_CODE
 AND C.DIVISION        = K.DIVISION
 AND C.CUSTOMER_NUMBER = K.CUSTOMER_NUMBER
LEFT JOIN FIN.CUSTOMER_ADDRESSES CA
  ON CA.COMPANY_CODE    = K.COMPANY_CODE
 AND CA.DIVISION        = K.DIVISION
 AND CA.CUSTOMER_NUMBER = K.CUSTOMER_NUMBER
 AND CA.ADDRESS_CODE    = K.DELIVERY_ADDRESS_CODE
LEFT JOIN FIN.PRODUCT_WAREHOUSE PW
  ON PW.COMPANY_CODE = K.COMPANY_CODE
 AND PW.PART_CODE    = K.PART_CODE
 AND PW.WAREHOUSE    = K.WAREHOUSE
LEFT JOIN FIN.SYS_CURRENCY_CODES CUR
  ON CUR.SYS_CURRENCY_CODE = C.SYS_CURRENCY_CODE
LEFT JOIN FIN.SALES_ORDER_TYPES SOT
  ON SOT.COMPANY_CODE      = K.COMPANY_CODE
 AND SOT.SALES_ORDER_TYPE  = C.SALES_ORDER_TYPE
LEFT JOIN FIN.COMPANY_CONTROLS CC
  ON CC.COMPANY_CODE = K.COMPANY_CODE
LEFT JOIN FIN.COST_CENTERS CCT
  ON CCT.COMPANY_CODE = K.COMPANY_CODE
 AND CCT.COST_CENTER  = SOT.COST_CENTER
LEFT JOIN PROCGRP P
  ON P.GROUP_KEY = K.GROUP_KEY
CROSS APPLY (SELECT
    -- ---- RULE 1: required staging fields
    CASE WHEN NULLIF(LTRIM(RTRIM(K.COMPANY_CODE)), '') IS NULL
         THEN '; COMPANY_CODE is required' ELSE '' END AS R1a_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.DIVISION)), '') IS NULL
         THEN '; DIVISION is required' ELSE '' END AS R1b_msg,
    CASE WHEN K.ORDER_DATE IS NULL
         THEN '; ORDER_DATE is required' ELSE '' END AS R1c_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.CUSTOMER_NUMBER)), '') IS NULL
         THEN '; CUSTOMER_NUMBER is required' ELSE '' END AS R1d_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.DELIVERY_ADDRESS_CODE)), '') IS NULL
         THEN '; DELIVERY_ADDRESS_CODE is required' ELSE '' END AS R1e_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.CUSTOMER_REFERENCE)), '') IS NULL
         THEN '; CUSTOMER_REFERENCE is required for order grouping' ELSE '' END AS R1f_msg,
    CASE WHEN K.SYS_DELIVERY_DATE IS NULL
         THEN '; SYS_DELIVERY_DATE is required' ELSE '' END AS R1g_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.WAREHOUSE)), '') IS NULL
         THEN '; WAREHOUSE is required' ELSE '' END AS R1h_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PART_CODE)), '') IS NULL
         THEN '; PART_CODE is required' ELSE '' END AS R1i_msg,
    CASE WHEN K.QUANTITY  IS NULL
         THEN '; QUANTITY  is required' ELSE '' END AS R1j_msg,
    CASE WHEN K.SALES_PRICE IS NULL
         THEN '; SALES_PRICE is required' ELSE '' END AS R1k_msg,

    -- ---- RULE 2: warehouse exists for the company
    CASE WHEN NULLIF(LTRIM(RTRIM(K.WAREHOUSE)), '') IS NOT NULL
          AND WC.WAREHOUSE IS NULL
         THEN CONCAT('; Warehouse ', K.WAREHOUSE, ' does not exist in WAREHOUSE_CONTROLS')
         ELSE '' END AS R2_msg,
    -- company exists (staging value is used as-is, never defaulted)
    CASE WHEN NULLIF(LTRIM(RTRIM(K.COMPANY_CODE)), '') IS NOT NULL
          AND CC.COMPANY_CODE IS NULL
         THEN CONCAT('; Company ', K.COMPANY_CODE, ' does not exist in COMPANY_CONTROLS')
         ELSE '' END AS R2b_msg,
    -- the loaders need an SO numbering row for the company/division; this also
    -- proves the division is valid
    CASE WHEN NULLIF(LTRIM(RTRIM(K.COMPANY_CODE)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.DIVISION)), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM FIN.SOP_TRANSACTION_TYPES T
              WHERE T.COMPANY_CODE     = K.COMPANY_CODE
                AND T.DIVISION         = K.DIVISION
                AND T.TRANSACTION_TYPE = @SO_MODULE)
         THEN CONCAT('; No SOP_TRANSACTION_TYPES row (TRANSACTION_TYPE=', @SO_MODULE,
                     ') for company ', K.COMPANY_CODE, ' / division ', K.DIVISION)
         ELSE '' END AS R2c_msg,

    -- ---- RULE 3: customer exists / active / not stopped / currency / type / invoice address
    CASE WHEN NULLIF(LTRIM(RTRIM(K.CUSTOMER_NUMBER)), '') IS NOT NULL
          AND C.CUSTOMER_NUMBER IS NULL
         THEN CONCAT('; Customer ', K.CUSTOMER_NUMBER, ' does not exist in CUSTOMERS')
         ELSE '' END AS R3a_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND ISNULL(C.ACTIVATION_STATUS, '') <> @ACTIVE
         THEN CONCAT('; Customer ', K.CUSTOMER_NUMBER, ' is not active')
         ELSE '' END AS R3b_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.STOP_CODE)), '') IS NOT NULL
         THEN CONCAT('; Customer ', K.CUSTOMER_NUMBER, ' has STOP_CODE ', C.STOP_CODE)
         ELSE '' END AS R3c_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.SYS_CURRENCY_CODE)), '') IS NULL
         THEN CONCAT('; Customer ', K.CUSTOMER_NUMBER, ' has no currency code')
         ELSE '' END AS R3d_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.SYS_CURRENCY_CODE)), '') IS NOT NULL
          AND (CUR.SYS_CURRENCY_CODE IS NULL OR ISNULL(CUR.ACTIVATION_STATUS, '') <> @ACTIVE)
         THEN CONCAT('; Customer currency ', C.SYS_CURRENCY_CODE, ' does not exist or is inactive')
         ELSE '' END AS R3e_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.DEFAULT_ADDR)), '') IS NULL
         THEN CONCAT('; Customer ', K.CUSTOMER_NUMBER, ' has no DEFAULT_ADDR invoice address')
         ELSE '' END AS R3f_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.DEFAULT_ADDR)), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM FIN.CUSTOMER_ADDRESSES DA
              WHERE DA.COMPANY_CODE    = C.COMPANY_CODE
                AND DA.DIVISION        = C.DIVISION
                AND DA.CUSTOMER_NUMBER = C.CUSTOMER_NUMBER
                AND DA.ADDRESS_CODE    = C.DEFAULT_ADDR
                AND ISNULL(DA.ACTIVATION_STATUS, '') = @ACTIVE)
         THEN CONCAT('; Customer default invoice address ', C.DEFAULT_ADDR, ' does not exist or is not active')
         ELSE '' END AS R3g_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.SALES_ORDER_TYPE)), '') IS NULL
         THEN CONCAT('; Customer ', K.CUSTOMER_NUMBER, ' has no SALES_ORDER_TYPE')
         ELSE '' END AS R3h_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(C.SALES_ORDER_TYPE)), '') IS NOT NULL
          AND SOT.SALES_ORDER_TYPE IS NULL
         THEN CONCAT('; SALES_ORDER_TYPE ', C.SALES_ORDER_TYPE, ' is not defined in SALES_ORDER_TYPES')
         ELSE '' END AS R3i_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND SOT.SALES_ORDER_TYPE IS NOT NULL
          AND ISNULL(CC.COST_CENTER_ON_ORDER_TYPE, 'N') = 'Y'
          AND NULLIF(LTRIM(RTRIM(SOT.COST_CENTER)), '') IS NULL
         THEN CONCAT('; SALES_ORDER_TYPE ', C.SALES_ORDER_TYPE,
                     ' has no COST_CENTER but cost centers are required')
         ELSE '' END AS R3j_msg,
    CASE WHEN C.CUSTOMER_NUMBER IS NOT NULL
          AND ISNULL(CC.COST_CENTER_ON_ORDER_TYPE, 'N') = 'Y'
          AND NULLIF(LTRIM(RTRIM(SOT.COST_CENTER)), '') IS NOT NULL
          AND CCT.COST_CENTER IS NULL
         THEN CONCAT('; Cost center ', SOT.COST_CENTER,
                     ' for SALES_ORDER_TYPE ', C.SALES_ORDER_TYPE,
                     ' does not exist in COST_CENTERS')
         ELSE '' END AS R3k_msg,

    -- ---- RULE 4: delivery address exists / active
    CASE WHEN NULLIF(LTRIM(RTRIM(K.DELIVERY_ADDRESS_CODE)), '') IS NOT NULL
          AND C.CUSTOMER_NUMBER IS NOT NULL
          AND CA.ADDRESS_CODE IS NULL
         THEN CONCAT('; Delivery address ', K.DELIVERY_ADDRESS_CODE,
                     ' does not exist for customer ', K.CUSTOMER_NUMBER)
         ELSE '' END AS R4a_msg,
    CASE WHEN CA.ADDRESS_CODE IS NOT NULL
          AND ISNULL(CA.ACTIVATION_STATUS, '') <> @ACTIVE
         THEN CONCAT('; Delivery address ', K.DELIVERY_ADDRESS_CODE,
                     ' is not active for customer ', K.CUSTOMER_NUMBER)
         ELSE '' END AS R4b_msg,

    -- ---- RULE 5: part exists / active
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PART_CODE)), '') IS NOT NULL
          AND K.PM_PART_CODE IS NULL
         THEN CONCAT('; Part ', K.PART_CODE, ' does not exist in PRODUCT_MASTER')
         ELSE '' END AS R5a_msg,
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND ISNULL(K.PM_ACTIVATION_STATUS, '') <> @ACTIVE
         THEN CONCAT('; Part ', K.PART_CODE, ' is not active in PRODUCT_MASTER')
         ELSE '' END AS R5b_msg,

    -- ---- RULE 6: product-warehouse record for warehoused products
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND K.WAREHOUSED_FLAG = 'Y'
          AND NULLIF(LTRIM(RTRIM(K.WAREHOUSE)), '') IS NOT NULL
          AND PW.PART_CODE IS NULL
         THEN CONCAT('; Part ', K.PART_CODE, ' has no PRODUCT_WAREHOUSE record for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R6a_msg,
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND K.WAREHOUSED_FLAG = 'Y'
          AND PW.PART_CODE IS NOT NULL
          AND ISNULL(PW.ACTIVATION_STATUS, '') <> @ACTIVE
         THEN CONCAT('; PRODUCT_WAREHOUSE for part ', K.PART_CODE,
                     ' is not active in warehouse ', K.WAREHOUSE)
         ELSE '' END AS R6b_msg,
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND K.WAREHOUSED_FLAG = 'Y'
          AND PW.PART_CODE IS NOT NULL
          AND ISNULL(PW.SALES_ORDERS_FLAG, '') <> 'Y'
         THEN CONCAT('; Sales orders are not allowed for part ', K.PART_CODE,
                     ' in warehouse ', K.WAREHOUSE)
         ELSE '' END AS R6c_msg,

    -- ---- RULE 7: supported scenario / no mixed scenarios in an order group
    CASE WHEN K.PM_PART_CODE IS NOT NULL AND K.SCENARIO = 'UNSUPPORTED'
         THEN CONCAT('; Unsupported product scenario (IC_PRODUCT_UOM_CONTROL=',
                     ISNULL(K.IC_PRODUCT_UOM_CONTROL, ''), ', IC_PACKAGED_PRODUCT=',
                     ISNULL(K.IC_PACKAGED_PRODUCT, ''), ')')
         ELSE '' END AS R7a_msg,
    CASE WHEN K.SCENARIO <> 'UNSUPPORTED'
          AND K.GrpScenarioMin <> K.GrpScenarioMax
         THEN CONCAT('; Order group mixes product scenarios (',
                     K.GrpScenarioMin, ' / ', K.GrpScenarioMax, ')')
         ELSE '' END AS R7b_msg,

    -- ---- RULE 8: sales/price UOM
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.PM_UNIT_SALES)), '') IS NULL
         THEN '; PRODUCT_MASTER.UNIT_SALES is blank' ELSE '' END AS R8a_msg,
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.PM_UNIT_PRICE)), '') IS NULL
         THEN '; PRODUCT_MASTER.UNIT_PRICE is blank' ELSE '' END AS R8b_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PM_UNIT_SALES)), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM FIN.UNITS_OF_MEASURE U
              WHERE LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(K.PM_UNIT_SALES)))
         THEN CONCAT('; Sales UOM ', K.PM_UNIT_SALES, ' is not in UNITS_OF_MEASURE')
         ELSE '' END AS R8c_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PM_UNIT_PRICE)), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM FIN.UNITS_OF_MEASURE U
              WHERE LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(K.PM_UNIT_PRICE)))
         THEN CONCAT('; Price UOM ', K.PM_UNIT_PRICE, ' is not in UNITS_OF_MEASURE')
         ELSE '' END AS R8d_msg,
    CASE WHEN K.PM_PART_CODE IS NOT NULL
          AND K.IC_PACKAGED_PRODUCT = 'Y'
          AND NULLIF(LTRIM(RTRIM(K.PM_UNIT_SALES)), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM FIN.IC_PRODUCT_MASTER_UNITS U
              WHERE U.COMPANY_CODE      = K.COMPANY_CODE
                AND U.PART_CODE         = K.PART_CODE
                AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(K.PM_UNIT_SALES))
                AND U.IC_PRODUCT_UOM_TYPE = @IC_PACKAGED_UOM)
         THEN CONCAT('; Sales UOM ', K.PM_UNIT_SALES,
                     ' is not a packaged IC unit for part ', K.PART_CODE)
         ELSE '' END AS R8e_msg,

    -- ---- RULE 9: QUANTITY  / price / freight
    CASE WHEN K.QUANTITY  IS NOT NULL AND TRY_CAST(K.QUANTITY AS DECIMAL(18,4)) <= 0
         THEN '; QUANTITY  must be greater than zero'
         WHEN K.QUANTITY IS NOT NULL AND TRY_CAST(K.QUANTITY AS DECIMAL(18,4)) IS NULL
         THEN '; QUANTITY must be a valid number'
         ELSE '' END AS R9a_msg,
    CASE WHEN K.SALES_PRICE IS NOT NULL AND K.SALES_PRICE < 0
         THEN '; SALES_PRICE cannot be negative' ELSE '' END AS R9b_msg,
    CASE WHEN K.FREIGHT IS NOT NULL AND K.FREIGHT < 0
         THEN '; FREIGHT cannot be negative' ELSE '' END AS R9c_msg,

    -- ---- RULE 10: date order
    CASE WHEN K.ORDER_DATE IS NOT NULL
          AND K.SYS_DELIVERY_DATE IS NOT NULL
          AND K.SYS_DELIVERY_DATE < K.ORDER_DATE
         THEN '; SYS_DELIVERY_DATE cannot be before ORDER_DATE' ELSE '' END AS R10_msg,

    -- ---- RULE 11: duplicate staging line
    CASE WHEN K.DupCnt > 1
         THEN CONCAT('; Duplicate staging line: ', K.DupCnt,
                     ' rows share the same customer, reference, address, dates, warehouse, part, QUANTITY , price and freight')
         ELSE '' END AS R11_msg,

    -- ---- RULE 12: already-processed order group
    CASE WHEN ISNULL(P.ProcCnt, 0) > 0
         THEN '; Order group already contains processed rows; use a new CUSTOMER_REFERENCE'
         ELSE '' END AS R12_msg
) X;

-- Safety check: fails here if ID is not unique (or is NULL)
CREATE UNIQUE CLUSTERED INDEX IX_R_KEY ON #R (ID);

-- ============================================================================
-- RULE 13: an order is only loaded whole. If any line of an order group failed,
-- the clean lines of that group are marked as errors too.
-- ============================================================================
UPDATE R
SET MSG = 'Another line of this order group failed validation; the order loads only as a whole',
    F13 = 1
FROM #R R
WHERE R.MSG IS NULL
  AND EXISTS (SELECT 1 FROM #R R2
              WHERE R2.GROUP_KEY = R.GROUP_KEY
                AND R2.MSG IS NOT NULL);

-- ============================================================================
-- UPDATE: apply STATUS_FLAG and RS_MESSAGE_TEXT (processed rows untouched)
-- ============================================================================
UPDATE K
SET STATUS_FLAG     = CASE WHEN R.MSG IS NOT NULL THEN 'E' ELSE @CLEAN_FLAG END,
    RS_MESSAGE_TEXT = CASE WHEN R.MSG IS NOT NULL THEN LEFT(R.MSG, @MSG_MAX)
                           ELSE 'Validated' END
FROM FIN.KAS_SO_LOADS K
JOIN #R R ON R.ID = K.ID
WHERE ISNULL(K.STATUS_FLAG, 'N') <> 'P';   -- never overwrite a processed row

COMMIT TRANSACTION;

-- ============================================================================
-- SUMMARY: errors per rule (a row with several errors counts under each rule)
-- Counted from the per-rule flags in #R, not from message text.
-- ============================================================================
SELECT V.Rule_Name, V.Error_Count
FROM (
    SELECT
        ISNULL(SUM(F1), 0)  AS r1,  ISNULL(SUM(F2), 0)  AS r2,  ISNULL(SUM(F3), 0)  AS r3,
        ISNULL(SUM(F4), 0)  AS r4,  ISNULL(SUM(F5), 0)  AS r5,  ISNULL(SUM(F6), 0)  AS r6,
        ISNULL(SUM(F7), 0)  AS r7,  ISNULL(SUM(F8), 0)  AS r8,  ISNULL(SUM(F9), 0)  AS r9,
        ISNULL(SUM(F10), 0) AS r10, ISNULL(SUM(F11), 0) AS r11, ISNULL(SUM(F12), 0) AS r12,
        ISNULL(SUM(F13), 0) AS r13,
        ISNULL(SUM(CASE WHEN MSG IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_err
    FROM #R
) C
CROSS APPLY (VALUES
    (1,  'Rule 1 - Required staging fields',                         C.r1),
    (2,  'Rule 2 - Warehouse / company / SO numbering exist',        C.r2),
    (3,  'Rule 3 - Customer/type/currency/address/cost center',      C.r3),
    (4,  'Rule 4 - Delivery address exists and active',              C.r4),
    (5,  'Rule 5 - Part exists and active',                          C.r5),
    (6,  'Rule 6 - Product/warehouse active and sales allowed',      C.r6),
    (7,  'Rule 7 - Supported scenario / no mixed scenarios',         C.r7),
    (8,  'Rule 8 - Sales and price UOM valid',                       C.r8),
    (9,  'Rule 9 - QUANTITY /price/freight valid',                    C.r9),
    (10, 'Rule 10 - Delivery date not before order date',            C.r10),
    (11, 'Rule 11 - Duplicate staging line',                         C.r11),
    (12, 'Rule 12 - Order group already processed',                  C.r12),
    (13, 'Rule 13 - Clean line in an order group with a failed line', C.r13),
    (14, 'Total rows with errors',                                   C.total_err),
    (15, 'Total rows validated (passed)',   (SELECT COUNT(*) FROM FIN.KAS_SO_LOADS WHERE STATUS_FLAG = 'V')),
    (16, 'Total rows already processed',    (SELECT COUNT(*) FROM FIN.KAS_SO_LOADS WHERE STATUS_FLAG = 'P'))
) V (Sort_Order, Rule_Name, Error_Count)
ORDER BY V.Sort_Order;

-- ============================================================================
-- FAILED ROWS for review
-- ============================================================================
SELECT K.ID, K.COMPANY_CODE, K.DIVISION, K.CUSTOMER_NUMBER,
       K.DELIVERY_ADDRESS_CODE, K.CUSTOMER_REFERENCE, K.ORDER_DATE,
       K.SYS_DELIVERY_DATE, K.WAREHOUSE, K.PART_CODE,
       K.QUANTITY, K.SALES_PRICE, K.FREIGHT,
       K.STATUS_FLAG, K.RS_MESSAGE_TEXT
FROM FIN.KAS_SO_LOADS K
WHERE K.STATUS_FLAG = 'E'
ORDER BY K.CUSTOMER_NUMBER, K.CUSTOMER_REFERENCE, K.WAREHOUSE, K.PART_CODE, K.ID;
GO
