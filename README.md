# Migration Studio

A Databricks App that runs a hands-on **legacy-to-Databricks migration workshop** end to end. Attendees work in pairs, and
every task happens in the app:

1. **Trace** a legacy flow: code browser, SSIS package viewer, lineage worksheet, prompt pack. Agree what "correct" means.
2. **Convert:** hand off to Genie Migrate and import the result, or draft with AI. Edit, then save and **run their own files**.
3. **Validate:** scorecard, affected records, AI explanations treated as hypotheses, and classification of every difference.
4. **Prove:** write a validation rule, inject a controlled fault, watch the gate reject that exact run, repair it.
5. **See the estate:** pipelines outside Databricks (inventory, retirement blocker map, cross-system schedule timeline).
6. **Ask Genie** about results, the estate and the data. **Close** with a pilot plan and an evidence pack.

The app is **generic**. Customer specifics come from a private **engagement pack** (`pack.json` + files in a Unity Catalog
volume); see `pack/pack.schema.json` and the fictional `pack/example/`.

## Status
Planning pack, created 23 Nov 2026. Build in progress. Start with `BUILD_PLAN.md`, then `AGENTS.md`.

## Layout
```
BUILD_PLAN.md    resume file: decisions, gates, work packages, status log
AGENTS.md        rules for builder agents
docs/            architecture, pages, contracts, jobs, Genie + assistant, scanner, external pipelines, Genie Migrate hand-off,
                 deploy + rehearsal, test plan, risks; docs/wp/ = one brief per work package
pack/            engagement-pack JSON Schema + fictional example
app/             AppKit app (WP0 onwards)
scanner/         estate scanner job (WP2)
sql/ scripts/    studio DDL, grants, preflight, pack upload
```

## Built on
- Databricks Apps (AppKit) with the analytics, jobs, files, genie, serving and agents (beta) plugins.
- Unity Catalog (Delta).
- Lakeflow Jobs.
- Genie.
- Foundation Model APIs.
