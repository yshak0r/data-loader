-- ============================================================================
-- VALIDATION: FIN.KAS_SO_LOADS
-- Set-based, re-runnable, keyed on ID
--
--   * warehouse / customer / delivery address / product existence and status
--   * product-warehouse active + sales-order flag
--   * supported product scenario and no mixed scenarios in one order group
--       supported scenarios (all loaded by LOAD_SO_COMPLETE.sql):
--         SINGLE_NON_PACKAGED (S/N), SINGLE_PACKAGED (S/Y), POTENT_NON_PACKAGED (P/N)
--       anything else (e.g. potent / packaged, P/Y) is rejected as unsupported.
--       An order MAY mix the supported scenarios: each line is loaded by its own rules.
--   * potent non-packaged items (P/N): the potency quantity (LBS -> SLBS) must be derivable,
--     using the same rule as LOAD_SO_POTENT_NON_PACKAGED.sql (Rule 14); the unit on the
--     staging row (KAS_SO_LOADS.UNIT_SALES) must equal PRODUCT_MASTER.UNIT_SALES
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
--
-- ALSO VALIDATES FIN.KAS_SO_EXPORT_LOADS (export details / export notes loaded by section 7 of
-- LOAD_SO_COMPLETE.sql): see the 'EXPORT VALIDATION' block (rules E1-E7) before the COMMIT.
-- Run it after the sales orders are loaded; the loader does no validation of its own.
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

-- ---- Export staging (FIN.KAS_SO_EXPORT_LOADS) settings
DECLARE @EXP_ENFORCE_DATES      BIT = 1;    -- 1 = sail / rail / cut-off / laycan dates later than the order delivery
                                            --     date are errors (the order form only warns)
DECLARE @EXP_NOTE_MATCH_ADDRESS BIT = 1;    -- 1 = note type / code must be defined for the customer AND the order's
                                            --     delivery address; 0 = for any address of the customer
DECLARE @EXP_EXIT_TYPE  VARCHAR(1) = '1';   -- SYS_EXPORT_PORTS.SYS_PORT_TYPE of an exit port
DECLARE @EXP_DEST_TYPE  VARCHAR(1) = '2';   -- SYS_EXPORT_PORTS.SYS_PORT_TYPE of a destination port
DECLARE @EXP_DECLARANT  VARCHAR(1) = '1';   -- SYS_SIGNATORIES.SYS_SIGNATORY_TYPE of a declarant (not allowed)
DECLARE @EXP_MSG_MAX INT = (SELECT ISNULL(
    COLUMNPROPERTY(OBJECT_ID('FIN.KAS_SO_EXPORT_LOADS'), 'RS_MESSAGE_TEXT', 'charmaxlen'), -1));
IF @EXP_MSG_MAX < 1 SET @EXP_MSG_MAX = 4000;

IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;
IF OBJECT_ID('tempdb..#RE') IS NOT NULL DROP TABLE #RE;

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
           PM.UNIT_SALES               AS PM_UNIT_SALES,
           PM.UNIT_PRICE               AS PM_UNIT_PRICE,
           PM.IC_PRODUCT_UOM_CONTROL,
           PM.IC_PACKAGED_PRODUCT,
           PM.IC_UNIT_CAPACITY,
           CASE
             WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S'  AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'SINGLE_NON_PACKAGED'
             WHEN PM.IC_PRODUCT_UOM_CONTROL = 'S'  AND PM.IC_PACKAGED_PRODUCT = 'Y' THEN 'SINGLE_PACKAGED'
             WHEN PM.IC_PRODUCT_UOM_CONTROL = 'P' AND PM.IC_PACKAGED_PRODUCT = 'N' THEN 'POTENT_NON_PACKAGED'
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
        X.R8a_msg, X.R8b_msg, X.R8c_msg, X.R8d_msg, X.R8e_msg,
        X.R9a_msg, X.R9b_msg, X.R9c_msg,
        X.R10_msg,
        X.R11_msg,
        X.R12_msg,
        X.R14a_msg, X.R14b_msg, X.R14c_msg, X.R14d_msg, X.R14e_msg, X.R14f_msg, X.R14g_msg, X.R14h_msg, X.R14i_msg, X.R14j_msg
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
    CASE WHEN CONCAT(X.R14a_msg, X.R14b_msg, X.R14c_msg, X.R14d_msg, X.R14e_msg, X.R14f_msg, X.R14g_msg, X.R14h_msg, X.R14i_msg, X.R14j_msg) <> '' THEN 1 ELSE 0 END AS F14,
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
-- Potent non-packaged only: formula conversion rows that start at the sales unit
OUTER APPLY (
    SELECT COUNT(*) AS N_FORMULA
    FROM FIN.PART_UOM_CONVERSIONS PF
    WHERE K.SCENARIO       = 'POTENT_NON_PACKAGED'
      AND PF.COMPANY_CODE  = K.COMPANY_CODE
      AND PF.PART_CODE     = K.PART_CODE
      AND PF.UNIT_FROM     = K.PM_UNIT_SALES
      AND PF.SYS_FORMULA_CODE <> ''
) PF
-- Potency quantity exactly as the loader derives it (no lot on a sales order -> product defaults):
--   SLBS = QUANTITY * IC_DEF_CHAR_NUMERIC(lot characteristic) / IC_DEF_CHAR_NUMERIC(product characteristic)
OUTER APPLY (
    SELECT COUNT(DISTINCT CONCAT(Z.ACT_UOM, '|', Z.ACT_QTY)) AS N_MATCH,
           MIN(Z.ACT_UOM) AS ACT_UOM,
           MIN(Z.ACT_QTY) AS ACT_QTY
    FROM (SELECT PUC.UNIT_TO AS ACT_UOM,
                 TRY_CAST(K.QUANTITY AS DECIMAL(28,10)) * PCL.IC_DEF_CHAR_NUMERIC
                         / NULLIF(PC.IC_DEF_CHAR_NUMERIC, 0) AS ACT_QTY
          FROM FIN.PART_UOM_CONVERSIONS PUC
          JOIN FIN.SYS_FORMULA_DEFINITIONS FD_LOT
               ON FD_LOT.SYS_FORMULA_CODE = PUC.SYS_FORMULA_CODE AND FD_LOT.SYS_DEFINITION_TYPE = 'L'
          JOIN FIN.SYS_FORMULA_DEFINITIONS FD_PROD
               ON FD_PROD.SYS_FORMULA_CODE = PUC.SYS_FORMULA_CODE AND FD_PROD.SYS_DEFINITION_TYPE = 'P'
          JOIN FIN.IC_PRODUCT_CHARACTERISTICS PCL
               ON PCL.COMPANY_CODE = K.COMPANY_CODE AND PCL.PART_CODE = K.PART_CODE
              AND PCL.CHARACTERISTIC_CODE = FD_LOT.CHARACTERISTIC_CODE
          JOIN FIN.IC_PRODUCT_CHARACTERISTICS PC
               ON PC.COMPANY_CODE = K.COMPANY_CODE AND PC.PART_CODE = K.PART_CODE
              AND PC.CHARACTERISTIC_CODE = FD_PROD.CHARACTERISTIC_CODE
          WHERE K.SCENARIO       = 'POTENT_NON_PACKAGED'
            AND PUC.COMPANY_CODE = K.COMPANY_CODE
            AND PUC.PART_CODE    = K.PART_CODE
            AND PUC.UNIT_FROM    = K.PM_UNIT_SALES
            AND PUC.SYS_FORMULA_CODE <> '') Z
) PT
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

    -- ---- RULE 6: PRODUCT_WAREHOUSE (same logic as the KAS_DC_LOADS validation)
    -- Applies to every part, no WAREHOUSED_FLAG gate. Checked with EXISTS so the
    -- PRODUCT_WAREHOUSE table can never multiply staging rows.
    -- 6a: a PRODUCT_WAREHOUSE record must exist for company / warehouse / part
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PART_CODE)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.WAREHOUSE)), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM FIN.PRODUCT_WAREHOUSE PW
                          WHERE PW.COMPANY_CODE = K.COMPANY_CODE
                            AND PW.WAREHOUSE    = K.WAREHOUSE
                            AND PW.PART_CODE    = K.PART_CODE)
         THEN CONCAT('; Part ', K.PART_CODE, ' has no PRODUCT_WAREHOUSE record for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R6a_msg,
    -- 6b: the record exists but none is active
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PART_CODE)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.WAREHOUSE)), '') IS NOT NULL
          AND EXISTS (SELECT 1 FROM FIN.PRODUCT_WAREHOUSE PW
                      WHERE PW.COMPANY_CODE = K.COMPANY_CODE
                        AND PW.WAREHOUSE    = K.WAREHOUSE
                        AND PW.PART_CODE    = K.PART_CODE)
          AND NOT EXISTS (SELECT 1 FROM FIN.PRODUCT_WAREHOUSE PW
                          WHERE PW.COMPANY_CODE = K.COMPANY_CODE
                            AND PW.WAREHOUSE    = K.WAREHOUSE
                            AND PW.PART_CODE    = K.PART_CODE
                            AND ISNULL(PW.ACTIVATION_STATUS, '') = @ACTIVE)
         THEN CONCAT('; PRODUCT_WAREHOUSE for part ', K.PART_CODE,
                     ' is not active for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R6b_msg,
    -- 6c: record is active but sales orders are not allowed for it
    CASE WHEN NULLIF(LTRIM(RTRIM(K.PART_CODE)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.WAREHOUSE)), '') IS NOT NULL
          AND EXISTS (SELECT 1 FROM FIN.PRODUCT_WAREHOUSE PW
                      WHERE PW.COMPANY_CODE = K.COMPANY_CODE
                        AND PW.WAREHOUSE    = K.WAREHOUSE
                        AND PW.PART_CODE    = K.PART_CODE
                        AND ISNULL(PW.ACTIVATION_STATUS, '') = @ACTIVE)
          AND NOT EXISTS (SELECT 1 FROM FIN.PRODUCT_WAREHOUSE PW
                          WHERE PW.COMPANY_CODE = K.COMPANY_CODE
                            AND PW.WAREHOUSE    = K.WAREHOUSE
                            AND PW.PART_CODE    = K.PART_CODE
                            AND ISNULL(PW.ACTIVATION_STATUS, '') = @ACTIVE
                            AND ISNULL(PW.SALES_ORDERS_FLAG, '') = 'Y')
         THEN CONCAT('; Sales orders are not allowed for part ', K.PART_CODE,
                     ' in warehouse ', K.WAREHOUSE)
         ELSE '' END AS R6c_msg,

    -- ---- RULE 7: supported scenario / no mixed scenarios in an order group
    CASE WHEN K.PM_PART_CODE IS NOT NULL AND K.SCENARIO = 'UNSUPPORTED'
         THEN CONCAT('; Unsupported product scenario (IC_PRODUCT_UOM_CONTROL=',
                     ISNULL(K.IC_PRODUCT_UOM_CONTROL, ''), ', IC_PACKAGED_PRODUCT=',
                     ISNULL(K.IC_PACKAGED_PRODUCT, ''), ')')
         ELSE '' END AS R7a_msg,
    '' AS R7b_msg,   -- mixed scenarios in one order are allowed: LOAD_SO_COMPLETE.sql loads each line by its own category

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
    CASE WHEN K.QUANTITY  IS NOT NULL AND K.QUANTITY  <= 0
         THEN '; QUANTITY  must be greater than zero' ELSE '' END AS R9a_msg,
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
         ELSE '' END AS R12_msg,

    -- ---- RULE 14: potent non-packaged items - the potency quantity (e.g. LBS -> SLBS) must be derivable
    -- 14a: no formula-driven conversion starts at the sales unit
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND NULLIF(LTRIM(RTRIM(K.PM_UNIT_SALES)), '') IS NOT NULL
          AND ISNULL(PF.N_FORMULA, 0) = 0
         THEN CONCAT('; Potent part ', K.PART_CODE, ': no formula-driven UOM conversion from sales unit ',
                     K.PM_UNIT_SALES, ' in PART_UOM_CONVERSIONS (needed for the potency quantity)')
         ELSE '' END AS R14a_msg,
    -- 14b: conversion row exists but its formula characteristics cannot be resolved
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND ISNULL(PF.N_FORMULA, 0) > 0
          AND ISNULL(PT.N_MATCH, 0) = 0
         THEN CONCAT('; Potent part ', K.PART_CODE, ': the potency formula for sales unit ', K.PM_UNIT_SALES,
                     ' cannot be resolved (SYS_FORMULA_DEFINITIONS lot/product characteristic or IC_PRODUCT_CHARACTERISTICS row missing)')
         ELSE '' END AS R14b_msg,
    -- 14c: more than one different result: target unit / quantity would be ambiguous
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND ISNULL(PT.N_MATCH, 0) > 1
         THEN CONCAT('; Potent part ', K.PART_CODE, ': more than one different formula-driven UOM conversion matches sales unit ',
                     K.PM_UNIT_SALES, '; the potency unit and quantity are ambiguous')
         ELSE '' END AS R14c_msg,
    -- 14d: result cannot be calculated or is not positive (missing default value, zero standard value)
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND ISNULL(PT.N_MATCH, 0) = 1
          AND TRY_CAST(K.QUANTITY AS DECIMAL(28,10)) IS NOT NULL
          AND (PT.ACT_QTY IS NULL OR PT.ACT_QTY <= 0)
         THEN CONCAT('; Potent part ', K.PART_CODE, ': potency quantity cannot be calculated or is not positive',
                     ' (default value of a formula characteristic is missing, or the standard (product) value is zero)')
         ELSE '' END AS R14d_msg,
    -- 14e: potency unit blank or identical to the sales unit (the order would get two rows for one unit)
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND ISNULL(PT.N_MATCH, 0) = 1
          AND (NULLIF(LTRIM(RTRIM(PT.ACT_UOM)), '') IS NULL
               OR LTRIM(RTRIM(PT.ACT_UOM)) = LTRIM(RTRIM(K.PM_UNIT_SALES)))
         THEN CONCAT('; Potent part ', K.PART_CODE, ': potency unit is blank or equals the sales unit ', K.PM_UNIT_SALES)
         ELSE '' END AS R14e_msg,
    -- 14f: potency unit does not exist
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND ISNULL(PT.N_MATCH, 0) = 1
          AND NULLIF(LTRIM(RTRIM(PT.ACT_UOM)), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM FIN.UNITS_OF_MEASURE U
                          WHERE LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(PT.ACT_UOM)))
         THEN CONCAT('; Potency unit ', PT.ACT_UOM, ' of part ', K.PART_CODE, ' is not in UNITS_OF_MEASURE')
         ELSE '' END AS R14f_msg,
    -- 14g: sales unit must be defined for the part in IC_PRODUCT_MASTER_UNITS
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND NULLIF(LTRIM(RTRIM(K.PM_UNIT_SALES)), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                          WHERE U.COMPANY_CODE = K.COMPANY_CODE AND U.PART_CODE = K.PART_CODE
                            AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(K.PM_UNIT_SALES)))
         THEN CONCAT('; Sales unit ', K.PM_UNIT_SALES, ' is not defined for part ', K.PART_CODE, ' in IC_PRODUCT_MASTER_UNITS')
         ELSE '' END AS R14g_msg,
    -- 14h: the unit the formula converts into must be defined for the part in IC_PRODUCT_MASTER_UNITS
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND ISNULL(PT.N_MATCH, 0) = 1
          AND NULLIF(LTRIM(RTRIM(PT.ACT_UOM)), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM FIN.IC_PRODUCT_MASTER_UNITS U
                          WHERE U.COMPANY_CODE = K.COMPANY_CODE AND U.PART_CODE = K.PART_CODE
                            AND LTRIM(RTRIM(U.UNIT_OF_MEASURE)) = LTRIM(RTRIM(PT.ACT_UOM)))
         THEN CONCAT('; Potency unit ', PT.ACT_UOM, ' (from the UOM conversion formula) is not defined for part ',
                     K.PART_CODE, ' in IC_PRODUCT_MASTER_UNITS')
         ELSE '' END AS R14h_msg,
    -- 14i: staging unit required for potent items
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND NULLIF(LTRIM(RTRIM(K.UNIT_SALES)), '') IS NULL
         THEN CONCAT('; UNIT_SALES is required for potent part ', K.PART_CODE,
                     ' (must equal PRODUCT_MASTER.UNIT_SALES ', ISNULL(K.PM_UNIT_SALES, ''), ')')
         ELSE '' END AS R14i_msg,
    -- 14j: staging unit must equal the product's sales unit
    CASE WHEN K.SCENARIO = 'POTENT_NON_PACKAGED'
          AND NULLIF(LTRIM(RTRIM(K.UNIT_SALES)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(K.PM_UNIT_SALES)), '') IS NOT NULL
          AND LTRIM(RTRIM(K.UNIT_SALES)) <> LTRIM(RTRIM(K.PM_UNIT_SALES))
         THEN CONCAT('; Staging UNIT_SALES ', K.UNIT_SALES, ' does not match PRODUCT_MASTER.UNIT_SALES ',
                     K.PM_UNIT_SALES, ' of part ', K.PART_CODE)
         ELSE '' END AS R14j_msg
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

