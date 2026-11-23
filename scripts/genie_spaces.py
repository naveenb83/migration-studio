#!/usr/bin/env python3
"""Create or update the Genie spaces described in a pack (results / estate / data). Idempotent.

  python3 scripts/genie_spaces.py --pack <pack.json> --catalog <cat> --warehouse <id> --profile <p> --state <spaces.json>

`--state` (git-ignored, e.g. local/genie_spaces.<target>.json) maps space key -> space id; existing ids are updated,
missing ones created. Prints the ids for the app bundle variables. Never auto-selects a profile.
"""
import argparse, hashlib, json, os, subprocess

# Generic example SQL for the results space (studio union views; same in every engagement).
RESULTS_EXAMPLES = [
    ("Which checks failed in a team's most recent labelled run?",
     "SELECT r.check_name, r.level, r.status, r.metric, r.expect, r.detail FROM {studio}.v_check_results r "
     "WHERE r.team_id = 'team1' AND r.run_id = (SELECT max_by(run_id, run_ts) FROM {studio}.v_run_log WHERE team_id = 'team1') "
     "AND r.status IN ('FAIL', 'ERROR') ORDER BY r.level, r.check_name"),
    ("How many PASS, FAIL and WARN checks did each team's runs have?",
     "SELECT team_id, run_label, run_ts, n_pass, n_fail, n_warn, n_info, n_error FROM {studio}.v_run_log ORDER BY team_id, run_ts"),
]


def hid(*parts: str) -> str:
    return hashlib.md5("|".join(parts).encode()).hexdigest()


def cli(args: list[str], profile: str) -> dict:
    r = subprocess.run(["databricks", *args, "--profile", profile, "-o", "json"], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"databricks {' '.join(args[:3])} failed: {r.stderr.strip()[:600]}")
    return json.loads(r.stdout or "{}")


def serialized(key: str, sp: dict, cat: str, studio: str) -> str:
    tables = sorted({t.replace("{cat}", cat) for t in sp.get("tables", [])})
    out = {"version": 2,
           "config": {"sample_questions": sorted(({"id": hid(key, "q", q), "question": [q]} for q in sp.get("sample_questions", [])), key=lambda x: x["id"])},
           "data_sources": {"tables": [{"identifier": t} for t in tables]}}
    instr = {}
    if sp.get("instructions"):
        instr["text_instructions"] = [{"id": hid(key, "text"), "content": [sp["instructions"]]}]
    if key == "results":
        instr["example_question_sqls"] = sorted(({"id": hid(key, "sql", q), "question": [q], "sql": [s.format(studio=f"{cat}.{studio}")]} for q, s in RESULTS_EXAMPLES), key=lambda x: x["id"])
    if instr:
        out["instructions"] = instr
    return json.dumps(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--warehouse", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--state", required=True)
    a = ap.parse_args()
    pack = json.load(open(a.pack))
    studio = pack["workspace"]["studio_schema"]
    state = json.load(open(a.state)) if os.path.exists(a.state) else {}
    for key, sp in (pack.get("genie_spaces") or {}).items():
        body = serialized(key, sp, a.catalog, studio)
        if state.get(key):
            cli(["genie", "update-space", state[key], "--serialized-space", body, "--title", sp["title"], "--description", sp.get("description", "")], a.profile)
            print(f"updated {key}: {state[key]}")
        else:
            r = cli(["genie", "create-space", a.warehouse, body, "--title", sp["title"], "--description", sp.get("description", "")], a.profile)
            state[key] = r["space_id"]
            print(f"created {key}: {state[key]}")
    json.dump(state, open(a.state, "w"), indent=2)
    print(json.dumps(state))
