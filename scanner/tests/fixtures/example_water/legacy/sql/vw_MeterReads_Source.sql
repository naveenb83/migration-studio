USE [ExampleSource]
GO
CREATE VIEW [dbo].[vw_MeterReads_Source]
AS
WITH recent AS (SELECT * FROM meter_reads_raw WHERE status = 'ok')
SELECT DISTINCT m.MeterID AS MeterID, r.read_date AS ReadDate, r.read_value AS ReadValue
FROM [meters] m
JOIN recent r ON m.MeterID = r.MeterID
LEFT JOIN [sites] s ON m.SiteID = s.SiteID
GO
