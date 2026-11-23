# WP3 · UI: Home, Setup, Task 1 (Trace), Exercise, Estate (starts at G1)

Tiers:
- **A:** Home, Setup, and the Task 1 core (code browser, lineage and rules on the generic register, done-when).
- **B:** Exercise, presenter, the SSIS viewer (React Flow if it passed the canary, otherwise a collapsible tree), and the Estate pages.
- **C:** federation, rescan.

Read `docs/02_pages.md` for each page's spec and acceptance criteria, and use the `databricks-app-design` skill.

## Owns
- Page folders: `pages/home`, `pages/presenter`, `pages/setup`, `pages/exercise`, `pages/task1`, `pages/estate`.
- Diagram components: `components/flow/*` (React Flow + elkjs layered layout; SSIS node types).
- Routes: none. Lineage, rules and progress are `entries` kinds written via WP0's `/api/entries`.
- Query files: `config/queries/{home,setup,exercise,trace,estate}_*.sql`.

## Steps
1. **Home** (Tier A; presenter B)
   - Engagement title, the four outcomes from `pack.outcomes`, each with its live measure (see `02_pages.md`).
   - The current agenda block from `current_agenda`, with a countdown.
   - A team status card: provisioned, last run, scorecard summary.
   - **Presenter mode:** a full-screen walk through the pack's narrative sections.
2. **Setup** (A)
   - Roster and role assignment, plus a "swap drivers" action that writes an event.
   - **Access check** (per user): read one row from the team's tables; save and delete a test file in team_work; list the Genie Migrate input folder; confirm the skill is present in the pack. Record the result in `app_events`. Show fallback guidance when any check fails.
3. **The exercise** (A)
   - Legacy-vs-new flow diagram built from `pack.dataset`: two lanes, nodes clickable to the code browser.
   - Three comparison layers (R1/R2/R3 from `pack.recon.layers`), each with live pass counts from the team's latest *labelled* run, mapped by `check_layer_map`.
   - Tools panel (what's used today and its status) from the pack.
4. **Task 1: Trace** (A)
   - Steps, done-when and watch-for, all from the pack.
   - **Code browser:** files plugin on the pack legacy folder, with syntax highlighting.
   - **SSIS viewer:** control flow (A) and data flow (B, flag `task1_dataflow`) from graph JSON, built to the parity checklist in `docs/06_estate_scanner.md`:
     - containers that collapse; precedence labels (success/failure/completion, expression, AND/OR);
     - a details panel: SQL highlighted, expressions, connection manager with secrets masked, variables, event handlers;
     - search and highlight; fit, zoom and pan; SVG/PNG export; a package switcher.
   - **Lineage worksheet:** an editable grid seeded from `lineage_template`, with a cited file and a verified tick per row; saves as append-only rows.
   - **Prompt pack:** one button per prompt. It sends the prompt plus code context to the assistant drawer (when flag on), otherwise copies the prompt.
   - **Rules agreement form:** one item per `rules_contract` entry, with status proposed/agreed/open and a business-owner sign-off.
   - **Shared-package panel:** `estate_blocker_map` row(s) for the pack's shared job ("what else it loads").
   - **Done-when auto-checklist:** evaluate each `done_when.rule` against saved data. When all are true, offer "Mark task done" (writes `task_progress`).
5. **Estate** (B; federation and upload are C)
   - Inventory table: packages, objects, Agent jobs, complexity, landing destination with rationale.
   - Retirement blocker map.
   - **Cross-system schedule timeline:** SQL Agent + Databricks schedules on one 24 h axis, flagging any curation that runs before its ingest.
   - Federation panel (C): list foreign catalogs, test-query one table, show the logical → physical mapping.
   - Upload a wider export (C): files plugin upload → `/api/fac/scan`.

## Done when (e2e)
A Playwright journey as a seeded test user:
1. Pick team → access check (all green in the build workspace).
2. Open the code browser and the SSIS viewer, and select a task to see its SQL.
3. Add 6 verified lineage rows.
4. Agree all rules.
5. The done-when list goes green and the task is marked done.
6. A `task_progress` row exists.

Home shows the team status and the current block. Smoke passes with payloads < 1 MB.
