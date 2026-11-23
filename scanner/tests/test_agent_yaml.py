import pytest

from estate.agent import describe_schedule, parse_agent_script
from estate.util import read_text
from estate.yaml_sched import classify_yaml, load_yaml, parse_quartz, workflow_schedule, ingest_schedule

from conftest import FIXTURES

AGENT = FIXTURES / "legacy" / "agent" / "ExampleWater_nightly_jobs.sql"
DBX = FIXTURES / "example_water_Databricks"


@pytest.fixture(scope="module")
def agent():
    return parse_agent_script(read_text(AGENT), "agent.sql")


def test_jobs_steps_and_package_reference(agent):
    jobs = {j["job_name"]: j for j in agent["jobs"]}
    assert set(jobs) == {"EXW01_Meter_Nightly", "EXW02_Late_Summary"}
    step = jobs["EXW01_Meter_Nightly"]["steps"][0]
    assert step["subsystem"] == "SSIS"
    assert step["package_ref"] == "ExampleWater_MeterReads"
    assert step["package_ref_kind"] == "ssisdb"
    tsql = jobs["EXW02_Late_Summary"]["steps"][0]
    assert tsql["subsystem"] == "TSQL" and tsql["package_ref"] is None


def test_password_parameter_in_step_command_is_masked(agent):
    cmd = agent["jobs"][0]["steps"][0]["command"]
    assert "Pw-FIXTURE-STEP" not in cmd


def test_weekly_mon_to_fri_0812_schedule(agent):
    sched = agent["jobs"][0]["schedules"][0]
    assert sched["human"] == "Weekly on Mon-Fri at 08:12"
    assert sched["weekdays"] == ["Mon", "Tue", "Wed", "Thu", "Fri"]
    assert sched["start_time"] == "08:12"


def test_named_schedule_is_attached_to_job(agent):
    job = {j["job_name"]: j for j in agent["jobs"]}["EXW02_Late_Summary"]
    assert [s["human"] for s in job["schedules"]] == ["Daily at 23:30"]
    assert job["schedules"][0]["start_time"] == "23:30"


def test_describe_schedule_variants():
    assert describe_schedule({"freq_type": "8", "freq_interval": "1"})[0] == "Weekly on Sun at 00:00"
    assert describe_schedule({"freq_type": "8", "freq_interval": "127", "active_start_time": "63000"})[0] == "Weekly on every day at 06:30"
    text, days, start = describe_schedule(
        {"freq_type": "4", "freq_interval": "1", "freq_subday_type": "4", "freq_subday_interval": "15",
         "active_start_time": "60000", "active_end_time": "180000"}
    )
    assert text == "Daily, every 15 minute(s) from 06:00 to 18:00"
    assert start == "06:00"


def test_quartz_parsing():
    wf = parse_quartz("0 22 6 ? * MON-FRI *")
    assert wf["time_local"] == "06:22"
    assert wf["weekdays"] == ["Mon", "Tue", "Wed", "Thu", "Fri"]
    daily = parse_quartz("0 21 7 * * ?")
    assert daily["time_local"] == "07:21" and len(daily["weekdays"]) == 7
    numeric = parse_quartz("0 30 9 ? * 2-6")  # Quartz numbers: 1 = Sunday
    assert numeric["weekdays"] == ["Mon", "Tue", "Wed", "Thu", "Fri"]
    with pytest.raises(ValueError):
        parse_quartz("0 0 ?")


def test_yaml_classification_and_schedules():
    docs = {p.name: load_yaml(p) for p in DBX.iterdir() if p.suffix in (".yml", ".yaml")}
    kinds = {name: classify_yaml(doc) for name, doc in docs.items()}
    assert sorted(kinds.values()) == ["framework_config", "ingest_config", "workflow"]
    wf = [d for n, d in docs.items() if kinds[n] == "workflow"][0]
    sched = workflow_schedule(wf)
    assert sched["time_local"] == "06:22" and sched["timezone"] == "Australia/Brisbane"
    ing = [d for n, d in docs.items() if kinds[n] == "ingest_config"][0]
    assert ingest_schedule(ing)["time_local"] == "07:21"
