# gdocsmith

AI-optimized surgical authoring and workflow engine for Google Docs. CLI and MCP server.

Workflows are an ordered list of `steps`. Each step has a `kind` (`open`, `docCreate`, `query`, `dump`, `markdownInsert`, surgical edits, …). A single `run` invocation can query, create, mutate across multiple docs without extra round trips.

## Motivation

The Google Docs REST API sucks:

1. **High-friction Markdown Ingestion (**`markdownInsert`**)**: Agents naturally produce markdown specs, RFCs, and runbooks. Translating markdown into Docs previously forced agents to construct hundreds of verbose JSON AST payloads, write custom scripts, or make fragile line-by-line character writes.
2. **Fragile Character Offsets**: The raw REST API reads and edits via absolute character indices (`startIndex`/`endIndex`) — similar to editing an XML document using string slices. Any concurrent change or index drift causes off-by-one errors, heading clobbering, and document corruption. `gdocsmith` introduces stable DOM node IDs (`kind: query` & surgical steps), eliminating character math. Drive `pinHead` before mutation provides safe undo via Version history.
3. **Simple things are hard**: Outlining and querying a doc, bulk replacements, dry-run diffs, or even small text updates require complex multi-step orchestration.
4. **Missing Core REST API Endpoints**: While the Google Docs web UI allows easily managing tabs and duplicating content, the REST API only creates blank tabs. `gdocsmith` provides tab management (`kind: tabAdd` / `tabRename` / `tabDelete`) and high-fidelity node cloning (`cloneNode`) within and across documents.
5. **Silent Pitfalls & Error Recovery**: The Docs API silently rejects or mangles edits that delete trailing body newlines, mix table inserts with text edits, nest bullets incorrectly, or overwrite named styles. Built-in guardrails block these pitfalls pre-flight to protect document integrity.
6. **Aesthetics & Taste Guidance**: Agents often make silly decisions for styling, like using custom styles for headings for no good reason or using a bullet symbol instead of a real bulleted list. [docs/style.md](docs/style.md) codifies decent default patterns directly into the CLI workflows.


How we block drift and common mistakes: [docs/guards.md](docs/guards.md).

## Quick start

Requires [Homebrew](https://brew.sh), [just](https://just.systems), and [Bun](https://bun.sh):

```bash
brew install just bun
just setup
just schemagen
just run run --help
```

Auth uses `gws auth export` (same credentials as other Google Workspace skills).

## Commands

- **`gdocsmith run`** — Execute a YAML/JSON workflow (`steps` with `kind`). Primary MCP tool.
- **`gdocsmith status`** — Print app version.

## Example

```yaml
dryRun: true
steps:
  - kind: docCreate
    title: Architecture Spec
    as: spec
  - kind: markdownInsert
    doc: spec
    markdown: |
      # Architecture Spec
      Initial overview.
  - kind: query
    doc: spec
    contains: Overview
    as: heading
  - kind: dump
    as: heading
```

```bash
gdocsmith run < spec.yaml
```

MCP: `gdocsmith mcp` or `gdocsmith configure install`.

## Docs

| Need | File |
| --- | --- |
| Agent router | [skills/gdocsmith/SKILL.md](skills/gdocsmith/SKILL.md) |
| Architecture / Internals | [docs/architecture.md](docs/architecture.md) |
| Edit loop | [docs/runbook-diagram.md](docs/runbook-diagram.md) |
| Selectors / ops | [docs/mechanics.md](docs/mechanics.md) |
| Taste | [docs/style.md](docs/style.md) |
| Markdown | [docs/markdown.md](docs/markdown.md) |
| Feature matrix / loss | [docs/features.md](docs/features.md) |
| Guards | [docs/guards.md](docs/guards.md) |
| Images | [docs/images.md](docs/images.md) |
| Comments | [docs/comments.md](docs/comments.md) |
| Generated CLI / MCP | `just docgen` → [docs/cli.md](docs/cli.md), [docs/mcp.md](docs/mcp.md) |

