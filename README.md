![Logo](logo.png)
<!-- https://patorjk.com/software/taag/#p=display&f=Double&t=gdoc+smith&x=none&v=4&h=4&w=80&we=false -->

# gdocsmith - ai plugin

**The missing intelligence layer between AI coding agents and Google Docs.**

Giving an AI agent direct access to Google APIs is a recipe for disaster. Because the native API is very limited and finicky, agents routinely make mistakes and aren't able to detect or recover from many mistakes. It's common to completely break a page, butcher the layout, make so many mistakes that it's not worth using AI at all.

`gdocsmith` helps agents avoid mistakes altogether, while also reducing effort 10x.

## Why Google Docs breaks AI agents

The native Docs API was designed for batch backend scripts, not LLMs:

1. **Fragile character offsets**: Edits rely on absolute character indices (`startIndex`/`endIndex`). Any upstream edit shifts every offset, guaranteeing off-by-one errors and clobbered headings.
2. **No native Markdown**: Inserting basic Markdown requires dozens of deeply nested JSON structures (`insertText`, `updateTextStyle`, `createParagraphBullets`).
3. **Destructive rewrites**: Because surgical edits are hard, agents wipe whole sections—destroying inline human comments, suggestion tracks, and revision history.
4. **No structural awareness**: No way to query document outlines, check list nesting, diff changes, or clone nodes.
5. **Silent formatting corruption**: A single missing newline or misordered list call silently breaks document layout.

## How gdocsmith fixes it

`gdocsmith` gives agents safe, surgical hands:

- **Stable scoped IDs (`h.arch.9a1b`)**: Outline nodes use heading-scoped checksums instead of volatile character offsets, letting agents target content reliably across revisions.
- **Native Markdown**: Agents author in standard Markdown (headings, lists, tables, callouts, code blocks); gdocsmith compiles it directly into native Google Docs styled elements.
- **Semantic color & callout queries (`fontColors: ["red"]`, `["!default"]`)**: Find warnings, blockers, and review marks by color name or exclusion without decoding raw RGB floats.
- **2D table & list scoping (`rows`, `cols`, `sameList`)**: Target specific cells (`h.arch.table.0.1.3c8f`) without clobbering column widths, and treat bullet lists as logical subtrees.
- **Zero turn tax**: Batch document creation, tab management, queries, and edits into a single 5-second tool call with in-memory aliasing (`as:` → `doc:`, `tab:`).
- **Anti-demolition guardrails**: Blocks agents from deleting and recreating unchanged text, protecting human comments and version history ([docs/guards.md](docs/guards.md)).
- **Single declarative MCP tool**: One `run` workflow contract instead of 15+ chatty tools, cutting prompt bloat and hallucinations.
- **Aesthetic defaults**: Native Google Docs styling presets prevent ugly agent formatting hacks ([docs/style.md](docs/style.md)).

## How it works

Workflows run in three simple steps:

1. **Inspect**: Query headings, bullet trees, table rows/cols, or text colors (`query`). Matches return stable IDs (e.g. `h.arch.9a1b`, cell `h.arch.table.0.1.3c8f`).
2. **Mutate**: Target verified IDs with surgical edits or Markdown insertions (`nodeAt`, `nodeAfter`, `nodeBefore`, `nodeUnder`).
3. **Batch**: Chain creation (`docCreate`), tabs (`tabCreate`), and insertions in one pass using aliases (`as: "spec"` → `doc: "spec"`).

### Workflow Example

```json
{
  "dryRun": false,
  "steps": [
    { "kind": "docCreate", "title": "Architecture RFC", "as": "rfc" },
    {
      "kind": "markdownInsert",
      "doc": "rfc",
      "markdown": "# Architecture RFC\n\n## Overview\n\nThis RFC proposes the document transformation pipeline.\n\n## Components\n\n- Ingestion engine\n- Transformation pipeline"
    },
    {
      "kind": "query",
      "doc": "rfc",
      "contains": "Components",
      "as": "componentsHeading"
    }
  ]
}
```

The query result in `dumped.componentsHeading` contains the matching node ID (`h.comp.2c4e`), which can be targeted in subsequent steps without computing character offsets.

## Installation & Setup

### 1. Cursor Plugin

Install directly via the Cursor Marketplace, or link for local development:

```bash
git clone https://github.com/bdombro/gdocsmith.git
cd gdocsmith
just install-plugin-cursor
```

The plugin automatically provides `.cursor-plugin/plugin.json`, `mcp.json`, and the bundled zero-dependency Node runner at `scripts/mcp.mjs`.

### 2. Claude Code Plugin

`gdocsmith` includes native Claude Code plugin manifests:
- `.claude-plugin/plugin.json`
- `.mcp.json`

### 3. Authentication

`gdocsmith` uses credentials from the official Google Workspace CLI ([`gws`](https://github.com/googleworkspace/cli)). If you have `gws` installed and authenticated (`gws auth login`), no additional setup is required.

## MCP Tools

- `run` *(Primary)*: Execute an ordered Google Docs workflow from JSON (`steps` with `kind`).
- `status`: Print application version and verify environment health.

## CLI Usage (Testing & Debugging)

The CLI is provided for local testing, dry runs, and piping JSON workflows during development:

```bash
gdocsmith run < workflow.json
```

See [docs/cli.md](docs/cli.md) for full CLI documentation and options.

## Documentation

| Need                                | File                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| Agent skill router                  | [skills/gdocsmith/SKILL.md](skills/gdocsmith/SKILL.md) |
| MCP server reference                | [docs/mcp.md](docs/mcp.md)                             |
| CLI reference (testing & debugging) | [docs/cli.md](docs/cli.md)                             |
| Architecture / maintainer guide     | [docs/architecture.md](docs/architecture.md)           |
| Edit loop & runbook                 | [docs/runbook-diagram.md](docs/runbook-diagram.md)     |
| Selectors & DOM ops                 | [docs/mechanics.md](docs/mechanics.md)                 |
| Aesthetic & formatting taste        | [docs/style.md](docs/style.md)                         |
| Markdown ingestion                  | [docs/markdown.md](docs/markdown.md)                   |
| Feature matrix & API limits         | [docs/features.md](docs/features.md)                   |
| Guardrails & anti-demolition        | [docs/guards.md](docs/guards.md)                       |
| Images                              | [docs/images.md](docs/images.md)                       |
| Comments                            | [docs/comments.md](docs/comments.md)                   |
