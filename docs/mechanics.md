# Mechanics

Selectors, steps, and YAML/JSON shape for `gdocsmith run`. Loop: [runbook-diagram.md](runbook-diagram.md). Taste: [style.md](style.md).

Each item in `steps` requires `kind`. Load this when a selector or op is unclear. Don’t start here.

## Tape

`body.content` is a **tape of siblings**. A heading does not wrap the paragraphs after it.

```
TITLE
HEADING_2          ← "Status"   (does not wrap anything)
NORMAL_TEXT        ← sibling after the heading
NORMAL_TEXT[bullet]
NORMAL_TEXT[image] ← diagram (inline image inside the paragraph)
HEADING_2          ← "Approach"
NORMAL_TEXT
```

Don’t replace a whole section as a range. Walk `nodes` in query YAML/JSON — the next item is the next sibling.

## Targeting

1. `kind: query` — map of the tape. Multi-tab: set `tab:` (`id` or unique title). Bind with `as:` (also writes `dumped`). `output: markdown` / `yaml` for a serialized dump.
2. Scope with `under:` (heading) and `contains:` (substring). That node and following siblings until the next same-or-higher heading, including `sectionBreak` / tables.
3. Copy `at` from dumped ids (heading-scoped `"h.arch.9a1b"`) or table cells (`"h.arch.table.0.1.3c8f"`).

Do not guess heading structures or character offsets. Query using `under:` (heading) and `contains:` (substring), dump the matched nodes, and target them using heading-scoped IDs (`at: "h.arch.9a1b"`).

**Writes use `at` / `after` / `before`.** Extra keys ignored, except `cell` / `para` / `segmentId` / `tabId` on a step — those are refused (copy the id instead; use `tab:` on the step). Header/footer chrome is not a `run` kind yet.

| Field | Finds | When |
| ----- | ----- | ---- |
| `at` | Heading-scoped id (`"h.arch.9a1b"`), heading id (`"h.arch"`), or cell id (`"h.arch.table.0.1.3c8f"`) | Required on every write step. Heading-scoped IDs are resilient across edits in other sections. |

Same-run inserts: use `as: "<name>"` then `after: "name"` / `at: "name.0.1"`. Another pass = new query.
Heading-scoped IDs (`{headingId}.{checksum}`) compute a hash over text and all metadata. They provide high confidence that the targeted node matches the agent's expectation and auto-rebase cleanly across revisions.

## Scoping and Filtering

Targeting nodes in `gdocsmith run` uses `kind: query`. The workflow engine filters the DOM tape cleanly without fragile character offsets or raw CSS selectors:

| Query Parameter | Description |
|---|---|
| `doc:` | Optional target document alias or ID (defaults to active doc). |
| `tab:` | Target tab ID or unique title. |
| `under:` | Scopes query to the neighborhood under a heading (matching the heading and following siblings until the next same-or-higher heading). |
| `contains:` | Substring filter (case-insensitive) on paragraph or heading text. |
| `stylesOnly:` | Boolean filter to find only custom-styled nodes. |
| `unsafeOnly:` | Boolean filter to surface fragile nodes (e.g. math equations, chips, horizontal rules). |
| `as:` | Binds the matched node(s) to a local alias for subsequent steps in the same workflow. Writes `dumped[as]` immediately. |
| `output:` | Serializer: `nodes` (default, `NodeSummary` rows), `markdown`, or `yaml`. Markdown/yaml skip the 80-node heading echo. |
| `full:` | Keep every node (no heading-only truncation) and include table cells in `nodes` dumps. |

**Markdown / YAML dump**

- Whole document: `kind: query` + `output: markdown` (no `tab`, no `under`). Multi-tab docs join tabs with `---` (tab divider, not YAML). Styles and omissions are on `audit`.
- One tab: add `tab: <id or unique title>`.
- One section: add `under: <heading id or alias>`.
- `kind: dump` is optional for these because query already fills `dumped`. Dump of an **open** alias is still `{ id, title }` only.

Do not attempt to pass raw character indices to write steps. Writes use heading-scoped IDs (`at: "h.arch.9a1b"`), cell IDs (`at: "h.arch.table.0.1.3c8f"`), or bound aliases (`at: "statusNode"`).

## Writes

