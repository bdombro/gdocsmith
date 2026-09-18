# Google Docs Feature Matrix, API Limitations & Loss Guards

This document is the authoritative reference on what Google Docs features can be safely read, created, modified, cloned, or detected via the Google Docs REST API (`v1/documents`), Apps Script (`DocumentApp`), and the `gdocsmith` CLI.

Use this guide to avoid overconfidence when planning mutations or estimating whether content can be edited without loss or corruption.

---

## 1. Feature Support Matrix

| Category | Feature | Docs UI | REST API Read | REST API Write | Apps Script | CLI Support | Danger / Loss Risk & Corruption Guard |
|---|---|:---:|:---:|:---:|:---:|:---:|---|
| **Tabs & Structure** | **Document Tabs** | ✅ | ✅ (`includeTabsContent`) | ✅ (`addDocumentTab`, `deleteTab`) | ⚠️ Partial | ✅ Full (`kind: addTab` / `renameTab` / `deleteTab`) | Multi-tab steps set `tab:`. Cross-tab cloning via engine `cloneNode`. |
| | **Section Breaks** | ✅ | ✅ (`sectionBreak`) | ✅ (`insertSectionBreak`, `updateSectionStyle`) | ✅ | ✅ (`insertSectionBreak`, `columnCount`, margins) | Insertion supported (`CONTINUOUS`, `NEXT_PAGE`). ⚠️ **Cannot clone detachedly** (governs margins, page orientation, headers/footers). Guarded in `cloneNode`. |
| | **Page Breaks** | ✅ | ✅ (`pageBreak`) | ✅ (`insertPageBreak`) | ✅ | ✅ (`pageBreak`) | Safe to insert/remove. |
| | **Column Breaks** | ✅ | ✅ (`columnBreak`) | ❌ No insert request | ✅ | ⚠️ Read-only | Cannot insert column breaks via REST API. |
| | **Page Setup & Margins** | ✅ | ✅ (`documentStyle`) | ✅ (`updateDocumentStyle`) | ✅ | ✅ Full (`pageSetup`) | Roundtrip page geometry (margins, orientation, pageSize) via query dump and workflow `pageSetup`. |
| | **Headers / Footers** | ✅ | ✅ (segment IDs) | ✅ (`createHeader`, `createFooter`) | ✅ | ⚠️ Not a `run` kind yet | Not on body tape. Use the Docs UI until chrome steps exist. |
| | **Pageless Mode** | ✅ | ✅ (`documentFormat.documentMode`) | ✅ (`updateDocumentStyle`) | ✅ | ✅ Full (`pageSetup`) | Supported. Toggle via `pageSetup.mode` ("PAGES" \| "PAGELESS"), `pageSetup.pageless`, or `kind: pageSetup`. |
| | **Table of Contents (TOC)** | ✅ | ✅ (`tableOfContents`) | ❌ Read-only paragraphs | ✅ (`addTableOfContents`) | ⚠️ Read-only | 🚫 **Do not mutate/delete TOC nodes**: Overwriting with `innerText` or `remove` destroys live links. API cannot regenerate TOC. |
| | **Watermarks** | ✅ | ❌ Hidden | ❌ | ❌ | ❌ Unsupported | Invisible in REST API; preserved unless whole doc is wiped. |
| **Typography & Styles** | **Heading Styles (H1–H6)** | ✅ | ✅ (`namedStyleType`) | ✅ (`updateParagraphStyle`) | ✅ | ✅ Full | Supported up to `HEADING_6`. Real styles only (never bold `NORMAL_TEXT`). |
| | **Inline Text Formatting** | ✅ | ✅ (`textStyle`) | ✅ (`updateTextStyle`) | ✅ | ✅ Full | Bold, italic, underline, strikethrough, monospace, colors, background. |
| | **Paragraph Spacing & Indent** | ✅ | ✅ (`paragraphStyle`) | ✅ (`updateParagraphStyle`) | ✅ | ✅ Full | `spaceAbove`, `spaceBelow`, `lineSpacing`, `indentStart`, `indentFirstLine`, `indentEnd`. Auto-calculates 18pt hanging indent for bullets. |
| | **Hyperlinks** | ✅ | ✅ (`link.url`) | ✅ (`link`) | ✅ | ✅ Full | Native clickable links. Markdown links `[text](url)` auto-convert. |
| | **Custom Named Styles** | ✅ | ✅ (`namedStyles`) | ✅ (`updateNamedStyle`) | ❌ | ⚠️ Read-only | Default style presets can be updated via API, but "Save as default styles" is UI-only. |
| **Lists & Tasks** | **Bulleted & Numbered Lists** | ✅ | ✅ (`bullet`) | ✅ (`createParagraphBullets`) | ✅ | ✅ Full | Uses native Docs glyph presets (`BULLET_*`, `NUMBERED_*`). Never put glyphs in text. |
| | **Interactive Checklists** | ✅ | ✅ (`BULLET_CHECKBOX`) | ✅ (`BULLET_CHECKBOX`) | ✅ | ✅ Full | Real interactive checkboxes. |
| | **List Nesting Level** | ✅ | ✅ (`nestingLevel`) | ✅ (via leading `\t`) | ✅ | ✅ Full | Absolute nesting (0–8). Leading tabs auto-calculated. Queryable via `[level=N]` / `[bullet:N]`. |
| | **Custom Bullet Glyphs** | ✅ | ❌ Not in API | ❌ | ❌ | ❌ Unsupported | Custom glyph prefixes ("Step 1", "•") cannot be styled as bullets in REST API. |
| **Tables** | **Table Grid & Dimensions** | ✅ | ✅ (`table`) | ✅ (`insertTable`, rows/cols) | ✅ | ✅ Full | Insert must be followed by query to fill cells. |
| | **Row & Column Manipulation** | ✅ | ✅ (`table`) | ✅ (`insertTableRow`, `deleteTableRow`, `insertTableColumn`, `deleteTableColumn`) | ✅ | ✅ Full | Surgical insertion and deletion of rows and columns with cell content population. |
| | **Cell Content & Multiline** | ✅ | ✅ (`cell.content[]`) | ✅ (`innerText` with heading-scoped cell id) | ✅ | ✅ Full | Heading-scoped cell targeting (`h.arch.table.0.1.3c8f`). |
| | **Cell Borders & Shading** | ✅ | ✅ (`updateTableCellStyle`) | ✅ (`borderColor`, `cellBackground`) | ✅ | ✅ Full | Supported on table or per cell. |
| | **Column Widths & Min Height**| ✅ | ✅ (`columnWidth`, `minRowHeight`) | ✅ (`updateTableColumnProperties`) | ✅ | ✅ Full | In PT. Fixed column width allows left-alignment. |
| | **Cell Merging / Unmerging** | ✅ | ✅ (spans) | ✅ (`mergeTableCells`, `unmergeTableCells`) | ✅ | ⚠️ Low-level | Manual cell merging possible; complex layouts discouraged. |
| | **Pinned Header Rows & Overflow** | ✅ | ✅ (`pinnedHeaderRows`, `preventOverflow`) | ✅ (`pinTableHeaderRows`, `updateTableRowStyle`) | ❌ | ✅ Full | Pinned top rows repeat across pages; row overflow prevention configurable. |
| | **Table Alignment on Page** | ✅ | ❌ No page alignment prop | ❌ | ❌ | ⚠️ Workaround | API lacks "Center Table". Use fixed `columnWidth` to sit left. |
| | **Nested Tables** | ❌ | ❌ Docs rejects nested tables | ❌ | ❌ | ❌ Unsupported | Google Docs does not allow tables inside table cells. |
| **Media & Graphics** | **Inline Images (Public HTTPS)**| ✅ | ✅ (`inlineObjects`) | ✅ (`insertInlineImage`) | ✅ | ✅ Full (`insertImage`) | Insert public HTTPS image directly via REST API. |
| | **Images from Drive Blob** | ✅ | ❌ REST API cannot read bytes | ❌ | ✅ (`appendImage`) | ✅ Via Script | Requires Apps Script bridge (`Apps Script bootstrap (src/core/appsScriptImages.ts)`). |
| | **Image Resize & Crop** | ✅ | ✅ (`embeddedObject.size`) | ❌ No resize request | ✅ (`setWidth`/`setHeight`) | ⚠️ Via Script | REST API cannot resize existing images. |
| | **Floating / Wrap-Text Images**| ✅ | ✅ (`positionedObjects`) | ❌ Read-only (delete only) | ❌ | ⚠️ Read/Delete only | Cannot create or reposition floating wrap-around objects via REST API. |
| | **Google Drawings (Vector)** | ✅ | ⚠️ Read-only embedded object | ❌ | ❌ | ⚠️ Read-only | Drawing canvas cannot be inspected, modified, or minted via API. |
| | **Linked Sheets Charts** | ✅ | ⚠️ Read-only embedded object | ❌ | ❌ | ⚠️ Read-only | Cannot create or trigger refresh on linked Google Sheets charts via API. |
| **Smart Canvas / Chips** | **People Mentions (`@user`)** | ✅ | ✅ (`person`) | ✅ (`insertPerson`) | ⚠️ | ✅ Full (`insertPerson`) | Native chip creation supported via `insertPerson`. Clone/`tabCreate` recreates mentions that have an email. `innerText`/`remove` on existing chips guarded. |
| | **Rich File Links (`@file`)** | ✅ | ✅ (`richLink`) | ✅ (`insertRichLink`) | ⚠️ | ✅ Full (`insertRichLink`)| Native rich link chip creation supported via `insertRichLink`. |
| | **Date Chips (`@today`)** | ✅ | ✅ (`dateElement`) | ✅ (`insertDate`) | ⚠️ | ✅ Full (`insertDate`)| Native date chip creation supported via `insertDate`. |
| | **Dropdown Chips** | ✅ | ❌ Degrades to plain text | ❌ | ❌ | ❌ Unsupported | Dropdowns (status, priority) appear as plain text in REST API; modifying text destroys interactive dropdown. |
| | **Variable Chips** | ✅ | ❌ Degrades to plain text | ❌ | ❌ | ❌ Unsupported | Document variables appear as raw text runs. Replaced variables lose dynamic binding. |
| | **Timer / Stopwatch Chips** | ✅ | ❌ Degrades to plain text | ❌ | ❌ | ❌ Unsupported | Interactive timers cannot be read or created via API. |
| **Math & Special Elements**| **Math Equations** | ✅ | ✅ (`equation`) | ❌ Read-only | ✅ (`appendEquation`) | ⚠️ Read-only / Warn | Equation blocks exist inside paragraphs. Mutating text or deleting the node permanently destroys them. |
| | **Horizontal Rules / Dividers**| ✅ | ✅ (`horizontalRule`) | ❌ No insert request | ✅ (`appendHorizontalRule`) | ⚠️ Read-only / Warn | Horizontal rules reside inside paragraphs. Mutating text destroys them. Alternative: paragraph bottom border. |
| | **Footnotes** | ✅ | ✅ (`footnoteReference`) | ✅ (`createFootnote`) | ✅ (`appendFootnote`) | ✅ Full (`insertFootnote`) | Native footnote reference creation supported via `insertFootnote` / `createFootnote`. |
| | **Bookmarks** | ✅ | ✅ (`bookmarkId`) | ❌ Read-only | ✅ (`addBookmark`) | ⚠️ Read-only | Bookmarks can be targeted by links (`#bookmark=id`). Cannot insert via REST API. |
| **Collaboration** | **Drive Comment Threads** | ✅ | ✅ (Drive API) | ⚠️ Partial | ❌ | ✅ (`gws drive comments`) | Drive API lists/replies to comments, but **cannot create text-anchored comments** (UI mints private `kix.*` IDs). |
| | **File Permissions & Sharing** | ✅ | ✅ (Drive API) | ✅ (Drive API) | ✅ | ✅ Full (`docPermissionAdd`, `docPermissionRemove`, `docPermissionList`) | Granular access control (reader, commenter, writer, owner) across users, groups, domains, and public links. |
| | **Suggestions (Track Changes)** | ✅ | ✅ (via developer preview) | ⚠️ Accept/Reject preview | ❌ | ⚠️ Read-only | Live suggestions cannot be created via public REST API. |

