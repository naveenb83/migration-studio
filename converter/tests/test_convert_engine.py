"""Engine tests on a FICTIONAL water-meter example (hand-written; no customer content)."""
import convert_engine as ce

SB = "cat.t1_converted"
CFG = {
    "sandbox": SB,
    "inputs": {"meter": "cat.t1_src.meter", "reading": "cat.t1_src.reading", "ref_codes": "cat.t1_legacy.ref_codes"},
    "feeds": [{"match": "stg_meter_reads$", "from": "cat.t1_legacy.stg_meter_reads", "label": "Stand-in for the loader"}],
    "stand_ins": [{"kind": "function", "name": "fn_src_code", "sql": "CREATE OR REPLACE FUNCTION {sandbox}.fn_src_code(x STRING) RETURNS STRING RETURN split_part(x, '_', 1)"}],
    "outputs": [
        {"id": "view", "label": "Reads view", "legacy_object": "vw_meter_reads", "legacy_table": "cat.t1_legacy.stg_meter_reads",
         "match": ["^vw_.*meter_reads$"], "kinds": ["VIEW", "TABLE"], "key": ["MeterID"]},
        {"id": "dim", "label": "Meter table", "legacy_object": "dim_meter", "legacy_table": "cat.t1_legacy.dim_meter",
         "match": ["^dim_meter$"], "kinds": ["TABLE"], "key": ["METER_KEY"], "prepare": "empty_like_legacy"},
    ],
}
KNOWN = {"site": "cat.t1_src.site"}

VIEW = """-- Converted by a tool
CREATE OR REPLACE VIEW all_views.vw_meter_reads AS
SELECT meter.Name AS meter_id, 'a;b' AS literal, current_timestamp() AS audit_dte, r.value
FROM src.meter AS meter JOIN src.reading r ON r.meter = meter.ID
JOIN site s ON s.id = meter.site
WHERE meter.kind COLLATE UTF8_LCASE = 'domestic';
/* trailing config, not code:
schedule: daily
*/"""
STG = "CREATE TABLE IF NOT EXISTS edh.stg_meter_reads (MeterID STRING, value DOUBLE);"
PROC = """-- converted procedure
/* header */
CREATE OR REPLACE PROCEDURE edh.spx_upsert_meter()
LANGUAGE SQL
AS BEGIN
  MERGE INTO edh.dim_meter AS t
  USING (SELECT MeterID, fn_src_code(MeterID) AS code, CASE WHEN value > 0 THEN value END AS v FROM edh.stg_meter_reads) s
  ON t.METER_KEY = s.MeterID
  WHEN MATCHED THEN UPDATE SET t.VAL = s.v
  WHEN NOT MATCHED THEN INSERT (METER_KEY, VAL) VALUES (s.MeterID, s.v)
  WHEN NOT MATCHED BY SOURCE THEN DELETE;
END;
CALL edh.spx_upsert_meter();"""


def test_split_respects_strings_comments_and_blocks():
    parts = ce.split_statements("SELECT 'a;b'; -- x;\nSELECT 2;\n/* only; a comment */")
    assert parts == ["SELECT 'a;b'", "-- x;\nSELECT 2"]
    body = ce.split_statements("CREATE PROCEDURE p() AS BEGIN SELECT CASE WHEN 1=1 THEN 1 END; SELECT 2; END; SELECT 3")
    assert len(body) == 2 and body[1] == "SELECT 3"
    assert ce.split_statements("/*\nyaml: only\n*/\n-- and a note") == []


def test_analyse_view_targets_reads_and_nondeterministic_columns():
    a = ce.analyse(ce.split_statements(VIEW)[0])
    assert a.kind == "create_view" and a.status == "run"
    assert a.target.written == "all_views.vw_meter_reads"
    assert sorted(r.written for r in a.refs if not r.is_target) == ["site", "src.meter", "src.reading"]
    assert a.nondeterministic == ["audit_dte"]


def test_analyse_blocks_what_is_not_allowed():
    assert ce.analyse("GRANT SELECT ON TABLE x TO `someone`").status == "blocked"
    assert ce.analyse("this is: not sql").status == "blocked"
    assert ce.analyse("USE CATALOG main").status == "skip"
    assert ce.analyse("-- note\nSET x = 1").status == "skip"
    assert ce.analyse("DROP TABLE src.meter").kind == "drop"


