"""Lineage, blocker map, landing rules and schedule-order check.

Edges (docs/06): schedules (Agent job -> package), loads (package -> destination table), feeds (source -> package),
calls (package/object -> procedure), reads (table -> object), writes (object -> table), plus framework_load and
lakeflow_load for the Databricks-side configs.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from .dtsx import ParsedPackage
from .sql_refs import PARSED, SqlAnalysis, analyze_sql
from .util import clean_name, mask_secrets, norm_name

LOGGING_PROC_RE = re.compile(r"(?i)etl_log")
STAGE_PREFIX = "STG"
MIGRATED_VALUES = {"migrated"}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@dataclass
class Artifact:
    artifact_id: str
    side: str  # legacy | target
    kind: str  # ssis_package | agent_job_script | sql_view | sql_procedure | sql_function | sql_table | sql_script | sql_unknown | workflow | ingest_config | framework_config | yaml_other
    name: str
    rel_path: str
    sha256: str
    size: int
    parse_status: str = "ok"  # ok | partial | regex | error | skipped
    error: str | None = None
    warnings: list[str] = field(default_factory=list)
    package: ParsedPackage | None = None
    package_id: str | None = None
    jobs: list[dict] = field(default_factory=list)
    sql: SqlAnalysis | None = None
    sql_text: str = ""
    yaml_doc: dict | None = None
    schedule: dict | None = None
    graph_path: str | None = None
    graph_bytes: int = 0
    truncated_sql: int = 0


@dataclass
class Estate:
    inventory: list[dict] = field(default_factory=list)
    packages: list[dict] = field(default_factory=list)
    dataflows: list[dict] = field(default_factory=list)
    statements: list[dict] = field(default_factory=list)
    refs: list[dict] = field(default_factory=list)
    blocker_map: list[dict] = field(default_factory=list)
    schedules: list[dict] = field(default_factory=list)
    landing: list[dict] = field(default_factory=list)
    order_checks: list[dict] = field(default_factory=list)
    dataset_map: dict[str, str | None] = field(default_factory=dict)


def match_dataset(table: str | None, keys: list[str]) -> str | None:
    """Map a destination table to a pack dataset key (longest key contained in the table name)."""
    if not table or not keys:
        return None
    upper = table.replace("[", "").replace("]", "").upper()
    hits = [k for k in keys if k.upper() in upper]
    return max(hits, key=len) if hits else None


def _join(items) -> str:
    seen, out = set(), []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return ", ".join(out)


def _days_overlap(a: list[str], b: list[str]) -> list[str]:
    return [d for d in WEEKDAYS if d in a and d in b]


def _stage_key(text: str) -> str | None:
    m = re.search(r"([a-z0-9]+_to_[a-z0-9]+)", (text or "").lower())
    return m.group(1) if m else None


def _edge(est: Estate, kind: str, src: str, dst: str, side: str, confidence: str, artifact_id: str, note: str = "") -> None:
    est.refs.append(
        {
            "edge_id": f"e{len(est.refs) + 1:05d}",
            "edge_kind": kind,
            "src": src,
            "dst": dst,
            "side": side,
            "confidence": confidence,
            "artifact_id": artifact_id,
            "note": note,
        }
    )


def build_estate(
    artifacts: list[Artifact],
    dataset_status: dict[str, str] | None = None,
    stage_prefix: str = STAGE_PREFIX,
) -> Estate:
    est = Estate()
    status = dataset_status or {}
    keys = list(status.keys())
    pkgs = [a for a in artifacts if a.package is not None]
    pkg_by_name = {a.package.package_name.lower(): a for a in pkgs}
    defined = {norm_name(a.sql.defines) for a in artifacts if a.sql and a.sql.defines}

    # ---- packages: data flows, SQL statements, edges
    pkg_calls: dict[str, list[str]] = defaultdict(list)
    pkg_loads: dict[str, list[str]] = defaultdict(list)
    for a in pkgs:
        p = a.package
        pid = a.package_id
        comps_by_df: dict[str, list[dict]] = defaultdict(list)
        for c in p.components:
            comps_by_df[c["data_flow"]].append(c)
        analyses: dict[str, SqlAnalysis] = {}
        for blob in p.sql_blobs:
            an = analyze_sql(blob["text"], ("tsql",))
            analyses[blob["owner"]] = an
            est.statements.append(
                {
                    "artifact_id": a.artifact_id,
                    "package_id": pid,
                    "owner": blob["label"],
                    "owner_kind": blob["owner_kind"],
                    "parse_status": an.parse_status,
                    "sql_text": mask_secrets(blob["text"]),
                    "reads": _join(r.name for r in an.reads),
                    "writes": _join(r.name for r in an.writes),
                    "execs": _join(r.name for r in an.execs),
                    "error": an.error,
                }
            )
            for r in an.execs:
                pkg_calls[pid].append(r.name)
                _edge(est, "calls", pid, r.name, "legacy", r.confidence, a.artifact_id, blob["label"])
            for r in an.writes:
                _edge(est, "writes", pid, r.name, "legacy", r.confidence, a.artifact_id, blob["label"])
            for r in an.reads:
                _edge(est, "reads", r.name, pid, "legacy", r.confidence, a.artifact_id, blob["label"])

        for e in p.executables:
            if e["category"] != "data_flow":
                continue
            comps = comps_by_df.get(e["id"], [])
            dests = [c for c in comps if c["role"] == "destination"]
            sources = [c for c in comps if c["role"] == "source"]
            source_labels = [c["table"] or "(sql command)" for c in sources]
            for c in sources:
                if c["table"]:
                    _edge(est, "feeds", c["table"], pid, "legacy", PARSED, a.artifact_id, e["name"])
            if not dests:
                est.dataflows.append(_dataflow_row(pid, e["name"], None, keys, status, source_labels, len(comps), stage_prefix))
                continue
            for d in dests:
                dest = d["table"] or clean_name(d["name"])
                pkg_loads[pid].append(dest)
                _edge(est, "loads", pid, dest, "legacy", PARSED, a.artifact_id, e["name"])
                est.dataflows.append(_dataflow_row(pid, e["name"], dest, keys, status, source_labels, len(comps), stage_prefix))
                est.dataset_map[dest] = match_dataset(dest, keys)
        # Command transforms (per-row SQL) are already covered by their blob analyses above.

    # ---- SQL objects (views, procedures, functions, tables, scripts) on both sides
    for a in artifacts:
        if a.sql is None or a.package is not None:
            continue
        obj = a.sql.defines or a.name
        est.statements.append(
            {
                "artifact_id": a.artifact_id,
                "package_id": None,
                "owner": obj,
                "owner_kind": a.kind,
                "parse_status": a.sql.parse_status,
                "sql_text": mask_secrets(a.sql_text),
                "reads": _join(r.name for r in a.sql.reads),
                "writes": _join(r.name for r in a.sql.writes),
                "execs": _join(r.name for r in a.sql.execs),
                "error": a.sql.error,
            }
        )
        for r in a.sql.reads:
            _edge(est, "reads", r.name, obj, a.side, r.confidence, a.artifact_id)
        for r in a.sql.writes:
            _edge(est, "writes", obj, r.name, a.side, r.confidence, a.artifact_id)
        for r in a.sql.execs:
            _edge(est, "calls", obj, r.name, a.side, r.confidence, a.artifact_id)

    # ---- Agent jobs -> packages (and T-SQL steps -> procedures)
    job_rows: list[dict] = []
    for a in artifacts:
        for job in a.jobs:
            pkg_ids = []
            tsql_procs: list[str] = []
            for step in job["steps"]:
                if (step.get("subsystem") or "").upper() == "TSQL" and step.get("command"):
                    tsql_procs.extend(r.name for r in analyze_sql(step["command"], ("tsql",)).execs)
                ref = step.get("package_ref")
                if not ref:
                    continue
                target = pkg_by_name.get(ref.lower())
                if target is None:
                    _edge(est, "schedules", job["job_name"], f"unresolved:{ref}", a.side, "regex", a.artifact_id, "package not in scan")
                    a.warnings.append(f"Job '{job['job_name']}' runs package '{ref}', which is not in the scan")
                else:
                    pkg_ids.append(target.package_id)
                    _edge(est, "schedules", job["job_name"], target.package_id, a.side, "regex", a.artifact_id)
            job_rows.append({"job": job, "packages": pkg_ids, "artifact": a, "tsql_procs": tsql_procs})

    # ---- Blocker map (legacy jobs, plus packages that no job schedules)
    scheduled_pkgs = {pid for row in job_rows for pid in row["packages"]}
    for row in job_rows:
        est.blocker_map.append(
            _blocker_row(row["job"]["job_name"], _sched_text(row["job"]), row["packages"], pkg_loads, pkg_calls, status, keys, row["tsql_procs"])
        )
    for a in pkgs:
        if a.package_id not in scheduled_pkgs:
            est.blocker_map.append(_blocker_row("(not scheduled)", "", [a.package_id], pkg_loads, pkg_calls, status, keys))

    # ---- Procedures called by legacy packages that are not defined anywhere in the scanned code
    for a in pkgs:
        for n in dict.fromkeys(pkg_calls.get(a.package_id, [])):
            if LOGGING_PROC_RE.search(n) or norm_name(n) in defined:
                continue
            a.package.warnings.append(f"calls procedure '{clean_name(n)}', which is not in the scanned code")

    # ---- Schedules (SQL Agent, Databricks workflows, Lakeflow ingest configs)
    for row in job_rows:
        job, a = row["job"], row["artifact"]
        for s in job["schedules"]:
            est.schedules.append(
                {
                    "source_system": "sql_agent",
                    "schedule_name": s.get("name") or job["job_name"],
                    "job_name": job["job_name"],
                    "human": s.get("human"),
                    "weekdays": _join(s.get("weekdays") or []),
                    "start_time": s.get("start_time"),
                    "timezone": "server local (not recorded)",
                    "enabled": bool(s.get("enabled", True)),
                    "tasks": _join(row["packages"]),
                    "order_flag": "",
                    "artifact_id": a.artifact_id,
                    "_days": s.get("weekdays") or [],
                    "_time": s.get("start_time") or "",
                }
            )

    workflows = [a for a in artifacts if a.kind == "workflow" and a.schedule]
    ingests = [a for a in artifacts if a.kind == "ingest_config" and a.schedule]
    for a in workflows + ingests:
        sch = a.schedule
        task_names = [t.get("name") for t in (a.yaml_doc or {}).get("jobs", [])] if a.kind == "workflow" else [t.get("name") for t in (a.yaml_doc or {}).get("tables", [])]
        est.schedules.append(
            {
                "source_system": "databricks_workflow" if a.kind == "workflow" else "lakeflow_connect",
                "schedule_name": a.name,
                "job_name": a.name,
                "human": sch.get("human") or sch.get("cron"),
                "weekdays": _join(sch.get("weekdays") or []),
                "start_time": sch.get("time_local"),
                "timezone": sch.get("timezone") or "not stated in config",
                "enabled": (sch.get("pause_status") or "UNPAUSED") != "PAUSED",
                "tasks": _join(t for t in task_names if t),
                "order_flag": "",
                "artifact_id": a.artifact_id,
                "_days": sch.get("weekdays") or [],
                "_time": sch.get("time_local") or "",
            }
        )

    # ---- Schedule order: a curation workflow that reads an ingest's tables must not run before that ingest
    _order_checks(est, artifacts, workflows, ingests)

    # ---- Framework / Lakeflow config edges (Databricks side)
    for a in artifacts:
        if a.kind == "framework_config" and a.yaml_doc:
            for t in a.yaml_doc.get("tables", []):
                if t.get("source_view_name") and t.get("target_table"):
                    _edge(est, "framework_load", t["source_view_name"], t["target_table"], a.side, PARSED, a.artifact_id)
        if a.kind == "ingest_config" and a.yaml_doc:
            dest_schema = a.yaml_doc.get("destination_schema") or ""
            src_schema = a.yaml_doc.get("source_schema") or ""
            for t in a.yaml_doc.get("tables", []):
                name = t.get("name")
                if not name:
                    continue
                _edge(
                    est,
                    "lakeflow_load",
                    f"{src_schema}.{name}".strip("."),
                    f"{dest_schema}.{name}".strip("."),
                    a.side,
                    PARSED,
                    a.artifact_id,
                )

    # ---- Landing rules (legacy artifacts; Databricks-side ingest configs are already Lakeflow)
    # A table the scanned code writes is curated in scope, so it is never a legacy read that stays behind.
    written = {norm_name(e["dst"]) for e in est.refs if e["edge_kind"] in ("writes", "loads")}
    _landing(est, artifacts, pkgs, defined | written, stage_prefix)

    # ---- Inventory and package rows
    _inventory_and_packages(est, artifacts, pkg_loads, pkg_calls, job_rows)
    return est


def _dataflow_row(pid, df_name, dest, keys, status, sources, n_comps, stage_prefix):
    dataset = match_dataset(dest, keys) if dest else None
    stage = bool(dest) and norm_name(dest).upper().startswith(stage_prefix.upper())
    return {
        "package_id": pid,
        "data_flow": df_name,
        "destination_table": dest or "",
        "dataset_key": dataset or "",
        "dataset_status": status.get(dataset, "") if dataset else "",
        "sources": _join(sources),
        "stage": stage,
        "landing": "lakeflow_connect" if stage else "review",
        "n_components": n_comps,
    }


def _sched_text(job: dict) -> str:
    return "; ".join(s.get("human") or "" for s in job.get("schedules", []))


def _blocker_row(job_name, schedule_text, pkg_ids, pkg_loads, pkg_calls, status, keys, extra_procs=()):
    tables = []
    for pid in pkg_ids:
        tables.extend(pkg_loads.get(pid, []))
    datasets, unmapped = [], []
    for t in tables:
        k = match_dataset(t, keys)
        if k:
            datasets.append(k)
        else:
            unmapped.append(f"unmapped:{clean_name(t)}")
    datasets = list(dict.fromkeys(datasets))
    migrated = [d for d in datasets if status.get(d, "") in MIGRATED_VALUES]
    remaining = [d for d in datasets if d not in migrated] + unmapped
    procs = list(extra_procs)
    for pid in pkg_ids:
        procs.extend(n for n in pkg_calls.get(pid, []) if not LOGGING_PROC_RE.search(n))
    total = len(datasets) + len(unmapped)
    if total == 0:
        # Conservative: nothing in the scan proves what this job loads, so it must not look retireable.
        text = "Not confirmed: no SSIS data flow found for this job; review its steps before retiring it"
        blocks = True
    elif not remaining:
        text = f"All {total} datasets migrated; this job can retire"
        blocks = False
    else:
        text = f"{len(migrated)} of {total} datasets migrated; retirement blocked by {_join(remaining)}"
        blocks = True
    return {
        "job_name": job_name,
        "schedule_text": schedule_text,
        "packages": _join(pkg_ids),
        "datasets_loaded": _join(datasets + unmapped),
        "datasets_total": total,
        "datasets_migrated": len(migrated),
        "datasets_remaining": len(remaining),
        "remaining_datasets": _join(remaining),
        "procedures_called": _join(clean_name(p) for p in dict.fromkeys(procs)),
        "blocks_retirement": blocks,
        "status_text": text,
    }


def _order_checks(est: Estate, artifacts, workflows, ingests) -> None:
    """Flag a curation workflow that reads an ingest's tables but is scheduled to start before that ingest."""
    view_reads: dict[str, set[tuple[str, str]]] = {}
    for a in artifacts:
        if a.sql and a.sql.defines:
            keys = set()
            for r in a.sql.reads:
                parts = [p.strip("[] ").lower() for p in r.name.split(".")]
                if len(parts) == 2:
                    keys.add((parts[0], parts[1]))
            view_reads[a.sql.defines.lower()] = keys
    ingest_tables = []
    for ing in ingests:
        schema = (ing.yaml_doc or {}).get("destination_schema", "").lower()
        names = {(schema, t.get("name", "").lower()) for t in (ing.yaml_doc or {}).get("tables", []) if t.get("name")}
        ingest_tables.append((ing, names))
    for wf in workflows:
        wf_doc = wf.yaml_doc or {}
        for task in wf_doc.get("jobs", []):
            tname = task.get("name", "")
            key = _stage_key(tname)
            for cfg in (a for a in artifacts if a.kind == "framework_config" and key and _stage_key(a.name) == key):
                for t in (cfg.yaml_doc or {}).get("tables", []):
                    view = (t.get("source_view_name") or "").lower()
                    reads = view_reads.get(view, set())
                    for ing, names in ingest_tables:
                        hit = reads & names
                        if hit and wf.schedule and ing.schedule:
                            _record_order(est, wf, ing, tname, sorted(f"{s}.{n}" for s, n in hit))


