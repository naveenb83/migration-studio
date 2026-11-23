#!/usr/bin/env python3
"""Run SQL statements on a Databricks SQL warehouse through the CLI (`databricks api post`).

Usage:
  scripts/dbsql.py --profile <p> --warehouse <id> -f file.sql [-f more.sql] [--var cat=x --var studio=y]
  scripts/dbsql.py --profile <p> --warehouse <id> -e "SELECT 1"

Statements are split on lines that end with ';' (keep one statement per block). `{name}` placeholders are filled
from --var. Prints a compact result for SELECT-like statements. Never auto-selects a profile.
"""
import argparse, json, subprocess, sys, time


def run(profile: str, warehouse: str, stmt: str, quiet: bool = False):
    body = {"warehouse_id": warehouse, "statement": stmt, "wait_timeout": "50s", "on_wait_timeout": "CONTINUE",
            "format": "JSON_ARRAY", "disposition": "INLINE"}
    out = subprocess.run(["databricks", "api", "post", "/api/2.0/sql/statements", "--profile", profile, "--json",
                          json.dumps(body)], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"CLI error: {out.stderr.strip()[:800]}")
    r = json.loads(out.stdout)
    while r["status"]["state"] in ("PENDING", "RUNNING"):
        time.sleep(2)
        g = subprocess.run(["databricks", "api", "get", f"/api/2.0/sql/statements/{r['statement_id']}", "--profile",
                            profile], capture_output=True, text=True)
        r = json.loads(g.stdout)
    if r["status"]["state"] != "SUCCEEDED":
        err = r["status"].get("error", {}).get("message", r["status"])
        raise SystemExit(f"FAILED: {stmt[:200]}...\n  -> {str(err)[:1200]}")
    cols = [c["name"] for c in r.get("manifest", {}).get("schema", {}).get("columns", [])]
    rows = r.get("result", {}).get("data_array", []) or []
    if not quiet and cols and rows:
        print(" | ".join(cols))
        for row in rows[:200]:
            print(" | ".join("" if v is None else str(v) for v in row))
    return cols, rows


def split(sql: str):
    buf, stmts = [], []
    for line in sql.splitlines():
        if line.strip().startswith("--") and not buf:
            continue  # leading comments break some tools; drop them
        buf.append(line)
        if line.rstrip().endswith(";"):
            s = "\n".join(buf).strip().rstrip(";").strip()
            if s:
                stmts.append(s)
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--warehouse", required=True)
    ap.add_argument("-f", "--file", action="append", default=[])
    ap.add_argument("-e", "--execute", action="append", default=[])
    ap.add_argument("--var", action="append", default=[])
    a = ap.parse_args()
    vars_ = dict(v.split("=", 1) for v in a.var)
    stmts = []
    for f in a.file:
        stmts += split(open(f).read())
    stmts += a.execute
    for s in stmts:
        for k, v in vars_.items():
            s = s.replace("{" + k + "}", v)
        head = " ".join(s.split())[:110]
        t0 = time.time()
        run(a.profile, a.warehouse, s, quiet=False)
        print(f"ok ({time.time() - t0:.1f}s): {head}", file=sys.stderr)
