# WP6 · Migration assistant (AppKit `agents` plugin, **beta**, **Tier C**; only after G3 if time allows)

The Tier B AI path is the streamed single-shot `/api/draft` (WP4). Build this only when Tier A and B are green.

Read `docs/05_genie_and_assistant.md` and the AppKit agents docs (`npx @databricks/appkit docs ./docs/plugins/agents.md`).

## Owns
`server/agents/migration-assistant/agent.ts` (code agent), `server/agents/migration-assistant/tools/*`,
`client/src/components/assistant/*` (drawer built on `useAgentChat`), `tsdown.server.config.ts` (`appkitServerConfig()`,
so code agents are bundled).

## Steps
1. **Model backend:** a streaming chat serving endpoint (`DATABRICKS_SERVING_ENDPOINT_NAME`). No `temperature`, and a large `max_tokens`.
2. **Tools.** Opt-in; tool calls run OBO.
   - `plugins.analytics.toolkit()` (read-only SQL).
   - Files toolkit limited to **read** on the pack and team_work volumes.
   - The Genie toolkit for the three spaces, if available. Otherwise a custom `ask_genie(space, question)` that uses the genie plugin.
   - Custom tools:
     - `read_legacy_file(path)` (pack legacy folder only).
     - `get_check(run_id, check_name)`: result, samples and explanation.
     - `list_questions()` (pack).
     - `save_team_file(name, content)`: `effect: "write"`, so human approval is required. It goes through the same validation as `PUT /api/teamwork/file` and sets provenance `assistant_draft`.
     - `run_recheck()`: `effect: "write"`, approval required; calls `/api/recheck` logic.
3. **Skills.** Load the customer's framework skill from the pack (`DATABRICKS_VOLUME_AGENT_SKILLS`). Expose each prompt-pack entry as a quick action (`/A1` … `/A10`).
4. **Instructions.** From `pack.assistant.extra_instructions`, plus these rules:
   - cite the files and lines relied on;
   - treat explanations as hypotheses and propose a confirm query;
   - never claim to have run Genie Migrate;
   - label code as a draft.
5. **UI.** A right-side drawer available on Task 1–4 pages:
   - streaming text;
   - tool-call chips;
   - approval prompts (approve/deny, posting to `/api/agents/approve`);
   - an "AI-generated" label;
   - an explicit container height.
6. **Feature flag `assistant`.** If the plugin fails at start-up, the app must still start: catch the failure, disable the flag and log it.

## Done when (e2e)
1. Ask "explain the shared package (A2)" → an answer that cites files.
2. Ask for a stage-view draft → the agent proposes `save_team_file` → the approval prompt appears → approve → the file appears in drafts with provenance.
3. Deny → nothing is written.
4. With the flag off, nothing breaks and `/api/draft` still works (WP4).