def _record_order(est: Estate, wf: Artifact, ing: Artifact, job_name: str, tables: list[str]) -> None:
    wf_days, ing_days = wf.schedule.get("weekdays") or [], ing.schedule.get("weekdays") or []
    overlap = _days_overlap(wf_days, ing_days)
    wf_t, ing_t = wf.schedule.get("time_local") or "", ing.schedule.get("time_local") or ""
    if not overlap or not wf_t or not ing_t or wf_t >= ing_t:
        return
    text = (
        f"review: '{job_name}' ({wf.schedule.get('human')}) runs before the ingest it reads "
        f"('{ing.name}', {ing.schedule.get('human')}) on {', '.join(overlap)}; reads {', '.join(tables)}"
    )
    est.order_checks.append({"workflow": wf.name, "ingest": ing.name, "days": overlap, "tables": tables, "text": text})
    for row in est.schedules:
        if row["artifact_id"] == wf.artifact_id and row["source_system"] == "databricks_workflow":
            row["order_flag"] = _join([row["order_flag"], text])
        if row["artifact_id"] == ing.artifact_id and row["source_system"] == "lakeflow_connect":
            row["order_flag"] = _join([row["order_flag"], f"feeds '{wf.name}', which runs earlier on the same days"])


def _landing(est: Estate, artifacts, pkgs, defined, stage_prefix) -> None:
    seen = set()

    def add(obj, kind, side, landing, reason, artifact_id, pkg_id=""):
        key = (obj, landing, artifact_id)
        if key in seen or not obj:
            return
        seen.add(key)
        est.landing.append(
            {"object_name": obj, "object_kind": kind, "side": side, "landing": landing, "reason": reason, "artifact_id": artifact_id, "package_id": pkg_id or ""}
        )

    for a in pkgs:
        p = a.package
        comps_by_df = defaultdict(list)
        for c in p.components:
            comps_by_df[c["data_flow"]].append(c)
        for e in p.executables:
            if e["category"] != "data_flow":
                continue
            comps = comps_by_df.get(e["id"], [])
            dests = [c for c in comps if c["role"] == "destination"]
            is_stage = any(norm_name(c["table"] or c["name"]).upper().startswith(stage_prefix.upper()) for c in dests)
            for c in comps:
                if c["role"] != "source":
                    continue
                obj = c["table"] or f"sql command in '{c['name']}'"
                kind = "source_table" if c["table"] else "source_query"
                if is_stage:
                    add(obj, kind, "legacy", "lakeflow_connect", f"Source-to-stage data flow '{e['name']}'", a.artifact_id, a.package_id)
            for d in dests:
                if not is_stage:
                    add(d["table"] or d["name"], "curated_target", "legacy", "review", f"Data flow '{e['name']}' writes a non-stage table", a.artifact_id, a.package_id)

    for a in artifacts:
        if a.side != "legacy":
            continue
        if a.jobs:
            for job in a.jobs:
                add(job["job_name"], "sql_agent_job", "legacy", "databricks_jobs", "SQL Agent schedule", a.artifact_id)
        if a.sql is None or a.package is not None:
            continue
        obj = a.sql.defines or a.name
        if a.kind in ("sql_view", "sql_procedure", "sql_function"):
            add(obj, a.kind.replace("sql_", ""), "legacy", "databricks_sql", "View, procedure or function moves to Databricks SQL", a.artifact_id)
            if a.kind == "sql_procedure":
                for r in a.sql.reads:
                    if norm_name(r.name) not in defined:
                        add(clean_name(r.name), "legacy_read", "legacy", "federation_bridge", f"Read by legacy procedure '{obj}'; not in scanned code, stays on the legacy source until migrated", a.artifact_id)
        elif a.kind == "sql_table":
            if obj and norm_name(obj).upper().startswith(stage_prefix.upper()):
                add(obj, "stage_table", "legacy", "lakeflow_connect", "Stage table loaded by a source-to-stage data flow", a.artifact_id)
            else:
                add(obj, "table", "legacy", "review", "Table definition with no clear landing", a.artifact_id)

    for a in artifacts:
        if a.kind == "ingest_config" and a.yaml_doc:
            for t in a.yaml_doc.get("tables", []):
                if t.get("name"):
                    add(t["name"], "ingest_table", "target", "lakeflow_connect", "Already configured as a Lakeflow Connect ingest", a.artifact_id)


