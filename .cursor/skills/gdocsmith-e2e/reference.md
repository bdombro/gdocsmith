# End-To-End Reference

## Agent E2E Runner

- Use `just test-e2e` with headless Claude Code and Sonnet on the current checkout. Do not substitute a runner or model. Do not add policy-block detection.
- Each attempt uses a fresh fixture copy, unique Claude session, the current checkout's Node MCP bundle and skill, and a disposable workspace. Use `--restricted --strict-mcp-config` with one session-local server and only its run/status tools allowed. No shell, web, edit, or delegation tools.
- The checkout's skill is staged locally and injected into the session prompt because restricted mode ignores project customizations.
- Run a read-only outline pilot first. Confirm tool/server isolation, effective Sonnet model, tool calls, result event, and fixture cleanup. Halt on authentication, isolation, schema, or cleanup failure.
- Count every headless process launch, including pilots and failures, in the per-invocation launch ledger. Never start more than 40 per invocation.
- Parse Claude stream JSONL and reported usage/cost. Missing values are unavailable, not zero. Keep raw local artifacts and report incomplete attempts without inventing results. Do not change model or account on quota failures.

## Expectations

- The agent works through the gdocsmith MCP tool only. The harness may use existing clients to copy the fixture, verify resulting document state, and delete copies.
- Read a narrow scope before changing unfamiliar content. Preserve frontmatter and tokens in markdown exports. Do not calculate character offsets or issue direct Docs API calls from the agent.
- Treat a refusal as useful information. A headless agent explains why a destructive operation cannot proceed and stops instead of forcing it.

## Assertions And Cleanup

- Verify final text, headings, tab order, rich content, table shapes, and safeguards independently from the agent's narrative.
- Permanently remove every temporary copy after the attempt, including failure or timeout, unless explicitly retaining it. Report undeleted IDs; never modify or delete the source fixture.