/****** Object:  Script [FIN].[SP_KAS_DC_LOADS_DRY_RUN] / Validation Script ******/
-- ============================================================================
-- VALIDATION: KAS_DC_LOADS (ALL product types)
-- All 8 rules in single pass, set-based, performant for millions of rows
-- Message concatenation with "; " separator, re-runnable, summary + failed rows
-- UOM Rule 7 now covers: Single/Packaged, Single/non-Packaged, Potent/non-packaged, Potent/Packaged
-- ============================================================================

SET NOCOUNT ON;

-- ---- Settings -----------------------------------------------------------
DECLARE @ACTIVE VARCHAR(10) = 'A';           -- ACTIVATION_STATUS = active
DECLARE @CLEAN_FLAG VARCHAR(10) = 'V';      
DECLARE @MSG_MAX INT = (SELECT ISNULL(
    COLUMNPROPERTY(OBJECT_ID('[FIN].[KAS_DC_LOADS]'), 'RS_MESSAGE_TEXT', 'charmaxlen'),
    COLUMNPROPERTY(OBJECT_ID('FIN.KAS_DC_LOADS'),    'RS_MESSAGE_TEXT', 'charmaxlen')));
-- Fallback to 150 (the actual column size) if schema resolution failed
IF @MSG_MAX IS NULL OR @MSG_MAX < 1 SET @MSG_MAX = 150;