| Op | Does |
| -- | ---- |
| `replace` | Alias for `innerText`. Replaces **text** of the target node in place. Named style unchanged. Inline markdown is parsed to styled runs. Combinable with `style`. |
| `replaceSection` | Section-level auto-diffing replacement (alias: `replaceSectionMarkdown`). Target MUST be a heading node. Parses markdown, hashes nodes via checksum, matches live nodes with incoming elements, updates modified paragraphs in place, preserves unchanged nodes (zero lost comments or suggestions!), and only adds/removes actual deltas. Accepts inline markdown, file path string, or `replaceSection: true, file: "path.md"`. Exclusive. |
| `replaceMarkdown` | Single-node markdown replacement. Replaces ONLY the target node (even when targeting a heading), never touching children or following siblings. Expands multi-element markdown directly after the node. Accepts inline markdown, file path string, or `file: "path.md"`. Exclusive. |
| `markdownInsert` | Workflow `kind` that inserts rendered markdown at an anchor (`after` / `before` / `at`). Use `markdown:` or `text:` (or `file:`). Supports sibling `markdownStyles: { alert: { color: "#f00" } }`. Exclusive. |
| `markdownStyles` | Sibling attribute on `markdownInsert`, `replaceMarkdown`, or `replaceSection` providing named `::styleName[]::` directive styles (e.g. `markdownStyles: { alert: { color: "#f00" } }`). Distinct from native `style`. |
| `after` / `before` | Anchor properties set directly on the op: `after: <id>` inserts `afterend`; `before: <id>` inserts `beforebegin`. Replaces boilerplate nested `insertAdjacentElement.position`. |
| `element` / `elements` | Detached element spec(s) to insert at anchor (paired with `after: <id>` or `before: <id>`). No `insertAdjacentElement` wrapper needed. |
| `as` | Assigns a local name/alias to an inserted node or section (e.g. `as: "my-table"`). Subsequent ops in the same session can reference it directly via `after: "my-table"`, `at: "my-table.0.1"`, etc. without guessing runtime synthetic IDs. |
| `innerText` | Replace **text**. Named style unchanged. Inline images in that paragraph (or cell) are kept (caption is written before them). Inline markdown (`code`, `**bold**`, `*italic*`, `~~strike~~`, `[links](url)`) → plain + styles. Optional explicit `runs: [{ text, code, fontSize, ... }]` for custom word formatting without offset math. Combinable with `style`. |
| `namedStyleType` | Change `TITLE` / `HEADING_*` / `NORMAL_TEXT`. Text unchanged. Paragraphs only. Combinable with `style`. |
| `alignment` | `START` / `CENTER` / `END` / `JUSTIFIED`. Folds into `style`. Paragraph, or a cell id. Center an image by aligning its paragraph or cell. |
| `style` | Native fields on the same op: `spaceAbove` / `spaceBelow` / `lineSpacing` (100 = single) / `shading` / `foregroundColor` / `backgroundColor` / `fontSize` / `fontFamily` / `bold` / `italic` / `underline` / `strikethrough` / `indentStart` / `indentFirstLine` / `indentEnd` (PT) / `cellBackground` / `cellTextAlignment` / `columnCount` / `columnWidth` / `borderColor` / `borderWidth` / `cellPadding` / `contentAlignment` / `minRowHeight`. Hex is `#RRGGBB`. Table chrome: `at` the table node (or a cell id `"h.arch.table.0.1.3c8f"` to scope one cell/column/row). `cellTextAlignment` (or `alignment` on a table) sets cell paragraph alignment (START/CENTER/END). Google Docs tables default to full page width (left-aligned under the hood); fixed `columnWidth` shrinks columns but the table remains left-aligned because page-level table alignment is not in the Docs REST API. `indentStart` is the same field on insert and restyle (not insert-only). On a list item, omitted `indentFirstLine` hangs (glyph at indentStart−18). Flush level-0: `indentStart: 18`, `indentFirstLine: 0`. Named-style definitions / “save as my default styles” are not in the API. |
| `createElement` | Detached spec. `"paragraph"` (`namedStyleType` + `text`, optional `alignment` / `style` / `bullet` / `indentStart`), `"codeBlock"` (`text`, optional `style` / `alignment` — defaults to `NORMAL_TEXT` + Courier New 10pt monospace), `"table"` (`rows` as `string[][]`) or `"pageBreak"`. `bullet` can be `true`, `{}`, or `{ preset, nestingLevel }`. `style.indentStart` is equivalent to top-level `indentStart`. |
| `bullet` | On **insert**: `createElement` `bullet.preset` + `nestingLevel`. On **existing**: `{ "at": "h.arch.9a1b", "bullet": { "preset": "NUMBERED_DECIMAL_ALPHA_ROMAN" } }` converts that listId run. Not custom glyph text, not start-at-N, not `nestingLevel` change (tabs are already stripped). |
| `remove` | That node only, including any images in it. `remove` on a table deletes every cell image. Cannot remove the last paragraph — `innerText` it. Exclusive. |
| `dangerousRemoveSection` | Removes the target heading and all following siblings until the next same-or-higher heading. Exclusive. Target must be a heading. |
| `dangerousClear` | Set at tab level (`dangerousClear: true`) to clear all content on that tab, leaving a single blank NORMAL_TEXT paragraph ready for inserts. |

