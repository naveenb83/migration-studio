# WP2 · Estate scanner (Tier B; starts 12:30; output by G2 16:30)

**Today: run it offline** on the pack's legacy code (one shared package), then load the results with `scripts/load_estate.sh`
(`estate_*` tables + graph JSON into the pack volume). The job wrapper is optional (Tier C rescan). The builder **must not open
the third-party visualiser archive**: clean-room only, from `docs/06_estate_scanner.md`.

**Goal:** turn legacy artifacts (SSIS `.dtsx`, SQL Agent job scripts, view/procedure DDL, target-framework YAML)
into the `estate_*` tables and per-package graph JSON in `docs/03_contracts.md` §4. Read `docs/06_estate_scanner.md`.

## Owns
`scanner/` (Python package), `scanner/tests/`, `scanner/tests/fixtures/` (**hand-written, fictional**),
`resources/estate_scan.job.yml` (app bundle).

## Steps
1. Create the package with `uv init`. Dependencies: `lxml`, `sqlglot` (pinned), `pyyaml`, `pytest`. It must be pure Python and importable locally; Spark is only used in the job entry point.
2. **`estate/dtsx.py`:** parse both formats.
   - 2012+ attribute form: `DTS:ObjectName`, `DTS:ExecutableType`, `DTS:refId`, `DTS:DTSID`.
   - 2008 form: `<DTS:Property DTS:Name=…>` children.
   - UTF-16 BOM aware.
   - Extract: executables tree (tasks, containers, data flows, event handlers), precedence constraints (value, expression, AND/OR), connection managers (**mask passwords**), variables and parameters, Execute SQL statements, data-flow components (source/transform/destination, table or view, SQL command), and paths (including error outputs).
3. **`estate/sql_refs.py`:** `sqlglot.parse(sql, read="tsql")`.
   - Reads: tables in SELECT/JOIN.
   - Writes: INSERT/UPDATE/DELETE/MERGE/TRUNCATE/SELECT INTO targets.
   - Execs: EXEC/EXECUTE. Add a regex fallback when sqlglot returns a `Command`, and mark it `confidence=regex`.
4. **`estate/agent.py`:** parse `sp_add_job`, `sp_add_jobstep`, `sp_add_schedule`/`sp_add_jobschedule` and `sp_attach_schedule` calls.
   - Human-readable schedules: `freq_type` 4 is daily; 8 is weekly with a bitmask, so 62 = Mon–Fri. `active_start_time` is HHMMSS.
   - Get the package path from the step command (`/ISSERVER`, `/FILE`).
5. **`estate/yaml_sched.py`:** Quartz cron (6–7 fields) plus timezone from framework YAML, giving local run times.
6. **`estate/lineage.py`:**
   - Edges: job → package; package → destination tables ("datasets loaded"); stage table → procedure (reads); procedure → target (writes).
   - Blocker map, per legacy job: datasets loaded, procedures called, migrated vs remaining from `pack.estate.dataset_status`, and what it blocks.
   - Landing rules: data movement from a source DB → Lakeflow Connect; Agent schedule → Databricks Jobs; view/procedure → Databricks SQL in the target framework; still-needed legacy reads → Federation bridge; otherwise `review`.
7. **`estate/graph.py`:** graph JSON per package (contract shape). `estate/writer.py`: Delta tables via Spark in the job; JSON/CSV locally.
8. **Job entry `scanner/job_scan.py`** (serverless, dependencies in the job environment).
   - Params: `pack_volume`, `code_dirs` (from the pack), `upload_path` (optional; zip or files), `scan_id`.
   - Optional `msdb_catalog`/`ssisdb_catalog` (live metadata through federation, **off by default; unverified**).
   - Writes `estate_scan_log`.

## Fixtures and tests
- **Fixtures** (fictional "example water utility"):
  - one 2012-format package with a sequence container, two data flows, an Execute SQL task calling a procedure, a precedence constraint with an expression, and a connection manager whose password must be masked;
  - one 2008-format package;
  - one Agent job script (Mon–Fri 08:12);
  - two view/procedure files;
  - one framework YAML with a 06:22 cron.
- **Golden tests:** node and edge counts; refs found (reads, writes, execs); schedule strings; blocker-map rows; graph JSON validates against the contract; no secret appears in any output.

## Done when (e2e)
1. `uv run pytest` is green.
2. The job runs in the build workspace on the private pack's code folder.
3. The `estate_*` tables are populated.
4. The pack's shared package shows every data flow it loads, the procedures it calls and its schedule.
5. The blocker map says how many of its datasets are migrated.
6. A graph JSON exists per package, under 1 MB.

## Out of scope
UI rendering (WP3). Live federation (Tier C).
