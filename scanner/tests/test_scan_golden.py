"""End-to-end golden tests over the fictional example water utility fixtures."""

import csv
import json
from pathlib import Path

import pytest

from estate.graph import MAX_BYTES, validate_graph
from estate.scan import OutputInsideRepoError, REPO_ROOT, check_out_dir, run_scan
from estate.tables import TABLE_SPECS

from conftest import FIXTURES

SECRET_LITERALS = [
    "P@ssw0rd-FIXTURE",
    "Secr3t-FIXTURE",
    "Pw-FIXTURE-VAR",
    "Pw-FIXTURE-STEP",
    "Legacy-Pw-FIXTURE",
]


@pytest.fixture(scope="module")
def scan(tmp_path_factory):
    out = tmp_path_factory.mktemp("estate_out")
    pack = json.loads((FIXTURES / "pack_fixture.json").read_text(encoding="utf-8"))
    summary = run_scan(
        [FIXTURES],
        out,
        dataset_status=pack["estate"]["dataset_status"],
        scan_id="scan-test",
        dataset_status_source="fixture",
    )
    tables = {}
    for name in TABLE_SPECS:
        tables[name] = json.loads((out / "tables" / f"{name}.json").read_text(encoding="utf-8"))
    return {"out": out, "summary": summary, "tables": tables}


def _rows(scan, name):
    return scan["tables"][name]


def test_artifact_and_package_counts(scan):
    s = scan["summary"]
    assert s["artifacts"] == 11
    assert s["errors"] == []
    assert s["graph_problems"] == []
    assert set(s["packages"]) == {"ExampleWater_MeterReads", "ExampleWater_Legacy2008"}
    assert _rows(scan, "estate_scan_log")[0]["n_errors"] == 0


def test_graph_node_and_edge_counts_match_contract(scan):
    graph = json.loads((scan["out"] / "graphs" / "ExampleWater_MeterReads.json").read_text(encoding="utf-8"))
    assert graph["stats"]["nodes"] == 8 + 6
    assert graph["stats"]["edges"] == 5 + 4
    assert validate_graph(graph) == []
    assert graph["schema"] == "migration-studio/estate-graph/v1"
    assert (scan["out"] / "graphs" / "ExampleWater_MeterReads.json").stat().st_size < MAX_BYTES


def test_graph_json_is_valid_for_every_package(scan):
    for pid in scan["summary"]["packages"]:
        graph = json.loads((scan["out"] / "graphs" / f"{pid}.json").read_text(encoding="utf-8"))
        assert validate_graph(graph) == [], pid


def test_no_secret_literal_appears_in_any_output(scan):
    for path in scan["out"].rglob("*"):
        if path.is_file():
            text = path.read_text(encoding="utf-8", errors="replace")
            for literal in SECRET_LITERALS:
                assert literal not in text, f"{literal} leaked into {path.name}"


def test_blocker_map_for_the_shared_job(scan):
    rows = {r["job_name"]: r for r in _rows(scan, "estate_blocker_map")}
    job = rows["EXW01_Meter_Nightly"]
    assert job["datasets_total"] == 2
    assert job["datasets_migrated"] == 1
    assert job["remaining_datasets"] == "METER_READS"
    assert job["blocks_retirement"] is True
    assert job["procedures_called"] == "dbo.usp_Upsert_MeterReads"
    assert job["status_text"] == "1 of 2 datasets migrated; retirement blocked by METER_READS"


def test_tsql_only_job_is_not_reported_as_retireable(scan):
    rows = {r["job_name"]: r for r in _rows(scan, "estate_blocker_map")}
    job = rows["EXW02_Late_Summary"]
    assert job["blocks_retirement"] is True
    assert job["status_text"].startswith("Not confirmed")
    assert job["procedures_called"] == "dbo.usp_Rebuild_Summary"