**Cells** are nested in the table node, not body siblings. Compact query: `table: { cols, rows }`. Dumped cells use `{ id: "h.arch.table.0.1.3c8f", text, … }` and extra paragraphs as `{ id: "h.arch.table.0.1.3c8f.1", text }`. Write `{ "at": "h.arch.table.0.1.3c8f", "innerText": "…" }`. No `cell` / `para` fields.

**Headers / footers** are not the body tape and are not `gdocsmith run` kinds yet. Use the Docs UI.

**Tabs** are extra body tapes. Set `tab:` on the step. Manage tabs via `kind: tabAdd`, `tabRename`, `tabDelete`.

**Columns** are `sectionBreak.columnCount` (Format > Columns), not a table. Set with `{ "at": <sectionBreakId>, "style": { "columnCount": 2 } }`. Query does not invent a newspaper layout.

**Checkbox:** `bullet: { "preset": "BULLET_CHECKBOX" }` on a `NORMAL_TEXT` insert, or `{ "at": 7, "bullet": { "preset": "BULLET_CHECKBOX" } }` to convert an existing list.

- `innerText` changes text only. `namedStyleType` stays unless the op is `namedStyleType`.
- `insertAdjacentElement` is only `beforebegin` / `afterend`. Multiple same-anchor `afterend` ops preserve natural array order (they insert sequentially in forward order: 1st, then 2nd).
- After a heading, insert `afterend` — apply splits a new paragraph. Never write into the heading.
- Table insert: `afterend` of a **NORMAL_TEXT** sibling, not a heading (splits an undeletable empty `HEADING_*`). Do not mix with `remove`.
- After a **table**, `afterend` inserts at the table’s end (the next body paragraph). Do not treat a table like a paragraph (`end-1` is inside a cell).
- Inline `` `code` `` / `**bold**` / `[label](url)` are stripped to plain text plus styles on both insert and innerText. Apply **clears inherited** bold/link/code on the replaced range first (template placeholders are often fully bold).
- Do not `remove` the last paragraph; `innerText` it.
- **Smart chips (`richLink`).** Query includes chip titles in `text`, markdown links in `markup`, and `chips: [{ title, uri }]`. `innerText` and `remove` destroy chips (plan warns; they still apply). Chip insert is Docs UI.
- **Run chrome.** Compact query dumps `style: { italic, fontSize, foregroundColor }` when those values are uniform across visible text runs and are not Docs defaults (not italic, 11pt, black). Restyle with the same fields on `style`.
- **Lists.** Query reports `bullet: { nestingLevel, type }` where `type` is `NUMBERED`, `BULLET`, or `CHECKBOX`. To continue an existing list after a list item, pass `"bullet": true` (or `"bullet": {}`) on the inserted paragraph — it joins the existing list (preserving numbering or bullet style and inheriting `nestingLevel`). Omitting `bullet` on an insert after a list item emits `deleteParagraphBullets` so headings and prose do not inherit glyphs (plan warns). `nestingLevel` is absolute. Apply prefixes leading tabs, then `createParagraphBullets` (Google counts tabs and strips them). Indent alone does not nest. Restyle indent with `style.indentStart` / `indentFirstLine` (same as insert). Query dumps those when set. Numbered prefix = a `BulletGlyphPreset`, not typed `1.` text. `{ "at", "bullet": { "preset" } }` converts the listId run; `nestingLevel` change on an existing item is refused.

**Multiple inserts:** Use `after: <id>` or `before: <id>` with `elements: [...]` (or `kind: markdownInsert` with `markdown:`) to insert several elements sequentially in natural array order. No nested `insertAdjacentElement` boilerplate and no manual chaining needed.

**Clone nodes with 100% fidelity:** Pass `cloneNode: { fromDoc?, fromTab?, nodeId, innerText? }` (or intra-doc shorthand `cloneNode: h.arch.9a1b`) with `after: <id>` or `before: <id>` to copy any node from the current tab, another tab, or another doc while preserving all styles, bullets, margins, and alignments. `innerText` replaces text while retaining the source node's styling. Use `cloneNodes: [...]` for batch cloning. `nodeId` is the heading-scoped id from query.