---

## 2. High-Risk Operations & Silent Corruption Guards

The following operations carry silent data loss risks that agents must be explicitly guarded against:

### 1. The "Moving" Trap (Docs has No Move API)
* **The Reality:** The Google Docs API does not have a `moveNode` or `reorder` request.
* **The Destruction:** To "move" a paragraph, section, or table, an agent must `remove` the original and `insert` a new copy at the destination.
* **The Silent Loss:** Deleting the original node **permanently destroys all attached comment threads, suggestion mode history, and revision author blame**. 
* **The Guard:** Never move structural elements if editing in place is possible. If re-ordering is strictly required, warn the user that comment threads on those nodes will be lost.

### 2. The Smart Chip & Mention Wipeout
* **The Reality:** Google Docs smart chips (`person`, `richLink`, `dateElement`, dropdowns) live inside paragraph text runs.
* **The Destruction:** Running `innerText` or `replace` on a paragraph containing a smart chip replaces the entire element stream with plain text. The rich metadata, avatar, file preview, or date picker is permanently deleted.
* **The Guard:** The CLI parser explicitly inspects every paragraph for `richLink`, `person`, and `dateElement`. If any exist, `chipWarnings()` injects a warning into the plan:
  ```
  Caution: this paragraph has smart chips. innerText and remove destroy them. Query shows chips[].
  ```

