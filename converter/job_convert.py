# Databricks notebook source
# MAGIC %md
# MAGIC ### Migration Studio · run converted SQL in a sandbox and compare it with legacy
# MAGIC Triggered by the app (Task 2 "Run my files", Task 4 "Prove"). For one team and one labelled run:
# MAGIC 1. reads the run snapshot the app wrote (`<team_dir>/runs/<label>/config.json` + `manifest.json`) and checks each file's SHA-256;
# MAGIC 2. plans every statement (convert_engine): allowlist, names redirected into the team's sandbox, inputs resolved;
# MAGIC 3. runs the plan in a fresh sandbox schema (never writes anywhere else), with the labelled stand-ins and feeds;
# MAGIC 4. matches each converted output to the legacy table it replaces (columns by name, then by their values);
# MAGIC 5. generates the comparison checks and runs the standard validator on them (results → `<prefix>recon`, like every run);
# MAGIC 6. modes: `run` (no gate) · `prove_clean` (gate) · `prove_fault` (gate on a copy with one planted fault) ·
# MAGIC    `prove_edge` (tricky source rows: the legacy logic and the converted code both run on a copy, then compared, gate).
# MAGIC The engine and a vendored sqlglot live in the pack volume (`converter/`, `scanner/vendor`).

# COMMAND ----------
for _w, _d in [("catalog", ""), ("prefix", ""), ("team_dir", ""), ("pack_volume", ""), ("run_label", ""), ("mode", "run"),
               ("fault", ""), ("output_id", ""), ("validator", "")]:
    dbutils.widgets.text(_w, _d)

# COMMAND ----------
import hashlib, json, os, re, string, subprocess, sys, time, traceback
from datetime import datetime, timezone

sys.dont_write_bytecode = True
pv = dbutils.widgets.get("pack_volume").rstrip("/")
for _p in (f"{pv}/scanner/vendor", f"{pv}/scanner", f"{pv}/converter"):
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    import sqlglot  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "sqlglot==30.31.0"], check=True)
import convert_engine as ce

cat, p = dbutils.widgets.get("catalog").strip(), dbutils.widgets.get("prefix").strip()
assert re.fullmatch(r"[a-z][a-z0-9_]*", cat) and re.fullmatch(r"[a-z][a-z0-9_]*_", p), "catalog / prefix"
team_dir = dbutils.widgets.get("team_dir").rstrip("/")
assert team_dir.startswith(f"/Volumes/{cat}/{p}workshop/"), "team_dir must be the team's own volume folder"
label = dbutils.widgets.get("run_label").strip()
assert re.fullmatch(r"[A-Za-z0-9_:.-]{1,160}", label), "run_label"
mode = dbutils.widgets.get("mode").strip() or "run"
assert mode in ("run", "prove_clean", "prove_fault", "prove_edge"), "mode"
fault, fault_output = dbutils.widgets.get("fault").strip(), dbutils.widgets.get("output_id").strip()
validator = dbutils.widgets.get("validator").strip()
run_dir = f"{team_dir}/runs/{label}"
cfg = json.load(open(f"{run_dir}/config.json"))
manifest = json.load(open(f"{run_dir}/manifest.json"))
R = f"{cat}.{p}recon"
report = {"run_label": label, "mode": mode, "started": datetime.now(timezone.utc).isoformat(), "files": [], "prep": [], "feeds": [],
          "outputs": [], "unresolved": [], "edge": None, "fault": None, "validation": None, "errors": []}


def save_report():
    report["finished"] = datetime.now(timezone.utc).isoformat()
    with open(f"{run_dir}/report.json", "w") as f:
        json.dump(report, f, indent=1, default=str)


def qn(fqn):
    return ce.q(fqn)


def sql_rows(stmt):
    return [r.asDict(recursive=True) for r in spark.sql(stmt).collect()]

