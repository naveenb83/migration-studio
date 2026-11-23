#!/usr/bin/env python3
"""End-to-end journey against a DEPLOYED Migration Studio, through its own API (docs/10_test_plan.md).

  python3 tests/e2e_api.py --url https://<app-url> --profile <p> --team rehearsal \
      --fixed-stage-view <path> --fixed-workflow <path> [--skip-prove] [--skip-fix]

Runs as the CLI user (bearer token from `databricks auth token`). Uses only app routes, so it proves the same paths
attendees use: save validation, Genie Migrate paste import, prepared example, recheck (+ one-run-per-team guard),
classification -> classroom unlock -> fixed files -> after_fix, the Prove matrix (clean -> fault -> clean),
explanations, export, facilitator board/health. Expected numbers come from the pack (expected_scorecards).
"""
import argparse, json, subprocess, sys, time, urllib.error, urllib.request

T0 = time.time()
RESULTS: list[tuple[str, bool, str]] = []


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    log(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    return ok


class Api:
    def __init__(self, url: str, profile: str):
        self.url, self.profile, self.tok, self.tok_at = url.rstrip("/"), profile, "", 0.0

    def token(self) -> str:
        if time.time() - self.tok_at > 1500:
            out = subprocess.run(["databricks", "auth", "token", "--profile", self.profile, "-o", "json"], capture_output=True, text=True, check=True)
            self.tok, self.tok_at = json.loads(out.stdout)["access_token"], time.time()
        return self.tok

    def call(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.url + path, data=data, method=method,
                                     headers={"Authorization": f"Bearer {self.token()}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"null")
            except Exception:
                return e.code, None


def wait(api: Api, job_run_id: int, limit_s: int = 1500) -> dict:
    t = time.time()
    while time.time() - t < limit_s:
        st, s = api.call("GET", f"/api/jobs/{job_run_id}")
        if st == 200 and s["state"] not in ("queued", "running"):
            return s
        time.sleep(15)
    return {"state": "timeout"}


def counts(s: dict) -> tuple:
    r = s.get("run_log") or {}
    return tuple(int(r.get(k, -1)) for k in ("n_pass", "n_fail", "n_warn", "n_info", "n_error"))


def exp(pack: dict, key: str):
    e = (pack.get("recon", {}).get("expected_scorecards") or {}).get(key)
    return tuple(e[k] for k in ("pass", "fail", "warn", "info", "error")) if e else None


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--team", default="rehearsal")
    ap.add_argument("--fixed-stage-view")
    ap.add_argument("--fixed-workflow")
    ap.add_argument("--skip-prove", action="store_true")
    ap.add_argument("--skip-fix", action="store_true")
    a = ap.parse_args()
    api = Api(a.url, a.profile)

    st, me = api.call("POST", "/api/roster", {"team_id": a.team, "role": "driver"})
    st, me = api.call("GET", "/api/me")
    check("me: on the test team", st == 200 and (me.get("team") or {}).get("id") == a.team, f"{me.get('email')} -> {(me.get('team') or {}).get('id')}")
    pack = me["pack"]
    manifest = {m["artifact"]: m["file"] for m in pack["manifest"]}

    # Save validation: a view file must be exactly one CREATE VIEW
    st, r = api.call("PUT", f"/api/teamfiles/{manifest['stage_view']}", {"content": "SELECT 1; DROP TABLE x", "source": "team_edit"})
    check("save: non-view SQL rejected", st == 422, str(r)[:120])
    st, r = api.call("POST", "/api/genie-migrate/import", {"name": "e2e_pasted.sql", "pasted_sql": "CREATE OR REPLACE VIEW v AS SELECT 1 AS x"})
    st2, drafts = api.call("GET", "/api/drafts")
    pasted = [d for d in (drafts or []) if d["name"] == "e2e_pasted.sql"]
    check("import: paste-in creates a draft with provenance", st == 200 and bool(pasted) and (pasted[0].get("meta") or {}).get("source") == "pasted")
    st, tree = api.call("GET", "/api/pack/tree?dir=prepared_examples")
    if st == 200 and tree:
        st, r = api.call("POST", "/api/prepared", {"name": tree[0]["path"].split("/")[-1]})
        check("prepared example copied to drafts", st == 200, str(r)[:100])

    # Recheck of the as-built files + one-run-per-team guard
    st, rc = api.call("POST", "/api/recheck", {})
    check("recheck: started", st == 200, rc.get("run_label", str(rc))[:120] if isinstance(rc, dict) else str(rc))
    st2, again = api.call("POST", "/api/recheck", {})
    check("recheck: second concurrent run refused (409)", st2 == 409, str(again)[:120])
    s1 = wait(api, rc["job_run_id"])
    want = exp(pack, "recheck_as_built")
    check("recheck: as-built counts", counts(s1) == want, f"{s1.get('state')} {counts(s1)} want {want}")
    st, arts = api.call("GET", f"/api/runs/{rc['run_label']}/artifacts")
    check("recheck: executed files recorded with SHA-256", st == 200 and len(arts) >= 6 and all(len(x["sha256"]) == 64 for x in arts), f"{len(arts or [])} files")
    st, chk = api.call("GET", f"/api/runs/{rc['run_label']}/checks")
    fails = [c for c in chk["checks"] if c["status"] in ("FAIL", "WARN")]
    st, ex = api.call("GET", f"/api/runs/{rc['run_label']}/explanation/{fails[0]['check_name']}") if fails else (0, None)
    check("validate: explanation available for a failing check", st == 200 and bool(ex) and bool(ex.get("probable_cause")), f"from_baseline={ex.get('from_baseline') if ex else None}")
    st, sm = api.call("GET", f"/api/runs/{rc['run_label']}/samples/{fails[0]['check_name']}") if fails else (0, None)
    check("validate: sample rows for a failing check", st == 200 and isinstance(sm, list), f"{len(sm or [])} rows")

    if not a.skip_fix and a.fixed_stage_view and a.fixed_workflow:
        # Classify the redesign checks -> unlock the classroom toggle
        for name in pack["recon"].get("redesign_checks", []):
            api.call("POST", "/api/entries", {"kind": "classification", "entry_key": name, "payload": {"class": "redesign", "owner": "e2e business owner", "evidence": "grain change agreed", "run_label": rc["run_label"]}})
        st, cl = api.call("GET", "/api/classroom")
        check("classroom: unlocked after redesign checks classified", st == 200 and cl.get("unlocked") is True, f"missing={cl.get('missing')}")
        st, cl = api.call("POST", "/api/classroom", {"on": True})
        check("classroom: toggle on", st == 200 and cl.get("on") is True)
        st, r1 = api.call("PUT", f"/api/teamfiles/{manifest['stage_view']}", {"content": open(a.fixed_stage_view).read(), "source": "team_edit"})
        st2, r2 = api.call("PUT", f"/api/teamfiles/{manifest['workflow_yaml']}", {"content": open(a.fixed_workflow).read(), "source": "team_edit"})
        check("fix: corrected files saved", st == 200 and st2 == 200, f"{str(r1)[:80]} {str(r2)[:80]}")
        st, rc2 = api.call("POST", "/api/recheck", {})
        check("recheck 2: started with classroom approvals", st == 200 and rc2.get("apply_accepted") is True, rc2.get("run_label", ""))
        s2 = wait(api, rc2["job_run_id"])
        want = exp(pack, "after_fix")
        check("recheck 2: after-fix counts (SIMULATED approvals)", counts(s2) == want, f"{s2.get('state')} {counts(s2)} want {want}")
        st, cmp_ = api.call("GET", f"/api/compare?a=baseline_as_built&b={rc2['run_label']}")
        fixed = [c for c in (cmp_ or []) if c["status_a"] in ("FAIL", "ERROR") and c["status_b"] not in ("FAIL", "ERROR")]
        check("compare: baseline failures cleared in the fixed run", st == 200 and len(fixed) > 0, f"{len(fixed)} checks no longer failing")

    if not a.skip_prove:
        tids = [t["id"] for t in pack.get("rule_templates", [])]
        fault = "water_depth"
        for step, fid, want_state in (("clean", None, "passed"), ("fault", fault, "gate_rejected"), ("repair", None, "passed")):
            st, pr = api.call("POST", "/api/prove", {"template_ids": tids, "params": {}, "fault_id": fid})
            if not check(f"prove {step}: started", st == 200, (pr or {}).get("run_label", str(pr))[:100] if isinstance(pr, dict) else str(pr)):
                continue
            s = wait(api, pr["job_run_id"])
            want = exp(pack, "prove_clean" if fid is None else f"prove_fault_{fid}")
            check(f"prove {step}: {want_state}", s.get("state") == want_state and (want is None or counts(s) == want), f"{s.get('state')} {counts(s)} want {want}")
            if fid:
                st, ck = api.call("GET", f"/api/runs/{pr['run_label']}/checks")
                failing = [c["check_name"] for c in ck.get("checks", []) if c["status"] == "FAIL"]
                st, sm = api.call("GET", f"/api/runs/{pr['run_label']}/samples/{failing[0]}") if failing else (0, [])
                check("prove fault: failing rule shows the affected key", bool(failing) and bool(sm), f"{failing} {str((sm or [None])[0])[:120]}")

    st, ex = api.call("GET", "/api/export")
    check("export: evidence pack has run labels and hashes", st == 200 and "baseline_as_built" in ex.get("markdown", "") and "SHA-256" in ex.get("markdown", ""), f"saved={ex.get('saved') if isinstance(ex, dict) else None}")
    st, board = api.call("GET", "/api/fac/board")
    check("facilitator: board lists the test team", st == 200 and any(b["team_id"] == a.team for b in board))
    st, health = api.call("GET", "/api/fac/health")
    bad = [h["name"] for h in (health or []) if not h["ok"]]
    check("facilitator: health all green", st == 200 and not bad, f"not ok: {bad}")

    n_ok = sum(1 for _, ok, _ in RESULTS if ok)
    log(f"SUMMARY {n_ok}/{len(RESULTS)} passed")
    sys.exit(0 if n_ok == len(RESULTS) else 1)