**Replace a whole section:** Use `replaceSection: "..."` (or `replaceSectionMarkdown: "..."`) targeting the section heading (`at: "h.arch"`). It automatically diffs incoming elements against live nodes via checksum, preserves unchanged nodes (zero comment threads or suggestions lost), updates modified nodes in-place, and applies genuine additions/removals. Accepts inline markdown, file path string, or `file: "path.md"`. Never manually delete-then-insert.

**Replace a single node:** Use `replaceMarkdown: "..."` targeting any node (paragraph, heading, cell). It updates the node in place without touching children or following siblings.

**Referencing newly inserted nodes (`as`):** Give any inserted node or section an alias with `as: "name"`. Subsequent ops in the same file can reference it directly as an anchor (`after: "name"`, `before: "name"`) or for cell addressing (`at: "name.0.1"`), completely eliminating guesswork around synthetic runtime IDs (`maxId + 1`).

**Same-anchor `afterend` preserves natural order.** Issuing multiple `afterend` ops on the same anchor (or passing `elements: [...]`) inserts them sequentially in array order after the anchor (`Anchor -> Op1 -> Op2`). You do not need to reverse ops or calculate index shifts.

**Anti-Demolition Guard (No Lazy Bulk Replaces):**
The CLI actively inspects removed nodes vs inserted nodes in every apply session. If unchanged nodes are deleted and re-created with identical content, the apply is rejected with a descriptive error listing the unchanged nodes:
```
Lazy replacement rejected: 3 unchanged node(s) were deleted and re-created with identical content:
  - HEADING_2: "Architecture" (id: h.arch)
  - NORMAL_TEXT: "Component A handles authentication." (id: h.arch.12ab)
Deleting existing nodes destroys comment threads, suggestion mode history, and revision blame.
```
To update content safely:
- Use `replaceSection` on the section heading to auto-diff and retain unchanged section nodes
- Use `replaceMarkdown` on a single node to replace it surgically without touching siblings
- Or use `replace` / `innerText` on specific nodes that actually changed
- Bypassed only with `force: true` on the op or apply document when destructive demolition is genuinely intended.

**Headings with links.** Query `text` is the visible label. A heading that looks like “Project plan (draft)” may query as `(draft)` if the pretty name is a link.

## Images

Existing diagrams are **inline objects inside a paragraph or table cell**, not their own tape sibling. Query prints `image: { count, widthPt, heightPt }` on that node.

| Want | Do |
| ---- | -- |
| See it | Query. Empty-looking paragraphs with `image` are diagrams. Table cells have cell IDs like `h.arch.table.0.1.3c8f`. |
| Caption / nearby text | `innerText` on that paragraph, or `{ "at": "h.arch.table.0.1.3c8f", "innerText": "…" }` on a cell. |
| Center it | `{ "at": <id>, "alignment": "CENTER" }` on the paragraph or cell id. |
| Delete the diagram | `remove` that paragraph. `remove` on a table deletes every cell image in it. |
| Move / resize / insert a new image | Docs has `inlineObjectId` (`kix.*`) but no move/copy-by-id. Relocate is delete + insert (needs a URI / Script). Until Script API permission: Google Docs UI. |

Do not treat an image paragraph as `:empty`. An image paragraph contains inline media.

## Refuse

- Empty or dash-only bullet text (`""`, `"-"`, `"–"`)
- Text matching `/^\s*[-–—*•◦●○■‣·]\s+/` (with `bullet`, or on `NORMAL_TEXT` without)
- `1.` / `1)` prefix when `bullet` is set
- `bullet` on `TITLE`, `SUBTITLE`, `HEADING_*`
- `nestingLevel` change on an existing paragraph
- `remove` on the last tape paragraph

## Mutation YAML

Pipe to `gdocsmith run`. `insertAdjacentElement` and `remove` are exclusive on the same step; a table insert cannot share a run with `remove` or edits to other nodes. `innerText` / `namedStyleType` / `bullet` may combine with `style`.

```yaml
documentId: <ID>
steps:
  - kind: replace
    at: h.status.9a1b
    innerText: In progress
  - kind: replace
    at: h.status.9a1b
    style: { alignment: CENTER, spaceAbove: 12 }
  - kind: replace
    at: h.data.table.0.0.3c8f
    innerText: Name
  - kind: surgical
    after: h.status.9a1b
    element:
      kind: paragraph
      namedStyleType: NORMAL_TEXT
      text: Next step
      bullet: { preset: BULLET_DISC_CIRCLE_SQUARE, nestingLevel: 0 }
```