def test_schedule_strings_and_order_check(scan):
    sched = {r["schedule_name"]: r for r in _rows(scan, "estate_schedules")}
    assert sched["EXW01_Weekday_0812"]["human"] == "Weekly on Mon-Fri at 08:12"
    assert sched["EXW_Daily_2330"]["human"] == "Daily at 23:30"
    wf = [r for r in _rows(scan, "estate_schedules") if r["source_system"] == "databricks_workflow"][0]
    assert wf["start_time"] == "06:22"
    assert "runs before the ingest it reads" in wf["order_flag"]
    assert len(scan["summary"]["order_checks"]) == 1
    assert scan["summary"]["order_checks"][0]["days"] == ["Mon", "Tue", "Wed", "Thu", "Fri"]


def test_dataflows_and_dataset_status(scan):
    flows = _rows(scan, "estate_dataflows")
    stage = {(r["data_flow"], r["destination_table"]): r for r in flows}
    reads = stage[("Xfr - Meter Reads", "dbo.STG_EXW_METER_READS")]
    assert reads["dataset_key"] == "METER_READS" and reads["dataset_status"] == "in_progress"
    devices = stage[("Xfr - Meter Devices", "dbo.STG_EXW_METER_READS_DEVICES")]
    assert devices["dataset_key"] == "METER_READS_DEVICES" and devices["dataset_status"] == "migrated"
    assert len(flows) == 4


def test_refs_and_statement_lineage(scan):
    stmts = {r["owner"]: r for r in _rows(scan, "estate_statements") if r["owner"]}
    upsert = stmts["dbo.usp_Upsert_MeterReads"]
    assert set(upsert["reads"].split(", ")) == {"dbo.STG_EXW_METER_READS", "dbo.REF_UNIT_OF_MEASURE"}
    assert upsert["writes"] == "dbo.FACT_MeterRead"
    rebuild = stmts["dbo.usp_Rebuild_Summary"]
    assert "dbo.usp_Notify" in rebuild["execs"]
    refs = _rows(scan, "estate_refs")
    assert any(r["edge_kind"] == "calls" and r["confidence"] == "regex" for r in refs)
    assert any(r["edge_kind"] == "lakeflow_load" for r in refs)


def test_landing_rules(scan):
    rows = _rows(scan, "estate_landing")
    fed = {r["object_name"] for r in rows if r["landing"] == "federation_bridge"}
    assert fed == {"dbo.DIM_Device", "dbo.REF_UNIT_OF_MEASURE"}
    assert any(r["landing"] == "lakeflow_connect" and r["object_name"] == "dbo.vw_MeterReads_Source" for r in rows)
    assert any(r["landing"] == "databricks_jobs" and r["object_name"] == "EXW01_Meter_Nightly" for r in rows)
    assert any(r["landing"] == "databricks_sql" and r["object_kind"] == "procedure" for r in rows)


def test_package_warning_for_procedure_not_in_code(scan):
    pkgs = {r["package_id"]: r for r in _rows(scan, "estate_packages")}
    assert "usp_Legacy_Report" in pkgs["ExampleWater_Legacy2008"]["warnings"]
    assert pkgs["ExampleWater_MeterReads"]["warnings"] == ""
    assert pkgs["ExampleWater_MeterReads"]["n_error_paths"] == 1


def test_rows_match_table_specs_and_csv_headers(scan):
    for name, spec in TABLE_SPECS.items():
        cols = [c for c, _ in spec]
        for row in _rows(scan, name):
            assert set(row) <= set(cols), (name, set(row) - set(cols))
        with (scan["out"] / "tables" / f"{name}.csv").open(encoding="utf-8") as fh:
            assert next(csv.reader(fh)) == cols


def test_repo_guard_refuses_outputs_inside_the_repo():
    with pytest.raises(OutputInsideRepoError):
        check_out_dir(REPO_ROOT / "tmp-estate-out")
    with pytest.raises(OutputInsideRepoError):
        check_out_dir(REPO_ROOT / "scanner" / "anything")
    assert check_out_dir(Path("/tmp/outside-the-repo")).is_absolute()
