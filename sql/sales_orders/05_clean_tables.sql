-- ============================================================================
-- CLEAR_SO_TABLES.SQL
-- Whole-order cleanup of the Sales Orders created by the LOAD_SO_*.sql scripts.
--
-- Scope:
--
--   Orders recorded on FIN.KAS_SO_LOADS (STATUS_FLAG='P', ORDER_NUMBER set) and
--   still matching the staged customer + reference. The ENTIRE order (all
--   lines/details/qty/tax/history rows plus the header) is deleted so header
--   totals stay consistent. Orders not created by the loader are never touched.
--
-- After deleting, the staging rows of those orders are reset to STATUS_FLAG='N'
-- (ORDER_NUMBER / message / processed date cleared) so they can be re-validated
-- and re-loaded. Set @RESET_STAGING = 0 to leave the staging rows as they are.
--
-- Optional filter:
--   @WAREHOUSE - only orders that have a staged line in this warehouse.
--
-- Not touched (by design):
--   IC_DEMAND_SUPPLY / reservations / SOP_L_DO_IC_COMMITMENTS - left to the IC engine.
--   The SOP_TRANSACTION_TYPES order-number counter is not rolled back.
--
-- Use PREVIEW_CLEAR_SO_TABLES.sql first to see exactly what would be removed.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @WAREHOUSE     VARCHAR(2) = NULL;   -- e.g. '20'; NULL = all loader-created orders
DECLARE @RESET_STAGING BIT        = 1;      -- 1 = reset staging rows to 'N' after the delete

IF OBJECT_ID('tempdb..#SO_DELETE')    IS NOT NULL DROP TABLE #SO_DELETE;
IF OBJECT_ID('tempdb..#SO_STAGE_IDS') IS NOT NULL DROP TABLE #SO_STAGE_IDS;

BEGIN TRANSACTION;

-- Same lock the validator and loaders take, so nothing runs against these rows concurrently
DECLARE @LOCK_RC INT;
EXEC @LOCK_RC = sys.sp_getapplock @Resource = N'KAS_SO_LOADS_PIPELINE',
                                  @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
IF @LOCK_RC < 0
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('CLEAR_SO_TABLES: another validate/load/clear run is in progress. Try again when it finishes.', 16, 1);
    RETURN;
END

-- ----------------------------------------------------------------------------
-- 1. Resolve the orders THIS LOADER created
--    Only staging rows that were loaded (STATUS_FLAG='P') and recorded an
--    ORDER_NUMBER are in scope, and the order header must still match the
--    staged customer + customer reference. Orders that were not created by the
--    loader are never touched, whatever warehouse they are in.
-- ----------------------------------------------------------------------------
SELECT DISTINCT
       H.COMPANY_CODE,
       H.DIVISION,
       H.ORDER_NUMBER
INTO #SO_DELETE
FROM FIN.KAS_SO_LOADS K
JOIN FIN.SALES_ORDER_HEADERS H
  ON H.COMPANY_CODE       = K.COMPANY_CODE
 AND H.DIVISION           = K.DIVISION
 AND H.ORDER_NUMBER       = K.ORDER_NUMBER
 AND H.CUSTOMER_NUMBER    = K.CUSTOMER_NUMBER
 AND H.CUSTOMER_REFERENCE = K.CUSTOMER_REFERENCE
WHERE K.STATUS_FLAG  = 'P'
  AND K.ORDER_NUMBER IS NOT NULL
  AND (@WAREHOUSE IS NULL OR K.WAREHOUSE = @WAREHOUSE);

-- Loaded rows that cannot be traced (loaded before ORDER_NUMBER existed)
DECLARE @UNTRACED INT =
    (SELECT COUNT(*) FROM FIN.KAS_SO_LOADS WHERE STATUS_FLAG = 'P' AND ORDER_NUMBER IS NULL);
IF @UNTRACED > 0
    PRINT CONCAT('CLEAR_SO_TABLES: WARNING - ', @UNTRACED,
                 ' processed staging row(s) have no ORDER_NUMBER and cannot be cleared by this script ',
                 '(see the optional backfill in CREATE_KAS_SO_LOADS.sql).');

