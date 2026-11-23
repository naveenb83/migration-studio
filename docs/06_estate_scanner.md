# 06 · Estate scanner and the SSIS viewer

## Why a clean-room build
A third-party SSIS viewer was offered as a reference. It parses `.dtsx` in the browser and draws control-flow and
data-flow diagrams with a details panel, but its archive carries **no licence**. We therefore:
- copy no code;
- reimplement to **feature parity**;
- add what migration planning needs (SQL references, SQL Agent jobs, estate view, lineage, blocker map).

If the author later grants permission, porting its layout engine is an optional improvement.

## Parsing rules
| Artifact | Parser | Extracts |
|---|---|---|
| `.dtsx`, 2012+ format | lxml; namespace `www.microsoft.com/SqlServer/Dts`; attributes (`DTS:ObjectName`, `DTS:ExecutableType`, `DTS:refId`, `DTS:DTSID`, `DTS:CreationName`) | executables tree, precedence constraints, connection managers, variables, parameters, event handlers, data-flow pipelines |
| `.dtsx`, 2008 format | same; values in `<DTS:Property DTS:Name="…">` children | same |
| Execute SQL tasks | the `SqlStatementSource` property | SQL text → `sql_refs` |
| Data-flow components | `componentClassID` → category; `OpenRowset`/`TableOrViewName`/`SqlCommand` properties | source/destination tables, SQL → `sql_refs` |
| View/procedure/table DDL `.sql` | `sqlglot.parse(…, read="tsql")` + regex fallback for `EXEC` | reads, writes, execs per object |
| SQL Agent job scripts | regex over `msdb.dbo.sp_add_job*`/`sp_add_*schedule`/`sp_attach_schedule` named arguments | job, steps (SSIS package path), schedule (human readable) |
| Target-framework YAML | pyyaml; Quartz cron + timezone | Databricks-side schedules |

**Encoding.** Files may be UTF-16 with a BOM, so detect it.

**Secrets.** Mask the `Password=`, `PWD=` and `Pwd=` values in connection strings, and any property named like a password, before anything is written.

## Visualiser parity checklist (the WP3 viewer must meet all of these for control flow; data flow is Tier B)
- [ ] Nested containers (Sequence, For Loop, Foreach), collapsible
- [ ] Precedence constraint labels: success / failure / completion; expression; logical AND vs OR styling
- [ ] Node types visually distinct: Execute SQL, Data Flow, Execute Package, Script, File System, Send Mail, other
- [ ] Details panel: name, type, description, properties, SQL (highlighted), expressions, connection used
- [ ] Connection managers list with secrets masked; variables and parameters by scope; event handlers
- [ ] Data-flow view per Data Flow task: components by category, paths (including error outputs), column lists where present
- [ ] Search with highlight; fit, zoom and pan; export SVG and PNG
- [ ] Package switcher when several packages are scanned

Layout: elkjs `layered` algorithm, direction DOWN for control flow and RIGHT for data flow, with orthogonal edge routing.
Render with React Flow custom nodes. Never inject package strings as HTML.

## Lineage and blocker map
- **Edges:**
  - `schedules`: Agent job → package;
  - `loads`: package → destination table;
  - `reads`: table → procedure;
  - `writes`: procedure → table;
  - `calls`: package → procedure (Execute SQL `EXEC`).
- **Datasets loaded by a job** = the destination tables of its packages' data flows, grouped by the pack's dataset names.
- **Migrated** = `pack.estate.dataset_status`. **Blocks retirement** while any dataset loaded by the job is not migrated.
- **Landing rules:**
  - source-to-stage data flow → `lakeflow_connect`;
  - Agent schedule → `databricks_jobs`;
  - view/procedure → `databricks_sql`;
  - reads of legacy objects that stay for now → `federation_bridge`;
  - anything else → `review`.
- **Schedule order check:** any Databricks curation scheduled before the ingest it depends on, on the same day, is flagged.

## Outputs
`docs/03_contracts.md` §4: the `estate_*` tables and the graph JSON per package (kept under 1 MB; truncate very long SQL in the graph and keep the full text in Delta).
