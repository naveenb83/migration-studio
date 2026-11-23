#!/usr/bin/env python3
"""Generate sql/refresh_union_views.sql from a pack: studio union views over every team's results schema.

  python3 scripts/gen_union_views.py --pack <pack.json> --catalog <cat> [--studio <schema>] > sql/refresh_union_views.sql

- Teams = pack.teams + pack.demo_team. Each team's results live in {cat}.{prefix}recon (written by the kit notebooks).
- Pre-creates empty run_artifacts / ai_explanations in each recon schema (they only appear after a first recheck /
  explain run, and a missing table would break the union view).
- Explicit column lists: column order differs between schemas created at different times.
"""
import argparse, json

COLS = {
    "run_log": "run_id, run_label, run_ts, entity, n_pass, n_fail, n_warn, n_info, n_error, n_blocking, apply_accepted, approval_mode, config_sha256",
    "check_results": "run_id, run_label, run_ts, entity, level, check_name, description, severity, status, raw_status, metric, raw_metric, "
                     "expect, detail, raw_detail, coverage, sample_rows, accepted_applied, approval_status, approval_mode, approval_id, approved_by, approved_on",
    "mismatch_samples": "run_id, entity, check_name, row_no, sample_json",
    "ai_explanations": "run_id, check_name, category, probable_cause, suggested_fix, confirm_query, endpoint, explained_ts",
    "run_artifacts": "run_id, artifact, path, sha256, executed_as",
}
VIEWS = {"v_run_log": "run_log", "v_check_results": "check_results", "v_mismatch_samples": "mismatch_samples",
         "v_ai_explanations": "ai_explanations", "v_run_artifacts": "run_artifacts"}
COMMENTS = {
    "v_run_log": "One row per validation run, all teams. Filter by team_id; identify a run by run_label, never by the latest run.",
    "v_check_results": "One row per check per run, all teams. status = effective (after accepted differences); raw_status = before. Blocking = FAIL or ERROR.",
    "v_mismatch_samples": "Up to 100 sample offending rows per failing check per run (sample_json).",
    "v_ai_explanations": "AI-generated probable cause and suggested fix per failing check (AI output: check against the code).",
    "v_run_artifacts": "Which team files a recheck executed, with SHA-256 hashes.",
}
PRECREATE = {
    "run_artifacts": "run_id STRING, artifact STRING, path STRING, sha256 STRING, executed_as STRING",
    "ai_explanations": "run_id STRING, check_name STRING, prompt STRING, response STRING, category STRING, probable_cause STRING, "
                       "suggested_fix STRING, confirm_query STRING, explained_ts TIMESTAMP, endpoint STRING",
}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--studio")
    a = ap.parse_args()
    pack = json.load(open(a.pack))
    studio = a.studio or pack["workspace"]["studio_schema"]
    teams = [(t["id"], t["prefix"]) for t in pack["teams"]] + [(pack["demo_team"]["id"], pack["demo_team"]["prefix"])]
    out = []
    for _, p in teams:
        for t, cols in PRECREATE.items():
            out.append(f"CREATE TABLE IF NOT EXISTS {a.catalog}.{p}recon.{t} ({cols});")
    for v, t in VIEWS.items():
        parts = [f"SELECT '{tid}' AS team_id, '{p}' AS target_prefix, {COLS[t]} FROM {a.catalog}.{p}recon.{t}" for tid, p in teams]
        out.append(f"CREATE OR REPLACE VIEW {a.catalog}.{studio}.{v}\nCOMMENT '{COMMENTS[v]}' AS\n" + "\nUNION ALL\n".join(parts) + ";")
    print("\n\n".join(out))
