"""Scan orchestrator and CLI.

    cd scanner && uv run python -m estate.scan --code-dir <legacy dir> --out <outside the repo> [--pack-json <pack.json>]

Outputs (never inside this repository):
  <out>/graphs/<package_id>.json      one graph per SSIS package
  <out>/tables/estate_*.json|csv      the estate row sets
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import SCANNER_VERSION
from .agent import CALL_RE, parse_agent_script
from .dtsx import parse_dtsx
from .graph import build_graph, validate_graph
from .lineage import Artifact, build_estate
from .sql_refs import analyze_sql
from .util import mask_secrets, read_text, sha256_file, slug
from .writer import write_graph, write_tables
from .yaml_sched import classify_yaml, ingest_schedule, load_yaml, workflow_schedule

REPO_ROOT = Path(__file__).resolve().parents[2]
SKIP_DIRS = {".git", "__pycache__", ".venv", "node_modules"}


class OutputInsideRepoError(RuntimeError):
    pass


def check_out_dir(out: Path) -> Path:
    resolved = out.expanduser().resolve()
    if resolved == REPO_ROOT or REPO_ROOT in resolved.parents:
        raise OutputInsideRepoError(
            f"refusing to write customer outputs inside the migration-studio repo: {resolved}"
        )
    return resolved


def discover(code_dirs: list[Path]) -> list[tuple[Path, Path]]:
    found: list[tuple[Path, Path]] = []
    for root in code_dirs:
        root = root.expanduser().resolve()
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            rel_parts = path.relative_to(root).parts
            if any(part in SKIP_DIRS or part.startswith(".") for part in rel_parts):
                continue
            if path.suffix.lower() in (".dtsx", ".sql", ".yml", ".yaml"):
                found.append((root, path))
    return found


def _side(rel: str) -> str:
    return "target" if "databricks" in rel.lower() else "legacy"


def _sql_kind(defines_kind: str | None) -> str:
    return {
        "VIEW": "sql_view",
        "PROCEDURE": "sql_procedure",
        "PROC": "sql_procedure",
        "FUNCTION": "sql_function",
        "TABLE": "sql_table",
    }.get(defines_kind or "", "sql_script")


def build_artifact(root: Path, path: Path, used_ids: set[str]) -> Artifact | None:
    rel = path.relative_to(root).as_posix()
    side = _side(rel)
    base_id = slug(rel.rsplit(".", 1)[0])
    artifact_id = base_id
    n = 2
    while artifact_id in used_ids:
        artifact_id = f"{base_id}_{n}"
        n += 1
    used_ids.add(artifact_id)
    suffix = path.suffix.lower()
    common = dict(
        artifact_id=artifact_id,
        side=side,
        kind="yaml_other",
        name=path.stem,
        rel_path=rel,
        sha256=sha256_file(path),
        size=path.stat().st_size,
    )
    art = Artifact(**common)
    try:
        if suffix == ".dtsx":
            art.kind = "ssis_package"
            art.package = parse_dtsx(path)
            art.name = art.package.package_name
            art.parse_status = "ok" if not art.package.warnings else "partial"
            art.warnings.extend(art.package.warnings)
        elif suffix == ".sql":
            text = read_text(path)
            art.sql_text = mask_secrets(text)
            if CALL_RE.search(text) and "sp_add_job" in text.lower():
                art.kind = "agent_job_script"
                parsed = parse_agent_script(text, rel)
                art.jobs = parsed["jobs"]
                art.warnings.extend(parsed["warnings"])
                if not art.jobs:
                    art.parse_status = "partial"
                    art.warnings.append("no sp_add_job call found")
            else:
                dialects = ("databricks", "tsql") if side == "target" else ("tsql",)
                art.sql = analyze_sql(text, dialects)
                art.kind = _sql_kind(art.sql.defines_kind)
                art.name = art.sql.defines or path.stem
                art.parse_status = art.sql.parse_status
                if art.sql.error:
                    art.warnings.append(f"sqlglot fallback: {art.sql.error[:160]}")
        elif suffix in (".yml", ".yaml"):
            doc = load_yaml(path)
            kind = classify_yaml(doc)
            if kind == "workflow":
                art.kind = "workflow"
                art.yaml_doc = doc
                art.schedule = workflow_schedule(doc)
                if art.schedule.get("parse_error"):
                    art.warnings.append(f"schedule: {art.schedule['parse_error']}")
            elif kind == "ingest_config":
                art.kind = "ingest_config"
                art.yaml_doc = doc
                art.schedule = ingest_schedule(doc)
            elif kind == "framework_config":
                art.kind = "framework_config"
                art.yaml_doc = doc
            else:
                art.kind = "yaml_other"
                art.parse_status = "skipped"
                return None if side == "legacy" else art
    except Exception as err:  # one bad file must not stop the scan
        art.parse_status = "error"
        art.error = f"{type(err).__name__}: {str(err)[:300]}"
    return art


def run_scan(
    code_dirs: list[Path],
    out_dir: Path,
    dataset_status: dict[str, str] | None = None,
    scan_id: str | None = None,
    stage_prefix: str = "STG",
    dataset_status_source: str = "none",
) -> dict:
    out_dir = check_out_dir(out_dir)
    code_dirs = [Path(d).expanduser().resolve() for d in code_dirs]
    scanned_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    scan_id = scan_id or "scan-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    artifacts: list[Artifact] = []
    used: set[str] = set()
    for root, path in discover(code_dirs):
        art = build_artifact(root, path, used)
        if art is not None:
            artifacts.append(art)

    # package ids: slug of the SSIS package name, unique
    pkg_ids: set[str] = set()
    for art in artifacts:
        if art.package is not None:
            base = slug(art.package.package_name)
            pid, n = base, 2
            while pid in pkg_ids:
                pid, n = f"{base}_{n}", n + 1
            pkg_ids.add(pid)
            art.package_id = pid

    est = build_estate(artifacts, dataset_status or {}, stage_prefix)

    graphs_written: dict[str, Path] = {}
    graph_problems: list[str] = []
    for art in artifacts:
        if art.package is None:
            continue
        graph, size = build_graph(art.package, art.package_id, art.artifact_id)
        problems = validate_graph(graph)
        graph_problems.extend(f"{art.package_id}: {p}" for p in problems)
        art.graph_path = f"graphs/{art.package_id}.json"
        art.graph_bytes = size
        art.truncated_sql = graph["stats"]["truncated_sql"]
        graphs_written[art.package_id] = write_graph(out_dir, art.package_id, graph)

    # Packages rows were built before graph sizes were known: refresh them.
    by_pkg = {a.package_id: a for a in artifacts if a.package_id}
    for row in est.packages:
        a = by_pkg[row["package_id"]]
        row["graph_path"], row["graph_bytes"], row["truncated_sql"] = a.graph_path or "", a.graph_bytes, a.truncated_sql

    n_errors = sum(1 for a in artifacts if a.parse_status == "error") + len(graph_problems)
    n_warnings = sum(len(a.warnings) + (len(a.package.warnings) if a.package else 0) for a in artifacts)
    tables = {
        "estate_scan_log": [
            {
                "scan_id": scan_id,
                "scanned_at": scanned_at,
                "scanner_version": SCANNER_VERSION,
                "code_dirs": " | ".join(d.name for d in code_dirs),
                "n_artifacts": len(artifacts),
                "n_packages": len(pkg_ids),
                "n_jobs": sum(len(a.jobs) for a in artifacts),
                "n_graphs": len(graphs_written),
                "n_errors": n_errors,
                "n_warnings": n_warnings,
                "dataset_status_source": dataset_status_source,
            }
        ],
        "estate_inventory": [
            dict(row, error=next((a.error for a in artifacts if a.artifact_id == row["artifact_id"]), None) or "")
            for row in est.inventory
        ],
        "estate_packages": est.packages,
        "estate_dataflows": est.dataflows,
        "estate_statements": est.statements,
        "estate_refs": est.refs,
        "estate_blocker_map": est.blocker_map,
        "estate_schedules": [{k: v for k, v in row.items() if not k.startswith("_")} for row in est.schedules],
        "estate_landing": est.landing,
    }
    counts = write_tables(out_dir, tables)
    summary = {
        "scan_id": scan_id,
        "out_dir": str(out_dir),
        "artifacts": len(artifacts),
        "packages": {pid: {"graph": str(p), "bytes": p.stat().st_size} for pid, p in graphs_written.items()},
        "table_rows": counts,
        "graph_problems": graph_problems,
        "order_checks": est.order_checks,
        "errors": [f"{a.rel_path}: {a.error}" for a in artifacts if a.parse_status == "error"],
    }
    (out_dir / "scan_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    return summary


def _dataset_status_from_pack(pack_json: Path) -> tuple[dict[str, str], str]:
    doc = json.loads(pack_json.read_text(encoding="utf-8"))
    status = (doc.get("estate") or {}).get("dataset_status") or {}
    return {str(k): str(v) for k, v in status.items()}, f"pack.estate.dataset_status ({pack_json.name})"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline estate scanner (WP2).")
    parser.add_argument("--code-dir", action="append", required=True, help="legacy code folder (repeatable)")
    parser.add_argument("--out", required=True, help="output folder; must be outside the repo")
    parser.add_argument("--pack-json", help="engagement pack.json; reads estate.dataset_status")
    parser.add_argument("--scan-id", help="defaults to scan-<UTC timestamp>")
    parser.add_argument("--stage-prefix", default="STG", help="stage table prefix (default STG)")
    args = parser.parse_args(argv)
    status, source = ({}, "none")
    if args.pack_json:
        status, source = _dataset_status_from_pack(Path(args.pack_json))
    try:
        summary = run_scan(
            [Path(d) for d in args.code_dir],
            Path(args.out),
            dataset_status=status,
            scan_id=args.scan_id,
            stage_prefix=args.stage_prefix,
            dataset_status_source=source,
        )
    except OutputInsideRepoError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 2
    printable = {k: v for k, v in summary.items() if k not in ("order_checks",)}
    printable["order_check_count"] = len(summary["order_checks"])
    print(json.dumps(printable, indent=1, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
