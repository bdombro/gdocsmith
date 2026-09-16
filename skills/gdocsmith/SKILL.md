---
id: gdocsmith
name: gdocsmith
description: >-
  Surgical Google Docs authoring via a single run workflow (create, copy, query, dump, insert markdown, replace).
  Use when the user wants to create, edit, query, or template a Google Doc. Prefer the gdocsmith MCP tool `run`.
  NEVER calculate character offsets or write raw documents.batchUpdate scripts.
enabled: true
---

# gdocsmith

> Auth: `gws auth export` credentials. If missing, run `gws generate-skills` / sign in with the shared Google Workspace skill.

Prefer one MCP `run` call with ordered `steps`. Do not generate bash heredocs for this app.

## Hard rules

- Raw IDs only: extract between `/document/d/` and `/edit`. Full URLs are rejected.
- NEVER compute `startIndex` / `endIndex` or write `batchUpdate` scripts.
- Copy heading-scoped ids from `kind: query` into `at` / `after` / `before` (e.g. `h.arch.9a1b`).
- Prefer one `run` with ordered `steps` over many round trips. Use `kind: dump` + `as:` to return only what you need.
- No demolish-and-rebuild: never delete a section/tab only to re-insert identical content. Use `replaceSection` / `replaceMarkdown` / `replace`.
- Real headings only (`TITLE` / `HEADING_1`–`HEADING_3`). No bullet glyphs in surgical text. Run-in bold: `**Label**: value`.

## Workflow

```yaml
dryRun: false
steps:
  - kind: open
    doc: <documentId>
    as: spec
  - kind: query
    doc: spec
    contains: "Status"
    as: statusNode
  - kind: replace
    at: statusNode
    replace: "Status: APPROVED"
  - kind: dump
    as: statusNode
```

Step kinds: `open`, `close`, `createDoc`, `copyDoc`, `renameDoc`, `trashDoc`, `deleteDoc`, `addTab`, `renameTab`, `deleteTab`, `insertMarkdown`, `replaceText`, `query`, `dump`, plus surgical edits (`replace`, `innerText`, `remove`, `replaceMarkdown`, `replaceSection`, `element`).

Aliases: `ops` for `steps`; `action` / `op` / `step` for `kind`.

- `dryRun: true` → unified git diff, no write.
- Live → `highlights` and `dumped`.

