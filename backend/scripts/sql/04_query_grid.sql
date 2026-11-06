/****** Object:  Script [FIN].[SP_KAS_DC_LOADS_QUERY_GRID] / Paginated Grid Query ******/
-- Usage parameters: @PageNumber INT = 1, @PageSize INT = 50, @StatusFilter VARCHAR(10) = 'ALL', @SearchTerm VARCHAR(100) = ''
-- Returns Page Records and Total Record Counts

-- Sample query template executed via mssql parameterized query:
/*
SELECT 
    [GEM_DBKEY],
    [COMPANY_CODE],
    [WAREHOUSE],
    [PART_CODE],
    [IC_LOT_NUMBER],
    [BIN_LOCATION],
    [IC_STATUS_CODE],
    CONVERT(VARCHAR(19), [CREATION_DATE], 120) AS [CREATION_DATE],
    CONVERT(VARCHAR(19), [BATCH_DATE], 120) AS [BATCH_DATE],
    [DC_LICENSE_PLATE_ID],
    [DC_PARENT_LICENSE_PLATE_ID],
    [UOM_1],
    CAST([QTY_1] AS FLOAT) AS [QTY_1],
    [UOM_2],
    CAST([QTY_2] AS FLOAT) AS [QTY_2],
    [STATUS_FLAG],
    [RS_MESSAGE_TEXT],
    [DC_LICENSE_PLATE_LINE],
    CAST([UNIT_COST] AS FLOAT) AS [UNIT_COST],
    [IC_VENDOR_LOT_NUMBER],
    CONVERT(VARCHAR(19), [BEST_BEFORE_DATE], 120) AS [BEST_BEFORE_DATE],
    CONVERT(VARCHAR(19), [IC_RETEST_DATE], 120) AS [IC_RETEST_DATE]
FROM [FIN].[KAS_DC_LOADS]
WHERE (@StatusFilter = 'ALL' OR [STATUS_FLAG] = @StatusFilter)
  AND (@SearchTerm = '' OR (
      [PART_CODE] LIKE '%' + @SearchTerm + '%'
      OR [IC_LOT_NUMBER] LIKE '%' + @SearchTerm + '%'
      OR [IC_VENDOR_LOT_NUMBER] LIKE '%' + @SearchTerm + '%'
      OR [DC_LICENSE_PLATE_ID] LIKE '%' + @SearchTerm + '%'
      OR [WAREHOUSE] LIKE '%' + @SearchTerm + '%'
      OR [BIN_LOCATION] LIKE '%' + @SearchTerm + '%'
      OR [RS_MESSAGE_TEXT] LIKE '%' + @SearchTerm + '%'
  ))
ORDER BY [GEM_DBKEY] ASC
OFFSET @Offset ROWS
FETCH NEXT @PageSize ROWS ONLY;
*/
