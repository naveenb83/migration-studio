# 01 · Architecture

## Components
| Component | Where | What it does |
|---|---|---|
| **App** `migration-studio` | this repo, `app/` (AppKit, TS/React) | All attendee and facilitator journeys; reads via analytics; writes via `/api/*` |
| **Engagement pack** | private UC volume (`pack.json`, legacy code, skills, prepared examples, graph JSON) | Makes the app customer-specific without code changes |
| **Studio schema** | `{cat}.{studio}` (Delta) | App state (append-only) + estate tables |
| **Results** | `{cat}.{prefix}recon.*` per team (Delta) + studio union views `v_*` | Validation results written by the kit notebooks; the app and Genie read the union views |
| **Team schemas** | `{cat}.{prefix}*` per team | The simulated source, replica, target layers and legacy baseline |
| **Kit bundle** | private workshop kit (local git only) | `recheck` and `prove` jobs (the kit's own proven notebooks as tasks), provisioning via the notebook's guarded build mode, `answer_key` (demo only), validation engine |
| **App bundle** | this repo, `databricks.yml` | The app + the `estate_scan` job + resource bindings |
| **Genie spaces** | workspace | results, estate, data |
| **Serving endpoint** | Foundation Model API (Claude) | Draft-with-AI and the assistant |
| **Genie Migrate** | workspace UI (new tab) | Official SQL conversion; the app prepares inputs and imports outputs |

## Identity and authorization
| Action | Runs as | Why |
|---|---|---|
| Analytics reads (studio, results, team tables) | App SP | Plugin default. Team scoping is enforced by the app (roster → prefix) |
| Writes (`/api/*`) | App SP | Append-only, Zod-validated, parameterised; the roster decides which team you may write for |
| Job triggers | App SP | The AppKit `jobs` plugin has no OBO; the SP holds CAN_MANAGE_RUN |
| Genie chat | **User (OBO)** | Genie respects the user's grants; scope `dashboards.genie` |
| Rule test and confirm queries | **User (OBO)** | User-authored or AI-authored SQL must run with the user's rights; read-only guard as well |
| Files browse/upload | SP for app-managed volumes; `asUser(req)` where UC grants should apply | Files plugin policies: explicit `allowAll` only on team_work/uploads/exports |
| Assistant tool calls | **User (OBO)** | AppKit agents run tools with the caller's token; mutating tools need approval |

Team isolation:
- **Inside the app:** roster-scoped writes.
- **Outside the app** (notebooks, Genie Migrate UI): UC grants per team group, set during provisioning.
- Team prefixes separate names, not permissions. Grants do the isolating.

## Data flow per task (revision 2: per-team storage, shared with the notebook fallback)
1. **Trace**
   - Reads: pack legacy code (files), graph JSON, `estate_*`.
   - Writes: `entries` (lineage_row, rule_decision, task_progress).
2. **Convert**
   - Genie Migrate reads `{root}/teams/{team}/genie_in/` and writes `{root}/teams/{team}/genie_out/`.
   - The app imports or pastes into `/Volumes/{cat}/{prefix}workshop/team_work/drafts/`, then promotes to manifest files.
   - The **recheck job** (the kit's attendee notebook, `mode=recheck`) executes the manifest files and writes `{prefix}recon.*`.
   - The app reads these via the studio union views.
3. **Validate**
   - Reads: `v_run_log`/`v_check_results` by `run_label`.
   - Writes: `entries` (classification, classroom_toggle). The next recheck uses `apply_accepted=true` + `classroom` (results labelled SIMULATED).
4. **Prove**
   - The server generates `team_work/team_rules.recon.yml` from vetted templates.
   - The **prove job** (the kit's validate-dataset notebook) runs it against clean tables or one pre-created fault view.
   - Expected: gate FAILED on the fault `run_label`, PASS when clean.
5. **Estate:** pre-parsed offline today (scanner) → `estate_*` + graph JSON → inventory, blocker map, timeline, and the Genie estate space.
6. **Close:** reads everything above; writes `entries` (closeout_answer, pilot_plan); exports the evidence pack.

## Long-running work
Jobs take 4–15 minutes. Every trigger:
1. returns immediately with `{run_label, job_run_id}`;
2. the client polls a short status route every 10 s;
3. the result is fetched by `run_label`.

No request waits on a job: the 120 s proxy limit applies.

## Environments
| Target | Purpose | Who deploys |
|---|---|---|
| `build` | Internal build workspace: dev, e2e, demo team | Builders |
| `delivery` | The customer-accessible workspace for the session | Only with Naveen's OK (WP8) |
