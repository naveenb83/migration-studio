from estate.sql_refs import analyze_sql, split_batches


def _names(refs):
    return {r.name for r in refs}


def test_merge_proc_reads_writes_and_definition():
    sql = """USE [ExampleEDH]
GO
CREATE PROCEDURE [dbo].[usp_Upsert_MeterReads]
WITH EXEC AS CALLER
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.FACT_MeterRead WITH (HOLDLOCK) AS target
    USING (
        SELECT DISTINCT s.MeterID FROM dbo.STG_EXW_METER_READS AS s
        LEFT OUTER JOIN dbo.REF_UNIT_OF_MEASURE AS u ON s.UnitCode = u.UnitCode
    ) AS source
    ON target.MeterID = source.MeterID
    WHEN MATCHED THEN UPDATE SET target.MeterID = source.MeterID
    WHEN NOT MATCHED BY TARGET THEN INSERT (MeterID) VALUES (source.MeterID);
END;
GO
"""
    a = analyze_sql(sql)
    assert a.defines == "dbo.usp_Upsert_MeterReads"
    assert a.defines_kind == "PROCEDURE"
    assert _names(a.reads) == {"dbo.STG_EXW_METER_READS", "dbo.REF_UNIT_OF_MEASURE"}
    assert _names(a.writes) == {"dbo.FACT_MeterRead"}
    assert a.execs == []
    assert a.parse_status == "parsed"


def test_view_excludes_cte_names_and_reads_base_tables():
    sql = """CREATE VIEW [dbo].[vw_MeterReads_Source]
AS
WITH recent AS (SELECT * FROM meter_reads_raw WHERE status = 'ok')
SELECT DISTINCT m.MeterID AS MeterID
FROM [meters] m
JOIN recent r ON m.MeterID = r.MeterID
LEFT JOIN [sites] s ON m.SiteID = s.SiteID
"""
    a = analyze_sql(sql)
    assert a.defines_kind == "VIEW"
    assert a.defines == "dbo.vw_MeterReads_Source"
    assert _names(a.reads) == {"meter_reads_raw", "meters", "sites"}
    assert a.writes == []


def test_temp_tables_are_not_lineage():
    sql = "SELECT MeterID INTO #work FROM dbo.FACT_MeterRead; INSERT INTO dbo.T (a) SELECT a FROM #work;"
    a = analyze_sql(sql)
    assert "#work" not in _names(a.reads) and "work" not in {r.name for r in a.reads}
    assert _names(a.writes) == {"dbo.T"}
    assert "dbo.FACT_MeterRead" in _names(a.reads)


def test_dml_statements_and_regex_fallback_marks_confidence():
    sql = """CREATE PROCEDURE [dbo].[usp_Rebuild]
AS
BEGIN
    TRUNCATE TABLE dbo.SUM_MeterReads;
    DELETE FROM dbo.FACT_Old WHERE ReadDate < '2020-01-01';
    IF EXISTS (SELECT 1 FROM dbo.SUM_MeterReads) EXEC dbo.usp_Notify;
    EXEC dbo.usp_ETL_LogEnd;
END;
"""
    a = analyze_sql(sql)
    assert a.parse_status == "partial"
    assert "dbo.SUM_MeterReads" in _names(a.writes)
    assert "dbo.FACT_Old" in _names(a.writes)
    execs = {r.name: r.confidence for r in a.execs}
    assert execs == {"dbo.usp_Notify": "regex", "dbo.usp_ETL_LogEnd": "regex"}


def test_exec_variants_and_non_calls():
    sql = """EXEC ? = [dbo].[spx_ETL_LogEnd] ?, ?
GO
EXEC @r = dbo.p2 @x = 1
GO
EXECUTE dbo.p3;
GO
GRANT EXECUTE ON dbo.p4 TO app_role;
GO
EXEC sp_executesql N'select 1';
GO
"""
    a = analyze_sql(sql)
    assert {r.name for r in a.execs} == {"dbo.spx_ETL_LogEnd", "dbo.p2", "dbo.p3"}


def test_table_ddl_defines_table_without_lineage_and_batches_split_on_go_with_crlf():
    sql = "CREATE TABLE [dbo].[STG_X](\r\n  [a] int NULL\r\n)\r\nGO\r\nSELECT a FROM dbo.DIM_Y\r\nGO\r\n"
    assert len(split_batches(sql)) == 2
    a = analyze_sql(sql)
    assert a.defines_kind == "TABLE" and a.defines == "dbo.STG_X"
    assert _names(a.reads) == {"dbo.DIM_Y"}


def test_secrets_in_sql_are_not_returned_in_refs_names():
    a = analyze_sql("SELECT 1 FROM dbo.T -- password=hunter2")
    assert "hunter2" not in " ".join(_names(a.reads))
