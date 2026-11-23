# AGENTS.md: rules for builder agents

## Read first, in this order
1. `BUILD_PLAN.md` (context, gates, status log)
2. `docs/03_contracts.md` (frozen contracts; do not change them without a contract PR)
3. Your brief in `docs/wp/WPn_*.md`
4. `local/LOCAL_CONTEXT.md` (git-ignored, on the build machine): CLI profiles, catalog, warehouse, path to the private
   workshop kit, golden numbers. **If it is missing, stop and ask Naveen.**

## Load these skills before writing code
- `databricks-core`: CLI, auth, profiles. **Never auto-select a profile.** Always pass `--profile` with the profile named in `LOCAL_CONTEXT.md`.
- `databricks-apps` (AppKit), plus `databricks-app-design` for every data or chat surface.
- `databricks-jobs` and `databricks-dabs` for bundles and jobs. Add `databricks-genie-agents` for Genie spaces.
- The AppKit source of truth is the installed docs: `npx @databricks/appkit docs` (index first, then a section). Plugin
  shapes in training data are stale. Never guess `--set` keys: run `databricks apps manifest --profile <p>`.

## Hard rules
- **No customer content in this repo.** No customer names, people, hosts, workspace or warehouse ids, real code, or
  real file names.
  - Customer specifics live in the private pack (see `LOCAL_CONTEXT.md`).
  - The pre-push hook (`.githooks/pre-push`, enabled with `git config core.hooksPath .githooks`) scans for the
    git-ignored denylist. Never bypass it.
  - Test fixtures are fictional and hand-written. Never copy from third-party archives: the SSIS visualiser archive
    has no licence.
- **The private kit's fallback must keep working.**
  - Kit changes are additive (new jobs and notebooks).
  - Do not change the behaviour of the existing `dist/` notebooks or jobs.
  - Commit to the kit's local git only. It has no remote; never push it anywhere.
- **Honesty in the UI.**
  - Label AI output ("AI draft, check against the code").
  - Label provenance (Genie Migrate / assistant draft / team edit).
  - Label classroom approvals SIMULATED.
  - Never claim the app runs Genie Migrate: it hands off and imports.
- **Run identity.** Gates and pass/fail claims use the exact `run_label`/`run_id`, never "latest".
- **Deploying to the delivery workspace requires Naveen's go-ahead** (WP8). The build workspace is fine for dev deploys.
- **App name:** `migration-studio`; ≤26 characters, lowercase and hyphens.

## Workflow (one work package = one git worktree = one branch = one PR)
- **Branch:** `wp<n>-<slug>` off `main`. If you depend on an unmerged WP, branch off its branch and rebase when it merges.
- **Own your files.** Only touch the files your brief owns (`docs/03_contracts.md` §7). Shared files (registry, routes
  index, `shared/*`) belong to WP0; ask for a contract PR if you need a change.
- **PR checklist:** summary; e2e evidence (command + output, or a screenshot path); Tier and flag; known gaps. Merge when
  e2e is green. Naveen reviews at the end.
- **After merging,** append one line to `BUILD_PLAN.md` → Status log, and set your WP status in the table.
- **Tests:**
  - Python: `uv run pytest` (scanner, contracts).
  - App: `npm run typecheck && npm test`, plus Playwright smoke (`tests/smoke.spec.ts`; update selectors; keep payloads < 1 MB).
  - Databricks: the job e2e in your brief.
- Run `databricks apps validate --profile <p>` before every deploy.

## Known gotchas (each has cost a failed deploy before)
- **Caching.** AppKit caches analytics results (~1 h by default) and `jobs.getRun` (60 s). Disable the cache, and poll the Jobs API directly, or partners won't see each other's edits and run status freezes.
- **typegen DESCRIBEs every query at build time.** Create all tables and views (including union views over the `rehearsal`/`demo` prefixes) before building.
- **Never accept table names or SQL identifiers from the client.** Expand logical names on the server, for the caller's own team.
- **Jobs run as a least-privilege job SP**, never as an admin: team files are executed as SQL. View files must be exactly one `CREATE VIEW`.
- **Only WP8 deploys to the delivery workspace.** One deployer avoids clobbered app config.
- **AppKit `jobs` plugin**
  - Requires `DATABRICKS_JOB_ID` even with named jobs.
  - On `createApp` failure, `process.exit(1)`. The scaffold's `.catch(console.error)` leaves the app RUNNING but serving nothing.
- **Databricks Apps npm proxy** can 404 transitive deps.
  - Install every planned dependency in WP0 and deploy once.
  - If a dependency 404s, vendor its self-contained bundle as a `file:` package. Do **not** name that folder `dist/`, because the scaffold `.gitignore` drops it.
  - Import web workers with `?url` when Vite bundles them.
- **The 120 s proxy timeout is not configurable.** Never hold a request open waiting for a job: `runNow`, then poll `getRun`.
- **Claude Opus on FMAPI** rejects `temperature`, and its reasoning counts against `max_tokens`. Use ~2500+, with only user/assistant roles. Prefer a faster model for single-shot drafts if it's available in the workspace.
- **SQL**
  - `uuid()` is not allowed in `INSERT … VALUES`: generate ids in Node.
  - Stamp naive UTC.
  - A leading `-- comment` breaks some CLI query tools.
- **Bundles:** `mode: development` prefixes resource and schema names. Don't use it for the shared studio or results schemas.
- **Numbers from SQL** can arrive as strings: always `Number(x)`. No `as unknown as T` (lint fails validate).
- **Genie:** `DATABRICKS_GENIE_SPACE_ID` must always be set. Give GenieChat an explicit container height. Clear stale conversation ids after redeploys.
- **OBO scopes** can be wiped by updates: re-apply `user_api_scopes` after `apps create-update`.
- **Use `databricks apps deploy`, not a bare `bundle deploy`.** A bare `bundle deploy` leaves the app stopped.
