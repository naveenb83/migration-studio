# BUILD PLAN: Migration Studio

Resume file. **Read this first** if a session restarts, then `AGENTS.md`, then your work-package brief in `docs/wp/`.

## Context
- **What:** a Databricks App (AppKit, TypeScript/React) that drives a hands-on SQL Server/SSIS → Databricks migration
  workshop end to end. Every task **starts and ends in the app**:
  1. trace a flow and agree what "correct" means;
  2. convert (Genie Migrate hand-off and import, or a streamed AI draft);
  3. save and run the team's own files;
  4. validate and classify differences;
  5. prove a rule rejects a bad result;
  6. see the legacy estate;
  7. ask Genie;
  8. close with a pilot plan.

  Where the app can't act natively (Genie Migrate is UI only), it deep-links to a pre-permissioned folder and imports the result back.
- **Generic by design.** Customer specifics live in a private **engagement pack** (`pack.json` + files) in a UC volume. This
  repo holds **no customer code, names or people**. Private local context: `local/LOCAL_CONTEXT.md` (git-ignored).
- **When:** built **Mon 23 Nov**; used **Tue 24 Nov** (Australia/Brisbane).
- **Safety net:** the existing workshop kit (notebooks + deck). The app reuses the kit's **own notebooks as its jobs** and the
  **same per-team files and results**. If a page fails, teams switch to the notebook and keep their history.

## Decisions
| Topic | Decision |
|---|---|
| Scope | Full app today; Tier A/B/C cut-line + feature flags; go/no-go per page as a non-admin |
| Repo | Generic app; customer content in the private pack; pre-commit and pre-push denylist hooks |
| Jobs | **Reuse, don't port.** Recheck job = the kit's attendee notebook in `recheck` mode (add a `run_label` widget only). Prove job = the kit's validate-dataset notebook with the team rules config + `vars`. Provisioning = the notebook's guarded `build` mode, run via the CLI today |
| Storage | Per-team (as the kit has it). The app reads results through studio **union views** |
| App state | Delta: 3 append-only tables (`entries`, `events`, `requests`) + `latest_entries` + typed views |
| Approvals | Classification rows + the kit's all-or-nothing classroom toggle (`apply_accepted=true`, `approval_mode=classroom`; results labelled SIMULATED). The app patches no YAML |
| Task 4 | Vetted rule templates → a server-owned `team_rules.recon.yml`; pre-created fault views; clean → PASS, fault → gate FAILED, independent of Task 3 progress. Free-form rule SQL is Tier C |
| Genie Migrate | Hand-off to pre-created `genie_in`/`genie_out` folders + import or paste-in; prepared conversions generated today |
| AI | Streamed single-shot `/api/draft` (Tier B); explanations pre-generated for the baseline; rechecks run with AI off; the agents plugin is Tier C |
| Estate | The one shared package is parsed **offline today** (clean-room scanner) and shipped in the pack; React Flow viewer if it survives the canary, otherwise a tree |
| Security | Jobs run as a least-privilege job SP. View files must be exactly one `CREATE VIEW`. The client never sends table names. One in-flight run per team. Answer key only on the demo prefix |
| Caching | AppKit caches off (defaults would hide partner edits and freeze run status) |

## Verified facts (23 Nov)
- **Genie Migrate:** no API (UI only; Workspace-file input; folder output). T-SQL → DBSQL is GA; SSIS and SQL Server reconcile are private preview.
- **GA:** Genie Conversation API; Lakehouse Federation (SQL Server); Lakeflow Connect (SQL Server).
- **Unverified:** msdb/SSISDB through federation.
- **Golden numbers** (private pack): build baseline, as-built recheck, after fix (classroom) and the Prove matrix.

## Work packages (N = 5 builders + 1 integrator/QA; Naveen owns admin requests and go/no-go)
| WP | Brief | Starts | Tier | Status |
|---|---|---|---|---|
| WP0 Backbone + contracts + canary | `docs/wp/WP0_backbone.md` | 12:30 | A | done (build ws) |
| WP1 Kit jobs + pack + prepared assets | `docs/wp/WP1_kit_jobs.md` | 12:30 | A | done (build ws) |
| WP2 Estate scanner (offline) | `docs/wp/WP2_estate_scanner.md` | 12:30 | B | done |
| WP3 UI: Home, Setup, Task 1, Estate | `docs/wp/WP3_ui_assess_estate.md` | G1 | A/B | done |
| WP4 UI: Task 2 Convert, Task 4 Prove | `docs/wp/WP4_ui_convert_prove.md` | G1 | A | done |
| WP5 UI: Task 3 Validate, Genie, registers, Close, Facilitator | `docs/wp/WP5_ui_validate_genie_fac.md` | G1 | A/B | done |
| WP6 Assistant (agents beta) | `docs/wp/WP6_assistant.md` | after G3, if time | C | not started (Tier C, flag off) |
| WP7 Genie spaces | `docs/wp/WP7_genie_spaces.md` | ~14:30 | A (results) / B | done (3 spaces) |
| WP8 Deploy + rehearsals | `docs/wp/WP8_deploy_rehearsal.md` | canary at G1; full at G3 | A | build ws done; delivery pending |
| QA Integrator | `docs/10_test_plan.md` | G1 | A | e2e 26/26 + browser sweep |

