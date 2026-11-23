USE [ExampleEDH]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[usp_Upsert_MeterReads]
WITH EXEC AS CALLER
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.FACT_MeterRead WITH (HOLDLOCK) AS target
    USING (
        SELECT DISTINCT s.MeterID, s.ReadDate, s.ReadValue
        FROM dbo.STG_EXW_METER_READS AS s
        LEFT OUTER JOIN dbo.REF_UNIT_OF_MEASURE AS u ON s.UnitCode = u.UnitCode
    ) AS source
    ON target.MeterID = source.MeterID AND target.ReadDate = source.ReadDate
    WHEN MATCHED THEN UPDATE SET target.ReadValue = source.ReadValue
    WHEN NOT MATCHED BY TARGET THEN INSERT (MeterID, ReadDate, ReadValue) VALUES (source.MeterID, source.ReadDate, source.ReadValue);
END;
GO