def test_plan_resolves_rewrites_only_names_and_inlines_procedures():
    files = [{"name": "proc.sql", "text": PROC}, {"name": "view.sql", "text": VIEW}, {"name": "stg.sql", "text": STG}]
    p = ce.plan(files, CFG, KNOWN)
    # the staging table is created before the procedure that reads it runs
    assert p["order"].index("stg.sql") < p["order"].index("proc.sql")
    run = [s for s in p["steps"] if s.status == "run"]
    view = next(s for s in run if s.kind == "create_view")
    assert view.target == f"{SB}.vw_meter_reads"
    assert "`cat`.`t1_src`.`meter` AS meter" in view.sql and "meter.Name AS meter_id" in view.sql
    assert "'a;b'" in view.sql and "`cat`.`t1_src`.`site` s" in view.sql   # known table in an allowed read schema
    merge = next(s for s in run if s.kind == "merge")
    assert merge.from_procedure == "edh.spx_upsert_meter"
    assert f"`cat`.`t1_converted`.`dim_meter`" in merge.sql                 # prepared target, in the sandbox
    assert "`cat`.`t1_converted`.`stg_meter_reads`" in merge.sql             # created by stg.sql: read from the sandbox
    assert "`cat`.`t1_converted`.`fn_src_code`(MeterID)" in merge.sql       # stand-in function
    assert any(s.kind == "call" and s.status == "skip" for s in p["steps"])
    assert p["prepared"] == {"dim_meter": "cat.t1_legacy.dim_meter"}
    assert p["feeds"][0]["target"] == f"{SB}.stg_meter_reads" and p["feeds"][0]["from"] == "cat.t1_legacy.stg_meter_reads"


def test_unknown_tables_block_and_a_feed_is_read_directly_when_not_created():
    p = ce.plan([{"name": "x.sql", "text": "INSERT INTO edh.out SELECT * FROM edh.stg_meter_reads JOIN nowhere.mystery m ON 1=1"}], CFG, KNOWN)
    s = p["steps"][0]
    assert s.status == "blocked" and "nowhere.mystery" in s.reason
    assert p["unresolved"] == [{"name": "nowhere.mystery", "file": "x.sql", "n": 1}]
    p2 = ce.plan([{"name": "y.sql", "text": "CREATE VIEW v AS SELECT * FROM edh.stg_meter_reads"}], CFG, KNOWN)
    assert "`cat`.`t1_legacy`.`stg_meter_reads`" in p2["steps"][0].sql


def test_drop_of_something_not_created_is_blocked():
    p = ce.plan([{"name": "d.sql", "text": "DROP TABLE src.meter"}], CFG, KNOWN)
    assert p["steps"][0].status == "blocked"


def test_find_output_and_column_matching():
    p = ce.plan([{"name": "view.sql", "text": VIEW}, {"name": "proc.sql", "text": PROC}], CFG, KNOWN)
    assert ce.find_output(CFG["outputs"][0], p)[0] == f"{SB}.vw_meter_reads"
    assert ce.find_output(CFG["outputs"][1], p)[0] == f"{SB}.dim_meter"
    m = ce.name_matches(["MeterID", "Value", "Read_Date"], ["meter_id", "value", "readdate"], {})
    assert m == {"Value": ("value", "same name"), "MeterID": ("meter_id", "same name, ignoring case and _"),
                 "Read_Date": ("readdate", "same name, ignoring case and _")}
    assert ce.ignored(["AUDIT_ID", "lst_upd", "x"], ["^audit_", "^lst_"]) == ["AUDIT_ID", "lst_upd"]


def test_compare_checks_shape():
    checks = ce.compare_checks(CFG["outputs"][0], [("MeterID", "meter_id")], [{"legacy": "Value", "converted": "value", "how": "same name"}],
                               {"MeterID": "string", "Value": "double"}, ["Extra"])
    names = [c["name"] for c in checks]
    assert names == ["view_row_count", "view_rows_only_in_legacy", "view_rows_only_in_converted", "view__value", "view_legacy_columns_unmatched"]
    assert "try_cast(CAST(`value` AS STRING) AS double) AS `Value`" in checks[1]["sql"] and "${view_conv}" in checks[1]["sql"]
    same = ce.compare_checks(CFG["outputs"][0], [], [{"legacy": "Value", "converted": "value", "how": "x"}], {"Value": "double"}, [], {"value": "double"})
    assert "`value` AS `Value`" in same[1]["sql"]
    assert all(c["expect"] == "== 0" for c in checks)
