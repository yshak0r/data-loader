-- ============================================================================
-- VALIDATION: KAS_DC_LOADS (ALL product types)
-- Set-based, re-runnable, keyed on GEM_DBKEY
-- Only rows that are NOT yet populated (STATUS_FLAG <> 'P', or NULL) are validated.
-- Rows already populated by the loader (STATUS_FLAG = 'P') are never read into the
-- checks and never updated, so this can be re-run safely after a partial/failed load.
-- ============================================================================
SET NOCOUNT ON;

DECLARE @ACTIVE     VARCHAR(10) = 'A';   -- ACTIVATION_STATUS = active
DECLARE @CLEAN_FLAG VARCHAR(10) = 'V';
DECLARE @POPULATED  VARCHAR(10) = 'P';   -- already loaded into inventory: skip these rows
DECLARE @MSG_MAX INT = (SELECT ISNULL(
    COLUMNPROPERTY(OBJECT_ID('KAS_DC_LOADS'), 'RS_MESSAGE_TEXT', 'charmaxlen'), -1));
IF @MSG_MAX < 1 SET @MSG_MAX = 4000;

IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;

-- ---- Compute all rule messages once, one row per KAS_DC_LOADS row ----------
-- Window functions are computed in the derived table K, over the NOT-populated rows only.
-- WC and PM are assumed unique per key; everything else uses EXISTS so
-- joins cannot multiply rows.
SELECT
    K.GEM_DBKEY,
    NULLIF(STUFF(CONCAT(
        X.R1_msg, X.R1b_msg, X.R1c_msg, X.R2a_msg, X.R2b_msg,
        X.R3a_msg, X.R3b_msg, X.R3c_msg, X.R3d_msg, X.R4_msg, X.R5_msg,
        X.R6a_msg, X.R6b_msg,X.R6c_msg, X.R6d_msg, X.R7_msg, X.R8_msg, X.R8b_msg,
        X.R9a_msg, X.R9b_msg, X.R9c_msg, X.R9d_msg
    ), 1, 2, ''), '') AS MSG
