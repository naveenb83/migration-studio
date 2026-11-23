# WP4 · UI: Task 2 (Convert) and Task 4 (Prove) (Tier A; starts at G1; needs WP1 jobs for e2e)

Read `docs/02_pages.md`, `docs/08_genie_migrate_handoff.md`, `docs/04_jobs.md` and `docs/03_contracts.md` §4 and §10.

## Owns
`pages/task2`, `pages/task4`, `components/editor/*` (CodeMirror 6: SQL + YAML, merge view), `routes/teamfiles.ts`,
`routes/drafts.ts`, `routes/migrate.ts`, `routes/draft.ts`, `routes/recheck.ts`, `routes/prove.ts`, `config/queries/{convert,prove}_*.sql`.

## Task 2: Convert (Tier A; 3-way diff and AI draft are Tier B)
1. **Object picker.** The legacy objects from the pack lanes and `estate`.
2. **Genie Migrate hand-off.**
   - Show the team's `genie_in` and `genie_out` folders and the pack checklist (**select Databricks SQL explicitly**).
   - "Open Genie Migrate" opens `pack.genie_migrate.url` in a new tab.
   - **Import:** list `genie_out` (`/api/genie-migrate/out`) → preview → import to drafts. **Paste-in import** is always available.
   - Provenance: `genie_migrate` or `pasted`.
3. **Prepared example** (fallback). One click copies the prepared conversion into drafts with provenance `prepared_example`. Label it clearly: it is not a live conversion.
4. **AI draft** (Tier B, `draft` flag).
   - `/api/draft` streams a single serving call, with SKILL.md as the system prompt plus the selected file and target.
   - Bounded input; stream to the UI. If there is no first token in 60 s, cancel and suggest the prepared example.
   - Label "AI draft, check against the code".
5. **Editor.**
   - Edit the manifest files (`/api/teamfiles/:name`) and drafts.
   - Server validation per kind. A **view file must be exactly one `CREATE [OR REPLACE] VIEW` statement.** Framework YAML must parse, have its required keys, and use only allowed mechanisms.
   - Show the SHA-256 and provenance after each save. "Promote draft → manifest file" shows a diff preview (merge view; full 3-way is Tier B).
6. **Run my files.**
   - `POST /api/recheck` → `run_label` → poll `/api/jobs/:id` every 10 s.
   - Show the state (`docs/03_contracts.md` §4), then the scorecard summary from `v_run_log` by `run_label`, then the executed files with hashes (`convert_artifacts`). Link to Validate.
   - Show a "another run is in progress for your team" notice when the server refuses a second run.

## Task 4: Prove (Tier A)
1. **Rule builder from templates** (`pack.rule_templates`).
   - Pick 1–3 templates, fill their parameters (column, tolerance), and preview the generated rule YAML read-only.
   - Free-form SQL is Tier C (`rules_freeform`).
2. **Clean run.** `POST /api/prove {template_ids, params, fault_id: null}` → gate result for that exact `run_label` (expect PASS).
3. **Fault run.** Pick a fault from `pack.faults` → `POST /api/prove {…, fault_id}` → **gate FAILED** for that exact `run_label`. Show the failing rule and the affected key from `validate_samples`.
4. **Repair.** Rerun clean → PASS. Then "Run again" shows the same rule present in the next run (`check_results.check_name`).
5. **Swap drivers.** Updates the roster entry and logs an event. Person B repeats the fault with another fault kind.

## Done when (e2e on the `rehearsal` prefix)
1. Import (folder and paste) creates drafts with provenance.
2. Promote → save → recheck shows the `recheck_as_built` counts and the new hash.
3. A second simultaneous recheck is refused.
4. Prove: clean PASS → fault FAILED with the key → clean PASS; the rule is present in two runs.
5. A non-view SQL file is rejected on save.
