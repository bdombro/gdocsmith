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

Surgical Google Docs authoring via sequential declarative steps. Prefer the MCP tool `run` (or CLI `gdocsmith run`). No bash heredocs or raw `documents.batchUpdate` scripts.

> **Auth:** `gws auth export` credentials. If missing, use the shared Google Workspace skill or `gws`.

> CLI: Do use the CLI directly

## Agent protocol

1. **Probe first:** one doc, `open` then `query` with `as:` (query writes `dumped`). Succeed once before batching unfamiliar `kind`s.
2. **Bindings:** only `open` and `query` create aliases. `query` with `as:` also writes `dumped[as]`. `dump` re-emits an existing alias; dump of an open alias is `{ id, title }` only.
3. **Unfamiliar steps:** read MCP `run` schema or `gdocsmith run --help` for that `kind` before use. This file is not the full step reference.
4. **Errors:** stop and report. No CLI fallback unless the user allows it. MCP tool rejection on write is a blocker — ask the user to approve or unblock.

## Execution model

Prefer one `run` per phase (read → copy → edit). Batch steps only after each `kind` in the batch has worked in this session.

Step schemas: `gdocsmith run --help` or MCP tool description.

### Canonical workflow

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
```

Full-doc markdown: `kind: query` + `output: markdown` + `as:` (add `tab:` for one tab, `under:` for a section). Dump of the open alias is metadata only.

1. **`open`** — bind document handle to `as`.
2. **`query`** — locate nodes; bind matches to `as` (heading-scoped ids like `h.arch.9a1b`); writes `dumped`. Use `output: markdown` or `yaml` to serialize.
3. **Edits** (`replace`, `replaceMarkdown`, `replaceSection`, `markdownInsert`, `kind: surgical` for chips/tables/clones) — anchor with `at`, `after`, or `before`.
4. **`dump`** — optional re-emit of a bound alias into `dumped`.
