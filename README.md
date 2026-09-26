# gdocsmith

`gdocsmith` gives agents one transactional `run` tool for reading and editing Google Docs. It works from document structure and markdown rather than character offsets, preserving untouched content whenever possible.

## How It Works

Each run validates all steps, loads documents into an in-memory model, plans a minimal Google Docs request set, evaluates safety findings, and then sends work in revision-locked phases. `dryRun: true` returns the same plan without sending.

Use the smallest scope that covers the change: query an outline, query markdown for a section or node, make the edit, then inspect the returned diff and result.

## Real world examples

### Example 1: Creating and querying a document

Prompt: "Create a Google Doc titled 'Architecture RFC' with an Overview section containing 'Draft content', then show me its outline."

Tool call (`run`):
```json
{
  "steps": [
    { "kind": "doc", "action": "create", "as": "rfc", "title": "Architecture RFC" },
    { "kind": "write", "doc": "rfc", "append": true, "markdown": "# Architecture RFC\n\n## Overview\n\nDraft content." },
    { "kind": "query", "doc": "rfc", "output": "outline" }
  ]
}
```

Tool response:
```json
{
  "ok": true,
  "steps": [
    { "kind": "doc" },
    { "kind": "write" },
    { "kind": "query", "data": { "tabs": [
      { "title": "Architecture RFC", "headings": [
        { "level": 1, "text": "Architecture RFC" },
        { "level": 2, "text": "Overview" }
      ] }
    ] } }
  ],
  "warnings": []
}
```

Final response: "Created Architecture RFC. Its outline contains Architecture RFC and Overview."

### Example 2: Editing a section with an image and comments

Prompt: "In my existing Google Doc, update the System Architecture section of the Spec Template tab: change 'Launch readiness: pending.' to 'Launch readiness: security review required.' and replace 'Placeholder: Add launch plan.' with a two-item numbered plan. Keep the embedded schematic, its caption, and reviewer comments intact. If that cannot be done safely, stop and explain."

First, query the section. Its markdown shows the target text and an existing `{{image:...}}` token under the Network Topology Diagram child heading. Comments are not edited through markdown.

Tool call 1 (`run`):
```json
{
  "steps": [
    {
      "kind": "query", "doc": "<existing-document-id>", "tab": "Spec Template",
      "at": { "section": "System Architecture" }, "output": "markdown"
    }
  ]
}
```

Dry-run both narrow changes together. The edit count catches an unexpected duplicate; the write replaces only the placeholder paragraph, not the image-bearing section.

Tool call 2 (`run`):
```json
{
  "dryRun": true,
  "steps": [
    {
      "kind": "edit", "doc": "<existing-document-id>", "tab": "Spec Template",
      "at": { "section": "System Architecture" },
      "find": "Launch readiness: pending.",
      "replace": "Launch readiness: security review required.", "expectCount": 1
    },
    {
      "kind": "write", "doc": "<existing-document-id>", "tab": "Spec Template",
      "replace": { "text": "Placeholder: Add launch plan." },
      "markdown": "1. Review the flight-control interface.\n2. Approve the launch and recovery plan."
    }
  ]
}
```

Illustrative dry-run response (selected fields):
```json
{
  "ok": true,
  "dryRun": true,
  "diff": { "text": "--- a/Spec Template\n+++ b/Spec Template\n..." },
  "warnings": []
}
```

If the plan shows only those changes and no refusal, repeat tool call 2 without `"dryRun": true`. Inspect the live diff, then query the section again with tool call 1 to check the new text, numbered items, and unchanged image token. Review the comment thread in Google Docs when its preservation matters. If a guard refuses because a comment quote or unrecreatable content would be removed, stop; do not add `force` without approval.

Final response (after successful verification): "Updated the launch-readiness line and added the two-item plan. The schematic is still in the section; please confirm the reviewer comment thread in Google Docs."

This second example is illustrative, not a recorded run or proof of live comment-anchor verification.

## Agent E2E Testing

Agent E2E testing asks whether an agent can complete realistic Google Docs tasks with the current gdocsmith tool and skill, and where its instructions or tool surface need improvement.

After authentication and `just setup`, run a read-only pilot, then choose realistic tasks:

```bash
just test-e2e --case outline-headings --runs 1 --pilot
just test-e2e --case placeholder-fill copy-section new-tab --runs 2
```

Each attempt launches a fresh isolated Claude session using the current checkout's built MCP bundle and skill, with a new disposable copy of the complex source fixture. The scenarios cover multiple tabs, nested sections, lists, tables, images, links, and guards. The runner independently checks the requested result and preservation of unrelated content; it records prompts, tool events, final answers, checks, and usage in a new private directory under `~/.cache/gdocsmith/evals/` for each invocation. Inspect `report.md` and the corresponding JSONL traces for failures or opportunities to improve agent guidance and tool behavior. Fixture copies are permanently deleted even on failure unless `--keep-docs` is explicitly supplied; the source is never edited.

Review-sensitive comment anchors have only synthetic guard coverage so far; do not treat a passing scenario as live proof that UI-authored comments were preserved.

## Test Suites

| Suite | Command | What it checks |
| --- | --- | --- |
| Unit and offline model tests | `just test` | Source and script tests, including emulator, lens laws, and the offline E2E runner. Local cached-document corpus tests run when snapshots exist. |
| Offline MCP integration | `just test-mcp` | JSON-RPC over stdio against the source server and built Node bundle; no Google authentication needed. |
| Live Google integration | `just test-live` | Docs API conformance, fixture workflow, and end-to-end core tests on scratch documents; requires `gws` authentication and deletes test copies. |
| Agent E2E | `just test-e2e --case outline-headings --runs 1 --pilot` | A restricted Claude session on a disposable fixture copy, checked independently. After the pilot, select cases with `just test-e2e --case placeholder-fill new-tab --runs 1`. Requires `gws` authentication and Claude Code access. |

`just test-all` runs the first three suites once each. `just lint` checks source formatting without writing; `just typecheck` checks TypeScript. `just check` also formats source files in place before running lint, typecheck, and unit tests.

## MCP Tools

- `run`: Read and edit Google Docs through ordered `doc`, `query`, `write`, `edit`, `remove`, `style`, `table`, `tab`, `share`, and `page` steps.
- `status`: Report the installed version.

The MCP server exposes the gdocsmith skill at `gdocsmith://docs/skill`.

## Install

### Cursor

Import `https://github.com/bdombro/gdocsmith` from Cursor's Team Marketplaces.

### Claude Code

```bash
/plugin marketplace add bdombro/gdocsmith
/plugin install gdocsmith@gdocsmith
```

### Authentication

Authenticate the Google Workspace CLI before using the plugin:

```bash
gws auth login
gws auth export
```

## Local Development

```bash
git clone https://github.com/bdombro/gdocsmith.git
cd gdocsmith
just setup
just check
just build
```

`just plugin-claude-update` refreshes the installed Claude Code plugin and then requires a Claude Code restart. During argsbarg work, use `just argsbarg-local`; return to npm with `just argsbarg-published 7.1.2` before committing.

## Documentation

- [Agent skill](skills/gdocsmith/SKILL.md)
- [MCP reference](docs/mcp.md)
- [CLI reference](docs/cli.md)
- [Architecture](docs/architecture.md)
- [Markdown lens](docs/markdown.md)
- [Guards](docs/guards.md)