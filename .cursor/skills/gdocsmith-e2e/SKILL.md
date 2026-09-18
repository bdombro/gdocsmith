---
name: gdocsmith-e2e
description: Run and iterate headless Cursor agent E2E tests for gdocsmith using just agent-e2e.
---

# gdocsmith-e2e

Autonomous orchestrator loop for headless end-to-end agent testing of the dev `gdocsmith` MCP server.

RUN WITH BEST LLM so diagnosis and decisions are better. This skill already uses a cheap LLM for the test-runner, so it's not that expensive.

## Autonomous Feedback Loop (Max 10 Rounds)

Iterate autonomously up to 10 rounds:

1. **Run E2E Test**:
   ```bash
   just agent-e2e
   ```
   Or pass a custom prompt if testing a specific workflow:
   ```bash
   just agent-e2e "custom prompt..."
   ```

2. **Print Outcome**:
   - Report whether the run succeeded or halted.
   - **Efficiency & Turn Budget Audit**:
     - Turn & tool call count: Number of MCP `run` invocations vs. ideal turn budget.
     - Batching ratio: Were related steps grouped into multi-step `run` calls (e.g. Phase 1 Discover, Phase 2 Structure, Phase 3 Populate), or split into serial single-step calls?
     - Recovery loops & back-and-forth: Did the agent spend extra turns guessing, backtracking, or repeating failed actions?
     - Dry-run thrashing: Did the agent run repetitive `dryRun: true` cycles before writing?
   - List all surfaced friction points, unexpected errors, schema confusion, or formatting degradations.
   - Include the exact tool call payload and error message.
   - Provide concrete suggestions for each issue.

3. **Autonomous Triage & Action**:
   - Inspect the failure against `AGENTS.md` (Engineering & Triage Principles):
     - **Intended guard / client error**: If the failure is an intended guardrail or client agent error, verify the error message is actionable. Do not modify schemas, add permissive fallbacks, or bypass guards to force a test pass.
     - **Mandatory halt**: If the failure is due to `argsbarg` or auth/credentials, stop immediately.
     - **Non-obvious decision**: Stop and ask if it involves architectural tradeoffs, safety defaults, or breaking changes.
     - **Obvious engine bug / doc gap**: Apply the root-cause fix in `src/core/` or `skills/gdocsmith/SKILL.md`, maintain code quality rules (JSDocs, `CHANGELOG.md`), verify with `just check`, and proceed directly to step 1.

4. **Termination**:
   - Stop when all known issues are resolved and the workflow completes cleanly without halts or warnings.
   - Hard cap at 10 rounds overall.