-- ---- Pre-compute per-row validation rules (single CTE pass) ------------
-- We use LEFT JOINs with ISNULL to handle NULLs gracefully; each CASE appends
-- a "; " prefixed message only when the rule fails. Final STUFF removes the
-- leading "; " from the concatenated string.
WITH R AS (
    SELECT
        K.*,

        -- ---- RULE 0: IC_STATUS_CODE must be one of QOH, QC, QR (matches legacy DML validation)
        CASE WHEN ISNULL(K.IC_STATUS_CODE, '') NOT IN ('QOH', 'QC', 'QR')
            THEN '; IC_STATUS_CODE ' + ISNULL(K.IC_STATUS_CODE, '(blank)') + ' is not valid; must be QOH, QC, or QR'
            ELSE '' END AS R0_msg,

        -- ---- RULE 1: Warehouse must exist in WAREHOUSE_CONTROLS (scoped by COMPANY_CODE)
        CASE WHEN WC.WAREHOUSE IS NULL
            THEN '; Warehouse ' + ISNULL(K.WAREHOUSE, '') + ' does not exist in WAREHOUSE_CONTROLS'
            ELSE '' END AS R1_msg,

        -- ---- RULE 1b: Part must be active in PRODUCT_WAREHOUSE for this warehouse
        CASE WHEN PW.WAREHOUSE IS NOT NULL AND ISNULL(PW.ACTIVATION_STATUS, '') <> @ACTIVE
            THEN '; Warehouse ' + ISNULL(K.WAREHOUSE, '') + ' is not active in PRODUCT_WAREHOUSE for part ' + ISNULL(K.PART_CODE, '')
            ELSE '' END AS R1b_msg,

        -- ---- RULE 2: Part code must exist in PRODUCT_MASTER and be active (scoped by COMPANY_CODE)
        CASE WHEN PM.PART_CODE IS NULL
            THEN '; Part code ' + ISNULL(K.PART_CODE, '') + ' does not exist in PRODUCT_MASTER'
            ELSE '' END AS R2a_msg,

        CASE WHEN PM.PART_CODE IS NOT NULL AND ISNULL(PM.ACTIVATION_STATUS, '') <> @ACTIVE
            THEN '; Part code ' + ISNULL(K.PART_CODE, '') + ' is not active in PRODUCT_MASTER'
            ELSE '' END AS R2b_msg,

        -- ---- RULE 3: Bin location checks
        -- 3a: Bin location must be populated if warehouse is binned (BIN_SIZING = Y)
        CASE WHEN WC.BIN_SIZING = 'Y'
            AND (K.BIN_LOCATION IS NULL OR LTRIM(RTRIM(K.BIN_LOCATION)) = '')
            THEN '; Bin location is blank but warehouse is binned (BIN_SIZING=Y)'
            ELSE '' END AS R3a_msg,

        -- 3b: Bin location must exist in BIN_LOCATIONS master table (keyed by WAREHOUSE + BIN_LOCATION)
        --     Only checked when warehouse is binned and a bin location was provided
        CASE WHEN WC.BIN_SIZING = 'Y'
            AND K.BIN_LOCATION IS NOT NULL
            AND LTRIM(RTRIM(K.BIN_LOCATION)) <> ''
            AND NOT EXISTS (
                SELECT 1 FROM BIN_LOCATIONS BL
                WHERE BL.WAREHOUSE    = K.WAREHOUSE
                  AND BL.BIN_LOCATION = K.BIN_LOCATION)
            THEN '; Bin location ' + K.BIN_LOCATION + ' does not exist in BIN_LOCATIONS for warehouse ' + ISNULL(K.WAREHOUSE, '')
            ELSE '' END AS R3b_msg,

        -- ---- RULE 4: Part must have a PRODUCT_WAREHOUSE record for the warehouse (scoped by COMPANY_CODE)
        CASE WHEN PW.WAREHOUSE IS NULL
            THEN '; Part ' + ISNULL(K.PART_CODE, '') + ' has no PRODUCT_WAREHOUSE record for warehouse ' + ISNULL(K.WAREHOUSE, '')
            ELSE '' END AS R4_msg,

        -- ---- RULE 5: Lot number mandatory if part is lotted (BATCHES_EXIST = Y)
        CASE WHEN PM.BATCHES_EXIST = 'Y'
            AND (K.IC_LOT_NUMBER IS NULL OR LTRIM(RTRIM(K.IC_LOT_NUMBER)) = '')
            THEN '; Lot number required: part ' + ISNULL(K.PART_CODE, '') + ' is lotted (BATCHES_EXIST = Y)'
            ELSE '' END AS R5_msg,

        -- ---- RULE 6: Batch expiry checks (only when lotted)
        -- 6a: If BATCH_EXPIRY = 'Y', batch date must be populated
        CASE WHEN PM.BATCHES_EXIST = 'Y' AND PM.BATCH_EXPIRY = 'Y'
            AND (K.BATCH_DATE IS NULL OR LTRIM(RTRIM(CONVERT(VARCHAR(50), K.BATCH_DATE))) = '')
            THEN '; Batch date required: part ' + ISNULL(K.PART_CODE, '') + ' has BATCH_EXPIRY = Y'
            ELSE '' END AS R6a_msg,

        -- 6b: If BATCH_EXPIRY = 'Y', batch date must be a valid date
        CASE WHEN PM.BATCHES_EXIST = 'Y' AND PM.BATCH_EXPIRY = 'Y'
            AND K.BATCH_DATE IS NOT NULL
            AND LTRIM(RTRIM(CONVERT(VARCHAR(50), K.BATCH_DATE))) <> ''
            AND TRY_CAST(K.BATCH_DATE AS DATE) IS NULL
            THEN '; Batch date ' + CONVERT(VARCHAR(10), K.BATCH_DATE, 121) + ' is not a valid date'
            ELSE '' END AS R6b_msg,

        -- ---- RULE 7: UOM_1 must match the appropriate UOM based on product type
        -- Matches legacy DML logic:
        --   - Non-packaged (IC_PACKAGED_PRODUCT = N): UOM_1 must equal IC_UNIT_CAPACITY from PRODUCT_MASTER
        --   - Packaged (IC_PACKAGED_PRODUCT = Y): UOM_1 must exist in IC_PRODUCT_STATUS for this company/wh/part
        CASE
            WHEN PM.IC_PACKAGED_PRODUCT = 'N'
                AND K.UOM_1 IS NOT NULL
                AND LTRIM(RTRIM(K.UOM_1)) <> LTRIM(RTRIM(ISNULL(PM.IC_UNIT_CAPACITY, '')))
                THEN '; UOM_1 ' + K.UOM_1 + ' does not match PRODUCT_MASTER.IC_UNIT_CAPACITY ' + ISNULL(PM.IC_UNIT_CAPACITY, '') + ' for part ' + ISNULL(K.PART_CODE, '')

            WHEN PM.IC_PACKAGED_PRODUCT = 'Y'
                AND K.UOM_1 IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM IC_PRODUCT_STATUS S
                    WHERE S.COMPANY_CODE = K.COMPANY_CODE
                      AND S.WAREHOUSE    = K.WAREHOUSE
                      AND S.PART_CODE    = K.PART_CODE
                      AND LTRIM(RTRIM(S.UNIT_OF_MEASURE)) = LTRIM(RTRIM(K.UOM_1))
                )
                THEN '; UOM_1 ' + K.UOM_1 + ' does not match IC_PRODUCT_STATUS unit of measure for packaged part ' + ISNULL(K.PART_CODE, '')

            ELSE '' END AS R7_msg,

        -- ---- RULE 8: Duplicate LPN (same DC_LICENSE_PLATE_ID + PART_CODE + IC_LOT_NUMBER in staging)
        --      Uses window function; flags ALL rows with a duplicate combination
        CASE WHEN COUNT(*) OVER (PARTITION BY K.DC_LICENSE_PLATE_ID, K.PART_CODE, K.IC_LOT_NUMBER) > 1
            THEN '; Duplicate LPN: ' + CAST(
                COUNT(*) OVER (PARTITION BY K.DC_LICENSE_PLATE_ID, K.PART_CODE, K.IC_LOT_NUMBER) AS VARCHAR)
                + ' rows share DC_LICENSE_PLATE_ID ' + ISNULL(K.DC_LICENSE_PLATE_ID, '')
                + ' / PART_CODE ' + ISNULL(K.PART_CODE, '')
                + ' / LOT ' + ISNULL(K.IC_LOT_NUMBER, '')
            ELSE '' END AS R8_msg

    FROM FIN.KAS_DC_LOADS K
    -- NOTE: COMPANY_CODE is NOT used in joins because KAS_DC_LOADS.COMPANY_CODE
    -- defaults to ' ' (space) — the real company code is a session/app-level concern.
    -- Warehouse and part lookups are scoped by their natural keys only.
    LEFT JOIN WAREHOUSE_CONTROLS WC ON WC.WAREHOUSE = K.WAREHOUSE
    LEFT JOIN PRODUCT_MASTER     PM ON PM.PART_CODE  = K.PART_CODE
    LEFT JOIN PRODUCT_WAREHOUSE  PW ON PW.WAREHOUSE  = K.WAREHOUSE
                                   AND PW.PART_CODE  = K.PART_CODE
),

