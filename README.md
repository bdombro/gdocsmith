# gdocsmith

`gdocsmith` gives agents one transactional `run` tool for reading and editing
Google Docs. It works from document structure and markdown rather than character
offsets, preserving untouched content whenever possible.

## How It Works

Each run validates all steps, loads documents into an in-memory model, plans a
minimal Google Docs request set, evaluates safety findings, and then sends work
in revision-locked phases. `dryRun: true` returns the same plan without sending.

Use the smallest scope that covers the change: query an outline, query markdown
for a section or node, make the edit, then inspect the returned diff and result.

```json
{
  "steps": [
    { "kind": "doc", "action": "create", "as": "rfc", "title": "Architecture RFC" },
    { "kind": "write", "doc": "rfc", "append": true, "markdown": "# Architecture RFC\n\n## Overview\n\nDraft content." },
    { "kind": "query", "doc": "rfc", "output": "outline" }
  ]
}
```

## MCP Tools

- `run`: Read and edit Google Docs through ordered `doc`, `query`, `write`,
  `edit`, `remove`, `style`, `table`, `tab`, `share`, and `page` steps.
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

`just plugin-claude-update` refreshes the installed Claude Code plugin and then
requires a Claude Code restart. During argsbarg work, use `just argsbarg-local`;
return to npm with `just argsbarg-published 7.1.2` before committing.

## Documentation

- [Agent skill](skills/gdocsmith/SKILL.md)
- [MCP reference](docs/mcp.md)
- [CLI reference](docs/cli.md)
- [Architecture](docs/architecture.md)
- [Markdown lens](docs/markdown.md)
- [Guards](docs/guards.md)