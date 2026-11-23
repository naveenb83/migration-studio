"""Local writer: estate_* row sets as JSON and CSV, and graph JSON per package. Delta writes live in scripts/load_estate.py."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .tables import TABLE_SPECS


def _csv_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def write_tables(out_dir: Path, tables: dict[str, list[dict]]) -> dict[str, int]:
    tdir = out_dir / "tables"
    tdir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for name, rows in tables.items():
        counts[name] = len(rows)
        (tdir / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        cols = [c for c, _ in TABLE_SPECS[name]]
        with (tdir / f"{name}.csv").open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(cols)
            for row in rows:
                writer.writerow([_csv_cell(row.get(c)) for c in cols])
    return counts


def write_graph(out_dir: Path, package_id: str, graph: dict) -> Path:
    gdir = out_dir / "graphs"
    gdir.mkdir(parents=True, exist_ok=True)
    path = gdir / f"{package_id}.json"
    path.write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    return path