-- ============================================================================
-- EXPORT VALIDATION: FIN.KAS_SO_EXPORT_LOADS
--   (loaded by section 7 of LOAD_SO_COMPLETE.sql into SOP_ORDER_HEADER_EXP_DETAILS and
--    SALES_ORDER_EXPORT_NOTES; ALL checks live here, the loader only inserts)
--
--   Run this AFTER the sales orders are loaded: the export rows attach to existing orders.
--   Same result convention as KAS_SO_LOADS: STATUS_FLAG 'E' + reason, or 'V' + 'Validated'.
--
--   E1  required: COMPANY_CODE, DIVISION, ORDER_NUMBER
--   E2  the order exists on SALES_ORDER_HEADERS and its delivery address exists on
--       CUSTOMER_ADDRESSES (source of the export defaults)
--   E3  ONE details record per order (SOP_ORDER_HEADER_EXP_DETAILS is one-to-one with the order):
--         - the order must not already have export details
--         - every staging row of the same order must carry the same detail values
--   E4  detail codes exist: transport term, mode of transport, exit / destination port (+ port type),
--       container type / size, shipping line, signatory; container count not negative
--   E5  dates: laycan to not before laycan from; sail / rail / cut-off / laycan not after the order
--       delivery date (switch @EXP_ENFORCE_DATES)
--   E6  notes (an order may have MANY notes, key = order + note type + note code):
--         - type and code both given when any note field is given
--         - type exists in SYS_EXPORT_NOTE_TYPES, code in SYS_EXPORT_NOTE_CODES
--         - type and code are DEFINED FOR THE CUSTOMER in CUSTOMER_ADDRESS_EXP_NOTES
--           (delivery address of the order, or any address - switch @EXP_NOTE_MATCH_ADDRESS)
--         - the same type + code must not appear twice for one order in the staging rows
--   E7  an order's export data is only loaded whole: if any row of an order fails,
--       every row of that order is marked as an error
-- ============================================================================
;WITH EB AS (
    SELECT E.*,
           LTRIM(RTRIM(ISNULL(E.COMPANY_CODE, '')))          AS CO,
           LTRIM(RTRIM(ISNULL(E.DIVISION, '')))              AS DV,
           LTRIM(RTRIM(ISNULL(E.ORDER_NUMBER, '')))          AS ORD,
           LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_NOTE_TYPE, '')))  AS NT,
           LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_NOTE_CODE, '')))  AS NC,
           LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_NOTES, '')))      AS NX,
           H.ORDER_NUMBER                  AS H_ORD,
           H.CUSTOMER_NUMBER               AS H_CUST,
           H.DELIVERY_ADDRESS_CODE         AS H_ADDR,
           CAST(H.SYS_DELIVERY_DATE AS DATE) AS H_DELIV,
           CA.ADDRESS_CODE                 AS CA_ADDR,
           -- fingerprint of the detail values: rows of one order must all carry the same values
           HASHBYTES('SHA2_256', CONCAT(
               LTRIM(RTRIM(ISNULL(E.SYS_TRANS_TERM_CODE, ''))), '|', ISNULL(CONVERT(VARCHAR(30), E.SYS_NBR_OF_CONTAINERS), ''), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_CONTAINER_TYPE, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_CONTAINER_SIZE, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_MOT_CODE, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_INCOTERM_CODE, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_INCOTERM_CITY, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_SIGNATORY_NAME, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_LC_NUMBER, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_CARRIER_ADVICE_NUMBER, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_INSPECTION_NUMBER, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_SHIPPING_LINE, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_INSUR_CERT_NUMBER, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_CUSTOMS_REF_STATUS, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_EXIT_PORT, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_DEST_PORT, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_ADDL_INFO_1, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_EXPORT_ADDL_INFO_2, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_FRT_FORWARDER_NBR, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_BOOKING_NUMBER, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_VESSEL_NAME, ''))), '|', LTRIM(RTRIM(ISNULL(E.SYS_VOYAGE_NUMBER, ''))), '|',
               LTRIM(RTRIM(ISNULL(E.SYS_CONTAINER_NUMBER, ''))), '|',
               ISNULL(CONVERT(VARCHAR(23), E.SYS_SAIL_DATE, 121), ''), '|', ISNULL(CONVERT(VARCHAR(23), E.SYS_RAIL_DATE, 121), ''), '|',
               ISNULL(CONVERT(VARCHAR(23), E.SYS_CUT_OFF_DATE, 121), ''), '|',
               ISNULL(CONVERT(VARCHAR(23), E.SYS_LAYCAN_FROM_DATE, 121), ''), '|',
               ISNULL(CONVERT(VARCHAR(23), E.SYS_LAYCAN_TO_DATE, 121), ''))) AS FP
    FROM FIN.KAS_SO_EXPORT_LOADS E
    LEFT JOIN FIN.SALES_ORDER_HEADERS H
      ON H.COMPANY_CODE = LTRIM(RTRIM(E.COMPANY_CODE))
     AND H.DIVISION     = LTRIM(RTRIM(E.DIVISION))
     AND H.ORDER_NUMBER = LTRIM(RTRIM(E.ORDER_NUMBER))
    LEFT JOIN FIN.CUSTOMER_ADDRESSES CA
      ON CA.COMPANY_CODE    = H.COMPANY_CODE
     AND CA.DIVISION        = H.DIVISION
     AND CA.CUSTOMER_NUMBER = H.CUSTOMER_NUMBER
     AND CA.ADDRESS_CODE    = H.DELIVERY_ADDRESS_CODE
    WHERE ISNULL(E.STATUS_FLAG, 'N') <> 'P'          -- processed rows are never re-validated
),
EB2 AS (
    SELECT B.*,
           CONCAT(B.CO, '|', B.DV, '|', B.ORD)                      AS ORDER_KEY,
           MIN(B.FP) OVER (PARTITION BY B.CO, B.DV, B.ORD)          AS FP_MIN,
           MAX(B.FP) OVER (PARTITION BY B.CO, B.DV, B.ORD)          AS FP_MAX,
           COUNT(*)  OVER (PARTITION BY B.CO, B.DV, B.ORD, B.NT, B.NC) AS NOTE_DUP
    FROM EB B
)
SELECT
    K.ID,
    K.ORDER_KEY,
    NULLIF(STUFF(CONCAT(
        X.E1a, X.E1b, X.E1c,
        X.E2a, X.E2b,
        X.E3a, X.E3b,
        X.E4a, X.E4b, X.E4c, X.E4d, X.E4e, X.E4f, X.E4g, X.E4h, X.E4i,
        X.E5a, X.E5b, X.E5c, X.E5d, X.E5e, X.E5f,
        X.E6a, X.E6b, X.E6c, X.E6d, X.E6e, X.E6f, X.E6g
    ), 1, 2, ''), '') AS MSG,
    CASE WHEN CONCAT(X.E1a, X.E1b, X.E1c) <> '' THEN 1 ELSE 0 END AS EF1,
    CASE WHEN CONCAT(X.E2a, X.E2b) <> '' THEN 1 ELSE 0 END AS EF2,
    CASE WHEN CONCAT(X.E3a, X.E3b) <> '' THEN 1 ELSE 0 END AS EF3,
    CASE WHEN CONCAT(X.E4a, X.E4b, X.E4c, X.E4d, X.E4e, X.E4f, X.E4g, X.E4h, X.E4i) <> '' THEN 1 ELSE 0 END AS EF4,
    CASE WHEN CONCAT(X.E5a, X.E5b, X.E5c, X.E5d, X.E5e, X.E5f) <> '' THEN 1 ELSE 0 END AS EF5,
    CASE WHEN CONCAT(X.E6a, X.E6b, X.E6c, X.E6d, X.E6e, X.E6f, X.E6g) <> '' THEN 1 ELSE 0 END AS EF6,
    CAST(0 AS INT) AS EF7
