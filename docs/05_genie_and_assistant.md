# 05 · Genie and the assistant

## Where Genie is hooked in
| Surface | How | Tier |
|---|---|---|
| Ask Genie page | AppKit `genie` plugin, `GenieChat`, `spaces` map {results, estate, data} | A (results) / B |
| Task 1 prompt pack | "Ask Genie (estate)" for dependency questions A1, A4, A9 | B |
| Task 3 drawer | "Ask Genie about this check" pre-fills the results space with the check name and run label | B |
| Estate page | "Ask Genie" over the inventory and blocker map | B |
| Assistant | Genie toolkit (or `ask_genie` tool) so the assistant can query any of the three spaces | B |
| Genie Code (workspace) | Workspace-wide customer skill so Genie Code in Genie Migrate and notebooks follows the target framework conventions | A (setup, by an admin) |

### Space instructions (put them in the pack; these are generic templates)
**Results space**
- "Blocking statuses are FAIL and ERROR. INFO means an accepted difference; SIMULATED approvals are classroom-only, not sign-off."
- "Always filter by `target_prefix` for a team, and by `run_label` for a specific run. Never answer 'did it pass' using the latest run when several teams run concurrently."
- "`raw_status` is the result before accepted differences; `status` is after."

**Estate space**
- "A legacy job can be retired only when `datasets_remaining` is empty and its consumers are confirmed."
- "`landing` says where an object goes on Databricks; `review` means not decided."

**Data space**
- "The legacy table is one row per <legacy grain>; the new table is one row per <new grain>. To compare, roll the new table up to the legacy grain (see the grain bridge in the recon config)."

Sample and benchmark questions live in `pack.genie_spaces.*`. WP7 runs the benchmarks as a non-admin user.

### Trust cues (required)
- Show the generated SQL for every answer.
- Show "Genie can be wrong; check the SQL and the numbers".
- Never present a Genie answer as a gate result. Only the validator's labelled run is a gate result.

## Assistant (AppKit `agents`, beta)
- **Backend:** a streaming FMAPI chat endpoint (Claude). No `temperature`; `max_tokens` ≥ 2500.
- **Tools** (opt-in; tool calls run as the user):

| Tool | Effect | Purpose |
|---|---|---|
| analytics toolkit | read | Read-only SQL over the studio, results and team tables |
| files toolkit (pack, team_work: read) | read | Read legacy code and team files |
| genie toolkit / `ask_genie` | read | Ask any of the three spaces |
| `read_legacy_file(path)` | read | Bounded to the pack legacy folder |
| `get_check(run_id, check_name)` | read | Result, samples and explanation |
| `list_questions()` | read | The pack's register |
| `save_team_file(name, content)` | **write, needs approval** | Same validation as `PUT /api/teamwork/file`; provenance `assistant_draft` |
| `run_recheck()` | **write, needs approval** | Same as `/api/recheck` |

- **Skills:** the customer's framework skill (pack `skills/`), plus the prompt pack as `/A1` … `/A10` quick actions.
- **Rules in the instructions:**
  - cite files and lines;
  - treat explanations as hypotheses and give a confirm query;
  - label code as a draft;
  - never claim to have run Genie Migrate or to have approved anything.
- **Fallback (Tier A):** `/api/draft`, a single serving call with the skill + file + target, if the agents plugin is unavailable.
