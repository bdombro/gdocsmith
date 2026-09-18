# Made with /thread-memory

## Meta
updated: 2026-09-18 09:07
scope: src/**, docs/**, skills/**, .agents/memories/**, AGENTS.md, CHANGELOG.md
counts: 17 terms

## Terms
as:
current: Document or tab alias binding within a single run call; aliases do not persist across separate MCP invocations.

DocCache:
current: Two-tier document snapshot cache in memory and SQLite at ~/.cache/gdocsmith/db.sqlite with TTL stale-while-revalidate and hard freshness checks via Docs revisionIdGet plus in-flight deduplication.

DomWriter:
current: In-memory AST and mutation accumulator in src/core/dom/write.ts that stages document modifications across workflow steps and flushes as batchUpdate at pendingWritersFlush.

Drive-only-images:
current: Inline images stored in Drive that Google Docs REST insertImage cannot recreate from a public URL; tabCreate fromTab fail-closed unless force true.

fail-closed:
current: tabCreate with fromTab rejects when uncreatable-elements remain unless force true, with first-line counts and UI Duplicate guidance.

heading-scoped-id:
current: Stable target id from kind query output (for example h.arch.9a1b or table cell h.arch.table.0.1.3c8f) used in nodeAt and related anchors instead of integer tape indexes.

nodeAt:
current: Step field naming a heading-scoped id or anchor for replace, remove, or insert operations in the target doc tab.

pageless:
current: Document layout mode mode PAGELESS or pageless true for continuous unpaginated content.

replaceSection:
current: Step kind that diff-replaces a heading and its outline body until the next sibling or parent heading.

requiredRevisionId:
current: writeControl.requiredRevisionId on batchUpdate refusing stale snapshots; flush replays mutations after refresh on conflict.

revisionIdGet:
current: Lightweight documents.get with fields=revisionId on DocsClient for DocCache freshness; Drive headRevisionId does not apply to Google Docs files.

stepKind:
current: Discriminated union key kind on every workflow step with strict per-variant MCP JSON Schema required arrays.

symbolicLink:
current: Markdown link forms tab:Tab#Heading or #Heading compiled in linkResolver to native Google Docs deep links.

t.0-root-tab:
current: Legacy template docs sometimes lack root tab id t.0; tabRename and tabMove may HTTP 500 so set title on tabCreate.

tape:
current: Ordered body.content siblings in a tab; headings do not wrap following paragraphs.

uncreatable-elements:
current: Tab copy blockers including Drive-only images, equations, footnotes, unsupported chips, TOC, and horizontal rules unless force true.
