#!/usr/bin/env python3
"""End-to-end: legacy vs converted, through the DEPLOYED app's own API.
  python3 tests/e2e_convert.py --url https://<app-url> --profile <p> [--team <id>] [--import-all]
      [--fix <draft name>=<local file>] [--skip-prove] [--skip-edge]
Runs as the CLI user. Journey: (optional) Import all from Genie Migrate → list converted files → Run my files
(+ one-run-per-team guard) → report + checks → (optional) edit a file with a fix and run again → Prove: clean,
break it (wrong value, missing row: the gate must reject), edge cases. Nothing here knows the dataset: it reads the
pack's outputs from /api/conversion, so it works for any pack.
"""
import argparse, sys, time
from e2e_api import Api, RESULTS, check, log, wait  # same helpers as the framework e2e


def blocking(s: dict) -> int:
    return int((s.get("run_log") or {}).get("n_blocking", -1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--team", default="")
    ap.add_argument("--import-all", action="store_true")
    ap.add_argument("--fix", action="append", default=[], help="<draft name>=<local file> to save as a team edit before the second run")
    ap.add_argument("--skip-prove", action="store_true")
    ap.add_argument("--skip-edge", action="store_true")
    a = ap.parse_args()
    api = Api(a.url, a.profile)

    st, me = api.call("GET", "/api/me")
    check("session", st == 200 and me, f"user {(me or {}).get('email')}")
    if a.team and (me.get("team") or {}).get("id") != a.team:
        st, _ = api.call("POST", "/api/roster", {"team_id": a.team, "role": "driver"})
        check(f"joined team {a.team}", st == 200)
    st, info = api.call("GET", "/api/conversion")
    check("conversion settings", st == 200 and info and info.get("job_configured"), f"{len((info or {}).get('outputs', []))} outputs · {len((info or {}).get('tables', []))} tables")

    if a.import_all:
        st, r = api.call("POST", "/api/genie-migrate/import-all")
        check("Import all", st == 200 and r and not r.get("failed"), f"{len((r or {}).get('imported', []))} imported, {len((r or {}).get('failed', []))} failed")
    st, files = api.call("GET", "/api/converted")
    running = [f for f in (files or []) if f["include"]]
    check("converted files to run", st == 200 and len(running) > 0, ", ".join(f["name"] for f in running))

    # Run my files + the one-run-per-team guard
    st, run = api.call("POST", "/api/convert-run")
    check("Run my files started", st == 200 and run and run.get("job_run_id"), (run or {}).get("run_label", str(run)))
    st2, _ = api.call("POST", "/api/convert-run")
    check("second run refused while one is running (409)", st2 == 409)
    s = wait(api, run["job_run_id"])
    check("run finished with results", s.get("run_log") is not None, f"state {s.get('state')} · {s.get('run_log')}")
    st, rep = api.call("GET", f"/api/conversion/report/{run['run_label']}")
    ok = st == 200 and rep
    check("run report", ok, f"{sum(len(f['steps']) for f in rep['files'])} statements" if ok else str(rep))
    if ok:
        failed = [f"{f['name']}#{x['n']}: {x['reason'][:80]}" for f in rep["files"] for x in f["steps"] if x["status"] in ("failed", "blocked")]
        check("every converted statement ran", not failed, "; ".join(failed[:4]))
        for o in rep["outputs"]:
            check(f"output '{o['id']}' found and matched", bool(o["converted_object"]) and len(o["columns"]) > 0,
                  f"{o['converted_object']} · {len(o['columns'])} cols · unmatched legacy {o['unmatched_legacy']}")
    st, ch = api.call("GET", f"/api/runs/{run['run_label']}/checks")
    if st == 200:
        bad = [c for c in ch["checks"] if c["status"] != "PASS"]
        log(f"first run: {len(ch['checks'])} checks, {len(bad)} not passing: {', '.join(c['check_name'] for c in bad[:12])}")
        if bad:
            st, smp = api.call("GET", f"/api/runs/{run['run_label']}/samples/{bad[0]['check_name']}")
            check("sample rows for a failing check", st == 200 and isinstance(smp, list) and len(smp) > 0, str((smp or [None])[0])[:160])

    if a.fix:
        for spec in a.fix:
            name, path = spec.split("=", 1)
            st, r = api.call("PUT", f"/api/converted/{name}", {"content": open(path).read()})
            check(f"saved fix to {name}", st == 200 and r and r.get("meta", {}).get("source") == "team_edit")
        st, run2 = api.call("POST", "/api/convert-run")
        s2 = wait(api, run2["job_run_id"])
        check("run after the fix: no blocking checks", blocking(s2) == 0, f"state {s2.get('state')} · {s2.get('run_log')}")

    if not a.skip_prove:
        st, p = api.call("POST", "/api/conversion/prove", {"mode": "clean"})
        sp = wait(api, p["job_run_id"])
        log(f"prove clean: {sp.get('state')} {sp.get('run_log')}")
        check("prove clean has results", sp.get("run_log") is not None, sp.get("state"))
        clean_ok = blocking(sp) == 0
        for fault in ("wrong_value", "missing_row"):
            st, p = api.call("POST", "/api/conversion/prove", {"mode": "fault", "fault": fault})
            sf = wait(api, p["job_run_id"])
            check(f"break it ({fault}): the gate rejects it", sf.get("state") == "gate_rejected" and blocking(sf) > 0, f"{sf.get('state')} · {sf.get('run_log')}")
            st, rep = api.call("GET", f"/api/conversion/report/{p['run_label']}")
            check(f"break it ({fault}): the planted fault is described", st == 200 and rep and rep.get("fault"), str((rep or {}).get("fault"))[:160])
        if not a.skip_edge and info.get("edge"):
            st, p = api.call("POST", "/api/conversion/prove", {"mode": "edge"})
            se = wait(api, p["job_run_id"])
            check("edge cases ran and were compared", se.get("run_log") is not None, f"{se.get('state')} · {se.get('run_log')}")
            st, rep = api.call("GET", f"/api/conversion/report/{p['run_label']}")
            check("edge cases: the legacy logic ran on the copy", st == 200 and rep and rep.get("edge"), str((rep or {}).get("edge"))[:200])
        log(f"clean run {'passed' if clean_ok else 'was rejected'} the gate")

    n_ok = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\n{n_ok}/{len(RESULTS)} checks passed")
    sys.exit(0 if n_ok == len(RESULTS) else 1)
