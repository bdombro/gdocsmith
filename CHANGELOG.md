# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The fragile-node guard now also refuses removing or rewriting a paragraph containing an inline image (in-place `innerText` is exempt and keeps the image), a horizontal rule, or a footnote reference, and refuses removing a table whose cells hold images — all without `force: true`. Previously only equations, smart chips, and Table of Contents were protected, so `replaceSection`, `replaceMarkdown`, `replace`, and `remove` could silently destroy images, dividers, and footnote text the Docs REST API cannot recreate. `query`'s `unsafeOnly` filter and node `lossWarning` summaries now flag these too
- `tests/integration/mcpWire.test.ts` now runs its whole suite against both the TS source (`bun src/index.ts mcp`) and the built Node bundle (`node scripts/mcp.mjs mcp`), so a bug introduced only by bundling (or only exercised under `node`, which is how both Claude and Cursor actually launch gdocsmith) no longer slips past `just check`
- `just argsbarg-local` and `just argsbarg-published <version>` recipes for developing against a local `../bun-argsbarg` checkout and switching back to a published release

### Changed
- `src/commands/{run,status}/__generated__/` is no longer committed (it was accidentally tracked; AGENTS.md already documented it as gitignored). `build`, `test`, `typecheck`, `release`, and (transitively, via `build`) `test-live`/`test-wire` now depend on the `schemagen` recipe, so the schema is always regenerated fresh instead of relying on a possibly stale committed copy
- `sectionCopy` without an anchor appends to the end of the target tab when it lacks the source heading (previously failed)
- argsbarg `^7.1.1` — MCP tool errors now arrive in full (previously truncated to the first line, hiding recovery hints like "pass force: true" or the list of near-miss candidates on an unresolved anchor)

### Fixed
- `DocCache.get` returned an uncloned snapshot on a SQLite cache hit (both the fresh and stale-revalidating branches), and every in-flight in-memory dedupe caller shared one Gdoc instance. In the long-lived MCP server, a dry run's in-place tape mutation of that shared object could poison what a later, unrelated live write would compile against. Both paths now return an isolated `structuredClone`, matching the memory-cache and hard-validate paths, which already cloned

## [1.0.6] - 2026-09-23

### Removed
- `allowNoop` on mutation steps. It was added alongside the no-op rejection as an escape hatch for re-running a partially applied script, but batches are atomic — a failed batch writes nothing, so a re-run starts clean and produces no no-ops. The case it existed for cannot occur, and it cost seven schema fields (~2% of the input schema, paid on every tool-schema load) to suppress the very signal the rejection exists to give. A step that changes nothing is now always an error

### Changed
- `textReplace` returned `ok: true` when its `find` string was absent, having replaced nothing — the one missing-target case that stayed silent while `query`, `replace`, and `replaceMarkdown` all rejected. It now rejects on zero occurrences, using the `occurrencesChanged` count the replace helpers already returned and the handler discarded
- `QueryTextStyle` now covers the whole Docs `TextStyle` resource — `backgroundColor`, `baselineOffset`, `bold`, `fontFamily`, `fontWeight`, `link`, `smallCaps`, `strikethrough`, and `underline` join the original `fontSize`/`foregroundColor`/`italic`. It previously reported three properties, so a query could not tell a caller that a paragraph was bold, and `DomWriter.setStyle` had nowhere to record one. Queries are correspondingly more faithful, and node checksums (hence `scopedId` values) shift for styled nodes; ids are recomputed per parse and never persisted, so nothing needs migrating
- `DomWriter.setStyle` now mirrors every run-chrome property onto the working tape, and `cellBackground` on a table node fills every cell per its documented contract, so a later step in the same batch reads the restyled state. Default-dropping moved into a shared `queryTextStyleNormalize` used by both the parser and the writer, so a mirrored patch and a re-read cannot disagree
- Table cell summaries report `backgroundColor`; cell fill was previously invisible to queries

### Fixed
- Two more `applyScript.test.ts` cases reached the network under `dryRun` and intermittently timed out after 5s — `docOpen`/`docClose` opened a nonexistent document id, and the raw-doc-ID resolution case opened a live hardcoded document (the same hazard 1.0.4 fixed for a sibling test, missed here). Both now use in-memory fixtures and run in ~27ms

## [1.0.5] - 2026-09-23

### Fixed
- `DomWriter` recorded bullet restyles and table row/column operations without mirroring them onto the working node tape, so a later step in the same batch — a query, or a mutation resolving a cell scoped id — read the pre-mutation shape. `setBulletPreset`, `insertTableRow`, `deleteTableRow`, `insertTableColumn`, and `deleteTableColumn` now update the tape the way `setNamedStyleType` and `remove` already did. Compilation is unaffected: it resolves every range from `originalNodes()`, not the working tape

### Added
- `contains:` query matches now echo a `match` snippet windowed around the hit with the matched substring bracketed (`…is more effi[ci]ent…`). `contains` is an unanchored case-insensitive substring match, so a short term like `"ci"` silently matches "efficient" and "decisions"; the result previously showed only node ids and previews, giving no way to notice the search term was wrong
- `allowNoop: true` on mutation steps, to accept a step that intentionally changes nothing

### Changed
- Mutation steps that change nothing are now rejected instead of returning `ok: true`. A write that produces no change means the anchor resolved elsewhere, the content already matched, or an earlier step in the batch applied it — reporting success made a silent miss indistinguishable from a real edit, which pushed callers into re-reading the document after every write. Detection compares a content fingerprint of the working node tape before and after the step. Steps carrying `style` or `runs` are exempt: character-level styling compiles straight to batchUpdate requests without being mirrored onto the working nodes, so the tape cannot see it and a real restyle would be misread as a no-op. The exemption suppresses only the check — the requests are still emitted and applied
- Filtered `output: "nodes"` queries are now rejected when the serialized result exceeds ~20k characters, and the error lists the first five bracketed match snippets. Filtered queries had no cap at all (only unfiltered reads truncate via `liveDump`), so `full: true` plus an over-broad filter could return far more than a caller could read — and the resulting failure said only that the response was too large, never which term overmatched

## [1.0.4] - 2026-09-23

### Added
- Everything
- `forceFetch` option on `docOpen` and `docCreate` (`fromDoc`) to bypass the document snapshot cache for guaranteed-fresh reads when a doc may have changed outside gdocsmith

### Fixed
- `applyScript.test.ts`'s multi-tab `docOpen` coverage hit a live, hardcoded Google Doc over the network instead of a mock client; replaced with an in-memory fixture so the test no longer depends on that doc's mutable tab structure or on live credentials
- Bullet/numbered paragraphs built via `elementCreate` had no default paragraph style, so they inherited whatever `spaceAbove`/`spaceBelow` the surrounding prose carried at the insertion point — producing large visual gaps between list siblings despite correct numbering. Fixed at the shared `elementCreate` primitive (not just the markdown path) so every current and future caller (markdown lists, direct `surgical` bullet inserts) defaults to tight `spaceAbove: 0, spaceBelow: 0`, unless the caller supplies an explicit override