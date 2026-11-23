CREATE PROCEDURE [dbo].[usp_Rebuild_Summary]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT MeterID, COUNT(*) AS Reads
    INTO #work
    FROM dbo.FACT_MeterRead
    GROUP BY MeterID;
    TRUNCATE TABLE dbo.SUM_MeterReads;
    INSERT INTO dbo.SUM_MeterReads (MeterID, Reads) SELECT MeterID, Reads FROM #work;
    DELETE FROM dbo.FACT_MeterRead_Old WHERE ReadDate < '2020-01-01';
    UPDATE t SET t.Flag = 1 FROM dbo.SUM_MeterReads t JOIN dbo.DIM_Device d ON t.MeterID = d.MeterID;
    EXEC dbo.usp_ETL_LogEnd;
    IF EXISTS (SELECT 1 FROM dbo.SUM_MeterReads) EXEC dbo.usp_Notify;
END;
GO
