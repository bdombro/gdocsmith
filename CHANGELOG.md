# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Two-tier document snapshot caching (`DocCache`) in memory and SQLite at `~/.cache/gdocsmith/db.sqlite` with dual TTL freshness (TTL1: 10s stale-while-revalidate, TTL2: 5m hard check / memory GC) and in-flight promise deduplication.
- Dual-runtime SQLite abstraction (`SqliteDatabase`) seamlessly bridging `bun:sqlite` in Bun and `node:sqlite` in Node without native C++ compilation or external dependencies.
- Shared `fetchWithRetry` network utility with exponential backoff on transient network errors, HTTP 429 rate limits, and 5xx server errors.
- Native Docs API write locking using `writeControl.requiredRevisionId` on `batchUpdate` requests to prevent stale index corruption.
- Automatic declarative step mutation replay in `pendingWritersFlush` backing off up to ~2 minutes across revision conflicts, refreshing the cloud document and re-anchoring mutations against updated character offsets.
- Drive `headRevisionIdGet` method on `DriveClient` for fast, lightweight cloud revision freshness verification.
- Adopted `/thread-memory` for tracking agent thread context, decisions, and glossary in `.agents/memories/`, documented in `AGENTS.md`.
- Refactored `GdocsmithStepInput` from a flat interface into a discriminated union on `kind`, enforcing compile-time type safety and strict per-variant `required: [...]` schemas for MCP tools and CLI input.
- Unpacked content mutation operations into discrete discriminated step types (`StepMarkdownInsert`, `StepReplaceSection`, `StepReplaceMarkdown`, `StepReplace`, `StepTextReplace`, `StepSectionCopy`, `StepRemove`, `StepSurgical`), eliminating catch-all optional properties and giving each step kind explicit required fields.
- Consolidated tab creation into a unified `tabCreate` step supporting blank tab creation and structured tab cloning via `fromTab:`, requiring `as:` alias binding for downstream referencing.
- Merged document cloning into `docCreate` via optional `fromDoc:` parameter, deprecating separate `docCopy` step.
- In-memory `DomWriter` mutation accumulation across sequential workflow steps in `applyScriptExecute`, batching surgical mutations into a single `batchUpdate` request per document at script completion and eliminating N+1 API round trips.
- Fail-closed validation on `tabCreate` with `fromTab:` when copying tabs containing leftovers the Docs REST API cannot reconstruct (Drive-only images, math equations, footnotes, unsupported chips, TOC), requiring `force: true` to proceed with lossy conversion and providing actionable instructions for Google Docs UI duplication. Recreatable person/date/richLink chips and public https images copy natively.
- Automatic local plugin synchronization in `agent-e2e` recipe (`just install-plugin-cursor`).
- Document layout mode (`mode: "PAGES" | "PAGELESS"` and `pageless: boolean`) support in `PageSetup`, `buildDocumentStyleRequest`, and `pageSetupExtract`.
- New `kind: "pageSetup"` workflow step supporting whole-doc and per-tab layout mode toggling and geometry updates.
- Automatic layout mode detection in `query` dumps for single tabs and multi-tab documents.
- In-repo Cursor Plugin manifests: `.cursor-plugin/plugin.json` and `mcp.json`.
- In-repo Claude Code Plugin manifests: `.claude-plugin/plugin.json` and `.mcp.json`.
- Standalone zero-dependency Node MCP server entrypoint at `scripts/mcp.mjs` via `bun build --target=node`.
- `just build-mcp` and `just install-plugin-cursor` recipes for local development and Cursor testing.
- Added `"headings"` as a supported alias for `"outline"` in `kind: "query"` `output:` parameter.
- Documented Cursor Auto-review guidelines for dry-run inspection in `run` operational notes and agent skill rules.

### Changed
- Documented a When to Halt policy in `AGENTS.md`: argsbarg shortcomings are fixed in the argsbarg repo, not worked around here.
- `tabCreate` with `fromTab` / `cloneNode` now reconstructs person, date, and rich-link chips plus public https images via native insert requests. Fail-closed still blocks Drive-only images, footnotes, equations, unsupported chips, TOC, and horizontal rules unless `force: true`.

### Fixed
- `status` MCP/HTTP handler now returns `{ version }` instead of only writing CLI stdout, fixing "Handler did not call ctx.respond() or return a value".
- `tabCreate` fail-closed errors now put uncreatable-element counts (chips, images, equations, footnotes, TOC) on the first line so MCP first-line truncation still names the blockers and the UI Duplicate / `force: true` remedies.
- Resolved paradoxical "heading not found" error in `symbolicLinkResolve` when linking to newly created or simulated headings that lack a server-generated Google Docs `headingId`, falling back to scoped IDs or tape index anchors.
- Fixed sequential numbering in markdown export and dry-run diffs (`nodesRenderToMarkdown`), tracking contiguous ordered list items per nesting level across interleaved nested bullets instead of emitting `1.` for every list item.
- Eliminated redundant duplicate `Gdoc.load` document re-downloads between chunks in `markdownInsertExecute` across multi-chunk markdown insertions.
- Replaced lossy markdown export/re-parse round-trip in `tabCopy` with direct AST element transfer via `elementSpecFromNode`, preserving typography, list presets, indents, and table structures.
- Skipped redundant initial markdown state captures and unified diff generation on live runs (`dryRun: false`).
- Fixed `replaceSection` node positioning when inserting into a heading with no existing body so new elements insert after the heading instead of before it.
- Fixed incomplete dry-run unified diffs for `replaceSection`, `replace`, and `replaceMarkdown` where body diffs were omitted due to stale markup overriding updated node text.
- Guaranteed explicit `diff` field in JSON output on `dryRun: true` (returning an empty string when 0 changes are detected instead of omitting `diff`).
- Clipped compiled `updateParagraphStyle` / bullet ranges so `endIndex` stays strictly below the tab segment end, fixing Google 400s when `replaceSection` restyles the last section of a tab.
- Cleared stale smart chips, font colors, and footnote IDs when updating paragraph text in `DomWriter`.
- Added terse warning to `title` input schema advising callers to supply final tab titles at creation time (`tabAdd`/`tabDuplicate`) to avoid upstream Google Docs API HTTP 500 failures on documents without root `t.0`.
- Enhanced `tabRename` error reporting to attempt the API call first and provide clear web UI guidance if Google returns HTTP 500 on docs lacking root `t.0`.

### Removed
- Removed outdated guidance mandating `dryRun: true` before every mutation from skill rules, CLI operational notes, and MCP tool documentation.
- Dropped deprecated step kinds `docCopy`, `tabAdd`, `tabCopy`, and `tabDuplicate` in favor of consolidated `docCreate` (with `fromDoc:`) and `tabCreate` (with `fromTab:`).
- Pruned duplicate and obsolete properties from public step input schema: `copyFrom`, `copyFromDoc`, `copyFromTab`, `emailAddress` (favoring `email`), `tableAlignment`, `replaceSectionMarkdown`, and internal `noop` flag.
- Dropped `bodyOnly` parameter from workflow types and DOM ops in favor of explicit 2-phase querying and surgical node targeting.
- Dropped implicit heading-stripping heuristics from `sectionCopy`.
- Dropped fuzzy cross-kind field resolution (`stepContentRead`) across workflow steps to ensure strict parameter typing.
- Dropped Homebrew distribution, formulas, and formula development scripts in favor of native Cursor and Claude Code marketplace plugins.

## [1.0.2] - 2026-09-17

## [1.0.1] - 2026-09-17

### Changed
- Everything