# COMMAND ----------
# Edge cases: copy the inputs, add the tricky rows, run the LEGACY logic on the copy, and point everything at the copy.
if mode == "prove_edge":
    edge = cfg.get("edge") or {}
    assert edge.get("seed_sql"), "this pack has no edge cases"
    sfx = "edge_"
    remap = {}
    for rs in cfg["read_schemas"]:
        c_, s_ = rs.split(".")
        assert s_.startswith(p), rs
        remap[rs] = f"{c_}.{p}{sfx}{s_[len(p):]}"
    for src, dst in remap.items():
        spark.sql(f"DROP SCHEMA IF EXISTS {qn(dst)} CASCADE")
        spark.sql(f"CREATE SCHEMA {qn(dst)}")
        short = src.split(".")[1][len(p):]
        tables = [r["tableName"] for r in sql_rows(f"SHOW TABLES IN {qn(src)}") if not r.get("isTemporary")]
        keep = tables if short in (edge.get("copy_all") or []) else [t for t in tables if t in ((edge.get("copy_tables") or {}).get(short) or [])]
        for t in keep:
            spark.sql(f"CREATE TABLE {qn(dst + '.' + t)} AS SELECT * FROM {qn(src + '.' + t)}")
    edge_src = remap[next(rs for rs in cfg["read_schemas"] if rs.split(".")[1][len(p):] in (edge.get("copy_all") or []))]

    def run_sql_file(path, vars_):
        text = string.Template(open(path).read()).safe_substitute(vars_)
        n = 0
        for stmt in ce.split_statements(text):   # strings, comments and BEGIN ... END aware
            spark.sql(stmt)
            n += 1
        return n

    seeded = run_sql_file(f"{pv}/{edge['seed_sql']}", {"src": edge_src, "cat": cat, "p": p})
    ran = []
    for step in edge.get("legacy_runner") or []:
        ran.append({"file": step["file"], "statements": run_sql_file(f"{pv}/{step['file']}", {"cat": cat, "p": p + sfx, **(step.get("vars") or {})})})
    report["edge"] = {"schemas": remap, "seed_statements": seeded, "legacy_runner": ran, "explain": edge.get("explain", "")}

    def _swap(v):
        if isinstance(v, str):
            for a, b in remap.items():
                v = v.replace(a + ".", b + ".")
            return v
        if isinstance(v, list):
            return [_swap(x) for x in v]
        if isinstance(v, dict):
            return {k: _swap(x) for k, x in v.items()}
        return v
    old_sb = cfg["sandbox"]
    cfg = {**_swap({k: v for k, v in cfg.items() if k not in ("sandbox", "read_schemas")}),
           "sandbox": old_sb + "_edge", "read_schemas": list(remap.values())}
    for _st in cfg.get("stand_ins") or []:   # older snapshots carry the expanded sandbox name
        _st["sql"] = _st["sql"].replace(old_sb + ".", cfg["sandbox"] + ".")

# COMMAND ----------
# Plan. Known tables = every table in the allowed read schemas (first schema wins on a name clash).
sandbox = cfg["sandbox"]
assert sandbox.startswith(f"{cat}.{p}") and re.search(r"converted(_edge)?$", sandbox), "sandbox name"
known = {}
for rs in cfg["read_schemas"]:
    try:
        for r in sql_rows(f"SHOW TABLES IN {qn(rs)}"):
            known.setdefault(r["tableName"].lower(), f"{rs}.{r['tableName']}")
    except Exception as e:  # noqa: BLE001
        report["errors"].append(f"can't list {rs}: {str(e)[:200]}")

