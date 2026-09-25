---
id: gdocsmith
name: gdocsmith
description: >-
  Read and edit Google Docs with the gdocsmith run tool: outline and markdown
  queries, markdown writes into sections or nodes, find/replace, styles, tables,
  tabs, sharing, and page setup. Use for any Google Docs task; never compute
  character offsets or call the Docs API directly.
enabled: true
---

# gdocsmith

Use the `run` tool for Google Docs work. Do not calculate character offsets or
send Docs API requests yourself.

The v2 kinds are `doc`, `edit`, `page`, `query`, `remove`, `share`, `style`,
`tab`, `table`, and `write`.

## Workflow

1. Query an outline, then query markdown for the smallest relevant scope.
2. Make the smallest change that solves the request.
3. Trust the returned diff, created IDs, warnings, and per-step result at `steps[i]`.

One `run` call applies its steps to an in-memory document model before sending.
`dryRun: true` performs the same planning without sending anything.

## Addressing

`doc` is either a raw document ID or an alias established by an earlier `doc`
step. A `tab` may be a tab ID or a unique title.

Use one anchor key at a time:

- `{ "section": "Heading" }` targets the heading and its subtree.
- `{ "node": "anchor" }` targets a node or table cell from a nodes query.
- `{ "text": "unique phrase" }` targets the one matching node.
- `{ "body": true }` targets a whole tab where that scope is allowed.

IDs can change when content changes. Query again after a forceful edit or a
partial send failure.

## Judgment

- Use `edit` for literal find-and-replace.
- Use `write` for markdown or `from` content.
- Use `write` with `replace` rather than rebuilding unrelated content.
- Use `table` only for table structure or cell styling.
- Ask before setting `force: true`; it only waives findings from that step.
- Do not delete root tab `t.0` unless the user explicitly approves it.

## Sending

All validation, planning, and guards run before anything is sent. Sending then
happens in phases. If a later phase fails, the error names what landed; query
the document again before retrying.

## Markdown Lens

Markdown queries are editable views. Keep their frontmatter, style directives,
and position tokens when writing them back. Use `markdownFile` after editing an
exported file. Links to headings and tabs are written as real Docs links.

## Large Results

Large query results and diffs are written to files. Read the returned paths. To
control a markdown export location, set `saveTo` to an absolute directory in the
workspace, edit the file, then use `markdownFile` in a `write` step.

## Errors And Guards

Refusals name comments, suggestions, named ranges, links, or items that Docs
cannot recreate. Fix the scope first. Use `force: true` only after the user has
accepted the listed loss.

## Cache

Set `fresh: true` on a `doc` open step when a document may have changed outside
the current run.

## Not Supported

The tool preserves but cannot create headers, footnotes, equations, drawings,
charts, TOCs, bookmarks, checkbox state, or Drive-hosted image content. Markdown
cannot author or edit a nested list item whose kind differs from its parent; the
run refuses that input, and `force` cannot bypass it. Removing the mismatched
nested item is supported. Use the same list kind for nested items, or use `edit`
for a literal text change that leaves list membership alone. Existing UI-created
mixed-kind lists survive unchanged exports and unrelated edits.

## Recipes

### 1. Read An Outline And Section

```json
{
  "steps": [
    { "kind": "query", "doc": "<documentId>", "output": "outline" },
    { "kind": "query", "doc": "<documentId>", "at": { "section": "Overview" }, "output": "markdown" }
  ]
}
```

### 2. Rewrite A Section

```json
{
  "steps": [
    { "kind": "write", "doc": "<documentId>", "replace": { "section": "Overview" }, "markdown": "## Overview\n\nRewritten content." }
  ]
}
```

### 3. Replace A Placeholder

```json
{
  "steps": [
    { "kind": "write", "doc": "<documentId>", "replace": { "text": "TODO: Add notes" }, "markdown": "Concrete notes." }
  ]
}
```

### 4. Replace Text With A Count Check

```json
{
  "steps": [
    { "kind": "edit", "doc": "<documentId>", "at": { "section": "Mission" }, "find": "pigeon", "replace": "falcon", "expectCount": 2 }
  ]
}
```

### 5. Create A Document And Tabs

```json
{
  "steps": [
    { "kind": "doc", "action": "create", "as": "target", "title": "New Specification" },
    { "kind": "tab", "action": "rename", "doc": "target", "tab": "t.0", "title": "Summary" },
    { "kind": "write", "doc": "target", "append": true, "from": { "doc": "<sourceId>", "tab": "t.0" } },
    { "kind": "tab", "action": "create", "doc": "target", "title": "Details", "from": { "doc": "<sourceId>", "tab": "Details" } }
  ]
}
```

### 6. Copy A Cross-Document Section

```json
{
  "steps": [
    { "kind": "write", "doc": "<targetId>", "after": { "section": "Background" }, "from": { "doc": "<sourceId>", "section": "Goals" } }
  ]
}
```

### 7. Insert And Style A Table Row

```json
{
  "steps": [
    { "kind": "table", "action": "insertRow", "doc": "<documentId>", "at": { "section": "Capacity Matrix" }, "row": 0, "position": "below", "cells": ["Jitter", "< 5ms", "Nominal"] },
    { "kind": "table", "action": "style", "doc": "<documentId>", "at": { "section": "Capacity Matrix" }, "row": 0, "style": { "background": "#F3F4F6", "pinnedHeaderRows": 1 } }
  ]
}
```

### 8. Clear A Matching Text Color

```json
{
  "steps": [
    { "kind": "style", "doc": "<documentId>", "at": { "section": "Overview" }, "where": { "foregroundColor": "#333333" }, "text": { "foregroundColor": null } }
  ]
}
```

### 9. Share And Make Pageless

```json
{
  "steps": [
    { "kind": "share", "action": "add", "doc": "<documentId>", "scope": "domain", "domain": "example.com", "role": "commenter" },
    { "kind": "page", "doc": "<documentId>", "pageless": true }
  ]
}
```

### 10. Export, Edit, And Write Back

```json
{
  "steps": [
    { "kind": "query", "doc": "<documentId>", "output": "markdown", "saveTo": "/absolute/workspace/export" },
    { "kind": "write", "doc": "<documentId>", "replace": { "section": "Overview" }, "markdownFile": "/absolute/workspace/export/overview.md" }
  ]
}
```