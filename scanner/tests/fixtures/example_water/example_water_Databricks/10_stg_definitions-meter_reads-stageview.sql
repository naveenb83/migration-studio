CREATE OR REPLACE VIEW vw_stg_exw_meter_reads
AS
(
/* Fictional example view: staged meter reads joined to station reference data. */
SELECT m.meter_id, m.read_date, m.read_value, s.station_name
FROM stg_exw.meter_reads_src m
JOIN stg_exw.station s ON m.station_id = s.station_id
)
