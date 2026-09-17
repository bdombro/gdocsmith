---
id: gdocsmith
name: gdocsmith
description: >-
  Surgical Google Docs authoring via declarative workflow steps (docCreate, docOpen, query, markdownInsert, replace, docPermissionAdd).
  Always use the gdocsmith MCP tool `run`. NEVER calculate character offsets or write raw documents.batchUpdate scripts.
enabled: true
---

# gdocsmith

Declarative Google Docs authoring via the `run` MCP tool. No raw batchUpdate scripts, no character offsets.

> **Auth:** `gws auth export` credentials.
> **Rule:** Every workflow step must have `kind: <WorkflowStepKind>`. Always check the `run` tool's `inputSchema` for complete parameter definitions.

## Core Rules

1. **Explicit document opening & statelessness:** `docOpen` with `doc: <rawId>` and `as: <alias>`. Document aliases exist only within that single `run` call. Every step touching a doc must specify `doc: <alias>` (`docCreate` binds `as`, `docCopy` uses `copyFrom`).
2. **Anchor scoping:** `nodeAt`, `nodeAfter`, `nodeBefore`, and `nodeUnder` ALWAYS reference headings or node IDs in the **target document** (`doc:`), never IDs from a source document.
3. **Headings vs. sections:** Use `replace` (or `replaceMarkdown`) to rename a heading in place. NEVER use `replaceSection` on an H1 or Title—`replaceSection` replaces the *entire* outline tree under that heading! Use `replaceSection` on leaf/subsection headings (e.g. `Motivation`, `Decisions`) to diff and update section body.
4. **Creation-time tab positioning:** Always specify tab `title` and position (`afterTab: <title|id>` or `beforeTab: <title|id>`) at creation time in `tabAdd` or `tabDuplicate`. Tab titles must be unique. Avoid post-hoc `tabMove` on cloned template docs due to Google Docs API 500 bugs.
5. **Symbolic links:** Use `[Label](tab:TabTitle#HeadingTitle)`, `[Label](tab:TabTitle)`, or `[Label](#HeadingTitle)` in markdown. gdocsmith automatically compiles them to native Google Docs deep links.

## Canonical Recipes

### 1. Dump Document as Markdown
```json
{
  "steps": [
    { "kind": "docOpen", "doc": "<documentId>", "as": "myDoc" },
    { "kind": "query", "doc": "myDoc", "as": "docMd", "output": "markdown" }
  ]
}
```

### 2. Create Multi-Tab Doc & Insert Markdown (Single Pass)
```json
{
  "steps": [
    { "kind": "docCreate", "title": "Project Plan", "as": "plan" },
    { "kind": "markdownInsert", "doc": "plan", "markdown": "# Overview\n\nIntro copy..." },
    { "kind": "tabAdd", "doc": "plan", "title": "Execution", "afterTab": "Main" },
    { "kind": "markdownInsert", "doc": "plan", "tab": "Execution", "markdown": "# Execution\n\nSee [Overview](tab:Main#Overview)." }
  ]
}
```

### 3. Server-Side Section Transfer Across Documents
```json
{
  "steps": [
    { "kind": "docOpen", "doc": "<sourceDocId>", "as": "source" },
    { "kind": "docOpen", "doc": "<targetDocId>", "as": "target" },
    { "kind": "sectionCopy", "fromDoc": "source", "fromSection": "Decisions", "doc": "target", "nodeAt": "Decisions" }
  ]
}
```

### 4. Query Outline & Replace Leaf Section
```json
{
  "steps": [
    { "kind": "docOpen", "doc": "<documentId>", "as": "myDoc" },
    { "kind": "query", "doc": "myDoc", "as": "outline", "output": "outline" },
    { "kind": "replaceSection", "doc": "myDoc", "nodeAt": "Decisions", "markdown": "## Decisions\n\n- D1: New choice" }
  ]
}
```

### 5. Manage Document Permissions
```json
{
  "steps": [
    { "kind": "docOpen", "doc": "<documentId>", "as": "myDoc" },
    { "kind": "docPermissionAdd", "doc": "myDoc", "scope": "internal", "role": "commenter" },
    { "kind": "docPermissionAdd", "doc": "myDoc", "email": "teammate@example.com", "role": "writer" },
    { "kind": "docPermissionList", "doc": "myDoc", "as": "perms" }
  ]
}
```
