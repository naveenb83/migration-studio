# Databricks notebook source
# MAGIC %md
# MAGIC ### Migration Studio · scan uploaded legacy code (SSIS packages, T-SQL, Agent scripts, framework YAML)
# MAGIC Triggered by the app ("Your own code" → Scan). Reads one team's upload folder, writes the per-package graph JSON
# MAGIC and estate rows back into that team's folder (`<upload dir>/.scan/`). Parses only: nothing is executed.
# MAGIC The scanner code (and a vendored copy of sqlglot) live in the pack volume under `scanner/`.

# COMMAND ----------
dbutils.widgets.text("pack_volume", "")
dbutils.widgets.text("input_dir", "")
dbutils.widgets.text("out_dir", "")
dbutils.widgets.text("scan_id", "")
dbutils.widgets.text("run_label", "")

# COMMAND ----------
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.dont_write_bytecode = True
pv = dbutils.widgets.get("pack_volume").rstrip("/")
for p in (f"{pv}/scanner/vendor", f"{pv}/scanner"):
    if p not in sys.path:
        sys.path.insert(0, p)
# sqlglot: vendored copy in the pack volume first. lxml: preinstalled on some serverless environment versions only.
missing = []
for mod, spec in (("sqlglot", "sqlglot==30.31.0"), ("lxml", "lxml")):
    try:
        __import__(mod)
    except ImportError:
        missing.append(spec)
if missing:
    print("installing", missing)
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", *missing], check=True)
    import importlib
    importlib.invalidate_caches()
from estate.scan import run_scan

inp, out = dbutils.widgets.get("input_dir").rstrip("/"), dbutils.widgets.get("out_dir").rstrip("/")
assert inp.startswith("/Volumes/") and out.startswith(inp + "/"), "input_dir must be a volume folder and out_dir inside it"
scan_id = dbutils.widgets.get("scan_id") or dbutils.widgets.get("run_label") or "scan"

# Copy only uploaded code files to local disk (skip sidecars, hidden files and previous scan output).
work_in, work_out = Path(tempfile.mkdtemp()), Path(tempfile.mkdtemp())
n = 0
for name in sorted(os.listdir(inp)):
    src = os.path.join(inp, name)
    if name.startswith(".") or name.endswith(".meta.json") or not os.path.isfile(src):
        continue
    shutil.copyfile(src, work_in / name)
    n += 1
print(f"{n} uploaded file(s) to scan from {inp}")
summary = run_scan([work_in], work_out, scan_id=scan_id)

# Replace the previous scan output for this team.
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(work_out, out)
result = {"scan_id": scan_id, "files": n, "packages": sorted(summary.get("packages", {}).keys()),
          "table_rows": summary.get("table_rows", {}), "errors": summary.get("errors", [])[:20]}
print(json.dumps(result, indent=1))
dbutils.notebook.exit(json.dumps(result))
