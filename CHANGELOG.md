# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `kind: query` `output: markdown` | `yaml` | `nodes` (default) so agents can dump a document, tab, or `under:` section as markdown/YAML; query with `as:` writes `dumped` immediately. `stylesOnly`, `unsafeOnly`, and `full` are honored. Filtered queries with zero matches throw.
- Run adapter forwards every `TapeMutation` field through `kind: surgical` (chips, table grid, clone, `insertMarkdown`, …). Document `pageSetup` applies on live writes; `dangerousClear` wipes a tab before a surgical mutation.
- Adapter completeness tests: `TAPE_MUTATION_KEYS` must stay in sync with `TapeMutation`, and `query.ts` must read every query-only step field.
- Support for filtering query selectors by list nesting level (`[level=N]`, `[nestingLevel=N]`, `[bullet:N]`, `:level(N)`).
- Preserved bullet formatting metadata (`bullet: { nestingLevel, preset, type }`) in `kind: query` dumped output and `NodeSummary`.
- Annotated bullet nesting level (`[bullet:N]`) in query sibling dumps and missing-scoped-target diagnostics.
- Comprehensive documentation of list indentation mechanics, leading tab conversion, 18pt hanging indents, and nesting level immutability in `docs/features.md`.
- Created `docs/architecture.md` maintainer reference covering DOM tape modeling, scoped ID generation, workflow orchestration, LCS diffing, and anti-demolition guards.
- Aligned codebase with `AGENTS.md` code quality rules:
  - Single-line `/* core-responsibility */` file headers across `src/**` and `scripts/**`.
  - Comprehensive JSDoc on production code (`src/**`, `scripts/**`; tests and `__generated__` excluded).
  - Target-oriented naming across DOM, core services, CLI modules, and workflow step kinds (`docCreate`, `docCopy`, `markdownInsert`, …).
  - Sorted module imports and alphabetized type/interface properties and object literals where the naming pass touched code.
  - Path aliasing with `~/` across domain modules.

### Changed
- `diffAndApplyMarkdown` (`replaceSection` / `replaceMarkdown`) now detects changes in list item `nestingLevel` or bullet preset, replacing the item with proper leading tabs instead of attempting an in-place `innerText` rewrite.
- Markdown export and snapshotting (`exportDocumentToMarkdown`, `exportTabToMarkdown`) now formats consecutive list items into tight Markdown lists without extraneous blank lines between items.
- `chunkOpsBuild` properly handles `replaceAnchor` on blank document initialization when starting with nested list items or tables by inserting and removing the blank anchor, avoiding `EXISTING_NEST_MSG` failures.
- Workflow step anchors (`at`, `after`, `before`) are typed and schematized as strings only (heading-scoped ids from `kind: query`); tape-index numbers remain on `TapeMutation` for direct DOM apply.
- `commands/run/types.ts` exports only schemagen run I/O types (`GdocsmithDocument`, `GdocsmithJsonOutput`); workflow wire types live in `core/workflowTypes.ts` only.
- Refactored DOM apply pipeline: `applyCompile.ts` (compile mutations → API requests) and `applyBatch.ts` (batchUpdate execution + error mapping); `apply.ts` re-exports.
- Introduced `src/core/workflowTypes.ts` to break the `commands/run/types` ↔ `actions/types` import cycle.
- Workflow naming: runtime `stepsExecuted`, JSON `stepsCount` only; run input uses `steps` only (removed `ops` document alias); dropped `ApplyDocument` / `ApplyOpInput` type aliases.
- Surgical workflow steps use `domOpFromStep` (forwards all `TapeMutation` keys) + `surgicalMutationExecute`; explicit handlers for `innerText`, `remove`, `replace`, and `textReplace`.
- Renamed surgical write type to `TapeMutation` (`DomOp` alias) and planner entrypoint to `tapeMutationsApply` (`applyOps` / `opsApply` aliases); `tableAlignment` is typed and refused at apply time.
- Split workflow step handlers into `src/core/actions/` (one module per explicit kind; surgical steps in `surgical.ts`); `applyScript.ts` keeps session orchestration and dry-run diffs.
- Renamed hyphenated TypeScript module paths to camelCase (e.g. `applyScript.ts`, `markdownParser.ts`, `docCreate.ts` under `actions/`).
- Removed workflow backwards compatibility: legacy step-kind names (`createDoc`, `insertMarkdown`, …), `op` / `step` / `action` kind aliases, omitted-kind inference, and wire field aliases (`docId`, `tabId`, `target`, `insertMarkdown` on steps); each step requires explicit `kind`.
- Tightened run step typing with `WorkflowStepKind` and DOM batch error plans with `AppliedOpPlanPreview`.
- Replaced legacy `gws-docs-edit` naming in Google Drive image folder hierarchy (`googleworkspace-cli/gdocsmith/images`) and removed outdated configuration environment variable references.
- Cleaned up documentation drift across `README.md`, `docs/mechanics.md`, `docs/guards.md`, `docs/markdown.md`, and `docs/comments.md`.
- Purged obsolete legacy CLI flags, raw integer index examples, and outdated package references.
- Clarified markdown ingestion and native chip capabilities across reference guides.
- Moved operational rules and surgical authoring tips into `run` command `notes` (visible in CLI help and MCP tool descriptions).
- Streamlined `skills/gdocsmith/SKILL.md` to focus on intent routing and the core workflow execution model.
- Agent skill and `run` MCP notes: alias binding vs `dump`, `query` `output: markdown` / `yaml` for full-doc/tab/section reads, probe-first workflow, halt-on-error guidance.
- Markdown export (`kind: query` + `output: markdown`) is body-only; custom styles and omissions live on `audit`. Insert custom `::styleName[]::` styles via flattened `markdownStyles` (in-body `---` is a page break). Dropped `markdownFrontmatter` / `frontmatter`.

### Fixed
- Dry-run `markdownInsert` inserts successive elements after the previous insert so tape order matches live apply.
- Surgical `insertMarkdown` / `replaceMarkdown` / `replaceSection` honor sibling `h1IsTitle` (it is no longer stuffed into a frontmatter bag that parse ignored).

[Unreleased]: https://github.com/bdombro/gdocsmith/compare/v1.0.0...HEAD
