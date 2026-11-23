# 12 · Runbook: stand Migration Studio up in a workspace

This is the sequence used to build and test the app end to end in the build workspace. Repeat it for the delivery
workspace. Every id below is a placeholder: real values go in `local/LOCAL_CONTEXT.md` and `app/targets.local.yml`
(both git-ignored). **Always pass `--profile` explicitly. Deploying to the delivery workspace needs the owner's OK.**

`P=<profile>`, `CAT=<catalog>`, `WH=<warehouse id>`, `STUDIO=<studio schema from the pack>`, `KIT=<private kit path>`.
SQL files are run with `python3 scripts/dbsql.py --profile $P --warehouse $WH -f <file> --var cat=$CAT ...`.

| # | Step | How | Check |
|---|---|---|---|
| 1 | Kit notebooks into the workspace | `databricks workspace import <root>/kit/<name> --file $KIT/dist/<name>.py --format SOURCE --language PYTHON --overwrite` for the attendee, validate-dataset and facilitator notebooks | 3 notebooks under `<root>/kit/` |
| 2 | Provision every team prefix (teams, `rehearsal`, `demo`) | `databricks jobs submit --no-wait` one run per prefix: attendee notebook, `mode=build`, `confirm_rebuild=no` (parallel; ~5 min each on serverless) | `run_log` baseline = pack `expected_scorecards.baseline` for every prefix |
| 3 | Fault views (Task 4) | kit `src/sql/app/fault_views.sql` with `--var p=<prefix>` per prefix | 4 views in `<prefix>faults`; each changes exactly one row |
| 4 | Studio schema | `sql/studio_ddl.sql` (`--var studio=$STUDIO`) | tables `entries`, `events`, `requests`; views; volumes `pack`, `exports` |
| 5 | Results union views | `python3 scripts/gen_union_views.py --pack <pack> --catalog $CAT > /tmp/u.sql`, then run it | `SELECT * FROM $STUDIO.v_run_log` lists every team's baseline |
| 6 | Pack volume | upload `pack.json` (the target's pack), `legacy/<code dirs>`, `skills/<skill>/SKILL.md`, `prepared_examples/`, `estate/graphs/` with `databricks fs cp` (create folders with `fs mkdirs` first) | `/api/me` loads; access check "skill present" is green |
| 7 | Genie Migrate folders | per team: `workspace mkdirs <root>/teams/<team>/{genie_in,genie_out}`; import the legacy SQL files into `genie_in` with `--format RAW` (plain workspace files) | access check "Genie Migrate input" shows the file count |
| 8 | Estate tables | `uv run --project scanner python -m estate.scan …` (offline) then `python3 scripts/load_estate.py --profile $P --catalog $CAT --schema $STUDIO --warehouse-id $WH <dir>` | `estate_*` row counts printed by the loader |
| 9 | Jobs | `databricks jobs create --json @$KIT/resources/app_jobs/{recheck,prove}.job.json` (fix the notebook paths first). Keep `max_retries: 0` and `disable_auto_optimization: true`: serverless otherwise retries a deliberate gate failure | an app-labelled recheck on `rehearsal` = `recheck_as_built` |
| 9b | Scan job ("Your own code") | upload `scanner/estate/*.py` to `<pack volume>/scanner/estate/` and a pure-Python sqlglot (`pip download --no-deps sqlglot==30.31.0`, unzip) to `<pack volume>/scanner/vendor/`; import `scanner/job_scan.py` as notebook `<root>/kit/migration_studio_scan`; `databricks jobs create` from `scanner/scan.job.template.json` (fill the placeholders). The job pip-installs `lxml`/`sqlglot` only if the serverless environment lacks them: if PyPI is blocked, check `import lxml` works first | scanning the fictional fixtures returns 2 packages |
| 9c | Genie Code skill | workspace admin: `workspace mkdirs /Workspace/.assistant/skills/<skill>` + `workspace import …/SKILL.md --file <kit skill> --format RAW` (SKILL.md needs `name` + `description` frontmatter) | facilitator health shows "Genie Code skill installed" |
| 10 | Genie spaces | `python3 scripts/genie_spaces.py --pack <pack> --catalog $CAT --warehouse $WH --profile $P --state local/genie_spaces.<target>.json` | 3 space ids printed |
| 11 | App | fill `app/targets.local.yml` from `app/targets.example.yml`; `cd app && npm ci && npm run prebuild:client && databricks apps deploy --profile $P` | "App started successfully"; 9 resources bound; user scopes `sql`, `dashboards.genie`, `serving.serving-endpoints` |
| 12 | Grants for the app SP | `databricks apps get migration-studio` → `service_principal_client_id`; `python3 scripts/gen_grants.py --pack <pack> --catalog $CAT --app-sp <id> > /tmp/g.sql`, run it; give the SP `CAN_READ` on `<root>` | `/api/setup/check` all green as a team member |
| 13 | Attendee access | app `CAN_USE` for the attendee group; Genie runs as the user: `CAN_RUN` on the 3 spaces + `USE CATALOG`/`USE SCHEMA`/`SELECT` on the studio schema and the demo team tables (`gen_grants.py --users-group <group>`); team groups `CAN_EDIT` on their `genie_out` | a non-admin opens Ask Genie and gets an answer |
| 14 | Seed explanations | per prefix, one `jobs submit` of the attendee notebook with `mode=recheck`, `ai_explain=true`, `run_label=seed_explanations_<ts>` (seed runs are hidden from the run list and used only as the explanation fallback) | `v_ai_explanations` has rows for every team |
| 15 | End-to-end | `python3 tests/e2e_api.py --url <app url> --profile $P --team rehearsal --fixed-stage-view <answer key view> --fixed-workflow <answer key workflow> --own-code-dir scanner/tests/fixtures/example_water/legacy` | all checks PASS (as-built, after-fix with SIMULATED approvals, Prove clean → fault → clean, export, board, health) |

After step 15 the rehearsal team holds the fixed files. Re-provision it (`confirm_rebuild=yes`) before the session if you want it back at the start state.

## Gotchas found while building (each cost a deploy)
- The Apps npm proxy refused `zustand@4.5.7` and `yaml@2.9.1`, although the laptop proxy served both. The UI libraries are therefore `optionalDependencies` and the browser bundle ships prebuilt (`client/prebuilt`, built by `npm run prebuild:client`). Server dependencies must be ones the proxy serves (`yaml` is pinned to the version AppKit itself uses). Rebuild the prebuilt bundle after every client change.
- Serverless job tasks with no retry setting are retried once: a Prove gate failure ran twice and wrote duplicate results. Set `max_retries: 0` and `disable_auto_optimization: true`.
- The AppKit `jobs`, `files` and `analytics` plugins expose generic HTTP routes (any job parameter, any volume path, client-chosen query parameters). The app does not register them: every read and write goes through its own routes, scoped to the caller's roster team.
- `getWorkspaceClient()` exported by AppKit is the Lakebase helper; use `getExecutionContext().client` (the app facade) and `.toLegacyWorkspaceClient()` for the Workspace API.
- Genie Code has no API: the app hands off through `<root>/teams/<team>/genie_code/` (copies + README of prompts), links to it, and brings files back with provenance `genie_code`. The app SP needs write access under `<root>/teams` (Genie Migrate `own_code/` copies and the Genie Code folders).
- Serverless environment versions differ: `lxml` was preinstalled in one run and missing in another. The scan job installs what is missing.
- The customer's name can collide with common code words (icon names, libraries): keep denylist patterns specific.
