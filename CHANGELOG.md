# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Direct placeholder targeting in `replace` and `replaceMarkdown` via `find:` (or text snippets in `nodeAt:`), allowing agents to replace placeholder paragraphs with rich formatted Markdown (lists, formatting, bold) while preserving child subsections.
- Turn budget, batching ratio, recovery loops, and dry-run thrashing metrics tracking in `.cursor/skills/gdocsmith-e2e/SKILL.md`.
- Extended cache usage: table-fill paths in `applyBatch` use `Gdoc.load` with revision-locked fills; lifecycle steps invalidate cache on delete/trash/rename; live `replace` clears cache after mutations; cross-doc clone resolution forwards the runtime client; dry-run workflows preload `docOpen` targets in parallel; `DriveClient.userDomainGet` memoizes workspace domain.
- Two-tier document snapshot caching (`DocCache`) in memory and SQLite at `~/.cache/gdocsmith/db.sqlite` with dual TTL freshness (TTL1: 10s stale-while-revalidate, TTL2: 5m hard check / memory GC) and in-flight promise deduplication.
- Dual-runtime SQLite abstraction (`SqliteDatabase`) seamlessly bridging `bun:sqlite` in Bun and `node:sqlite` in Node without native C++ compilation or external dependencies.
- Shared `fetchWithRetry` network utility with exponential backoff on transient network errors, HTTP 429 rate limits, and 5xx server errors.
- Native Docs API write locking using `writeControl.requiredRevisionId` on `batchUpdate` requests to prevent stale index corruption.
- Automatic declarative step mutation replay in `pendingWritersFlush` backing off up to ~2 minutes across revision conflicts, refreshing the cloud document and re-anchoring mutations against updated character offsets.
- Drive `headRevisionIdGet` method on `DriveClient` for fast, lightweight cloud revision freshness verification.
- Adopted `/thread-memory` for tracking agent thread context, decisions, and glossary in `.agents/memories/`, documented in `AGENTS.md`; ported foundational memories from `gws-docs-edit` and backfilled 2026-09-16–18 thread files from Cursor transcripts; added `scripts/extractTranscriptMemoryHints.ts` for future ingest.
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
- Upgraded `sectionCopy` to transfer AST node specs (`elementSpecFromNode`) directly between documents and tabs instead of round-tripping through Markdown export, losslessly preserving images, chips, styles, and tables.
- Generalized `replaceSection` and `replaceMarkdown` to accept AST `ElementSpec[]` arrays directly alongside Markdown text.
- Generalized child heading deletion protection in `replaceSection` across all heading levels (`TITLE`, `HEADING_1` through `HEADING_6`) instead of restricting to top-level headings, failing upfront with a descriptive error naming the child headings when a caller attempts to overwrite a parent section without `force: true` and ending with an explicit bypass instruction (`To bypass, pass force: true.`).
- Documented 3-phase workflow batching guidance and creation-time tab title positioning rules in `skills/gdocsmith/SKILL.md` and `run` notes to prevent upstream Google Docs API rename bugs.
- Codified Engineering & Triage Principles and Agent Decision Boundaries in `AGENTS.md` (root-cause fixes over easiest patches, never coddling lazy client agents with permissive fallbacks or aliases, preventing schema and context bloat, not treating every client failure as a bug to fix), and streamlined `.cursor/skills/gdocsmith-e2e/SKILL.md` triage instructions to delegate directly to `AGENTS.md`.
- Documented a When to Halt policy in `AGENTS.md`: argsbarg shortcomings are fixed in the argsbarg repo, not worked around here.
- `tabCreate` with `fromTab` / `cloneNode` now reconstructs person, date, and rich-link chips plus public https images via native insert requests. Fail-closed still blocks Drive-only images, footnotes, equations, unsupported chips, TOC, and horizontal rules unless `force: true`.

### Fixed
- Preserved bullet preset and numbering type when reconstructing `DocNode` from `ParagraphSpec` in `write.ts`, ensuring numbered decimal lists serialize properly.
- Replaced paragraphs in `diffAndApplyMarkdown` when special content (images, smart chips) changes, preventing image loss during diff replacement.
- Fixed `insertRichLink` request payload to omit `mimeType` and `title`, complying with Google Docs API requirements that rich link insertion requests must only specify `uri`.
- Invalidate `docCache` and force-refresh document state immediately after `batchUpdate` across all tab operations (`tabCreate`, `tabDelete`, `tabRename`, `tabMove`), `pageSetup`, and `elementsInsertExecute`, preventing stale-cache hits from throwing `Unknown tab` on newly added tabs.
- Fixed date chip parsing (`parseChips` / `dateTimestampFromProps`) to extract ISO timestamps from Google Docs API `dateElementProperties.timestamp`, enabling lossless cloning of date smart chips.
- Fixed inline image parsing (`parseImages`) to extract Google Docs API `imageProperties.contentUri` as a fallback when `sourceUri` is empty, enabling lossless reconstruction of user-uploaded images.
- Fixed `docCreate` in live mode to load the created document from Google Docs via `Gdoc.load` instead of retaining a synthetic stub with hardcoded tab title `"Main"`, matching Google Docs' real default tab title (`"Tab 1"`), and aligned tab resolution to match root tab `t.0` when referencing default tab names.
- `DocCache` TTL revalidation now compares Docs API `revisionId` via `DocsClient.revisionIdGet` instead of Drive `headRevisionId` (always undefined for Google Docs), avoiding full document re-download on every stale-while-revalidate check.
- Smart chip cloning no longer throws when `InlineChip.uri` is omitted (date chips, email-only person chips).
- Symbolic heading links resolve full heading anchors from scoped ids (`h.heading_N`) instead of truncating to `#heading=h`.
- `domOpFromStep` honors shorthand anchor fields `at`, `after`, and `before` alongside `nodeAt` / `nodeAfter` / `nodeBefore`.
- `docCreate` calls `runtime.client.createDocument` when the injected client provides it.
- `tabCreate` blank-tab live path fails closed when `addDocumentTab` omits `tabId` instead of retaining a virtual tab id.
- `tabDelete` rejects deleting the sole remaining tab, and dry-run removes the tab from simulated document state.
- `textReplace` with `nodeAt` or `nodeUnder` performs scoped find-and-replace (via `regexReplaceExecute`) instead of overwriting the entire node via `innerText`.
- Surgical table inserts flush pending writers when the table spec is in an `elements` array, not only a singular `element`.
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