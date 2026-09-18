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

1. **Explicit document opening & statelessness:** `docOpen` with `doc: <rawId>` and `as: <alias>`. Document aliases exist only within that single `run` call. Every step touching a doc must specify `doc: <alias>` (`docCreate` binds `as`, with optional `fromDoc:` to clone).
2. **Anchor scoping:** `nodeAt`, `nodeAfter`, `nodeBefore`, and `nodeUnder` ALWAYS reference headings or node IDs in the **target document** (`doc:`), never IDs from a source document.
3. **Headings vs. sections:** Use `replace` (or `replaceMarkdown`) to rename a heading in place. By default, `replaceSection` replaces the *entire* outline tree under that heading (and guards reject deleting child subsections under any heading level without `force: true`). Use `replaceSection` on leaf headings (headings without child subsections, like `Overview & Problem Statement`, `Motivation`, `Decisions`) to diff and update section body. To update a specific paragraph or placeholder under a heading while preserving child subsections, use `replaceMarkdown` with `find: <placeholderText>` (or `nodeAt: <placeholderText|scopedId>`) to insert rich formatted markdown (lists, bold, links), or `textReplace` for plain string edits.
4. **Creation-time tab positioning & fidelity:** Always specify final tab `title`, `as`, and position (`afterTab: <title|id>` or `beforeTab: <title|id>`) at creation time in `tabCreate` (optionally with `fromTab: <title|id>` to duplicate). Tab titles must be unique across the document. Avoid post-hoc `tabRename` or `tabMove` on cloned template docs due to Google Docs API 500 bugs on documents lacking a root `t.0` tab. Google Docs REST API has no native tab duplication request; `tabCreate` with `fromTab` transfers AST nodes with styles, headings, bullets, tables, person/date/richLink chips, and public/internal images. If leftovers cannot be reconstructed (Drive-only drawing objects, equations, footnotes, unsupported chips, TOC), `tabCreate` rejects by default and instructs duplicating in the Google Docs UI (right-click tab > Duplicate); pass `force: true` on `tabCreate` to proceed with lossy conversion (placeholders / omitted footnotes).
5. **Symbolic links:** Use `[Label](tab:TabTitle#HeadingTitle)`, `[Label](tab:TabTitle)`, or `[Label](#HeadingTitle)` in markdown. gdocsmith automatically compiles them to native Google Docs deep links.
6. **Content field conventions:** Use `markdown: "..."` for markdown steps (`replaceSection`, `replaceMarkdown`, `markdownInsert`). Use `replace: "..."` (or `text: "..."`) for text steps (`replace`, `textReplace`). For querying document outlines, use `output: "outline"` or `output: "headings"`.
7. **Execution & dry runs:** Execute mutations directly. `dryRun: true` is an optional diagnostic for previewing diffs when troubleshooting, not a required prerequisite before edits. Do not get stuck in repetitive dry-run loops. If Auto-review blocks an action, immediately retry with the standard approval flag (`requestSmartModeApproval: true` or `request_smart_mode_approval: true`).
8. **List formatting & continuation:** Standard CommonMark nested lists (sub-items indented with 2–4 spaces under ordered or unordered items) compile cleanly into Google Docs nested list levels. In Google Docs, numbered lists continue and auto-increment automatically across nested sub-bullet runs; do not flatten lists or avoid nesting out of concern for list continuity.
9. **Template placeholders & child fixtures:** In cloned templates, sections often have placeholder paragraphs (e.g. `*Placeholder: ...*`) alongside child fixtures (subsections with tables or chips). In 2-phase workflows, query the outline or nodes first (`kind: query`), or target the placeholder text directly using `replaceMarkdown` (`kind: "replaceMarkdown", doc: "...", tab: "...", find: "Placeholder: ...", markdown: "..."`). This replaces the placeholder with rich formatted markdown (lists, bold, links) without modifying child subsections. Do not use `replaceSection` on a parent heading if you want to preserve its child subsections.
10. **Workflow phase batching:** Minimize turn round-trips by batching steps into three focused phases:
    - **Phase 1: Discover:** Single `run` querying source outlines and notes (`kind: docOpen`, `kind: query`).
    - **Phase 2: Create & Structure:** Single `run` creating the target doc and all tabs with final titles and positions (`kind: docCreate`, `kind: tabCreate` with `title`, `as`, `afterTab`).
    - **Phase 3: Populate & Link:** Single `run` transferring sections, updating placeholders, and inserting cross-tab links (`kind: sectionCopy`, `kind: replaceMarkdown`, `kind: markdownInsert`).

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
    { "kind": "tabCreate", "doc": "plan", "as": "exec", "title": "Execution", "afterTab": "Main" },
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

### 6. Configure Page Geometry or Toggle Pageless Mode
```json
{
  "steps": [
    { "kind": "docOpen", "doc": "<documentId>", "as": "myDoc" },
    { "kind": "pageSetup", "doc": "myDoc", "tab": "Spec Template", "mode": "PAGELESS" }
  ]
}
```

### 7. Replace Template Placeholders While Preserving Subsections
```json
{
  "steps": [
    { "kind": "docOpen", "doc": "<documentId>", "as": "myDoc" },
    {
      "kind": "replaceMarkdown",
      "doc": "myDoc",
      "tab": "Spec",
      "find": "Placeholder: Replace with architectural specification and component breakdown.",
      "markdown": "### Architecture\n\n1. **Core Service**: Handles packet routing.\n2. **Beacon Array**: Calibrates quantum frequencies."
    }
  ]
}
```