M AS (
    -- Concatenate all rule messages; STUFF removes the leading "; ".
    SELECT
        STATUS_FLAG,
        RS_MESSAGE_TEXT,
        NULLIF(LTRIM(RTRIM(STUFF(
            R0_msg + R1_msg + R1b_msg + R2a_msg + R2b_msg
            + R3a_msg + R3b_msg + R4_msg + R5_msg
            + R6a_msg + R6b_msg + R7_msg + R8_msg
            , 1, 2, ''))), '') AS MSG   -- STUFF removes leading "; "; NULLIF turns empty string -> NULL
    FROM R
)

-- ============================================================================
-- FINAL UPDATE: Apply STATUS_FLAG and RS_MESSAGE_TEXT changes
-- Set STATUS_FLAG = 'E' on errors, or @CLEAN_FLAG ('V') on passing rows
-- Keep already loaded records ('L') untouched
-- ============================================================================
UPDATE M
SET STATUS_FLAG = CASE
                    WHEN MSG IS NOT NULL AND LEN(LTRIM(RTRIM(MSG))) > 0 THEN 'E'
                    ELSE @CLEAN_FLAG END,
    RS_MESSAGE_TEXT = CASE
                    WHEN MSG IS NOT NULL AND LEN(LTRIM(RTRIM(MSG))) > 0 THEN LEFT(MSG, @MSG_MAX)
                    ELSE 'Validated' END
