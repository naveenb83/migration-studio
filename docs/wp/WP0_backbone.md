# WP0 · Backbone, contracts and canary (Tier A; starts 12:30; merge by G1 14:30)

**Goal:** a deployed skeleton every other WP builds into without touching shared files, plus a **canary** proving
every plugin, resource, OBO scope and npm dependency works for an **external** user in the delivery workspace.

## Inputs
- `docs/03_contracts.md`: implement §1, §3, §4, §6, §7, §8, the route stubs from §10, and the poller + state mapping.
- `pack/pack.schema.json` and `pack/example/pack.json`.
- Profiles, catalog and warehouse from `local/LOCAL_CONTEXT.md`.

## Owns
- `app/` scaffold, `app/shared/*`, `pages/registry.ts`, `components/common/*`, `components/register/*` (the **one generic register**), and `lib/*` (incl. `poll.ts`).
- Server routes: `routes/index.ts`, `routes/me.ts`, `routes/entries.ts`, `routes/events.ts`, `routes/jobs.ts` (poll only).
- `sql/studio_ddl.sql`, `sql/refresh_union_views.sql` (generated from the pack's prefixes).
- Scripts: `scripts/apply_studio_ddl.sh`, `scripts/upload_pack.sh`.
- `databricks.yml` (app bundle), `app/app.yaml`, `app/tests/smoke.spec.ts`.

## Steps
1. **Scaffold.** `databricks apps manifest --profile <p>` → `databricks apps init --name migration-studio --features analytics,jobs,files,genie,serving
   --set … --run none --profile <p>`. Leave agents out: Tier C, added later only if time allows.
2. **Dependencies.**
   - Pin and add **only**: `@xyflow/react`, `elkjs`, `@uiw/react-codemirror`, `@codemirror/lang-sql`, `@codemirror/lang-yaml`, `@codemirror/merge`, `zod`.
   - Deploy once to the build workspace. **Vendor anything the Apps npm proxy 404s now.**
   - Every later dependency needs integrator approval.
3. **Disable caches.** Use `createApp({ … cache: { enabled: false } })` or the installed docs' equivalent; check with `npx @databricks/appkit docs`. Then verify that two browser sessions see each other's writes immediately.
4. **Shared code.** `shared/pack.ts` (Zod), `shared/expand.ts` (server-only template expansion), `shared/ids.ts` (`uuid()`, `runLabel()`), `shared/state.ts` (contracts §4 states).
5. **Server.**
   - Load and validate the pack from `DATABRICKS_VOLUME_PACK`, failing fast with a readable error.
   - `/api/me`: email from `x-forwarded-email` (dev: `DEV_USER_EMAIL`) → `latest_entries` roster → team, prefix, role and facilitator flag, plus features and `pack_public`. **No table names.**
   - `/api/entries` (allow-listed kinds, Zod per kind), `/api/events`, `/api/jobs/:id` (direct Jobs API `getRun`, no plugin cache).
   - Helpers: `statement()` (SQL Statement Execution, named params, as the SP) and `filesSdk()` (Files API as the SP, **only** under `/Volumes/{cat}/{prefix}workshop/team_work/` for the caller's prefix).
   - Fail fast: `createApp(...).catch(e => { console.error(e); process.exit(1) })`.
6. **Client shell.**
   - Nav from the registry, filtered by features and role.
   - Team badge and role chip; the first-visit team/role dialog.
   - Common components, plus the **generic register component**: an editable grid over one entries `kind`, with columns from a schema.
   - A stub page for every page id, showing the pack task text and "coming soon".
7. **DDL.**
   - `sql/studio_ddl.sql`: `entries`, `events`, `requests`, `latest_entries`, typed views.
   - `sql/refresh_union_views.sql`: generated from the pack's team, demo and rehearsal prefixes. It also **creates empty `run_artifacts` and `ai_explanations`** in each team's `recon` schema if missing.
   - Apply both in the build workspace **before** typegen.
8. **Bundle.** `databricks.yml` targets `build` and `delivery`. Declare all §6 resources with permissions and `user_api_scopes: [sql, dashboards.genie]`. Ids are variables.
9. **Canary (G1).**
   - Deploy to the **delivery** workspace with Naveen's OK. Grant CAN_USE to the 3 external test users.
   - Each user opens the app, consents, and sees `/api/me`, one analytics query, one Genie call, one serving call and one Files write to the rehearsal team folder.
   - Record the results in the PR.
10. **Smoke.** `tests/smoke.spec.ts` asserts the title, the nav and the team dialog. Run `databricks apps validate`.

## Done when
- The app is RUNNING in the build workspace, with every stub page and smoke green.
- The canary passes for an external user in the delivery workspace.
- The two-session freshness check passes, proving the cache is off.