INTO #RE
FROM EB2 K
CROSS APPLY (SELECT
    LTRIM(RTRIM(ISNULL(K.SYS_TRANS_TERM_CODE, '')))  AS TT,
    LTRIM(RTRIM(ISNULL(K.SYS_MOT_CODE, '')))         AS MOT,
    LTRIM(RTRIM(ISNULL(K.SYS_EXPORT_EXIT_PORT, ''))) AS XP,
    LTRIM(RTRIM(ISNULL(K.SYS_EXPORT_DEST_PORT, ''))) AS DP,
    LTRIM(RTRIM(ISNULL(K.SYS_CONTAINER_TYPE, '')))   AS CT,
    LTRIM(RTRIM(ISNULL(K.SYS_CONTAINER_SIZE, '')))   AS CS,
    LTRIM(RTRIM(ISNULL(K.SYS_SHIPPING_LINE, '')))    AS SL,
    LTRIM(RTRIM(ISNULL(K.SYS_SIGNATORY_NAME, '')))   AS SG
) V
CROSS APPLY (SELECT
    -- ---- E1: required
    CASE WHEN K.CO  = '' THEN '; COMPANY_CODE is required' ELSE '' END AS E1a,
    CASE WHEN K.DV  = '' THEN '; DIVISION is required' ELSE '' END AS E1b,
    CASE WHEN K.ORD = '' THEN '; ORDER_NUMBER is required' ELSE '' END AS E1c,

    -- ---- E2: order and its delivery address exist
    CASE WHEN K.CO <> '' AND K.DV <> '' AND K.ORD <> '' AND K.H_ORD IS NULL
         THEN CONCAT('; Sales order ', K.ORD, ' does not exist in SALES_ORDER_HEADERS for company ', K.CO,
                     ' / division ', K.DV, ' (load the order first)')
         ELSE '' END AS E2a,
    CASE WHEN K.H_ORD IS NOT NULL AND K.CA_ADDR IS NULL
         THEN CONCAT('; Delivery address ', K.H_ADDR, ' of order ', K.ORD,
                     ' does not exist in CUSTOMER_ADDRESSES (needed for the export defaults)')
         ELSE '' END AS E2b,

    -- ---- E3: one details record per order
    CASE WHEN K.H_ORD IS NOT NULL
          AND EXISTS (SELECT 1 FROM FIN.SOP_ORDER_HEADER_EXP_DETAILS D
                      WHERE D.COMPANY_CODE = K.CO AND D.DIVISION = K.DV AND D.ORDER_NUMBER = K.ORD)
         THEN CONCAT('; Order ', K.ORD, ' already has export details in SOP_ORDER_HEADER_EXP_DETAILS (one record per order)')
         ELSE '' END AS E3a,
    CASE WHEN K.ORD <> '' AND K.FP_MIN <> K.FP_MAX
         THEN CONCAT('; Rows of order ', K.ORD, ' carry different export detail values (one details record per order: repeat identical values on every row)')
         ELSE '' END AS E3b,

    -- ---- E4: detail codes exist
    CASE WHEN V.TT <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_TRANSPORT_TERMS T WHERE T.SYS_TRANS_TERM_CODE = V.TT)
         THEN CONCAT('; Transport term ', V.TT, ' does not exist in SYS_TRANSPORT_TERMS') ELSE '' END AS E4a,
    CASE WHEN V.MOT <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_MOT_CODES T WHERE T.SYS_MOT_CODE = V.MOT)
         THEN CONCAT('; Mode of transport ', V.MOT, ' does not exist in SYS_MOT_CODES') ELSE '' END AS E4b,
    CASE WHEN V.XP <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_EXPORT_PORTS T
                                         WHERE T.SYS_EXPORT_PORT = V.XP AND T.SYS_PORT_TYPE <> @EXP_DEST_TYPE)
         THEN CONCAT('; Exit port ', V.XP, ' does not exist in SYS_EXPORT_PORTS (or is a destination port)') ELSE '' END AS E4c,
    CASE WHEN V.DP <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_EXPORT_PORTS T
                                         WHERE T.SYS_EXPORT_PORT = V.DP AND T.SYS_PORT_TYPE <> @EXP_EXIT_TYPE)
         THEN CONCAT('; Destination port ', V.DP, ' does not exist in SYS_EXPORT_PORTS (or is an exit port)') ELSE '' END AS E4d,
    CASE WHEN V.CT <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_CONTAINER_TYPES T WHERE T.SYS_CONTAINER_TYPE = V.CT)
         THEN CONCAT('; Container type ', V.CT, ' does not exist in SYS_CONTAINER_TYPES') ELSE '' END AS E4e,
    CASE WHEN V.CS <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_CONTAINER_SIZES T WHERE T.SYS_CONTAINER_SIZE = V.CS)
         THEN CONCAT('; Container size ', V.CS, ' does not exist in SYS_CONTAINER_SIZES') ELSE '' END AS E4f,
    CASE WHEN V.SL <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_SHIPPING_LINES T WHERE T.SYS_SHIPPING_LINE = V.SL)
         THEN CONCAT('; Shipping line ', V.SL, ' does not exist in SYS_SHIPPING_LINES') ELSE '' END AS E4g,
    CASE WHEN V.SG <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_SIGNATORIES T
                                         WHERE T.SYS_SIGNATORY_NAME = V.SG AND T.SYS_SIGNATORY_TYPE <> @EXP_DECLARANT)
         THEN CONCAT('; Signatory ', V.SG, ' does not exist in SYS_SIGNATORIES (or is a declarant)') ELSE '' END AS E4h,
    CASE WHEN K.SYS_NBR_OF_CONTAINERS < 0
         THEN '; SYS_NBR_OF_CONTAINERS cannot be negative' ELSE '' END AS E4i,

    -- ---- E5: dates
    CASE WHEN K.SYS_LAYCAN_FROM_DATE IS NOT NULL AND K.SYS_LAYCAN_TO_DATE IS NOT NULL
          AND K.SYS_LAYCAN_TO_DATE < K.SYS_LAYCAN_FROM_DATE
         THEN '; SYS_LAYCAN_TO_DATE is earlier than SYS_LAYCAN_FROM_DATE' ELSE '' END AS E5a,
    CASE WHEN @EXP_ENFORCE_DATES = 1 AND K.H_DELIV IS NOT NULL AND CAST(K.SYS_SAIL_DATE AS DATE) > K.H_DELIV
         THEN '; SYS_SAIL_DATE is later than the order delivery date' ELSE '' END AS E5b,
    CASE WHEN @EXP_ENFORCE_DATES = 1 AND K.H_DELIV IS NOT NULL AND CAST(K.SYS_RAIL_DATE AS DATE) > K.H_DELIV
         THEN '; SYS_RAIL_DATE is later than the order delivery date' ELSE '' END AS E5c,
    CASE WHEN @EXP_ENFORCE_DATES = 1 AND K.H_DELIV IS NOT NULL AND CAST(K.SYS_CUT_OFF_DATE AS DATE) > K.H_DELIV
         THEN '; SYS_CUT_OFF_DATE is later than the order delivery date' ELSE '' END AS E5d,
    CASE WHEN @EXP_ENFORCE_DATES = 1 AND K.H_DELIV IS NOT NULL AND CAST(K.SYS_LAYCAN_FROM_DATE AS DATE) > K.H_DELIV
         THEN '; SYS_LAYCAN_FROM_DATE is later than the order delivery date' ELSE '' END AS E5e,
    CASE WHEN @EXP_ENFORCE_DATES = 1 AND K.H_DELIV IS NOT NULL AND CAST(K.SYS_LAYCAN_TO_DATE AS DATE) > K.H_DELIV
         THEN '; SYS_LAYCAN_TO_DATE is later than the order delivery date' ELSE '' END AS E5f,

    -- ---- E6: export notes (many per order)
    CASE WHEN (K.NT <> '' OR K.NC <> '' OR K.NX <> '') AND K.NT = ''
         THEN '; SYS_EXPORT_NOTE_TYPE is required when a note is given' ELSE '' END AS E6a,
    CASE WHEN (K.NT <> '' OR K.NC <> '' OR K.NX <> '') AND K.NC = ''
         THEN '; SYS_EXPORT_NOTE_CODE is required when a note is given' ELSE '' END AS E6b,
    CASE WHEN K.NT <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_EXPORT_NOTE_TYPES T WHERE T.SYS_EXPORT_NOTE_TYPE = K.NT)
         THEN CONCAT('; Export note type ', K.NT, ' does not exist in SYS_EXPORT_NOTE_TYPES') ELSE '' END AS E6c,
    CASE WHEN K.NC <> '' AND NOT EXISTS (SELECT 1 FROM FIN.SYS_EXPORT_NOTE_CODES T WHERE T.SYS_EXPORT_NOTE_CODE = K.NC)
         THEN CONCAT('; Export note code ', K.NC, ' does not exist in SYS_EXPORT_NOTE_CODES') ELSE '' END AS E6d,
    -- type not defined for the customer (address)
    CASE WHEN K.H_ORD IS NOT NULL AND K.NT <> ''
          AND NOT EXISTS (SELECT 1 FROM FIN.CUSTOMER_ADDRESS_EXP_NOTES N
                          WHERE N.COMPANY_CODE = K.CO AND N.DIVISION = K.DV AND N.CUSTOMER_NUMBER = K.H_CUST
                            AND (@EXP_NOTE_MATCH_ADDRESS = 0 OR N.ADDRESS_CODE = K.H_ADDR)
                            AND N.SYS_EXPORT_NOTE_TYPE = K.NT)
         THEN CONCAT('; Export note type ', K.NT, ' is not defined for customer ', K.H_CUST,
                     CASE WHEN @EXP_NOTE_MATCH_ADDRESS = 1 THEN CONCAT(' / delivery address ', K.H_ADDR) ELSE '' END,
                     ' in CUSTOMER_ADDRESS_EXP_NOTES')
         ELSE '' END AS E6e,
    -- type defined, but not with this code
    CASE WHEN K.H_ORD IS NOT NULL AND K.NT <> '' AND K.NC <> ''
          AND EXISTS (SELECT 1 FROM FIN.CUSTOMER_ADDRESS_EXP_NOTES N
                      WHERE N.COMPANY_CODE = K.CO AND N.DIVISION = K.DV AND N.CUSTOMER_NUMBER = K.H_CUST
                        AND (@EXP_NOTE_MATCH_ADDRESS = 0 OR N.ADDRESS_CODE = K.H_ADDR)
                        AND N.SYS_EXPORT_NOTE_TYPE = K.NT)
          AND NOT EXISTS (SELECT 1 FROM FIN.CUSTOMER_ADDRESS_EXP_NOTES N
                          WHERE N.COMPANY_CODE = K.CO AND N.DIVISION = K.DV AND N.CUSTOMER_NUMBER = K.H_CUST
                            AND (@EXP_NOTE_MATCH_ADDRESS = 0 OR N.ADDRESS_CODE = K.H_ADDR)
                            AND N.SYS_EXPORT_NOTE_TYPE = K.NT AND N.SYS_EXPORT_NOTE_CODE = K.NC)
         THEN CONCAT('; Export note code ', K.NC, ' (type ', K.NT, ') is not defined for customer ', K.H_CUST,
                     CASE WHEN @EXP_NOTE_MATCH_ADDRESS = 1 THEN CONCAT(' / delivery address ', K.H_ADDR) ELSE '' END,
                     ' in CUSTOMER_ADDRESS_EXP_NOTES')
         ELSE '' END AS E6f,
    CASE WHEN K.NT <> '' AND K.NC <> '' AND K.NOTE_DUP > 1
         THEN CONCAT('; Note type ', K.NT, ' / code ', K.NC, ' appears more than once for order ', K.ORD)
         ELSE '' END AS E6g
) X;

