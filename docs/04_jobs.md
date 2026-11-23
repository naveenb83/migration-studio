# 04 · Jobs

**Principle: reuse the kit's proven notebooks as job tasks.** They are rehearsed: golden numbers and the gate on the exact run.
The app and the notebook fallback then share the same per-team files and results, so a mid-session fallback loses nothing.

All jobs are serverless and run as a **least-privilege job SP** (`run_as`). Notebook parameters arrive as strings.

| Job (resource key) | Task(s) | Parameters | Writes | Runtime | Concurrency |
|---|---|---|---|---|---|
| `recheck` (`job-recheck`) | the kit's attendee notebook, `mode=recheck` | `catalog, prefix, run_label, apply_accepted, approval_mode=classroom, gate=false, ai_explain=false, framework_dir=""` | the team's target layers; `{prefix}recon.*` | ~4 min | ≥ 8, queue on |
| `prove` (`job-prove`) | the kit's validate-dataset notebook | `catalog, prefix, config=<team_work>/team_rules.recon.yml, vars={…clean or one fault view…}, run_label, gate=true, approval_mode=classroom, results_schema={cat}.{prefix}recon, copy_template=false` | `{prefix}recon.*` | ~2 min | ≥ 8, queue on |
| Provisioning (CLI today) | the attendee notebook, `mode=build` (guarded; seeds team_work) + the fault-view notebook + union-view refresh + folder publish | `catalog, prefix, confirm_rebuild=no` | team schemas; team_work; `genie_in`/`genie_out` | ~12–15 min per prefix; run them in parallel | — |
| `answer_key` (facilitator, CLI) | the kit's apply-fix job, **demo prefix only** | none | demo team | ~3 min | 1 |
| `estate_scan` (optional) | `scanner/job_scan.py` | `pack_volume, code_dirs, scan_id` | `{studio}.estate_*`, graph JSON | ~2 min | 1 |

## App ↔ job contract
1. The server refuses a trigger if the team has a `requests` row for a still-running job (**one in-flight run per team**).
2. `jobs.runNow` (via the AppKit `jobs` plugin, as the app SP with CAN_MANAGE_RUN) → insert `requests(run_label, job_key, job_run_id, kind, params)`.
3. The client polls `/api/jobs/:job_run_id`, which calls the Jobs API directly (not the plugin's cached `getRun`), every 10 s.
4. On termination, read `v_run_log WHERE run_label = :run_label` (retry 3× over 15 s), then map to the UI state (`03_contracts.md` §4).
5. Gate outcome: recheck runs `gate=false` (diagnostic); prove runs `gate=true`. The notebook task fails on FAIL/ERROR **after** saving results. Map a task failure with saved results to `gate_rejected`.

## Fault views (Task 4)
- One view per fault per team, over the team's own tables. Each applies one deterministic mutation: wrong id, wrong value, deleted record, or corrupted consumer value.
- `vars` repoints the placeholders the rule templates use (e.g. `${edh}`, `${cif}`) at a fault view.
- The real team tables are never mutated.
- **Rule templates** are chosen to pass on the as-built candidate, so Task 4 works regardless of Task 3 progress (`pack.recon.expected_scorecards.prove_clean` / `prove_fault`).
