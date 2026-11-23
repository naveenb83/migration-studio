# WP7 · Genie spaces (results Tier A; estate and data Tier B; starts when WP1 and WP2 tables exist)

Read `docs/05_genie_and_assistant.md` and load the `databricks-genie-agents` skill.

## Owns
`genie/spaces.py` (or `.sh`): an idempotent setup script that reads `pack.genie_spaces` and calls
`databricks genie create-space`/`update-space` with the serialized space. `genie/benchmarks.md` holds the results evidence (committed to the private kit, not here, if it contains customer data).

## Steps
1. For each space (results, estate, data), build the serialized space:
   - tables, expanded from the pack;
   - instructions;
   - sample questions;
   - benchmark questions with expected SQL, where the pack gives them.
2. Create or update each space with the warehouse id. Put the space ids into the app bundle variables (`genie_space_id`, `genie_space_estate_id`, `genie_space_data_id`), then run `databricks apps create-update` with merged resources, and re-apply the user scopes.
3. Grants for **OBO** (each attendee's own identity):
   - CAN_RUN on the spaces;
   - CAN_USE on the warehouse;
   - SELECT on the tables in each space (studio schema views, the results schema, the estate tables, the demo team's data tables).

   Put these grants in `scripts/grants.sql` (shared with WP8).
4. Run the benchmarks as a **non-admin** test user and record pass/fail.

## Space contents
| Space | Tables | Purpose |
|---|---|---|
| **results** | `{studio}.v_check_results`, `v_run_log`, `v_ai_explanations`, `v_run_artifacts`, `v_classifications`, `requests` | "What failed in our last labelled run and why?" |
| **estate** | `{studio}.estate_*`, `latest_findings_decisions`, `latest_rule_decisions` | "What does the shared package load? What blocks retiring it? Which objects land on Lakeflow Connect?" |
| **data** | the demo team's legacy table, new core fact and consumer view, from `pack.dataset.tables` | "Legacy vs new counts by status." The instructions explain the grain change |

Federated foreign tables can be added to the data space in a real engagement (`docs/07`). In the workshop they're emulated.

## Done when (e2e)
The three spaces exist; the app's GenieChat switches between them; and at least 4/5 benchmark questions per space
answer correctly as a non-admin user.
