# 11 · Risks, mitigations and honest limits

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Delivery workspace not ready: Apps for external users, Genie Code + Migration Projects toggles, FMAPI, serverless, catalog, groups | High | High | Confirm the profile in hour 1; preflight before G3; facilitator-led mode if Apps can't reach externals | Naveen + WP8 |
| 2 | One-day scope for a multi-page app | High | High | Tier A/B/C; page-registry stubs; parallel worktrees; feature flags; G2 freeze; fallback card | All |
| 3 | Recheck behaviour drifts from the rehearsed numbers | Low (no port) | High | The recheck job runs the kit's own notebook; golden scorecards from the pack are the WP1 gate | WP1 |
| 4 | Concurrency: 6 teams × rechecks + faults at the same time | Medium | Medium | `max_concurrent_runs` 10 + queueing; unique run labels; append-only results; warehouse kept warm | WP1, WP8 |
| 5 | 120 s proxy timeout | Certain if ignored | Medium | runNow + short polling everywhere; bounded draft calls | WP0, WP4 |
| 6 | AppKit agents plugin is beta | Medium | Low | Tier B behind a flag; `/api/draft` is the Tier A fallback; start-up failure must not stop the app | WP6 |
| 7 | npm proxy 404s for diagram or editor deps | Medium | Medium | WP0 installs and deploys every dep first; vendor as a `file:` package | WP0 |
| 8 | OBO / grants missing for external users (Genie, confirm queries) | Medium | High | `scripts/grants.sql`; non-admin rehearsal mandatory; an admin run is never evidence | WP7, WP8 |
| 9 | The app SP can't read the Genie Migrate output folder | Medium | Medium | Grant CAN_READ on `{root}`; preflight test file; manual upload fallback | WP8 |
| 10 | Answer-key leakage to attendees | Low | High | Answer key only on the demo prefix, facilitator role only; no answer table in team schemas | WP1, WP5 |
| 11 | Customer content leaks to GitHub | Low | High | Generic repo; private pack; git-ignored denylist + pre-push hook; fictional fixtures only | All |
| 12 | Client-chosen table names let a user read any table the app SP can read | High if ignored | High | Resolved by design: the client never sends table names; `/api/data/:logical` expands an allow-listed logical name for the caller's team only | WP0 |
| 13 | AI conversion or explanation is wrong | Medium | Medium | AI labels; confirm queries; provenance; validator decides, never AI | All |
| 14 | Builders conflict on shared files | Medium | Medium | Ownership table (`03_contracts.md` §7); contract-change PRs only; regenerate typegen after merges | All |
| 16 | Privilege escalation: team files executed as SQL by a privileged job identity | Medium | High | Jobs `run_as` a least-privilege SP; a view file must be exactly one `CREATE VIEW`; never accept table names from the client | WP1, WP4 |
| 17 | Stale reads (AppKit caches analytics ~1 h; jobs `getRun` 60 s) hide partner edits and freeze status | High if ignored | High | Disable caches; poll the Jobs API directly; two-session freshness test in WP0 | WP0 |
| 18 | Task 4 can't reach PASS for teams still mid-Task 3 | High if ignored | High | Prove runs the team rules config on clean vs fault views; templates chosen to pass as-built | WP1, WP4 |
| 19 | Appending to the recon YAML corrupts it (sections after `checks:`) | High if ignored | Medium | The app never patches YAML; approvals are rows + the classroom toggle; the team rules file is generated whole | WP4, WP5 |
| 20 | typegen DESCRIBEs every query at build: missing tables fail the build | Medium | Medium | WP0 creates all DDL + union views (incl. `rehearsal`/`demo`) before typegen | WP0 |
| 21 | App and notebook write to different places, losing history on fallback | Medium if ported | High | Reuse the notebooks as jobs; per-team storage; union views | WP1 |
| 15 | Long or odd `.dtsx` (encoding, size) breaks the scanner | Low | Medium | UTF-16 BOM handling; truncate SQL in the graph JSON; scanner errors logged per package without failing the job | WP2 |

## Honest limits (say these in the app and in the room)
- The app **hands off** to Genie Migrate and imports results. There is no API to drive it.
- SSIS conversion and SQL Server reconciliation in Genie Migrate are **private preview**.
- msdb/SSISDB through Lakehouse Federation is **unverified**.
- Classroom approvals are **SIMULATED**, not sign-off. A clean run covers only the executed rules and scope.
- No speed-up percentage, production readiness or licence saving is implied by the workshop.