```
WP0 ──┬─▶ WP3 ─┐
WP1 ──┼─▶ WP4 ─┼─▶ QA ─▶ WP8 (rehearsals)
WP2 ──┤  WP5 ─┘
      └─▶ WP7
```

## Gates (AEST, Mon 23 Nov)
| Gate | Time | Must be true | If missed |
|---|---|---|---|
| **G0** | 13:15 | **Confirmed:** delivery workspace + profile, catalog, warehouse, groups, **3 external test users**, job SP. Contracts merged | Keep building in the build workspace; escalate the workspace at once (the app can't reach external attendees without it) |
| **G1** | 14:30 | Backbone merged; **canary app** (every plugin, resource, OBO scope and npm dependency) opened by an **external** test user in the delivery workspace; DDL + union views live | Fix the canary before fanning out; drop any dependency that fails the npm proxy |
| **G2** | 16:30 | All prefixes (teams, `demo`, `rehearsal`) at the build baseline. An app-triggered recheck reproduces `recheck_as_built`. Fix + classroom reproduces `after_fix`. Prove matrix passes. Tier A clickable | Cut to Tier A only |
| **G3** | 18:30 | Feature freeze; anything untested is flagged off | — |
| **G4** | 20:00 | Rehearsal 1 (timed, non-admin; `docs/10_test_plan.md` §4) | Fix Tier A; flag off the rest |
| **G5** | 21:30 | Tagged final deploy + rehearsal 2; after this, only `pack.features` changes | — |
| Doors −75 min | Tue | Playwright smoke + a 10-minute external pass + health green | Fallback card |

If Tier A fails at G4, the app becomes a **read-only scoreboard + Genie**, and teams use the notebooks (same files and results).

## Tiers (page ids: `docs/03_contracts.md` §7)
- **A:**
  - Shell, team context and agenda (`home`).
  - `setup`.
  - `task1` core: code browser, lineage register, rules register, done-when.
  - `task2` Convert.
  - `task3` Validate: KPIs, compare, drawer, classify, classroom toggle.
  - `task4` Prove.
  - `genie_results`.
  - Read-only `facilitator` board.
- **B:** `exercise`, `presenter`, `task1_ssis` (viewer), `task2_diff`, `draft`, `estate`, `estate_timeline`, `findings`, `questions`,
  `close` (+ export), `genie_estate`, `genie_data`.
- **C:** `assistant` (agents beta), `estate_rescan`, `estate_federation`, `confirm_query`, `rules_freeform`, `fac_provision`.

## Status log
- 2026-11-23 11:20: plan agreed with Naveen (full build today; generic repo; Delta state; Genie Migrate hand-off + assistant).
- 2026-11-23 12:36: plan pack rev 2 pushed to the private repo `naveenb83/migration-studio`. Revised after the stress-test review: reuse notebooks as jobs; per-team storage + union views; 3 state tables; Prove on team rules; security fixes; cache off.
- 2026-11-23 13:00–14:40: full build in the BUILD workspace (Naveen: "build on default and run it end to end first").
  - Kit: `run_label` widget; answer-key table no longer written to team schemas; recheck + prove jobs (max_retries 0, no auto-optimisation retry);
    fault views; 5 vetted rule templates; prove matrix verified (clean 5/0; faults 2/3, 3/2, 3/2, 4/1); 4 prefixes provisioned (baseline 10/15/9/0/0 each);
    seed AI explanations (15 per team); prepared examples.
  - App deployed (`migration-studio`): all pages, 9 resources, 3 Genie spaces. Server routes do every read/write (no jobs/files/analytics plugin routes).
    Client libraries are optional deps + prebuilt bundle (Apps npm proxy refused zustand 4.5.7 / yaml 2.9.1).
  - **e2e against the deployed app: 26/26** (`tests/e2e_api.py`): as-built 19/6/9/0/0; fixed + classroom 27/0/5/2/0 (SIMULATED); prove clean → fault gate_rejected
    with the affected key → clean; one-run-per-team guard; save validation; import/paste/prepared; explanations; export; board; health. Genie answers via OBO.
  - Runbook for the next workspace: `docs/12_runbook_new_workspace.md`.
- **NEXT:** pick the delivery workspace, then repeat the runbook there (steps 1–15) with the delivery pack; run the e2e + a non-admin pass.
- **Still needed for delivery:** the delivery workspace profile, attendee group, 3 external test users, facilitator emails, and the least-privilege job service principal (or an admin who can create it).
