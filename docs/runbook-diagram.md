# How to edit

Selectors / ops: [mechanics.md](mechanics.md). Taste: [style.md](style.md). Images: [images.md](images.md). Comments: [comments.md](comments.md).

One `gdocsmith run` document: `kind: query` to bind aliases, mutate, `kind: dump` what you need. Prefer one invocation over query/apply ping-pong.

```mermaid
flowchart LR
  q[1. kind: query + dump] --> f[2. Compose mutation steps]
  f --> a[3. gdocsmith run once]
  a --> d[4. Read highlights/dumped; ids are spent]
```

```yaml
dryRun: false
steps:
  - kind: open
    doc: <documentId>
    as: spec
  - kind: query
    doc: spec
    contains: Status
    as: statusNode
  - kind: replace
    at: statusNode
    replace: Shipped
  - kind: dump
    as: statusNode
```

```bash
gdocsmith run < workflow.yaml
```

## 1. Query

Use the Doc ID the user gave (extract from URL between `/d/` and `/edit`) — not another Drive copy.

`kind: query` maps headings and heading-scoped ids (`h.arch.9a1b`). Scope with `under:`, `contains:`, and `tab:`. Copy `at` / `after` / `before` from dumped ids. Do not invent nodes. Do not find headings with `:contains` CSS.

Multi-tab: set `tab:` on the step (`id` or unique title). Lifecycle: `kind: addTab` / `renameTab` / `deleteTab`.

Header/footer chrome is not on the body tape and is not a `run` kind yet — use the Docs UI.

## 2. Add steps

Each step is one action. `kind: replace` / `innerText` may include `style` on the same step. Inserts (`element` / `elements` / `insertMarkdown`) and `remove` stay exclusive.

Several related edits = one `steps` list. Use `as:` to label new docs, tabs, and nodes so later steps can reference them (`after: name`, `at: name.0.1`).

## 3. Run

`dryRun: true` returns a unified git diff and does not write. Live runs return `highlights` and `dumped`. Do not get stuck in repetitive dry-run loops.

`force: true` skips glyph/empty-bullet guards — only if the user asked.

## 4. Read and discard

Confirm `dumped` / `highlights` match intent. Snapshot ids are spent after a live write. Another pass = new `kind: query`. If a write failed: stop, restore the Drive pin if the Doc looks half-written, query again — do not retry the same spent ids.

Table insert + cell fill is two API calls; a half-written table is a pin restore, not more steps.

```mermaid
sequenceDiagram
  participant You
  participant Doc
  You->>Doc: kind query + dump
  Doc-->>You: aliases and ids
  You->>Doc: kind mutate in the same or next run
  Doc-->>You: highlights / dumped (or error + pin restore hint)
```
