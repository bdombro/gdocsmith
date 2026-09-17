---
name: gdocsmith-e2e
description: Run and iterate headless Cursor agent E2E tests for gdocsmith using just agent-e2e.
---

# gdocsmith-e2e

Autonomous orchestrator loop for headless end-to-end agent testing of the dev `gdocsmith` MCP server.

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
   - List all surfaced friction points, unexpected errors, or schema confusion.
   - Include the exact tool call payload and error message.
   - Provide concrete suggestions for each issue.

3. **Autonomous Triage & Action**:
   - **Obvious fix**:
     - Bugs in `src/core/` (e.g. incorrect variable resolution, conflicting flags, compiler edge cases).
     - Missing or misleading guidance in `skills/gdocsmith/SKILL.md`.
     - Obvious schema gaps in `src/commands/run/types.ts`.
     - *Action*: Apply the fix immediately, run `just check` (schemagen, format, lint, typecheck, test), and proceed directly to step 1 for the next round without waiting for user input.
   - **Non-obvious decision**:
     - Architectural tradeoffs (e.g. multi-call session persistence vs stateless runs).
     - Breaking API/schema changes.
     - Ambiguous requirements or conflicting Google Docs API behaviors.
     - *Action*: Stop, report the decision to the user with clear options, and wait for input before proceeding.

4. **Termination**:
   - Stop when all known issues are resolved and the workflow completes cleanly without halts or warnings.
   - Hard cap at 10 rounds overall.
