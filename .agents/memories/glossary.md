# Made with /thread-memory

## Meta
updated: 2026-09-18 08:20
scope: src/**, docs/**, skills/**, AGENTS.md, CHANGELOG.md
counts: 9 terms

## Terms
as:
current: Document or step result alias binding within a single workflow run, used to reference docs/tabs across sequential steps without persisting state.

DomWriter:
current: In-memory AST and mutation accumulator in src/core/dom/write.ts that stages document modifications across workflow steps and flushes them as a single batchUpdate at execution completion.

fail-closed:
current: Validation strategy on tabCreate with fromTab: that blocks tabs containing elements Google Docs REST API cannot recreate (Drive-only images, equations, footnotes, unsupported smart chips, TOC) unless force: true is specified.

nodeAt:
current: Positional anchor specifier targeting an exact heading title, scoped node ID, or outline path in the target document.

pageless:
current: Google Docs document layout mode (mode: "PAGELESS") that renders continuous unpaginated content without printed page breaks or margins.

replaceSection:
current: Workflow step kind that replaces an entire heading and its outline body tree up to the next sibling or parent heading.

stepKind:
current: Discriminated union key on every workflow step input (kind: ...) providing compile-time type safety and strict per-variant JSON schemas.

symbolicLink:
current: Cross-tab or intra-document markdown link format ([Label](tab:TabTitle#HeadingTitle) or [Label](#HeadingTitle)) compiled by linkResolver to native Google Docs deep links.

tape:
current: Ordered body.content elements within a Google Docs tab or segment where headings and paragraphs are linear siblings.
