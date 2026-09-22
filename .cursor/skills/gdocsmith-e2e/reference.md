# gdocsmith-e2e Reference

Autonomous orchestrator loop for headless end-to-end agent testing of the dev `gdocsmith` MCP server using Cursor's `agent` CLI.

- [Prerequisites & Build](#prerequisites--build)
- [Running Headless Agent](#running-headless-agent)
- [Scenario Selection](#scenario-selection)
- [Autonomous Feedback Loop](#autonomous-feedback-loop)
- [Triage & Guardrails](#triage--guardrails)
- [Drive Document Cleanup](#drive-document-cleanup)

## Prerequisites & Build

Before running scenarios against local changes, build and sync the MCP server to Cursor's local plugins directory:

```bash
# 1. Bundle standalone Node MCP server script
bun build ./src/index.ts --target=node --outfile=./scripts/mcp.mjs

# 2. Sync repository into Cursor local plugins
rm -rf ~/.cursor/plugins/local/gdocsmith && mkdir -p ~/.cursor/plugins/local/gdocsmith
rsync -a --delete --exclude='.git' --exclude='node_modules' ./ ~/.cursor/plugins/local/gdocsmith/
```

*Note: For agents running outside Cursor using `~/.agents/mcp.json`, register the dev server directly:*
```bash
test -f ~/.agents/mcp.json || echo '{}' > ~/.agents/mcp.json
jq --arg src "$(pwd)/src/index.ts" '.mcpServers = ({gdocsmith: {command:"bun",args:[$src,"mcp"]}} + ((.mcpServers // {}) | del(.gdocsmith)))' ~/.agents/mcp.json > ~/.agents/mcp.json.tmp && mv ~/.agents/mcp.json.tmp ~/.agents/mcp.json
```

## Running Headless Agent

Execute scenarios in an isolated workspace with auto-approved permissions:

```bash
WORKSPACE="/tmp/agentE2e"
rm -rf "$WORKSPACE" && mkdir -p "$WORKSPACE"
agent -p --trust --approve-mcps --force --model "${MODEL:-composer-2.5}" --workspace "$WORKSPACE" "$(bun scripts/e2ePrompt.ts <scenario-id>)"
```

Or pass a custom prompt string directly:
```bash
WORKSPACE="/tmp/agentE2e"
rm -rf "$WORKSPACE" && mkdir -p "$WORKSPACE"
agent -p --trust --approve-mcps --force --model "${MODEL:-composer-2.5}" --workspace "$WORKSPACE" "<custom prompt>"
```

### CLI Flags

| Flag | Purpose |
| --- | --- |
| `-p, --print` | Non-interactive headless execution; streams output to stdout. |
| `--trust` | Trust workspace without interactive confirmation. |
| `--approve-mcps` | Auto-approve all MCP tools without prompting. |
| `-f, --force` | Auto-approve commands/tools (alias: `--yolo`) to avoid hanging headless runs. |
| `--model <slug>` | LLM model for the test run (defaults to `composer-2.5`). |
| `--workspace <dir>` | Isolated directory for test run file operations (`/tmp/agentE2e`). |

## Scenario Selection

Catalog definitions and criteria are documented in [scenarios.md](scenarios.md).

List all scenarios from CLI:
```bash
bun scripts/e2ePrompt.ts --list
```

| Scenario ID | Focus / Primitive Tested | Target Turns |
| --- | --- | --- |
| `full-workflow` *(default)* | End-to-end 3-phase planning spec assembly with child fixtures and cross-tab links | 3 |
| `placeholder-preservation` | Surgical `replaceMarkdown` placeholder edits without deleting child subsections | 1–2 |
| `leaf-section-transfer` | Server-side AST section copying (`sectionCopy`) between documents and tabs | 1–2 |
| `multi-tab-structure` | Single-step root tab seeding (`fromTab`) and ordered tab creation without 500 bugs | 2 |
| `symbolic-linking` | Cross-tab and heading deep links compiled to native Docs URLs | 2 |
| `child-heading-guard` | Negative safety test verifying fail-closed protection against subsection deletion | 1 |
| `table-mutation` | Grid operations and row insertions inside existing tables | 1–2 |
| `dry-run-inspection` | Previewing unified diffs without mutating live cloud documents | 1–2 |

## Autonomous Feedback Loop

Iterate autonomously up to 10 rounds:

1. **Build & Sync**: Run prerequisites build/sync if code or skills were modified.
2. **Execute**: Run `agent` with target scenario or prompt.
3. **Audit Turn Budget & Efficiency**:
   - Compare turns taken vs target turn budget in [scenarios.md](scenarios.md).
   - **Batching ratio**: Were related steps grouped into multi-step `run` calls (e.g. 3-phase batching)?
   - **Recovery loops**: Did the agent backtrack, guess invalid schema fields, or repeat errors?
   - **Dry-run thrashing**: Did the agent loop repetitive `dryRun: true` calls before writing?
   - Log exact tool call payload and error message if unexpected failure occurs.
4. **Triage & Apply Fix**: Follow triage principles below. Rebuild, re-verify with unit tests, and re-run.
5. **Clean Up**: Remove any temporary Drive test documents (`[TEST] ...`).

## Triage & Guardrails

Follow `AGENTS.md` Engineering & Triage Principles:

- **Intended guard / client error**: If failure is an intended guardrail (e.g. `child-heading-guard`, uncreatable elements without `force: true`) or client hallucination, verify the error message is actionable. Do **not** loosen schemas, add loose aliases, or bypass guards.
- **Engine bug / doc gap**: Fix root cause in `src/core/` or `skills/gdocsmith/SKILL.md`. Maintain JSDocs, single-line file headers, and summarize in `CHANGELOG.md`. Run unit tests (`bun test src`), rebuild plugin, and re-run scenario.
- **Mandatory halt**: On auth failures (`401`, `403`) or upstream `argsbarg` framework issues, stop immediately and report to user without workarounds.
- **User decision required**: Stop and ask before making architectural changes or altering safety defaults.

## Drive Document Cleanup

Clean up temporary Drive test documents (`[TEST] ...`) created during runs:

```bash
# Search and delete using gws CLI
gws drive files list --params '{"q": "name contains \'[TEST]\' and trashed = false"}'
gws drive files delete --params '{"fileId": "<file-id>"}'
```