CREATE UNIQUE CLUSTERED INDEX IX_RE_KEY ON #RE (ID);

-- E7: an order's export data is only loaded whole
UPDATE R
SET MSG = 'Another row of this order failed export validation; the order''s export data loads only as a whole',
    EF7 = 1
FROM #RE R
WHERE R.MSG IS NULL
  AND EXISTS (SELECT 1 FROM #RE R2 WHERE R2.ORDER_KEY = R.ORDER_KEY AND R2.MSG IS NOT NULL);

UPDATE E
SET STATUS_FLAG     = CASE WHEN R.MSG IS NOT NULL THEN 'E' ELSE @CLEAN_FLAG END,
    RS_MESSAGE_TEXT = CASE WHEN R.MSG IS NOT NULL THEN LEFT(R.MSG, @EXP_MSG_MAX) ELSE 'Validated' END
FROM FIN.KAS_SO_EXPORT_LOADS E
JOIN #RE R ON R.ID = E.ID
WHERE ISNULL(E.STATUS_FLAG, 'N') <> 'P';

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
        ISNULL(SUM(F13), 0) AS r13, ISNULL(SUM(F14), 0) AS r14,
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
    (7,  'Rule 7 - Supported scenario (S/N, S/Y, P/N)',            C.r7),
    (8,  'Rule 8 - Sales and price UOM valid',                       C.r8),
    (9,  'Rule 9 - QUANTITY /price/freight valid',                    C.r9),
    (10, 'Rule 10 - Delivery date not before order date',            C.r10),
    (11, 'Rule 11 - Duplicate staging line',                         C.r11),
    (12, 'Rule 12 - Order group already processed',                  C.r12),
    (13, 'Rule 13 - Clean line in an order group with a failed line', C.r13),
    (14, 'Rule 14 - Potent items: potency (SLBS) quantity derivable', C.r14),
    (15, 'Total rows with errors',                                   C.total_err),
    (16, 'Total rows validated (passed)',   (SELECT COUNT(*) FROM FIN.KAS_SO_LOADS WHERE STATUS_FLAG = 'V')),
    (17, 'Total rows already processed',    (SELECT COUNT(*) FROM FIN.KAS_SO_LOADS WHERE STATUS_FLAG = 'P'))
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

-- ============================================================================
-- EXPORT SUMMARY: errors per rule (a row with several errors counts under each rule)
-- ============================================================================
SELECT V.Rule_Name, V.Error_Count
FROM (
    SELECT ISNULL(SUM(EF1), 0) AS e1, ISNULL(SUM(EF2), 0) AS e2, ISNULL(SUM(EF3), 0) AS e3,
           ISNULL(SUM(EF4), 0) AS e4, ISNULL(SUM(EF5), 0) AS e5, ISNULL(SUM(EF6), 0) AS e6,
           ISNULL(SUM(EF7), 0) AS e7,
           ISNULL(SUM(CASE WHEN MSG IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_err
    FROM #RE
) C
CROSS APPLY (VALUES
    (1,  'Export Rule E1 - Required fields',                             C.e1),
    (2,  'Export Rule E2 - Order and delivery address exist',            C.e2),
    (3,  'Export Rule E3 - One details record per order',                C.e3),
    (4,  'Export Rule E4 - Detail codes exist',                          C.e4),
    (5,  'Export Rule E5 - Dates',                                       C.e5),
    (6,  'Export Rule E6 - Notes (valid, defined for customer, no dups)', C.e6),
    (7,  'Export Rule E7 - Clean row in an order with a failed row',     C.e7),
    (8,  'Export - total rows with errors',                              C.total_err),
    (9,  'Export - total rows validated (passed)', (SELECT COUNT(*) FROM FIN.KAS_SO_EXPORT_LOADS WHERE STATUS_FLAG = 'V')),
    (10, 'Export - total rows already processed',  (SELECT COUNT(*) FROM FIN.KAS_SO_EXPORT_LOADS WHERE STATUS_FLAG = 'P'))
) V (Sort_Order, Rule_Name, Error_Count)
ORDER BY V.Sort_Order;

-- FAILED EXPORT ROWS for review
SELECT E.ID, E.COMPANY_CODE, E.DIVISION, E.ORDER_NUMBER,
       E.SYS_EXPORT_NOTE_TYPE, E.SYS_EXPORT_NOTE_CODE,
       E.STATUS_FLAG, E.RS_MESSAGE_TEXT
FROM FIN.KAS_SO_EXPORT_LOADS E
WHERE E.STATUS_FLAG = 'E'
ORDER BY E.COMPANY_CODE, E.DIVISION, E.ORDER_NUMBER, E.ID;
GO