### 3. The Math Equation & Horizontal Rule Destruction
* **The Reality:** `equation` and `horizontalRule` are inline paragraph elements with no direct insert request in the Docs REST API.
* **The Destruction:** Editing `innerText` on an equation paragraph wipes the LaTeX/MathML equation; deleting the paragraph destroys the horizontal divider with no way to recreate it via REST API.
* **The Guard:** The CLI inspects paragraphs for `hasEquation` and `hasHorizontalRule` and warns before mutation.

### 4. The Table of Contents (TOC) Corruption
* **The Reality:** `TableOfContents` is a specialized structural element. The REST API allows reading it, but cannot insert or trigger an update on it.
* **The Destruction:** If an agent targets a TOC node with `remove` or attempts to rewrite it with `innerText`, the dynamic link to document headings is broken forever.
* **The Guard:** `cloneNode` explicitly refuses `tableOfContents`. Agents must never mutate TOC nodes.

### 5. Section Break Cloning
* **The Reality:** Section breaks (`kind: "sectionBreak"`) govern margin widths, page orientation (portrait/landscape), column counts, and header/footer bindings.
* **The Destruction:** Cloning a section break detachedly without its page setup parameters corrupts layout geometry.
* **The Guard:** `cloneNode` throws an immediate descriptive error refusing to clone section breaks.

