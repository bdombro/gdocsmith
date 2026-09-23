# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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