INTO #R
FROM (
    SELECT K0.*,
        COUNT(*) OVER (PARTITION BY K0.DC_LICENSE_PLATE_ID, K0.PART_CODE, K0.IC_LOT_NUMBER) AS DupCnt,
        MIN(K0.WAREHOUSE)    OVER (PARTITION BY K0.DC_LICENSE_PLATE_ID)                  AS WhMin,
        MAX(K0.WAREHOUSE)    OVER (PARTITION BY K0.DC_LICENSE_PLATE_ID)                  AS WhMax,
        MIN(K0.BIN_LOCATION) OVER (PARTITION BY K0.DC_LICENSE_PLATE_ID, K0.WAREHOUSE)    AS BinMin,
        MAX(K0.BIN_LOCATION) OVER (PARTITION BY K0.DC_LICENSE_PLATE_ID, K0.WAREHOUSE)    AS BinMax
    FROM KAS_DC_LOADS K0
    WHERE ISNULL(K0.STATUS_FLAG, '') <> @POPULATED      -- skip rows already populated
) K
LEFT JOIN WAREHOUSE_CONTROLS WC ON WC.WAREHOUSE = K.WAREHOUSE
LEFT JOIN PRODUCT_MASTER     PM ON PM.PART_CODE = K.PART_CODE
CROSS APPLY (SELECT
    -- ---- RULE 1: Warehouse exists / active for part / IC_STATUS_CODE
    CASE WHEN WC.WAREHOUSE IS NULL
         THEN CONCAT('; Warehouse ', K.WAREHOUSE, ' does not exist in WAREHOUSE_CONTROLS')
         ELSE '' END AS R1_msg,
    CASE WHEN NOT EXISTS (SELECT 1 FROM PRODUCT_WAREHOUSE PW2
                          WHERE PW2.WAREHOUSE = K.WAREHOUSE
                            AND PW2.PART_CODE = K.PART_CODE
                            AND ISNULL(PW2.ACTIVATION_STATUS, '') = @ACTIVE)
         THEN CONCAT('; PRODUCT_WAREHOUSE for part ', K.PART_CODE , ' is not active for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R1b_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.IC_STATUS_CODE)), '') IS NULL
         THEN '; IC_STATUS_CODE is required' ELSE '' END AS R1c_msg,

    -- ---- RULE 2: Part code exists and active
    CASE WHEN PM.PART_CODE IS NULL
         THEN CONCAT('; Part code ', K.PART_CODE, ' does not exist in PRODUCT_MASTER')
         ELSE '' END AS R2a_msg,
    CASE WHEN PM.PART_CODE IS NOT NULL AND ISNULL(PM.ACTIVATION_STATUS, '') <> @ACTIVE
         THEN CONCAT('; Part code ', K.PART_CODE, ' is not active in PRODUCT_MASTER')
         ELSE '' END AS R2b_msg,

    -- ---- RULE 3: Bin location checks
    CASE WHEN WC.BIN_SIZING = 'Y' AND NULLIF(LTRIM(RTRIM(K.BIN_LOCATION)), '') IS NULL
         THEN '; Bin location is blank: warehouse is binned' ELSE '' END AS R3a_msg,
    CASE WHEN WC.BIN_SIZING = 'Y'
          AND NULLIF(LTRIM(RTRIM(K.BIN_LOCATION)), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM BIN_LOCATIONS B
                          WHERE B.WAREHOUSE = K.WAREHOUSE AND B.BIN_LOCATION = K.BIN_LOCATION)
         THEN CONCAT('; Bin location ', K.BIN_LOCATION, ' does not exist for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R3b_msg,
    CASE WHEN WC.BIN_SIZING = 'Y'
          AND NULLIF(LTRIM(RTRIM(K.BIN_LOCATION)), '') IS NOT NULL
          AND EXISTS (SELECT 1 FROM BIN_LOCATIONS B
                      WHERE B.WAREHOUSE = K.WAREHOUSE AND B.BIN_LOCATION = K.BIN_LOCATION)
          AND NOT EXISTS (SELECT 1 FROM BIN_LOCATIONS B
                          WHERE B.WAREHOUSE = K.WAREHOUSE AND B.BIN_LOCATION = K.BIN_LOCATION
                            AND ISNULL(B.LOCATION_STATUS, '') = @ACTIVE)
         THEN CONCAT('; Bin location ', K.BIN_LOCATION, ' is not active for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R3c_msg,
    CASE WHEN WC.BIN_SIZING = 'N' AND NULLIF(LTRIM(RTRIM(K.BIN_LOCATION)), '') IS NOT NULL
         THEN CONCAT('; Bin location ', K.BIN_LOCATION, ' is provided but warehouse is not binned')
         ELSE '' END AS R3d_msg,

    -- ---- RULE 4: PRODUCT_WAREHOUSE record must exist
    CASE WHEN NOT EXISTS (SELECT 1 FROM PRODUCT_WAREHOUSE PW
                          WHERE PW.WAREHOUSE = K.WAREHOUSE AND PW.PART_CODE = K.PART_CODE)
         THEN CONCAT('; Part ', K.PART_CODE, ' has no PRODUCT_WAREHOUSE record for warehouse ', K.WAREHOUSE)
         ELSE '' END AS R4_msg,

    -- ---- RULE 5: Lot number mandatory if lotted
    CASE WHEN PM.BATCHES_EXIST = 'Y' AND NULLIF(LTRIM(RTRIM(K.IC_LOT_NUMBER)), '') IS NULL
         THEN CONCAT('; Lot number required: part ', K.PART_CODE, ' is lotted (BATCHES_EXIST = Y)')
         ELSE '' END AS R5_msg,

    -- ---- RULE 6: Batch expiry checks
    CASE WHEN PM.BATCHES_EXIST = 'Y' AND PM.BATCH_EXPIRY = 'Y'
          AND NULLIF(LTRIM(RTRIM(K.BATCH_DATE)), '') IS NULL
         THEN CONCAT('; Batch date required: part ', K.PART_CODE, ' has BATCH_EXPIRY = Y')
         ELSE '' END AS R6a_msg,
    CASE WHEN PM.BATCHES_EXIST = 'Y' AND PM.BATCH_EXPIRY = 'Y'
          AND NULLIF(LTRIM(RTRIM(K.BATCH_DATE)), '') IS NOT NULL
          AND TRY_CAST(K.BATCH_DATE AS DATE) IS NULL
         THEN CONCAT('; Batch date ', K.BATCH_DATE, ' is not a valid date')
         ELSE '' END AS R6b_msg,

     CASE WHEN PM.BATCHES_EXIST = 'Y' AND PM.BATCH_EXPIRY = 'Y'
      AND TRY_CAST(K.CREATION_DATE AS DATE) IS NOT NULL
      AND TRY_CAST(K.BATCH_DATE AS DATE) IS NOT NULL
      AND TRY_CAST(K.CREATION_DATE AS DATE) > TRY_CAST(K.BATCH_DATE AS DATE)
     THEN CONCAT('; Creation date cannot be later than expiry date ', K.BATCH_DATE)
     ELSE '' END AS R6c_msg,

     CASE WHEN PM.BATCHES_EXIST = 'Y' AND PM.BATCH_EXPIRY = 'Y'
      AND TRY_CAST(K.IC_RETEST_DATE AS DATE) IS NOT NULL
      AND TRY_CAST(K.BATCH_DATE AS DATE) IS NOT NULL
      AND TRY_CAST(K.IC_RETEST_DATE AS DATE) > TRY_CAST(K.BATCH_DATE AS DATE)
     THEN CONCAT('; Retest date cannot be later than expiry date ', K.BATCH_DATE)
     ELSE '' END AS R6d_msg,

    -- ---- RULE 7: UOM_1 (S/P x packaged/non-packaged)
    CASE
      WHEN NULLIF(LTRIM(RTRIM(K.UOM_1)), '') IS NULL
           THEN '; UOM_1 is required'
      WHEN PM.IC_PRODUCT_UOM_CONTROL IN ('S','P') AND PM.IC_PACKAGED_PRODUCT = 'N'
           AND LTRIM(RTRIM(K.UOM_1)) <> ISNULL(LTRIM(RTRIM(PM.IC_UNIT_CAPACITY)), '')
           THEN CONCAT('; UOM_1 ', K.UOM_1, ' does not match PRODUCT_MASTER.IC_UNIT_CAPACITY ', PM.IC_UNIT_CAPACITY)
      -- packaged part: UOM_1 must be a PACKAGING unit, never the inventory (capacity) unit
      WHEN PM.IC_PRODUCT_UOM_CONTROL IN ('S','P') AND PM.IC_PACKAGED_PRODUCT = 'Y'
           AND LTRIM(RTRIM(K.UOM_1)) = ISNULL(LTRIM(RTRIM(PM.IC_UNIT_CAPACITY)), '')
           THEN CONCAT('; UOM_1 ', K.UOM_1, ' is the inventory unit (IC_UNIT_CAPACITY) of packaged part ', K.PART_CODE,
                       ': records have an inventory unit should be packaging unit')
      -- packaged part: UOM_1 must exist as a packaging unit (type P) for the part
      WHEN PM.IC_PRODUCT_UOM_CONTROL IN ('S','P') AND PM.IC_PACKAGED_PRODUCT = 'Y'
           AND NOT EXISTS (SELECT 1 FROM IC_PRODUCT_MASTER_UNITS S
                           WHERE S.PART_CODE = K.PART_CODE
                             AND S.COMPANY_CODE = K.COMPANY_CODE
                             AND S.IC_PRODUCT_UOM_TYPE = 'P'
                             AND LTRIM(RTRIM(S.UNIT_OF_MEASURE)) = LTRIM(RTRIM(K.UOM_1)))
           THEN CONCAT('; Packaging item doesn''t exist: UOM_1 ', K.UOM_1, ' is not a packaging unit (IC_PRODUCT_UOM_TYPE = P) in IC_PRODUCT_MASTER_UNITS for part ', K.PART_CODE)
      ELSE '' END AS R7_msg,

    -- ---- RULE 8: Duplicate LPN (LPN + PART_CODE + IC_LOT_NUMBER)
    CASE WHEN K.DupCnt > 1
         THEN CONCAT('; Duplicate LPN: ', K.DupCnt,
                     ' rows share DC_LICENSE_PLATE_ID ', K.DC_LICENSE_PLATE_ID,
                     ', PART_CODE ', K.PART_CODE, ', IC_LOT_NUMBER ', K.IC_LOT_NUMBER)
         ELSE '' END AS R8_msg,

    CASE WHEN EXISTS (SELECT 1 FROM DC_LICENSE_PLATES L
                           WHERE L.COMPANY_CODE = K.COMPANY_CODE
                             AND L.DC_LICENSE_PLATE_ID = K.DC_LICENSE_PLATE_ID)
         THEN CONCAT('; Duplicate LPN: ', K.DC_LICENSE_PLATE_ID,
                     ' exists in inventory ')
         ELSE '' END AS R8b_msg,

    -- ---- RULE 9: DC_LICENSE_PLATE_ID checks
    CASE WHEN WC.DATA_CAPTURE_IN_USE='Y' AND NULLIF(LTRIM(RTRIM(K.DC_LICENSE_PLATE_ID)), '') IS NULL
         THEN '; DC_LICENSE_PLATE_ID is required' ELSE '' END AS R9a_msg,
    CASE WHEN NULLIF(LTRIM(RTRIM(K.DC_LICENSE_PLATE_ID)), '') IN ('0', 'N/A', 'UNKNOWN')
         THEN '; DC_LICENSE_PLATE_ID is not valid' ELSE '' END AS R9b_msg,
    -- 9c: LPN assigned to more than one warehouse
    CASE WHEN NULLIF(LTRIM(RTRIM(K.DC_LICENSE_PLATE_ID)), '') IS NOT NULL
          AND K.WhMin <> K.WhMax
         THEN CONCAT('; DC_LICENSE_PLATE_ID ', K.DC_LICENSE_PLATE_ID, ' is assigned to multiple warehouses: ',
              (SELECT STRING_AGG(d.WAREHOUSE, ', ') WITHIN GROUP (ORDER BY d.WAREHOUSE)
               FROM (SELECT DISTINCT T.WAREHOUSE FROM KAS_DC_LOADS T
                     WHERE T.DC_LICENSE_PLATE_ID = K.DC_LICENSE_PLATE_ID
                       AND ISNULL(T.STATUS_FLAG, '') <> @POPULATED
                       AND T.WAREHOUSE IS NOT NULL) d))
         ELSE '' END AS R9c_msg,
    -- 9d: LPN with more than one bin location in the same warehouse
    CASE WHEN NULLIF(LTRIM(RTRIM(K.DC_LICENSE_PLATE_ID)), '') IS NOT NULL
          AND K.WAREHOUSE IS NOT NULL
          AND K.BinMin <> K.BinMax
         THEN CONCAT('; DC_LICENSE_PLATE_ID ', K.DC_LICENSE_PLATE_ID, ' has multiple bin locations in warehouse ',
              K.WAREHOUSE, ': ',
              (SELECT STRING_AGG(d.BIN_LOCATION, ', ') WITHIN GROUP (ORDER BY d.BIN_LOCATION)
               FROM (SELECT DISTINCT T.BIN_LOCATION FROM KAS_DC_LOADS T
                     WHERE T.DC_LICENSE_PLATE_ID = K.DC_LICENSE_PLATE_ID
                       AND T.WAREHOUSE = K.WAREHOUSE
                       AND ISNULL(T.STATUS_FLAG, '') <> @POPULATED
                       AND T.BIN_LOCATION IS NOT NULL) d))
         ELSE '' END AS R9d_msg
) X;

-- Safety check: fails here if GEM_DBKEY is not unique (or is NULL)
CREATE UNIQUE CLUSTERED INDEX IX_R_KEY ON #R (GEM_DBKEY);

-- ============================================================================
-- UPDATE: apply STATUS_FLAG and RS_MESSAGE_TEXT
-- ============================================================================
UPDATE K
SET STATUS_FLAG     = CASE WHEN R.MSG IS NOT NULL THEN 'E' ELSE @CLEAN_FLAG END,
    RS_MESSAGE_TEXT = CASE WHEN R.MSG IS NOT NULL THEN LEFT(R.MSG, @MSG_MAX)
                           ELSE 'Validated' END
FROM KAS_DC_LOADS K
JOIN #R R ON R.GEM_DBKEY = K.GEM_DBKEY
WHERE ISNULL(K.STATUS_FLAG, '') <> @POPULATED;   -- safety: never touch a populated row

-- ============================================================================
-- SUMMARY: errors per rule (a row with several errors counts under each rule)
-- ============================================================================
SELECT V.Rule_Name, V.Error_Count
FROM (
    SELECT
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%does not exist in WAREHOUSE_CONTROLS%'
                          OR RS_MESSAGE_TEXT LIKE '%is not active in PRODUCT_WAREHOUSE%'
                          OR RS_MESSAGE_TEXT LIKE '%IC_STATUS_CODE is required%' THEN 1 ELSE 0 END), 0) AS r1,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Part code%' THEN 1 ELSE 0 END), 0) AS r2,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Bin location%' THEN 1 ELSE 0 END), 0) AS r3,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%has no PRODUCT_WAREHOUSE record%' THEN 1 ELSE 0 END), 0) AS r4,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Lot number required%' THEN 1 ELSE 0 END), 0) AS r5,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Batch date%'
                         OR RS_MESSAGE_TEXT LIKE '%Creation date cannot be later%'
                         OR RS_MESSAGE_TEXT LIKE '%Retest date cannot be later%' THEN 1 ELSE 0 END), 0) AS r6,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%UOM_1%' THEN 1 ELSE 0 END), 0) AS r7,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%Duplicate LPN%' THEN 1 ELSE 0 END), 0) AS r8,
        ISNULL(SUM(CASE WHEN RS_MESSAGE_TEXT LIKE '%DC_LICENSE_PLATE_ID%' THEN 1 ELSE 0 END), 0) AS r9,
        COUNT(*) AS total_err
    FROM KAS_DC_LOADS
    WHERE STATUS_FLAG = 'E'
) C
CROSS APPLY (VALUES
    (1,  'Rule 1 - Warehouse exists and active',                    C.r1),
    (2,  'Rule 2 - Part code exists and active',                    C.r2),
    (3,  'Rule 3 - Bin location exists and valid',                  C.r3),
    (4,  'Rule 4 - PRODUCT_WAREHOUSE record exists',                C.r4),
    (5,  'Rule 5 - Lot number required if lotted',                  C.r5),
    (6,  'Rule 6 - Batch date required if lotted + BATCH_EXPIRY=Y', C.r6),
    (7,  'Rule 7 - UOM_1 matches appropriate UOM',                  C.r7),
    (8,  'Rule 8 - Duplicate LPN',                                  C.r8),
    (9,  'Rule 9 - DC_LICENSE_PLATE_ID checks',                     C.r9),
    (10, 'Total rows with errors',                                  C.total_err),
    (11, 'Total rows validated (passed)', (SELECT COUNT(*) FROM KAS_DC_LOADS WHERE STATUS_FLAG = 'V')),
    (12, 'Rows skipped - already populated (not touched)', (SELECT COUNT(*) FROM KAS_DC_LOADS WHERE STATUS_FLAG = @POPULATED))
) V (Sort_Order, Rule_Name, Error_Count)
ORDER BY V.Sort_Order;

-- ============================================================================
-- FAILED ROWS for review
-- ============================================================================
SELECT K.COMPANY_CODE, K.WAREHOUSE, K.PART_CODE, K.IC_LOT_NUMBER, K.BIN_LOCATION,
       K.BATCH_DATE, K.DC_LICENSE_PLATE_ID, K.UOM_1, K.IC_STATUS_CODE,
       K.STATUS_FLAG, K.RS_MESSAGE_TEXT
FROM KAS_DC_LOADS K
WHERE K.STATUS_FLAG = 'E'
ORDER BY K.WAREHOUSE, K.PART_CODE;