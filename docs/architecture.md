# gdocsmith Architecture & Maintainer Guide

`gdocsmith` is an AI-optimized surgical authoring and workflow engine for Google Docs. It operates both as a terminal CLI and as a stdio Model Context Protocol (MCP) server for AI coding agents.

This document describes the internal architecture, data pipeline, and key invariants for maintainers.

---

## 1. High-Level Architecture

`gdocsmith` converts declarative, multi-document workflows into atomic Google Docs API transactions.

```
                           ┌────────────────────────┐
                           │ User / AI Agent (MCP)  │
                           └───────────┬────────────┘
                                       │ JSON Workflow
                                       ▼
                     ┌───────────────────────────────────┐
                     │    CLI / MCP Layer (argsbarg)     │
                     │  src/commands/run/ (CliLeaf)      │
                     └─────────────────┬─────────────────┘
                                       │ GdocsmithDocument
                                       ▼
                     ┌───────────────────────────────────┐
                     │       Workflow Orchestrator       │
                     │    src/core/applyScript.ts        │
                     │   (aliases, multi-doc session)    │
                     └─────────────────┬─────────────────┘
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        ▼                                                             ▼
┌───────────────────────────────┐                             ┌───────────────────────────────┐
│     Live Execution Mode       │                             │      Dry-Run Mode             │
│  - DriveRevisions.pinHead     │                             │  - In-memory simulated nodes  │
│  - DomWriter + applyOps       │                             │  - No remote mutations        │
│  - RequestBuilder requests    │                             │  - exportDocumentToMarkdown   │
│  - Atomic batchUpdate         │                             │  - Unified git diff output    │
└───────────────────────────────┘                             └───────────────────────────────┘
```

---

## 2. Core Engine Pipeline

### 2.1 The DOM Tape Abstraction (`src/core/dom/`)

Google Docs documents are represented in the raw REST API as a deeply nested JSON hierarchy where body elements are addressed via absolute character offsets (`startIndex` and `endIndex`). Because any edit shifts indices across the entire document, direct index manipulation leads to off-by-one errors and heading clobbering.

`gdocsmith` flattens the document body into a linear **tape of sibling nodes** (`DocTape`):

- **Tape siblings**: Headings, paragraphs, tables, section breaks, and page breaks are sequential siblings on the tape. A heading does not wrap its following paragraphs.
- **Node properties**: Each `DocNode` tracks `kind` (`paragraph`, `table`, `sectionBreak`, `pageBreak`, etc.), `namedStyleType` (`TITLE`, `HEADING_1`–`HEADING_6`, `NORMAL_TEXT`), text runs, bullet formatting, and inline images.
- **Table cells**: Nested within table nodes rather than sitting directly on the body tape, addressed via cell coordinates (`row.col`).

### 2.2 Heading-Scoped IDs & Checksums (`src/core/dom/parse.ts`, `checksum.ts`)

To avoid volatile integer indices, `assignScopedIds` stamps every node on the tape with a resilient identifier:

1. **Heading ID**: Derived from heading text (e.g. `h.arch` for "Architecture").
2. **Checksum**: A 4-character hex hash computed from the node's text, styles, and attributes.
3. **Scoped ID format**: `{headingId}.{checksum}` (e.g. `h.arch.9a1b`) or `{headingId}.table.{row}.{col}.{checksum}` for table cells.

**Why this matters:** If an edit occurs in section A, the heading-scoped IDs in section B remain unchanged. Edits targeting `h.arch.9a1b` resolve reliably across revisions without index math.

### 2.3 Workflow Orchestration (`src/core/applyScript.ts`, `src/core/actions/`)

Workflows are executed through `applyScriptExecute`, which owns session state and dispatches each step via `stepRun` in `src/core/actions/` (one module per explicit kind; surgical DOM steps fall through to `surgical.ts`).

- **Session Context**: Manages open documents (`openDocs`), tab resolution (`resolveTab`), and alias bindings (`aliasMap`, `dumpStore`).
- **Alias Propagation**: Nodes targeted with `as: name` allow subsequent steps to reference them directly (e.g. `nodeAfter: name`, `nodeAt: name.0.1`).
- **Inspection (`kind: query` / `dump: true`)**: `open` with `dump: true` emits doc/tab metadata; `query` with `as:` writes matches into `dumped` (`output: nodes` | `markdown`).
- **Step kinds**: Each step sets explicit `kind` (`WorkflowStepKind`); `stepKindRead` trims the discriminator.

### 2.4 Mutation Planner & DomWriter (`src/core/dom/ops.ts`, `applyCompile.ts`, `write.ts`)

Surgical operations are planned before execution:

1. `DomWriter` stages mutations against the in-memory tape.
2. `tapeMutationsApply` (`applyOps`) validates invariants (guardrails against empty bullets, invalid headings, and index collisions).
3. `RequestBuilder` (`src/core/requests.ts`) generates atomic Google Docs `batchUpdate` requests (`insertText`, `deleteContentRange`, `updateTextStyle`, `createParagraphBullets`, etc.).

---

## 3. Key Invariants & Guardrails

### 3.1 Revision Pinning (`src/core/revisions.ts`)
Before any mutation is submitted to Google Docs, `DriveRevisions.pinHead` creates a pinned revision with `keepForever: true` via the Drive API.
- If a multi-step apply or table creation fails halfway, the document is never left in an unrecoverable corrupted state.
- The failure output provides a direct link to Google Docs **Version History** to restore the pinned revision.

### 3.2 Anti-Demolition Guard
Agents frequently attempt "demolish-and-rebuild" updates: deleting an entire section and re-inserting the content from scratch. This destroys Google Docs comment threads, suggestion mode history, and revision blame.

- `applyOps` compares deleted node checksums against inserted node checksums.
- If identical unchanged nodes are deleted and re-created, the apply is hard-rejected with a descriptive list of preserved nodes.
- Agents are directed to use `replaceSection` (LCS auto-diffing) or surgical `replace`.
- Bypassed only with explicit `force: true`.

### 3.3 Section-Level Auto-Diffing (`replaceSection`)
Targeting a heading with `replaceSection`:
1. Parses incoming markdown into AST elements.
2. Uses Longest Common Subsequence (LCS) diffing against live section nodes.
3. Modifies changed nodes in place (`innerText`), inserts genuine additions, and removes deletions.
4. Preserves unchanged nodes untouched—retaining inline comments and revision history.

---

## 4. Markdown Ingestion Pipeline (`src/core/markdown.ts`, `dom/markdownParser.ts`)

1. **Block Tokenization**: `marked.lexer` breaks markdown into AST tokens. Leading `---` is a page break (horizontal rule), not YAML.
2. **Partitioning / Chunking**: Tables and prose blocks are separated into isolated batches to comply with Docs API table creation rules.
3. **Style Mapping**: CommonMark inline syntax (`**bold**`, `*italic*`, `` `code` ``, `[links](url)`) and `::styleName[text]::` directives (styles from the `markdownStyles` step field) are converted into `updateTextStyle` ranges.

---

## 5. Development & Testing Conventions

- **Runtime**: Bun (`bun test src`, `just dev`).
- **Code Standards**: Strict JSDoc on all exported and module-private functions and types; alphabetical module imports; no unnecessary file extraction.
- **Schema Generation**: `argsbarg schemagen` generates JSON schemas for CLI/MCP outputs from `/** @sg */` annotated types in `types.ts`.
- **Documentation**: Hand-edited docs live in `docs/` and `README.md`. Generated reference files (`docs/cli.md`, `docs/mcp.md`, `docs/cli-schema.json`) are updated via `just docgen`.