### 6. The Demolish-and-Rebuild Trap (Anti-Demolition Guard)
* **The Reality:** When agents want to update content, they frequently delete all old paragraphs in a section and re-insert fresh content.
* **The Destruction:** Even if 90% of the content is identical, deleting the nodes destroys all attached comments and suggestions.
* **The Guard:** The CLI's **Anti-Demolition Guard** computes 4-character hex checksums of all deleted vs inserted nodes. If unchanged nodes were deleted and re-created, the apply is hard-rejected with:
  ```
  Lazy replacement rejected: 3 unchanged node(s) were deleted and re-created with identical content:
    - HEADING_2: "Architecture" (id: h.arch)
    - NORMAL_TEXT: "Component A handles authentication." (id: h.arch.12ab)
  Deleting existing nodes destroys comment threads, suggestion mode history, and revision blame.
  ```
  Agents must use `replaceSection` / `replaceMarkdown` (which uses LCS diffing to preserve identical nodes in place) or surgical `replace`.

### 7. Table Page Alignment (API Limitation)
* **The Reality:** Google Docs web UI allows setting table page alignment (Center, Left, Right). In Google Docs, tables default to full page width (under the hood, they are Left-aligned). The Google Docs REST API has no property or request for table page alignment (`TableStyle` only supports `tableColumnProperties`).
* **The Silent Confusion:** Setting `alignment: "CENTER"` on a table op applies horizontal alignment to the paragraph text inside cells, NOT the table on the page. Furthermore, setting a fixed `columnWidth` smaller than page width leaves the table hugging the left margin.
* **The Guard & Workaround:** The CLI emits a plan warning when table-wide cell alignment is set, rejects `tableAlignment` with actionable error text, and supports `cellTextAlignment` as an explicit alias. Centering a narrow table on the page can only be done manually in the Docs web UI.