IF NOT EXISTS (SELECT 1 FROM #SO_DELETE)
BEGIN
    PRINT 'CLEAR_SO_TABLES: no loader-created sales orders found. Nothing to delete.';
    ROLLBACK TRANSACTION;
    RETURN;
END

-- Staging rows belonging to those orders (reset afterwards so they can be re-validated)
SELECT K.ID
INTO #SO_STAGE_IDS
FROM FIN.KAS_SO_LOADS K
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = K.COMPANY_CODE
 AND D.DIVISION     = K.DIVISION
 AND D.ORDER_NUMBER = K.ORDER_NUMBER
WHERE K.STATUS_FLAG = 'P';

-- ----------------------------------------------------------------------------
-- 2. Safety checks: never delete orders that have progressed
-- ----------------------------------------------------------------------------
IF EXISTS (
    SELECT 1
    FROM FIN.SALES_ORDER_INVOICES I
    JOIN #SO_DELETE D
      ON D.COMPANY_CODE = I.COMPANY_CODE
     AND D.DIVISION     = I.DIVISION
     AND D.ORDER_NUMBER = I.ORDER_NUMBER)
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('CLEAR_SO_TABLES: one or more target sales orders have invoice rows. Cleanup aborted; handle invoiced orders manually.', 16, 1);
    RETURN;
END

IF EXISTS (
    SELECT 1
    FROM FIN.SALES_ORDER_LINE_QTYS Q
    JOIN #SO_DELETE D
      ON D.COMPANY_CODE = Q.COMPANY_CODE
     AND D.DIVISION     = Q.DIVISION
     AND D.ORDER_NUMBER = Q.ORDER_NUMBER
    WHERE ISNULL(Q.QTY_DESPATCHED, 0)     <> 0
       OR ISNULL(Q.QTY_INVOICED, 0)       <> 0
       OR ISNULL(Q.IC_QTY_PICKED, 0)      <> 0
       OR ISNULL(Q.IC_QTY_IN_DESPATCH, 0) <> 0)
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('CLEAR_SO_TABLES: one or more target sales orders already have picked/despatched/invoiced quantities. Cleanup aborted; handle them manually.', 16, 1);
    RETURN;
END

--PRINT CONCAT('CLEAR_SO_TABLES: deleting ', (SELECT COUNT(*) FROM #SO_DELETE), ' whole sales order(s).');

-- ----------------------------------------------------------------------------
-- 3. Delete child rows (order-scoped), then lines, then header
-- ----------------------------------------------------------------------------
DELETE T
FROM FIN.SALES_ORDER_LINE_DETAIL_QTYS T
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = T.COMPANY_CODE
 AND D.DIVISION     = T.DIVISION
 AND D.ORDER_NUMBER = T.ORDER_NUMBER;

DELETE T
FROM FIN.SALES_ORDER_LINE_DETAILS T
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = T.COMPANY_CODE
 AND D.DIVISION     = T.DIVISION
 AND D.ORDER_NUMBER = T.ORDER_NUMBER;

DELETE T
FROM FIN.SALES_ORDER_LINE_QTYS T
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = T.COMPANY_CODE
 AND D.DIVISION     = T.DIVISION
 AND D.ORDER_NUMBER = T.ORDER_NUMBER;

DELETE T
FROM FIN.SALES_ORDER_HISTORY T
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = T.COMPANY_CODE
 AND D.DIVISION     = T.DIVISION
 AND D.ORDER_NUMBER = T.ORDER_NUMBER;

DELETE T
FROM FIN.SALES_ORDER_LINES T
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = T.COMPANY_CODE
 AND D.DIVISION     = T.DIVISION
 AND D.ORDER_NUMBER = T.ORDER_NUMBER;

DELETE T
FROM FIN.SALES_ORDER_HEADERS T
JOIN #SO_DELETE D
  ON D.COMPANY_CODE = T.COMPANY_CODE
 AND D.DIVISION     = T.DIVISION
 AND D.ORDER_NUMBER = T.ORDER_NUMBER;

-- ----------------------------------------------------------------------------
-- 4. Reset the staging rows so the data can be re-validated / re-loaded
-- ----------------------------------------------------------------------------
IF @RESET_STAGING = 1
BEGIN
    UPDATE K
    SET STATUS_FLAG       = 'N',
        RS_MESSAGE_TEXT   = NULL,
        ORDER_NUMBER      = NULL,
        ORDER_LINE_NUMBER = NULL,
        PROCESSED_DATE    = NULL
    FROM FIN.KAS_SO_LOADS K
    JOIN #SO_STAGE_IDS S ON S.ID = K.ID;
END;

COMMIT TRANSACTION;

PRINT 'CLEAR_SO_TABLES: cleanup complete.';
GO
