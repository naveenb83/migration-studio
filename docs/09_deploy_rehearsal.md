# 09 · Deploy, rehearse, go/no-go

## Order of operations (delivery workspace; Naveen's OK required)
1. **Preflight** (`scripts/preflight.sh <profile>`). It checks:
   - auth;
   - Apps enabled;
   - the serving endpoint READY;
   - the warehouse;
   - the catalog (create the studio and results schemas);
   - serverless jobs;
   - Genie available.

   Manual, with a screenshot: Genie Code + Migration Projects toggles, and that external attendee accounts exist and are in the attendee group.
2. **Kit bundle deploy** (`delivery` target) → `scripts/apply_studio_ddl.sh` → `scripts/upload_pack.sh` (private pack).
3. **`estate_scan`** once.
4. **Provision** the demo, rehearsal and every team prefix in parallel. This uses the kit notebook's guarded build mode, then fault views, empty result tables, the union-view refresh and folder publishing (~15 min).
5. **App bundle:** `databricks apps validate` → `databricks apps deploy -t delivery --profile <p>` → note the app SP.
6. **`scripts/grants.sql`** (parameterised by catalog, schemas, SP, attendee group, team groups):
   - **SP:** USE CATALOG; USE SCHEMA + SELECT + MODIFY on studio and results; SELECT on team schemas; READ/WRITE VOLUME; CAN_MANAGE_RUN on the jobs (from bundle resources); CAN_READ on `{root}`.
   - **Attendee group:** app CAN_USE; Genie CAN_RUN; warehouse CAN_USE; SELECT on the Genie space tables.
   - **Team group** (if used): ownership or MANAGE on its own team schemas and views (replacing a view needs ownership or MANAGE); WRITE on its own Workspace output folder.
7. **Genie spaces** (WP7 script) → `apps create-update` with the space ids (merge resources) → re-apply `user_api_scopes`.
8. **Install the customer skill workspace-wide** for Genie Code (admin).
9. **Rehearsal** (`docs/10_test_plan.md` §4) as two non-admin accounts.
10. **Go/no-go per page** → set the flags in `pack.features` → upload → `/api/fac/reload-pack` → print the fallback card.

## Fallback card (page → what to do instead)
| Page | Fallback |
|---|---|
| setup | Facilitator assigns teams on screen; attendees use the kit notebook build output |
| task1 | Workspace input folder + Genie Code chat + lineage CSV template |
| task2 | Kit notebook `recheck` mode; Genie Migrate directly in the workspace; prepared example |
| task3 | Kit notebook scorecard + `check_results` queries |
| task4 | Kit framework notebook + YAML rule; facilitator demonstrates the fault on the demo team |
| genie_* | Genie spaces opened directly in the workspace |
| estate, findings, questions, close | Deck slides + facilitator-led discussion |
| facilitator | Kit notebooks + job UI |

## Morning of the session (07:30)
1. `/api/fac/health` is green.
2. Warm the warehouse: open Home and run one Validate query.
3. Run one recheck per team (scorecard unchanged).
4. Set the agenda to block 0.
5. Open the app on the presenter screen.

## Cost and teardown
- After the session: `databricks apps stop migration-studio --profile <p>`.
- Keep the schemas until the pilot decision.
- The cleanup owner is recorded in the pack.
