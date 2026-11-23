# 10 · Test plan

## 1. Per-WP e2e (must be green before merge)
| WP | Test | Evidence in the PR |
|---|---|---|
| WP0 | Deploy → RUNNING; `/api/me`; all stub pages; `data_browse` probe; smoke | deploy log, screenshot |
| WP1 | Demo team: baseline scorecard = `pack.recon.expected_scorecards.baseline`; after fix = `after_fix`; each fault fails the gate on its run with a key; repair passes; 3 concurrent rechecks; fallback notebook still runs | run ids + counts as text (kept in the private kit) |
| WP2 | `uv run pytest` golden tests on fictional fixtures; job run on the pack; no secrets in outputs | pytest output, row counts |
| WP3 | Playwright: setup → access check → Task 1 journey → task marked done | trace or screenshot |
| WP4 | Save → recheck → SHA; import → draft; draft-with-AI; rule → fault fails → repair passes → rule persists | run labels, screenshot |
| WP5 | Baseline vs after-fix compare; drawer; classification saved; GenieChat answer; facilitator board; health; export | screenshot, export file |
| WP6 | Cited answer; approve → file written; deny → none; flag-off safe | transcript |
| WP7 | ≥4/5 benchmarks per space as a non-admin | benchmark table |
| WP8 | Rehearsal script (§4) as two non-admin accounts | checklist with times |

## 2. Golden data
- Expected scorecards, the team list and the fault list come **only** from the private pack.
- Tests read `pack.json` at run time, never hard-coded constants.
- The fictional example pack (`pack/example`) is used by local unit tests.

## 3. Playwright smoke rules
- Selectors: `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder` only.
- Assert the page title plus one data-bound element per page.
- Keep the queries used by smoke under 1 MB (`LIMIT` or aggregates).
- Run against `npm run dev` with `DEV_USER_EMAIL` set, and against the deployed app before go/no-go.

## 4. Rehearsal script (U1 + U2 on the `rehearsal` team, U3 on another team; external, non-admin; ≤ 45 minutes; time each step)
| # | Who | Do | Expect |
|---|---|---|---|
| 1 | U1, U2 | Open the app → consent → pick `rehearsal`, roles driver/reviewer → Setup access check | 4/4 green; events recorded |
| 2 | U1 | Task 1: add a lineage row (with citation) and agree one rule | U2 sees both within 5 s (cache off) |
| 3 | U1 | Task 2: open Genie Migrate from the button → convert one SQL file → save to `genie_out` → Import (or paste) → diff → promote → save → Run my files | Draft provenance `genie_migrate` or `pasted`; new SHA; scorecard = `recheck_as_built` |
| 4 | U2 (drives) | Edit the stage view to a wrong id → run | More FAILs, with affected keys; then revert → run → back to `recheck_as_built` |
| 5 | U2 | Apply the prepared fix files (facilitator hint) → Task 3: classify every non-PASS check → turn the classroom toggle on → run | `after_fix` counts; SIMULATED badges; raw visible |
| 6 | U1 | Task 4: pick 2 templates → clean run → fault run → clean run → run again | PASS → gate FAILED (key shown) → PASS → rule present again |
| 7 | U2 | Ask Genie (results): "Which checks failed in our last labelled run?" | Answer with SQL; matches the scorecard |
| 8 | U1 | Close: answer the questions → Export | Markdown with run labels, hashes, classifications |
| 9 | U3 | Call the rehearsal team's `/api/teamfiles/:name` PUT directly (curl with own session) | **403** |
| 10 | Facilitator | Board + health | Rehearsal team shows every run; health green |

## 5. Prove matrix (WP1 verifies today; pack keys `prove_clean` / `prove_fault`)
Each rule template × {clean, every fault} on the `rehearsal` prefix: clean PASS; each fault FAILs at least one template with the affected key.