files = []
for f in manifest["files"]:
    raw = open(f["path"], "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != f["sha256"]:
        raise Exception(f"recheck REJECTED: {f['name']} changed after you pressed Run (expected {f['sha256'][:12]}, found {sha[:12]}). Run again.")
    files.append({"name": f["name"], "text": raw.decode("utf-8", "replace"), "path": f["path"], "sha256": sha})
pl = ce.plan(files, cfg, known)
report["unresolved"] = pl["unresolved"]
allowed_schemas = set(cfg["read_schemas"]) | {sandbox}
for s in pl["steps"]:
    if s.status != "run":
        continue
    bad = [v for v in s.resolved.values() if not v.endswith("(stand-in)") and v.rsplit(".", 1)[0] not in allowed_schemas]
    if bad:
        s.status, s.reason = "blocked", f"reads outside the allowed schemas: {', '.join(bad)}"

# COMMAND ----------
# Run: fresh sandbox, stand-ins + prepared tables, then every statement in order; feeds right after their table exists.
spark.sql(f"DROP SCHEMA IF EXISTS {qn(sandbox)} CASCADE")
spark.sql(f"CREATE SCHEMA {qn(sandbox)} COMMENT 'Migration Studio sandbox: converted SQL runs here. Recreated on every run.'")
for x in pl["prep"]:
    item = {"label": x["label"], "name": x["name"], "why": x.get("why", ""), "sql": x["sql"]}
    try:
        spark.sql(x["sql"])
        item["status"] = "ok"
    except Exception as e:  # noqa: BLE001
        item["status"], item["error"] = "failed", str(e).splitlines()[0][:400]
    report["prep"].append(item)
feeds_by_target = {fd["target_name"]: fd for fd in pl["feeds"]}


def run_feed(fd):
    item = {"label": fd["label"], "target": fd["target"], "from": fd["from"], "why": fd.get("why", "")}
    try:
        tcols = [c.name for c in spark.table(qn(fd["target"])).schema]
        fcols = {c.name.lower(): c.name for c in spark.table(qn(fd["from"])).schema}
        common = [c for c in tcols if c.lower() in fcols]
        if common:
            spark.sql(f"INSERT INTO {qn(fd['target'])} ({', '.join(f'`{c}`' for c in common)}) "
                      f"SELECT {', '.join(f'`{fcols[c.lower()]}`' for c in common)} FROM {qn(fd['from'])}")
            item["how"] = f"{len(common)} columns by name"
        elif len(tcols) == len(fcols):
            spark.sql(f"INSERT INTO {qn(fd['target'])} SELECT * FROM {qn(fd['from'])}")
            item["how"] = "by column position (no names in common)"
        else:
            raise Exception("no column names in common and a different number of columns")
        item["rows"] = spark.table(qn(fd["target"])).count()
        item["status"] = "ok"
    except Exception as e:  # noqa: BLE001
        item["status"], item["error"] = "failed", str(e).splitlines()[0][:400]
    report["feeds"].append(item)


by_file = {}
for s in pl["steps"]:
    t0 = time.time()
    if s.status == "run":
        try:
            df = spark.sql(s.sql)
            if s.kind == "query":
                df.limit(1).collect()
            elif s.kind in ("merge", "insert", "update", "delete"):
                try:
                    s.reason = ", ".join(f"{k} {v}" for k, v in df.collect()[0].asDict().items())
                except Exception:  # noqa: BLE001
                    pass
            s.status = "ran"
        except Exception as e:  # noqa: BLE001
            s.status, s.reason = "failed", str(e).splitlines()[0][:500]
        if s.status == "ran" and s.target_name in feeds_by_target and s.kind in ("create_table", "ctas"):
            run_feed(feeds_by_target.pop(s.target_name))
    by_file.setdefault(s.file, []).append({
        "n": s.n, "kind": s.kind, "status": s.status, "reason": s.reason, "target": s.target, "from_procedure": s.from_procedure,
        "reads": s.resolved, "ms": int((time.time() - t0) * 1000), "preview": ce.code_preview(s.original), "sql": s.sql[:20000]})
for f in files:
    report["files"].append({"name": f["name"], "path": f["path"], "sha256": f["sha256"], "steps": by_file.get(f["name"], [])})
save_report()

# COMMAND ----------
# Match each converted output to its legacy table, then generate the checks.
patterns = cfg.get("ignore_columns") or []
overrides = cfg.get("overrides") or {}
nondet = {}
for s in pl["steps"]:
    if s.target_name and s.nondeterministic:
        nondet.setdefault(s.target_name, set()).update(s.nondeterministic)


def schema_of(t):
    return [(f.name, f.dataType.simpleString()) for f in spark.table(qn(t)).schema]


def value_scores(L, lcols, ltypes, C, ccols):
    """Share of each legacy column's non-null values (as a multiset) that a converted column reproduces, after casting
    the converted column to the legacy type. Key-free, so it copes with fan-out and renamed columns."""
    if not lcols or not ccols:
        return {}
    types = sorted({ltypes[l] for l in lcols})
    lstack = ", ".join(f"'{l}', '{ltypes[l]}', CAST(`{l}` AS STRING)" for l in lcols)
    cstack = ", ".join(f"'{c}', '{t}', CAST({ce.to_type(c, None, t)} AS STRING)" for c in ccols for t in types)
    rows = sql_rows(f"""
      WITH lu AS (SELECT col, typ, val, count(*) AS n FROM (SELECT stack({len(lcols)}, {lstack}) AS (col, typ, val) FROM {qn(L)}) WHERE val IS NOT NULL GROUP BY ALL),
           cu AS (SELECT col, typ, val, count(*) AS n FROM (SELECT stack({len(ccols) * len(types)}, {cstack}) AS (col, typ, val) FROM {qn(C)}) WHERE val IS NOT NULL GROUP BY ALL),
           tot AS (SELECT col, sum(n) AS n FROM lu GROUP BY col)
      SELECT lu.col AS l, cu.col AS c, sum(least(lu.n, cu.n)) / max(tot.n) AS score
      FROM lu JOIN cu ON lu.typ = cu.typ AND lu.val = cu.val JOIN tot ON tot.col = lu.col GROUP BY ALL""")
    return {(r["l"], r["c"]): float(r["score"]) for r in rows}


checks = []
tables = {}
for o in cfg["outputs"]:
    oid = ce.safe_name(o["id"])
    conv, found_by = ce.find_output(o, pl, overrides)
    item = {"id": o["id"], "label": o.get("label", o["id"]), "explain": o.get("explain", ""), "legacy_table": o["legacy_table"],
            "converted_object": conv, "found_by": found_by, "columns": [], "keys": [], "ignored_legacy": [], "ignored_converted": [],
            "unmatched_legacy": [], "unmatched_converted": []}
    report["outputs"].append(item)
    try:
        lsch = schema_of(o["legacy_table"])
    except Exception as e:  # noqa: BLE001
        item["error"] = f"legacy table unreadable: {str(e)[:200]}"
        checks.append({"name": f"{oid}_converted_output_found", "level": "L1", "severity": "FAIL", "expect": "== 0",
                       "description": f"{item['label']}: legacy table readable", "sql": f"SELECT 1 AS metric, '{item['error'][:300].replace(chr(39), '')}' AS detail"})
        continue
    if not conv:
        checks.append({"name": f"{oid}_converted_output_found", "level": "L1", "severity": "FAIL", "expect": "== 0",
                       "description": f"{item['label']}: a converted object replaces the legacy {o.get('legacy_object', '')}",
                       "sql": f"SELECT 1 AS metric, 'No converted view or table matches {o.get('legacy_object', '')}: pick one in Validate → Mapping' AS detail"})
        continue
    try:
        csch = schema_of(conv)
    except Exception as e:  # noqa: BLE001
        item["error"] = f"converted object unreadable: {str(e).splitlines()[0][:300]}"
        checks.append({"name": f"{oid}_converted_output_found", "level": "L1", "severity": "FAIL", "expect": "== 0",
                       "description": f"{item['label']}: the converted object can be read",
                       "sql": f"SELECT 1 AS metric, '{item['error'].replace(chr(39), '')}' AS detail"})
        continue
    ltypes = dict(lsch)
    lnames, cnames = [c for c, _ in lsch], [c for c, _ in csch]
    item["ignored_legacy"] = ce.ignored(lnames, patterns)
    item["ignored_converted"] = ce.ignored(cnames, patterns, sorted(nondet.get(conv.rsplit(".", 1)[1], set())))
    lcand = [c for c in lnames if c not in item["ignored_legacy"]]
    ccand = [c for c in cnames if c not in item["ignored_converted"]]
    fixed = (overrides.get("columns") or {}).get(o["id"]) or {}
    matched = ce.name_matches(lcand, ccand, fixed)
    left_l = [l for l in lcand if l not in matched and l not in fixed]
    left_c = [c for c in ccand if c not in {m[0] for m in matched.values()}]
    scores = {}
    try:
        scores = value_scores(o["legacy_table"], left_l, ltypes, conv, left_c)
    except Exception as e:  # noqa: BLE001
        report["errors"].append(f"{o['id']}: value matching failed: {str(e)[:300]}")
    used = set()
    for (l, c), sc in sorted(scores.items(), key=lambda kv: (-kv[1], abs(lcand.index(kv[0][0]) - ccand.index(kv[0][1])))):
        if sc >= 0.6 and l not in matched and c not in used:
            matched[l] = (c, f"by their values ({round(sc * 100)}% of legacy values reproduced)")
            used.add(c)
    ctypes = dict(csch)
    for l in lcand:
        if l in matched:
            c, how = matched[l]
            item["columns"].append({"legacy": l, "converted": c, "how": how, "legacy_type": ltypes[l], "converted_type": ctypes[c],
                                    "key": l in (o.get("key") or [])})
    item["unmatched_legacy"] = [l for l in lcand if l not in matched]
    item["unmatched_converted"] = [c for c in ccand if c not in {m[0] for m in matched.values()}]
    keys = [(x["legacy"], x["converted"]) for x in item["columns"] if x["key"]]
    item["keys"] = [{"legacy": a, "converted": b} for a, b in keys]
    nonkey = [x for x in item["columns"] if not x["key"]]
    tables[f"{oid}_legacy"], tables[f"{oid}_conv"] = o["legacy_table"], conv
    if not item["columns"]:
        checks.append({"name": f"{oid}_columns_matched", "level": "L1", "severity": "FAIL", "expect": "== 0",
                       "description": f"{item['label']}: at least one column matched", "sql": "SELECT 1 AS metric, 'No converted column matches a legacy column: map them in Validate → Mapping' AS detail"})
        continue
    try:
        item["rows"] = {"legacy": spark.table(qn(o["legacy_table"])).count(), "converted": spark.table(qn(conv)).count()}
    except Exception as e:  # noqa: BLE001
        item["rows_error"] = str(e).splitlines()[0][:300]
    checks += ce.compare_checks(o, keys if len(keys) == len(o.get("key") or []) else [], nonkey, ltypes, item["unmatched_legacy"], ctypes)
checks = ce.execution_checks(pl["steps"], report["feeds"], report["prep"]) + checks
save_report()

# COMMAND ----------
# Prove · break it: a copy of one converted output with one planted fault (the gate must reject it).
vars_ = {}
if mode == "prove_fault":
    o = next((x for x in report["outputs"] if x["id"] == fault_output), None) or next((x for x in report["outputs"] if x.get("columns")), None)
    assert o and o.get("columns"), "no compared output to break"
    oid, C = ce.safe_name(o["id"]), o["converted_object"]
    keyc = (o["keys"] or [{"converted": o["columns"][0]["converted"]}])[0]["converted"]
    victim = next((x for x in o["columns"] if not x["key"]), o["columns"][0])
    cols = [c for c, _ in schema_of(C)]
    first = f"(SELECT min(`{keyc}`) FROM {qn(C)})"
    fv = f"{sandbox}.fault_{oid}_{fault or 'wrong_value'}"
    if fault == "missing_row":
        body = f"SELECT * FROM {qn(C)} WHERE NOT (`{keyc}` <=> {first})"
        what = f"removed every row where {keyc} = the smallest key"
    elif fault == "extra_row":
        body = f"SELECT * FROM {qn(C)} UNION ALL (SELECT * FROM {qn(C)} WHERE `{keyc}` <=> {first} LIMIT 1)"
        what = f"added a copy of one row (smallest {keyc})"
    else:
        t = dict(schema_of(C))[victim["converted"]]
        v = f"`{victim['converted']}`"
        alt = (f"{v} + 1" if re.match(r"(tinyint|smallint|int|bigint|float|double|decimal)", t) else
               f"date_add({v}, 1)" if t == "date" else f"{v} + INTERVAL 1 DAY" if t.startswith("timestamp") else
               f"NOT {v}" if t == "boolean" else f"concat(coalesce({v}, ''), ' (changed)')")
        body = "SELECT " + ", ".join(f"CASE WHEN `{keyc}` <=> {first} THEN {alt} ELSE {v} END AS {v}" if c == victim["converted"] else f"`{c}`" for c in cols) + f" FROM {qn(C)}"
        what = f"changed {victim['converted']} on the row(s) with the smallest {keyc}"
    spark.sql(f"CREATE OR REPLACE VIEW {qn(fv)} AS {body}")
    vars_[f"{oid}_conv"] = fv
    report["fault"] = {"output": o["id"], "fault": fault or "wrong_value", "view": fv, "what": what, "column": victim["converted"], "key": keyc}

# COMMAND ----------
recon = {"entity": "converted_vs_legacy", "owner": "Migration Studio", "tables": tables, "checks": checks,
         "ai_context": "A SQL Server -> Databricks SQL conversion: the converted code ran on the same inputs as legacy; each check compares its output with the legacy table."}
cfg_path = f"{run_dir}/compare.recon.yml"
with open(cfg_path, "w") as f:
    f.write(json.dumps(recon, indent=1))   # JSON is valid YAML
gate = mode.startswith("prove")
args = {"config": cfg_path, "catalog": cat, "prefix": p, "vars": json.dumps(vars_) if vars_ else "", "results_schema": R,
        "run_label": label, "gate": "true" if gate else "false", "approval_mode": "production", "ai_explain": "false",
        "apply_accepted": "false", "copy_template": "false", "reset_templates": "false", "framework_dir": ""}
gate_error = None
try:
    dbutils.notebook.run(validator, 1800, args)
except Exception as e:  # noqa: BLE001 - the gate raises inside the validator when a check is FAIL or ERROR
    gate_error = str(e)[:1500]
log = sql_rows(f"SELECT run_id, n_pass, n_fail, n_warn, n_info, n_error, n_blocking FROM {R}.run_log WHERE run_label = '{label}' ORDER BY run_ts DESC LIMIT 1")
report["validation"] = {**(log[0] if log else {}), "gate": gate, "gate_error": gate_error}
if log:
    from pyspark.sql import Row
    spark.sql(f"CREATE TABLE IF NOT EXISTS {R}.run_artifacts (run_id STRING, artifact STRING, path STRING, sha256 STRING, executed_as STRING)")
    rows = [Row(run_id=log[0]["run_id"], artifact=f["name"], path=f["path"], sha256=f["sha256"], executed_as=f"converted SQL in {sandbox}") for f in files]
    if rows:
        spark.createDataFrame(rows).select("run_id", "artifact", "path", "sha256", "executed_as").write.mode("append").saveAsTable(f"{R}.run_artifacts")
save_report()
print(json.dumps({k: report[k] for k in ("validation", "unresolved")}, default=str, indent=1))
if not log:
    raise Exception(f"validation produced no results for {label}: {gate_error or 'unknown error'}")
if gate and int(log[0]["n_blocking"]) > 0:
    raise Exception(f"VALIDATION GATE FAILED for run {log[0]['run_id']}: FAIL={log[0]['n_fail']} ERROR={log[0]['n_error']}")