### 8. List Nesting Level & Indentation Mechanics
* **The Reality:** In the Google Docs REST API, list nesting levels (0–8) are derived *solely* from leading tab characters (`\t`) in the paragraph text when `createParagraphBullets` runs. Setting `indentStart` alone does NOT establish nesting—it only shifts text without moving the bullet glyph, creating broken layouts like `- \titem`.
* **Leading Tab Conversion:** `gdocsmith` automatically converts Markdown list indentation (2-space, 4-space, or tabbed) into leading `\t` characters before creating bullets, allowing Docs to natively establish nesting depth.
* **18pt Hanging Indents for Bullets:** Google Docs places bullet glyphs at `indentFirstLine` and list item text at `indentStart` (an 18pt hanging gap). When explicit `indentStart` is styled on a bullet, `gdocsmith` automatically injects `indentFirstLine: indentStart - 18` so the glyph and text remain properly aligned.
* **Nesting Level Immutability on Existing Items:** Once a list item is created in Google Docs, leading tabs are stripped by the API. The REST API offers no property or request to mutate `nestingLevel` on an existing paragraph (`updateParagraphStyle` lacks nesting controls).
* **Surgical Diffing & Replacement:** When using `replaceSection` or `replaceMarkdown`, `gdocsmith` detects changes in list item `nestingLevel` or bullet preset. Instead of attempting invalid in-place text updates, it replaces the modified item by inserting a new spec with leading tabs and deleting the old node, ensuring accurate nesting without losing surrounding unchanged paragraphs.
* **Query & Selector Support:** Queries expose `bullet: { nestingLevel, preset, type }`. Selectors can filter by nesting level using `[level=N]`, `[nestingLevel=N]`, `[bullet:N]`, or `:level(N)`. Diagnostic outputs reflect levels as `NORMAL_TEXT[bullet:1]`.
* **Markdown Export / SS:** `kind: query` + `output: markdown` dumps a document, tab, or `nodeUnder:` section as body-only markdown (`{ markdown, audit }`). Custom run styles and lossy omissions live on `audit`. List items use hierarchical indentation (`"  ".repeat(nestingLevel)`) and tight lists without extra blank lines. Use `output: nodes` with `full: true` for a lossless JSON tape dump.

---

## 3. Excluded Features & API Non-Goals

The following features are supported in the Google Docs web UI or partially in the API, but are **deliberately excluded** from `gdocsmith` with architectural rationale:

| Feature | State in REST API | Why Excluded / Non-Goal | Recommendation |
|---|---|---|---|
| **Linked Sheets Charts** | Read-only object ID | Cannot insert or refresh linked charts via REST API; requires Google Sheets UI binding. | Embed static tables or export chart images to Drive. |
| **Floating / Wrap-Around Images** | Read / delete only | REST API cannot create or position `positionedObjects` (wrap text, behind text). Only inline images are supported. | Use inline images with center alignment or single-cell tables for positioning. |
| **Dropdown & Variable Chips** | Degrades to plain text | REST API strips dropdown menus (status, priority) and document variables down to flat text. Cannot create or edit without destroying interaction. | Keep in-place; do not mutate paragraphs holding dropdowns. |
| **Column Breaks** | Read-only | Google Docs has no `InsertColumnBreakRequest` in REST v1. | Use section breaks (`CONTINUOUS`) with column count adjustments. |
| **Watermarks** | Hidden from API | Zero visibility or control in REST API. | Manage via Google Docs UI (Insert → Watermark). |
| **Authoring Suggestions (Track Changes)** | Developer Preview only | Not part of stable public Google Workspace REST API v1. | Use Drive comments or direct surgical edits. |
| **Text-Anchored Drive Comments** | Drive API cannot mint `kix.*` IDs | Drive Comments API can create unanchored file-level comments, but cannot bind to exact paragraph text runs without internal UI tokens. | Use Drive API for document-level discussions; avoid pretending to anchor inline. |

