# gdocsmith

## Repository Shape

- `src/commands/run/` owns the public run schema and handler.
- `src/core/steps/` owns v2 step validation, mapping, output handling, and the
  orchestrator. `src/core/steps/types.ts` is the canonical input schema source.
- `src/core/engine/` owns the transaction, model, reconciliation, safeguards,
  and phased Google flushing.
- `src/core/model/`, `src/core/lens/`, `src/core/reconcile/`, and
  `src/core/emulator/` are the v2 content engine.
- `src/**/__generated__/` is generated and never hand-edited.

The public result is `GdocsmithRunResult`. A result for a particular input step
is always found at `steps[i]`; do not introduce detached result maps or aliases.

## Tooling

- Use Bun for source development and tests; the shipped MCP bundle targets Node.
- Run `just schemagen` after changing `/** @sg */` types.
- Run `just check` before every milestone commit.
- Run `just build` before testing the bundled MCP server.
- `__generated__/` is ignored. Do not stage it.
- Do not commit a local `file:../bun-argsbarg` dependency. Use
  `just argsbarg-published 7.1.2` before committing.

## Argsbarg

When changing a command schema or MCP behavior, read the relevant docs under
`node_modules/argsbarg/docs/`. Use `satisfies CliProgram` and `satisfies CliLeaf`.
Keep MCP schemas discriminated, concise, and within the configured tool-size
budget.

## Code Conventions

- Use a one-line `/* ... */` file header.
- Use JSDoc for public symbols and non-obvious internal logic.
- Put exports before private helpers; order imports and object keys alphabetically
  when no semantic order matters.
- Use camelCase file names and `.ts` extensions.
- Prefer `~/` imports only when traversing upward from a source module.
- Keep single-use helpers local unless reuse or complexity warrants extraction.
- Add a concise `[Unreleased]` CHANGELOG entry for behavior changes.

## Runtime Rules

- Use `run` for Google Docs work; never calculate offsets or call Docs APIs from
  a command handler.
- Preserve fail-closed safeguards and revision locking.
- Do not add compatibility aliases or permissive coercions.
- A run may partially send only when a later phase fails. Keep errors explicit
  about landed and unsent phases.
- `force` is step-scoped. Never broaden it to a run-wide escape hatch.

## Documentation

Keep [README.md](README.md), [skills/gdocsmith/SKILL.md](skills/gdocsmith/SKILL.md),
and this file aligned with the ten v2 kinds: `doc`, `edit`, `page`, `query`,
`remove`, `share`, `style`, `tab`, `table`, and `write`.

## Development Loop

`just plugin-claude-update` refreshes the cached Claude Code plugin. The command
falls back to uninstall/install because plugin update is version-gated rather
than content-aware. Restart Claude Code after it succeeds.