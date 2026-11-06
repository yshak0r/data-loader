/****** Object:  Script [FIN].[SP_KAS_DC_LOADS_EXECUTE_LOAD] / Live Loader Script ******/
SET NOCOUNT ON;

DECLARE @ValidCount INT;
SELECT @ValidCount = COUNT(*) FROM [FIN].[KAS_DC_LOADS] WHERE [STATUS_FLAG] = 'V';

IF @ValidCount = 0
BEGIN
    SELECT 
        0 AS [LoadedRecords],
        0 AS [FailedRecords],
        'NO_RECORDS' AS [BatchID],
        'No verified records with STATUS_FLAG = ''V'' ready for loading. Run Dry Run validation first.' AS [Message];
    RETURN;
END

DECLARE @BatchID VARCHAR(30) = 'TX-' + FORMAT(GETDATE(), 'yyyyMMdd-HHmmss');
DECLARE @LoadedCount INT = 0;

BEGIN TRY
    BEGIN TRANSACTION;

    -- Update records to Loaded status
    UPDATE [FIN].[KAS_DC_LOADS]
    SET [STATUS_FLAG] = 'L',
        [BATCH_DATE] = GETDATE(),
        [RS_MESSAGE_TEXT] = 'Loaded into Ross ERP (Batch ' + @BatchID + ')'
    WHERE [STATUS_FLAG] = 'V';

    SET @LoadedCount = @@ROWCOUNT;

    COMMIT TRANSACTION;

    SELECT
        @LoadedCount AS [LoadedRecords],
        0 AS [FailedRecords],
        @BatchID AS [BatchID],
        'Batch committed successfully: ' + CAST(@LoadedCount AS VARCHAR) + ' records loaded.' AS [Message];

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    DECLARE @ErrMsg VARCHAR(150) = SUBSTRING(ERROR_MESSAGE(), 1, 150);

    UPDATE [FIN].[KAS_DC_LOADS]
    SET [STATUS_FLAG] = 'E',
        [RS_MESSAGE_TEXT] = 'Load execution error: ' + @ErrMsg
    WHERE [STATUS_FLAG] = 'V';

    SELECT
        0 AS [LoadedRecords],
        @ValidCount AS [FailedRecords],
        @BatchID AS [BatchID],
        'Transaction failed: ' + @ErrMsg AS [Message];
END CATCH;