def _inventory_and_packages(est: Estate, artifacts, pkg_loads, pkg_calls, job_rows) -> None:
    job_names_by_pkg: dict[str, list[str]] = defaultdict(list)
    for row in job_rows:
        for pid in row["packages"]:
            job_names_by_pkg[pid].append(row["job"]["job_name"])
    stmts_by_artifact: dict[str, list[dict]] = defaultdict(list)
    for s in est.statements:
        stmts_by_artifact[s["artifact_id"]].append(s)

    for a in artifacts:
        p = a.package
        if a.sql is not None:
            n_reads, n_writes, n_execs = len(a.sql.reads), len(a.sql.writes), len(a.sql.execs)
        else:
            n_reads = n_writes = n_execs = 0
        est.inventory.append(
            {
                "artifact_id": a.artifact_id,
                "side": a.side,
                "kind": a.kind,
                "name": a.name,
                "package_id": a.package_id or "",
                "rel_path": a.rel_path,
                "sha256": a.sha256,
                "bytes": a.size,
                "format_version": p.format_version if p else "",
                "parse_status": a.parse_status,
                "n_executables": len(p.executables) if p else 0,
                "n_data_flows": sum(1 for e in p.executables if e["category"] == "data_flow") if p else 0,
                "n_components": len(p.components) if p else 0,
                "n_sql": len(stmts_by_artifact[a.artifact_id]),
                "n_reads": n_reads,
                "n_writes": n_writes,
                "n_execs": n_execs,
                "schedule_text": "; ".join(s.get("human") or "" for j in a.jobs for s in j["schedules"]) or (a.schedule or {}).get("human") or "",
                "n_warnings": len(a.warnings) + (len(p.warnings) if p else 0),
                "warnings": " | ".join((a.warnings + (p.warnings if p else []))[:5])[:500],
            }
        )

    for a in pkgs_of(artifacts):
        p = a.package
        n_error = sum(1 for x in p.paths if x["is_error"])
        est.packages.append(
            {
                "package_id": a.package_id,
                "package_name": p.package_name,
                "rel_path": a.rel_path,
                "format_version": p.format_version,
                "encoding": p.encoding,
                "n_executables": len(p.executables),
                "n_data_flows": sum(1 for e in p.executables if e["category"] == "data_flow"),
                "n_components": len(p.components),
                "n_paths": len(p.paths),
                "n_error_paths": n_error,
                "n_precedence": len(p.precedence),
                "n_connections": len(p.connections),
                "n_variables": len(p.variables),
                "n_sql": len(p.sql_blobs),
                "scheduled_by": _join(job_names_by_pkg.get(a.package_id, [])),
                "graph_path": a.graph_path or "",
                "graph_bytes": a.graph_bytes,
                "truncated_sql": a.truncated_sql,
                "warnings": " | ".join(p.warnings[:5])[:500],
            }
        )


def pkgs_of(artifacts):
    return [a for a in artifacts if a.package is not None]
