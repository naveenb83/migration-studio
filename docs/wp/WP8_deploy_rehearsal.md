# WP8 · Deploy to the delivery workspace and rehearse (Tier A; **canary at G1 14:30**, rehearsal 1 at G4 20:00, final at G5 21:30)

**Only one agent deploys** (this WP). Everyone else hands over through merged PRs.

Read `docs/09_deploy_rehearsal.md` and `docs/10_test_plan.md`. **Do not deploy to the delivery workspace without
Naveen's explicit OK.** The profile name comes from `local/LOCAL_CONTEXT.md` and is never auto-selected.

## Steps
1. **Preflight** (`scripts/preflight.sh <profile>`):
   - CLI auth works;
   - Apps are enabled and external users can be granted CAN_USE;
   - the serving endpoint is READY;
   - the warehouse exists;
   - the catalog has managed storage, and you can create the studio and results schemas;
   - serverless jobs run;
   - Genie is available;
   - Genie Code and Migration Projects toggles are on (**manual check, with a screenshot**).
2. **Kit bundle** → deploy (`delivery` target), then run the studio DDL and upload the private pack.
3. **`estate_scan`** → run it once.
4. **Provision** every prefix (demo, rehearsal, teams) **in parallel**: the notebook build mode plus fault views, empty result tables, the union-view refresh and folders. Expect about 15 minutes.
5. **App bundle** → `databricks apps deploy -t delivery --profile <p>`, then `scripts/grants.sql`:
   - SP: USE CATALOG, schema privileges, volume READ/WRITE, Workspace folder access, job CAN_MANAGE_RUN.
   - Attendee group: app CAN_USE, Genie CAN_RUN, warehouse CAN_USE, SELECT on the space tables, and their own team's schemas.
6. **Genie spaces** (WP7 script, delivery profile) → `apps create-update` with the space ids → re-apply the scopes.
7. **Install the workspace-wide skill for Genie Code** (admin, once).
8. **Rehearsal script** (`docs/10_test_plan.md` §4), run as **two non-admin accounts** in one pair.
9. **Go/no-go per page:** set `pack.features` → reload the pack. Print the fallback card (page → kit equivalent).
10. **Tue 07:30:** health green; warm the warehouse; one recheck smoke per team; confirm the agenda is at block 0.

## Done when
The rehearsal script passes for a non-admin pair. Health is green. The fallback card is printed. The status log is updated.