Table insert with styling. Use `as: "<name>"` to label the new table so subsequent steps can style it or target cells without guessing runtime numeric IDs:

```yaml
steps:
  - kind: surgical
    after: h.arch.9a1b
    as: draft-table
    element:
      kind: table
      rows: [["Status: draft"]]
  - kind: replace
    at: draft-table
    style:
      alignment: START
      columnWidth: 500
      borderColor: "#999999"
      cellPadding: 5
      contentAlignment: TOP
```

`at: "draft-table"` targets the newly created table directly. Insert `after` a NORMAL_TEXT sibling, not a heading.

## Table Grid Operations & Styling

Tables support surgical row and column manipulation without recreating the table:

```yaml
steps:
  # Insert row below row 0 with cell text
  - kind: surgical
    at: h.arch.table.9a1b
    insertTableRow:
      row: 0
      insertBelow: true
      cells: ["New Col 1", "New Col 2"]

  # Duplicate row 1 directly below
  - kind: surgical
    at: h.arch.table.9a1b
    duplicateTableRow:
      row: 1
      insertBelow: true

  # Insert column to the right of col 0
  - kind: surgical
    at: h.arch.table.9a1b
    insertTableColumn:
      col: 0
      insertRight: true

  # Delete row or column
  - kind: surgical
    at: h.arch.table.9a1b
    deleteTableRow:
      row: 2
  - kind: surgical
    at: h.arch.table.9a1b
    deleteTableColumn:
      col: 1

  # Pin header rows and prevent overflow
  - kind: surgical
    at: h.arch.table.9a1b
    style:
      pinnedHeaderRows: 1
      preventOverflow: true
```

## Smart Chips, Footnotes, Breaks & Page Setup

Roundtrip document page setup and insert native Docs rich elements:

```yaml
# Top-level pageSetup on a run document
pageSetup:
  orientation: PORTRAIT # or LANDSCAPE
  pageSize: LETTER      # LETTER, LEGAL, TABLOID, A4
  margins:
    top: 72
    bottom: 72
    left: 72
    right: 72

steps:
  # Native section break
  - kind: surgical
    after: h.arch.9a1b
    insertSectionBreak:
      sectionType: NEXT_PAGE # or CONTINUOUS

  # Native person mention chip
  - kind: surgical
    after: h.arch.9a1b
    insertPerson:
      email: alice@example.com

  # Native rich link chip
  - kind: surgical
    after: h.arch.9a1b
    insertRichLink:
      uri: https://docs.google.com
      title: Project Plan

  # Native date chip
  - kind: surgical
    after: h.arch.9a1b
    insertDate:
      displayText: "Sep 15, 2026"
      timestamp: "2026-09-15T00:00:00Z"

  # Native footnote reference
  - kind: surgical
    after: h.arch.9a1b
    insertFootnote:
      text: "See RFC 1234 for background."

  # Public HTTPS inline image
  - kind: surgical
    after: h.arch.9a1b
    insertImage:
      uri: https://example.com/diagram.png
      widthPt: 400
      heightPt: 250
```

## Lists

Each item is its own `NORMAL_TEXT` paragraph with `bullet`. Glyph not in the text. `nestingLevel` is **absolute** (0, 1, 2…). Apply prefixes `\t`.repeat(level), then creates bullets — Google nests from those tabs. Don’t pass `indentStart` to fake a nest.

Flush level-0 (glyph at the left, text at 18pt): `{ "style": { "indentStart": 18, "indentFirstLine": 0 } }` on insert or restyle. `indentStart` alone on a bullet hangs (firstLine = start−18). Plan warns. Shared `listId`: indenting one item may not move siblings — style each, or use the Docs ruler. Plan warns.

Numbered glyph: pick a preset (`NUMBERED_DECIMAL_NESTED` = 1.1.; `NUMBERED_DECIMAL_ALPHA_ROMAN` = 1. a. i.). Do not type `1.` in the text. Custom prefix strings and start-at-N are not in the Docs API.

Placeholder: `text: "<item>"` + `bullet`. Not `""` or `"-"`.

## Template copy

This app is edit-in-place. Copy/share is `gws drive` / `kind: docCopy`.

1. `kind: query` leftover empty headings
2. `remove` empty leftover H2/H3 (not the last node) or demote with `namedStyleType`
3. Fill with `at` from this query. Don’t replace the whole body
4. Fill placeholders only. `innerText` on a chip paragraph destroys chips (plan warns)
