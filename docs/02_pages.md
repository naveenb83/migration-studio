# 02 · Pages (mapped to the customer deck, with acceptance criteria)

Conventions for every page (use the `databricks-app-design` skill):
- A page title plus the pack's kicker line.
- Loading, empty and error states are always present.
- AI output carries an `AiBadge`. Provenance chips: seed / team edit / Genie Migrate / assistant draft / prepared example.
- Status colours are semantic: PASS green, FAIL red, WARN amber, INFO grey, ERROR purple. SIMULATED approvals get a dashed outline.
- Task pages show the pack's **steps**, **done when** and **watch for**, then the working area.

| Page id | Deck section | Tier | Acceptance criteria |
|---|---|---|---|
| `home` | Title, Why we're here, The day | A | Four outcomes with live measures. The current block and countdown match `current_agenda`. The team status card shows the last labelled run with its counts |
| `presenter` | Narrative slides | B | Full-screen sections from the pack; arrow keys move between them; the facilitator only |
| `setup` | How you'll work | A | Each user picks a team and role. The access check runs 4 probes and records them; a failure shows the fallback text. Swap drivers is logged |
| `exercise` | The exercise; three comparison layers; what we use today | B | The legacy and new lanes render from the pack. Layer cards show live pass counts for the team's selected run. The tools panel shows the status labels |
| `task1` | Task 1: trace one flow and agree "correct" | A | Code browser (the SSIS viewer is `task1_ssis`, Tier B); lineage worksheet saves rows; rules form saves decisions with business-owner sign-off; shared-package panel shows the blocker row; done-when auto-ticks; "Mark done" writes progress |
| `task1_ssis` (viewer incl. data flow) | (same) | B | Data-flow diagrams per data-flow task, with error paths and component details |
| `task2` | Task 2: convert, review, save and run | A | Hand-off panel (folders, steps, open link). Import lists the output folder and saves drafts with provenance. Draft with AI works or falls back. The editor validates and saves with SHA. Run my files shows status → run id → executed SHA list |
| `task2_diff` | (same) | B | 3-way diff of the legacy, Genie Migrate and team files, with "promote" |
| `task3` | Task 3: find what's wrong and what's just different | A | Run picker (labelled runs). KPIs, a by-level chart and run compare. Drawer with samples, explanation and a confirm query. Classification saved per check. Done-when needs every non-PASS check classified |
| `classroom` (part of task3) | (same) | A | The classroom toggle unlocks once every redesign check is classified; the next recheck runs `apply_accepted=true` + `classroom`; results show SIMULATED with raw visible. No YAML is patched |
| `task4` | Task 4: prove your test catches a bad result | A | Pick vetted rule templates (free-form SQL is Tier C). Clean run PASS → fault run gate FAILED for that exact run with the affected key → clean PASS → the rule is visible again. Swap drivers prompt |
| `own_code` | (optional: a team's own code) | B | Upload .sql/.dtsx/.yml/.txt/.xml (8 MB each) to the team folder; view (UTF-16 aware); copy to the Genie Migrate input (`own_code/`); AI-draft source in Task 2; "Scan my code" (scan job, parses only) → SSIS diagrams + inventory for the team's packages; delete any time. Nothing is uploaded unless the team chooses to |
| `task2` · Genie Code tab | Task 2 | A | Copy the team files (and uploads) to `<root>/teams/<team>/genie_code/` with a prompts README; links to the folder; workspace skill status; bring each file back with a diff, as a draft or as the team file (same save validation), provenance `genie_code` |
| `estate` | Where each legacy pipeline goes; what we noticed | B | Inventory with landing destinations; the blocker map; the pack's landing table |
| `estate_timeline` | (same) | B | 24 h timeline of SQL Agent + Databricks schedules; curation before ingest is flagged |
| `estate_federation` | (same) | C | Lists foreign catalogs, test-queries one table, shows the logical → physical map |
| `estate_upload` | (programme view) | C | Facilitator uploads a code export → scan → new packages appear |
| `findings` | What we noticed in the sample code | B | Seeded and detected findings with decision, owner and due date |
| `questions` | Questions we need your help with | B | Filterable register, answer/status capture, CSV export |
| `genie_results` | — | A | GenieChat on the results space; sample questions; the SQL is visible |
| `genie_estate`, `genie_data` | — | B | Space switcher; the same trust cues |
| `assistant` | Tasks 1–4 support | B | Drawer: cited answers, approval prompts before writes, flag-off safe |
| `close` | From workshop to pilot; five questions | B | Close-out answers and owners, pilot planner, evidence export (markdown + CSV) |
| `close_time_chart` | (business case) | C | Minutes per task against the current-method estimate |
| `facilitator` | The day (run of show) | A | Team board; provision one or all; agenda control and broadcast; answer key (demo only); reset with typed confirm; health |

## Live outcome measures (Home)
| `measure` | Computed from |
|---|---|
| `time_per_step` | `v_time_per_step` (median minutes per task, all teams) |
| `assets_created` | count of team_work saves with provenance plus rules added (`app_events`) |
| `blocker_coverage` | `estate_blocker_map`: jobs mapped and datasets remaining |
| `destinations_assigned` | share of `estate_landing` rows whose landing isn't `review` |

## Done-when rule language (`tasks[].done_when[].rule`)
A tiny expression set evaluated by the client against saved data. Examples:
- `lineage_rows.verified>=6`
- `rule_decisions.agreed==all`
- `questions_open>=1`
- `teamwork.saved>=1`
- `runs.recheck>=1`
- `classifications.covers_non_pass`
- `runs.fault_failed>=1`
- `runs.repair_passed>=1`
- `rules.added>=1`

Unknown rules render as manual checkboxes rather than failing.
