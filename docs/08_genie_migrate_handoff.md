# 08 · Genie Migrate hand-off

**Fact (23 Nov):** Genie Migrate (Migration Projects in Genie Code) has **no API, SDK or CLI**. It is UI only.
- **Input:** Workspace files. Don't assume a UC volume can be selected.
- **Output:** a workspace folder.
- **Limit:** 500 files per run.
- **Maturity:** SQL → Databricks SQL is GA; SSIS `.dtsx` is private preview (enrolment by form); SQL Server reconciliation is private preview.

So the app **prepares, hands off and imports**.

## Folder convention (per team, created during provisioning)
```
{root}/teams/{team}/genie_in/          ← Genie Migrate input (Workspace files published from the pack)
{root}/teams/{team}/genie_out/    ← where attendees point the Migration Project output
/Volumes/{cat}/{prefix}workshop/team_work/drafts/   ← imported, pasted or drafted files (never executed)
/Volumes/{cat}/{prefix}workshop/team_work/<manifest> ← what the recheck job executes
```

## Attendee flow (Task 2 panel)
1. **Pick the object** to convert, such as the source view or the MERGE procedure.
2. **Open Genie Migrate** (the button opens `pack.genie_migrate.url` in a new tab). Follow the checklist from the pack, typically:
   1. create a Migration Project;
   2. choose source SQL Server;
   3. choose the input folder above;
   4. **select Databricks SQL as the target explicitly**;
   5. run the conversion;
   6. save the output to `genie_out`.
3. **Import.** Back in the app, choose **Import converted files**. The app lists `genie_out` (Workspace API, as the SP), previews a file, and imports it into `drafts/` with provenance `genie_migrate`.
4. **Shape.** Use the editor (and optionally the assistant with the framework skill) to turn the generic Databricks SQL into the target framework's view SQL and YAML.
5. **Promote.** Promote the draft to the manifest file (diff preview). It is saved with a SHA, and **Run my files** follows.

## Fallbacks (feature-flagged; state them honestly in the UI)
- **Genie Migrate not enabled or not working:** "Draft with AI" (`/api/draft`) or the **prepared example** (`pack.genie_migrate.prepared_example_dir`), labelled as such. Never present either as a live Genie Migrate conversion.
- **SSIS:** only if the workspace is enrolled in the private preview. Otherwise the app explains packages with the SSIS viewer and assistant, and scheduling and ingestion remain reviewed engineering work.

## Permissions to check in preflight
- The attendee can open Genie Code and Migration Projects (workspace preview toggles).
- The attendee can read `genie_in/` and write `genie_out/`.
- The app SP can read `genie_out/`.
