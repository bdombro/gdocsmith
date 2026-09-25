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

---

## 6. v2 Core Engine (`src/core/{model,emulator,diff,reconcile,lens,engine}/`; not wired to `run` yet)

v2 replaces the DOM tape with one pipeline shared by dry and live runs. Only the flush talks to Google.

### 6.1 Pipeline
1. **Load** (`engine/load.ts`): each document is fetched (or served from the snapshot cache) and parsed into a `DocModel` (`model/fromJson.ts`) whose layout reproduces the API's indices exactly (`model/layout.ts`).
2. **Program** (`engine/session.ts`): a program edits only the in-memory model through `Session`/`DocHandle`/`TabHandle`/`TableHandle` (`engine/types.ts`). Markdown writes go through the lens; everything else uses the editing primitives (`model/edit*.ts`, `model/copy.ts`).
3. **Plan** (`engine/plan.ts`): `reconcile/` turns original vs final into minimal requests: blocks aligned by key, character diffs inside kept paragraphs, then a bullet pass and table reconciliation. Each plan is replayed through the emulator (`emulator/`) and must reproduce the intended model (`model/equivalence.ts`), otherwise nothing is sent. The guard (`engine/guard.ts`) lists what the plan would break (comments, suggestions, heading and tab links, named ranges, content the API can't recreate) and refuses unless forced.
4. **Flush** (`engine/flush.ts`, `engine/transaction.ts`): phases `create` → re-run → `content` (chunks locked to the revision) → `tabs` → `links` → `permissions`. A revision conflict before content lands reloads and re-runs the program; landed documents are pinned and must plan the same content again. Afterwards each document is reloaded and checked against the plan.

### 6.2 Markdown lens (`lens/`)
Markdown is a view with write-back, not a lossless format. `project.ts` projects a tab into blocks, `render.ts`/`parse.ts` convert to and from markdown, and `put.ts` writes markdown back by aligning blocks (`blockDiff.ts`, `tableAlign.ts`) and editing characters. Unchanged markdown changes nothing; content markdown can't show survives because it's never touched. Laws are property-tested (`lensLaws.test.ts`, `roundtrip.test.ts`).

### 6.3 Invariants
- A paragraph's state (style, heading id, bullet) belongs to its start: splits and merges keep it with the half or survivor holding the original start.
- Every container ends with a paragraph; every table, TOC, and section break follows one; new tables and section breaks follow a new paragraph, and new page breaks are followed by one (`model/invariants.ts`).
- Styles are sparse; unset and default compare equal (colors at float32 precision, as the API stores them).
- Lists: joining the previous same-preset list happens only at nesting 0; nesting and kind changes rebuild the run; a different kind of list can't be nested inside another (nested markdown items take their list's kind, with a note).

### 6.4 Testing layers
Unit tests; recorded live conformance fixtures (`emulator/__fixtures__/conformance/`, re-recorded with `GDOCSMITH_RECORD=1 bun test tests/integration/conformance.test.ts`, `GDOCSMITH_ONLY=<ids>` for a subset) replayed offline; seeded differential fuzzing of the reconciler; lens property tests; a local-only corpus test over cached documents; and the live end-to-end suite (`tests/integration/v2Live.test.ts`). `apiFacts.ts` holds constants the model and emulator share, and the emulator refuses (`UNMODELED`) request shapes whose live outcome isn't pinned down, so a plan relying on them is never sent.
