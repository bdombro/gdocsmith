# End-To-End Reference

## Runner

- Default to Copilot CLI with `--model gpt-5.6-luna --reasoning-effort xhigh`
- Use Cursor only when explicitly requested; do not substitute another runner,
  model, or reasoning level when the selected configuration is unavailable
- Updating this skill or an execution plan does not authorize live runs or resume
- M1 is strictly offline. Do not start fixture copies or model sessions until
  the M1 gate passes and the planned M2 pilot is explicitly reached
- CLI 1.0.88 help advertises these settings, JSONL output, and usage reports;
  account availability and effective settings still need live confirmation

## Headless Copilot

1. Give each scenario a fresh temporary working directory and a unique session
  ID. Keep the user's existing Copilot home so its saved login remains
  available; don't copy or print credentials. Disable updates with
  `COPILOT_AUTO_UPDATE=false` and never resume a prior session
2. Supply only the selected arm's Node MCP bundle via `--additional-mcp-config`
   with an absolute command path/arguments. Stage that arm's gdocsmith skill in
   the temporary workspace's `.github/skills/gdocsmith/`; never give v1 the v2
    temporary workspace's `.github/skills/gdocsmith/`; never give v1 the v2
    skill. This option augments Copilot's home MCP config. Unrelated MCP servers
    are already disabled per the user's confirmation: do not inspect or modify
    that config and do not add per-server disable flags. Use a unique name for the
    test server and disable built-in MCPs. Do not modify repo MCP configuration
3. Invoke `copilot --prompt <task> --session-id <fresh-uuid> --model gpt-5.6-luna --reasoning-effort xhigh
   --output-format json --usage-output-file <usage.json> --share <session.md>
  --disable-builtin-mcps --no-custom-instructions --no-ask-user --no-remote
  --disable-builtin-mcps --no-custom-instructions --no-ask-user --no-remote
  --no-remote-export --add-dir <workspace> --additional-mcp-config @<mcp.json>`
  from that workspace. Bind placeholders
  as separate arguments, not shell-interpolated command text
4. Restrict `--available-tools` and `--allow-tool` to the arm's run/status tools
4. Restrict `--available-tools` and `--allow-tool` to the configured server's
  `run` and `status` tools. Add a local file tool only for a case that requires
  it. Verify actual names and permission syntax in the installed CLI; exclude
  shell, web, unrelated MCPs, and delegation tools
5. Preserve JSONL stdout, stderr, the transcript, and final usage JSON locally.
   Run sequentially with a 600-second timeout. Do not resume a previous session
6. On the first pilot, confirm the effective model/effort, selected bundle and
6. On the first pilot, confirm the effective model/effort, selected bundle and
  skill, configured test server, and tool restrictions from runtime evidence.
  Unrelated MCP servers are user-confirmed disabled; do not inspect their config.
  Halt on auth, unavailable settings, or failed tool isolation; do not relax
  restrictions to pass

## Comparison And Usage

- G6 is real-document E2E: identical natural-language prompts, fresh fixture
  copies, the same model/effort for both arms, and deterministic outcome checks
- Use the G6 harness when implemented; this reference does not claim it exists.
  Keep prompts free of step-kind hints and interleave v1/v2 runs
- Parse Copilot JSONL and final usage using its verified event schema, not
  Claude's `system/init`, `tool_use`, or `total_cost_usd` fields
- Record CLI version, arm revision, requested/effective model and effort,
  success checks, duration, tool calls/errors/refusals/force, and reported token
  and billing usage. Missing metrics are unavailable, not zero
- The user chose no harness-imposed session or total-spend cap for G6: do not
  pass `--max-ai-credits`, reduce run counts, or stop based on reported usage.
  Copilot's account quotas and billing still apply. Record reported credits,
  premium requests, tokens, and cost when available; mark missing usage as
  unavailable, not zero. Report provider quota/rate-limit failures without
  silently switching accounts, models, or reasoning settings

## Expectations

- The agent under test works through the gdocsmith MCP tool only. The G6 harness
  may use existing clients for fixture setup, independent verification, and cleanup.
- Read a narrow scope before changing unfamiliar content.
- Preserve frontmatter and tokens when writing an edited markdown export back.
- Do not calculate character positions or issue direct Google API calls.
- Treat a refusal as useful information. Request confirmation before allowing a
  destructive change; a headless agent explains the refusal and stops instead.

## Assertions

Verify document state after each scenario using normal tool output:

- targeted text and headings match the requested state
- untouched tabs and content remain present
- tables keep expected row and column shape
- rich or unrecreatable content survives a refused operation
- the returned diff and `steps[i]` match the observed result

## Cleanup

When a scenario creates a temporary document, permanently remove it at the end
of the scenario, including failure or timeout. The harness owns cleanup for G6;
only an explicit keep-docs request skips it. Report any undeleted IDs. Do not
leave trial copies in Drive or delete the source fixture.