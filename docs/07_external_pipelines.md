# 07 · Pipelines that live outside Databricks

The legacy estate (SQL Server, SSIS, SQL Agent) runs outside Databricks. The app meets it at five points.

| Need | Today in the app | Real engagement |
|---|---|---|
| **See** what exists | `estate_scan` over exported artifacts (`.dtsx`, Agent job scripts, DDL) in the pack | Same, over a wider export. **Optional live metadata:** foreign catalogs on `msdb` (jobs, steps, schedules, history), `SSISDB` (packages, executions) and `sys.sql_modules`/`sys.sql_expression_dependencies`. **Unverified:** test with a read-only login before relying on it |
| **Understand** it | SSIS viewer, lineage edges, Genie estate space, assistant (prompts A2/A3/A9/A10) | Same |
| **Compare** old and new | The validator reads legacy targets through `vars`; in the workshop these are emulated Delta tables | Lakehouse Federation: `CREATE CONNECTION … TYPE sqlserver`, then one `CREATE FOREIGN CATALOG … OPTIONS (database '<db>')` per database; `vars` maps logical names → foreign tables. Query results and mismatch samples move into Databricks: agree masking and retention first |
| **Move** it | Landing table and per-object destination | Lakeflow Connect SQL Server connector (GA; change tracking or CDC; ingestion gateway on classic compute) for data movement; Databricks Jobs for schedules; Databricks SQL + the target framework for views and procedures; Genie Migrate for T-SQL conversion (GA) and SSIS (private preview, if enrolled) |
| **Orchestrate** across the boundary | Timeline of Agent schedules + framework crons; flags curation before ingest | Replace fixed-time crons with dependencies on ingest completion (task dependencies or table-update triggers; check availability in the workspace); keep alerting parity with the legacy job (it emailed an operator on failure) |

## Connections panel (Tier C)
- Lists the foreign catalogs visible to the user.
- "Test" runs `SELECT 1 FROM <catalog>.<schema>.<table> LIMIT 1` (OBO).
- Shows the pack's logical → physical map for the validator.

Read-only: the app never writes to external systems.

## What we must not claim
- That the app migrates SSIS or runs Genie Migrate (it hands off).
- That federation can read `msdb`/`SSISDB` (unverified).
- That a passing workshop run proves production readiness.