WHERE ISNULL(STATUS_FLAG, ' ') <> 'L';

-- ============================================================================
-- SUMMARY: Errors per rule (a row with multiple errors counts under each rule)
-- ============================================================================
SELECT Rule_Name, Error_Count
FROM (
    SELECT
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%is not valid; must be QOH%' THEN 1 ELSE 0 END), 0) AS r0,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%does not exist in WAREHOUSE_CONTROLS%'
                       OR RS_MESSAGE_TEXT LIKE '%is not active in PRODUCT_WAREHOUSE%' THEN 1 ELSE 0 END), 0) AS r1,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%does not exist in PRODUCT_MASTER%'
                       OR RS_MESSAGE_TEXT LIKE '%is not active in PRODUCT_MASTER%' THEN 1 ELSE 0 END), 0) AS r2,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Bin location%' THEN 1 ELSE 0 END), 0) AS r3,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%has no PRODUCT_WAREHOUSE record%' THEN 1 ELSE 0 END), 0) AS r4,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Lot number required%' THEN 1 ELSE 0 END), 0) AS r5,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Batch date%' THEN 1 ELSE 0 END), 0) AS r6,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%UOM_1%' THEN 1 ELSE 0 END), 0) AS r7,
        ISNULL(
            SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Duplicate LPN%' THEN 1 ELSE 0 END), 0) AS r8,
        COUNT(*) AS total_err
    FROM FIN.KAS_DC_LOADS
    WHERE STATUS_FLAG = 'E'
) C
CROSS APPLY (VALUES
    (0,  'Rule 0 - IC_STATUS_CODE valid (QOH/QC/QR)',                              C.r0),
    (1,  'Rule 1 - Warehouse exists in WAREHOUSE_CONTROLS',                         C.r1),
    (2,  'Rule 2 - Part code exists and active in PRODUCT_MASTER',                  C.r2),
    (3,  'Rule 3 - Bin location exists in BIN_LOCATIONS',                           C.r3),
    (4,  'Rule 4 - PRODUCT_WAREHOUSE record exists for warehouse+part',             C.r4),
    (5,  'Rule 5 - Lot number required if BATCHES_EXIST=Y',                         C.r5),
    (6,  'Rule 6 - Batch date required if BATCHES_EXIST=Y + BATCH_EXPIRY=Y',        C.r6),
    (7,  'Rule 7 - UOM_1 matches IC_UNIT_CAPACITY or IC_PRODUCT_STATUS UOM',        C.r7),
    (8,  'Rule 8 - Duplicate LPN (DC_LICENSE_PLATE_ID + PART_CODE + IC_LOT_NUMBER)',C.r8),
    (9,  'Total rows with errors',                                                   C.total_err),
    (10, 'Total rows validated',    (SELECT COUNT(*) FROM FIN.KAS_DC_LOADS))
) V (Sort_Order, Rule_Name, Error_Count)
ORDER BY V.Sort_Order;

-- ============================================================================
-- FAILED ROWS for review
-- ============================================================================
SELECT 
    K.COMPANY_CODE,
    K.WAREHOUSE,
    K.PART_CODE,
    K.IC_LOT_NUMBER,
    K.BIN_LOCATION,
    K.BATCH_DATE,
    K.DC_LICENSE_PLATE_ID,
    K.UOM_1,
    K.IC_STATUS_CODE,
    K.STATUS_FLAG,
    K.RS_MESSAGE_TEXT
FROM FIN.KAS_DC_LOADS K
WHERE K.STATUS_FLAG = 'E'
ORDER BY K.WAREHOUSE, K.PART_CODE;
