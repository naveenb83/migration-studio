#!/usr/bin/env python3
"""Load the offline estate scan into Unity Catalog as estate_* Delta tables (WP2).

Input is the scanner output folder (the <out> of `python -m estate.scan`), which holds tables/<name>.json.
Every table is created or replaced in {catalog}.{schema}, rows are inserted in batches, and each row count is
checked with SELECT COUNT(*) against the JSON.

  cd scanner && uv run --with databricks-sdk --with lxml --with sqlglot --with pyyaml \
    python ../scripts/load_estate.py --profile <profile> --catalog <catalog> --schema <schema> \
    --warehouse-id <warehouse id> <scan output folder>

--profile and --warehouse-id are required: the script never picks a profile or a warehouse itself.
Add --dry-run to print the plan without connecting.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

SCANNER_DIR = Path(__file__).resolve().parents[1] / "scanner"
sys.path.insert(0, str(SCANNER_DIR))

from estate.tables import TABLE_SPECS  # noqa: E402

IDENT = re.compile(r"^[A-Za-z0-9_]+$")
BATCH_ROWS = 200
BATCH_CHARS = 400_000


def sql_literal(value, sql_type: str) -> str:
    """SQL literal for one value. Strings escape backslash, quote and control characters (Spark string syntax)."""
    if value is None:
        return "NULL"
    if sql_type == "BOOLEAN":
        return "true" if value in (True, "true", "True", 1) else "false"
    if sql_type in ("INT", "BIGINT"):
        try:
            return str(int(value))
        except (TypeError, ValueError):
            return "NULL"
    text = str(value)
    text = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return f"'{text}'"


def insert_statements(fq: str, cols: list[tuple[str, str]], rows: list[dict]) -> list[str]:
    names = ", ".join(c for c, _ in cols)
    out, batch, size = [], [], 0
    for row in rows:
        values = "(" + ", ".join(sql_literal(row.get(c), t) for c, t in cols) + ")"
        if batch and (len(batch) >= BATCH_ROWS or size + len(values) > BATCH_CHARS):
            out.append(f"INSERT INTO {fq} ({names}) VALUES " + ", ".join(batch))
            batch, size = [], 0
        batch.append(values)
        size += len(values)
    if batch:
        out.append(f"INSERT INTO {fq} ({names}) VALUES " + ", ".join(batch))
    return out


def create_statement(fq: str, cols: list[tuple[str, str]]) -> str:
    body = ",\n  ".join(f"{c} {t}" for c, t in cols)
    return f"CREATE OR REPLACE TABLE {fq} (\n  {body}\n) USING DELTA"


class Runner:
    def __init__(self, profile: str, warehouse_id: str):
        from databricks.sdk import WorkspaceClient

        self.w = WorkspaceClient(profile=profile)
        self.warehouse_id = warehouse_id

    def run(self, sql: str):
        from databricks.sdk.service.sql import StatementState

        resp = self.w.statement_execution.execute_statement(
            statement=sql, warehouse_id=self.warehouse_id, wait_timeout="50s"
        )
        while resp.status and resp.status.state in (StatementState.PENDING, StatementState.RUNNING):
            time.sleep(1.5)
            resp = self.w.statement_execution.get_statement(resp.statement_id)
        if resp.status is None or resp.status.state != StatementState.SUCCEEDED:
            message = resp.status.error.message if resp.status and resp.status.error else "unknown error"
            raise RuntimeError(f"statement failed: {message[:400]}")
        return resp


def load_rows(input_dir: Path) -> dict[str, list[dict]]:
    tdir = input_dir / "tables"
    missing = [t for t in TABLE_SPECS if not (tdir / f"{t}.json").exists()]
    if missing:
        raise SystemExit(f"missing {', '.join(missing)} under {tdir}; run the scanner first")
    return {t: json.loads((tdir / f"{t}.json").read_text(encoding="utf-8")) for t in TABLE_SPECS}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load estate_* tables into a Unity Catalog schema.")
    parser.add_argument("input_dir", type=Path, help="scanner output folder (contains tables/)")
    parser.add_argument("--profile", required=True, help="Databricks CLI profile (never auto-selected)")
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--dry-run", action="store_true", help="print the plan; do not connect")
    args = parser.parse_args(argv)

    for label, value in (("catalog", args.catalog), ("schema", args.schema)):
        if not IDENT.match(value):
            parser.error(f"{label} must be letters, digits and underscores only")

    data = load_rows(args.input_dir)
    schema_fq = f"{args.catalog}.{args.schema}"
    if args.dry_run:
        for name, rows in data.items():
            print(f"{schema_fq}.{name}: {len(rows)} rows")
        return 0

    runner = Runner(args.profile, args.warehouse_id)
    runner.run(f"CREATE SCHEMA IF NOT EXISTS {schema_fq}")
    report, failures = [], []
    for name, cols in TABLE_SPECS.items():
        fq = f"{schema_fq}.{name}"
        rows = data[name]
        runner.run(create_statement(fq, cols))
        for stmt in insert_statements(fq, cols, rows):
            runner.run(stmt)
        counted = int(runner.run(f"SELECT COUNT(*) FROM {fq}").result.data_array[0][0])
        report.append((name, len(rows), counted))
        if counted != len(rows):
            failures.append(name)
    for name, expected, counted in report:
        flag = "ok" if counted == expected else "MISMATCH"
        print(f"{schema_fq}.{name}: expected {expected}, counted {counted} [{flag}]")
    if failures:
        print(f"row count mismatch in: {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
