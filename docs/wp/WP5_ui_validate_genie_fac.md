# WP5 · UI: Task 3 (Validate), Ask Genie, registers, Close, Facilitator board (starts at G1)

Read `docs/02_pages.md` and `docs/05_genie_and_assistant.md`.

## Owns
`pages/task3`, `pages/genie`, `pages/findings`, `pages/questions`, `pages/close`, `pages/facilitator`,
`routes/classroom.ts`, `routes/export.ts`, `routes/fac.ts`, `config/queries/{validate,registers,close,fac}_*.sql`.

## Steps
1. **Task 3: Validate** (Tier A)
   - **Run picker:** the team's labelled runs (`validate_runs` over `v_run_log`) with kind and time. The build baseline is listed first.
   - **Scorecard:**
     - KPIs PASS/FAIL/WARN/INFO/ERROR, equal to `v_run_log` for that `run_label`.
     - A by-level bar (L0–L6).
     - Compare two runs (baseline vs selected), showing the change per check.
   - **Checks table** with status chips; raw vs effective shown, with SIMULATED badges when the classroom toggle applied.
   - **Drawer per check:** description, metric vs expect, detail, coverage, sample rows (`validate_samples`, max 100), and the explanation (`validate_explanation`; baseline explanations are pre-generated) with AiBadge.
   - **Classification** per non-PASS check: defect / agreed redesign / inherited data quality / open question, plus owner and evidence. Written as `entries` kind `classification`. **The partner sees it at once** (cache off).
   - **Classroom toggle** (`/api/classroom`): enabled only when every check the pack marks as a redesign check is classified as `redesign`. Turning it on makes the next recheck use `apply_accepted=true` + `classroom`. Results are labelled SIMULATED and the raw results stay visible.
   - **Done-when:** every non-PASS check in the selected run is classified, with an owner.
   - "Run confirm query" is Tier C (`confirm_query`). Until then, show the query as copyable text.
2. **Ask Genie** (results Tier A; estate and data Tier B)
   - `GenieChat` with a `spaces` map and switcher; explicit container height.
   - Show the generated SQL, the "Genie can be wrong" note and the pack sample questions.
   - Clear stale conversations on a new build version.
3. **Findings and Questions** (Tier B). The generic register component over `finding_decision` and `question_answer` entries, plus CSV export.
4. **Close** (Tier B)
   - Five close-out answers + owners (register); the pilot planner (register).
   - Time per step (`v_time_per_step`) against the current-method estimate.
   - **Export:** `/api/export` builds markdown + CSV (lineage, rules, files with hashes, run labels with counts, classifications, Prove runs, open questions) and saves a copy to exports.
5. **Facilitator board** (Tier A, read-only)
   - Per team: last activity, current task, last run state + counts, gate result, blocking count.
   - Agenda control: set the current block and a broadcast message (`entries` kind `agenda`).
   - Health: warehouse, serving endpoint, Genie spaces, jobs, pack, union views.
   - Provision and reset are CLI-only today (Tier C buttons).

## Done when (e2e on `rehearsal`)
1. KPIs equal `v_run_log` for the selected run.
2. The compare shows the expected FAIL drop between the baseline and the after-fix run.
3. The drawer shows samples and the explanation.
4. A classification saved by user 1 appears for user 2 in under 5 s.
5. The toggle unlocks only after the redesign checks are classified.
6. Genie answers a sample question as an external user.
7. The board shows the rehearsal team.
8. The export contains the run labels and hashes.
