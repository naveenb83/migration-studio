from collections import Counter

import pytest

from estate.dtsx import parse_dtsx

from conftest import FIXTURES

PKG_2012 = FIXTURES / "legacy" / "ssis" / "ExampleWater_MeterReads.dtsx"
PKG_2008 = FIXTURES / "legacy" / "ssis" / "ExampleWater_Legacy2008.dtsx"


@pytest.fixture(scope="module")
def pkg2012():
    return parse_dtsx(PKG_2012)


def test_2012_package_structure(pkg2012):
    assert pkg2012.package_name == "ExampleWater_MeterReads"
    assert pkg2012.format_version == "2012+"
    cats = Counter(e["category"] for e in pkg2012.executables)
    assert cats == {"package": 1, "execute_sql": 4, "container": 1, "data_flow": 2}
    assert len(pkg2012.components) == 6
    assert Counter(c["role"] for c in pkg2012.components) == {"source": 2, "transform": 1, "destination": 3}
    assert len(pkg2012.paths) == 4
    assert sum(p["is_error"] for p in pkg2012.paths) == 1
    assert len(pkg2012.precedence) == 5


def test_precedence_expression_and_value_are_read(pkg2012):
    expr = [p for p in pkg2012.precedence if p["expression"]]
    assert len(expr) == 1
    assert expr[0]["eval_op"] == "expression_and_constraint"
    assert expr[0]["expression"] == "@[User::RowCount] >= 0"
    assert expr[0]["value"] == "success"
    assert expr[0]["scope"] == r"Package\Load Meter Reads"


def test_data_flow_tables_and_sql(pkg2012):
    tables = {c["name"]: c["table"] for c in pkg2012.components if c["table"]}
    assert tables["Read Meters"] == "dbo.vw_MeterReads_Source"
    assert tables["Write Staging"] == "dbo.STG_EXW_METER_READS"
    assert tables["Write Rejects"] == "dbo.EXW_Meter_Reads_Rejects"
    err = [p for p in pkg2012.paths if p["is_error"]][0]
    assert err["from"].endswith("Read Meters")
    assert err["to"].endswith("Write Rejects")


def test_execute_sql_statements_are_captured(pkg2012):
    sqls = {e["name"]: e["sql"] for e in pkg2012.executables if e["category"] == "execute_sql"}
    assert sqls["Run Upsert"].startswith("EXEC [dbo].[usp_Upsert_MeterReads]")
    assert sqls["Log End"].startswith("EXEC ? = [dbo].[usp_ETL_LogEnd]")


def test_connections_and_variables_are_masked(pkg2012):
    conns = {c["name"]: c for c in pkg2012.connections}
    assert "P@ssw0rd-FIXTURE" not in (conns["ExampleSource"]["connection_string"] or "")
    assert "Password=***" in conns["ExampleSource"]["connection_string"]
    assert conns["ExampleSource"]["server"] == "EXAMPLE-SQL-01"
    assert conns["ExampleEDH"]["property_expression"] == "@[User::edh_db_cfg]"
    values = {v["name"]: v["value"] for v in pkg2012.variables}
    assert values["ConnectionPassword"] == "***"
    assert "Secr3t-FIXTURE" not in (values["edh_db_cfg"] or "")
    assert values["RowCount"] == "0"


def test_2008_format_is_parsed():
    pkg = parse_dtsx(PKG_2008)
    assert pkg.format_version == "2008"
    assert pkg.package_name == "ExampleWater_Legacy2008"
    cats = Counter(e["category"] for e in pkg.executables)
    assert cats == {"package": 1, "execute_sql": 1, "data_flow": 1}
    sql = [e for e in pkg.executables if e["category"] == "execute_sql"][0]
    assert sql["sql"] == "EXEC [dbo].[usp_Legacy_Report]"
    assert {c["table"] for c in pkg.components if c["table"]} == {"dbo.LegacyMeters", "dbo.STG_EXW_LEGACY"}
    assert "Legacy-Pw-FIXTURE" not in (pkg.connections[0]["connection_string"] or "")


def test_utf16_bom_gives_same_result(tmp_path, pkg2012):
    raw = PKG_2012.read_text(encoding="utf-8")
    target = tmp_path / "ExampleWater_MeterReads_utf16.dtsx"
    target.write_bytes(raw.encode("utf-16"))
    again = parse_dtsx(target)
    assert again.encoding == "utf-16-bom"
    assert len(again.executables) == len(pkg2012.executables)
    assert len(again.components) == len(pkg2012.components)
    assert len(again.precedence) == len(pkg2012.precedence)
