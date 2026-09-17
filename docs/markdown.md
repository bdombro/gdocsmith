# Markdown Ingestion (`kind: markdownInsert`)

Specification of supported CommonMark / GFM syntax, custom style directives, and limitations when inserting markdown into Google Docs.

## Overview

`kind: markdownInsert` translates standard Markdown into native Google Docs DOM elements (`paragraphs`, `namedStyleType` headings, `lists`, 0-margin code block callouts, and native `tables`).

```yaml
steps:
  - kind: open
    doc: <documentId>
    as: spec
  - kind: markdownInsert
    doc: spec
    tab: Architecture
    after: h.arch.9a1b
    h1IsTitle: true
    file: spec.md
```

```bash
gdocsmith run < workflow.yaml
```

`dryRun: true` on the document validates without writing. Treat the first `#` as `TITLE` with `h1IsTitle: true`.

### Ingestion Pipeline
1. **Block Lexing**: The markdown body is tokenized into AST block nodes (`marked.lexer`). A leading `---` is a page break, not YAML.
2. **Chunking**: Non-table elements and tables are partitioned into isolated batches to satisfy Google Docs API table isolation constraints.
3. **DOM Application**: Blocks are mapped to `ElementSpec` nodes, styled via `InlineMarkup.withStyles`, and written atomically with revision pinning. Custom `::styleName[text]::` directives use `markdownStyles` on the step (not YAML in the markdown string).

---

## Supported Block Syntax

| Element | Markdown Syntax | Google Docs DOM Output | Notes |
|---|---|---|---|
| **Blockquote** | `> blockquote text` | `NORMAL_TEXT` with `indentStart` | Indented 18pt per `>` blockquote level |
| **Code Block** | ```` ```lang\ncode\n``` ```` | Code block | Rendered as 0-margin single-cell container in `Courier New` |
| **Heading** | `# Heading 1` .. `###### Heading 6` | `HEADING_1` .. `HEADING_6` | Scaled to valid Google Docs heading levels 1–6 (first H1 maps to `TITLE` if `h1IsTitle: true`) |
| **List (Bullet)** | `- item` / `* item` / `+ item` | `NORMAL_TEXT` + bullet preset | Preset: `BULLET_DISC_CIRCLE_SQUARE`. Indentation sets `nestingLevel` |
| **List (Numbered)** | `1. item` / `2. item` | `NORMAL_TEXT` + numbered preset | Preset: `NUMBERED_DECIMAL_NESTED`. Indentation sets `nestingLevel` |
| **List (Task / Checkbox)** | `- [ ] task` / `- [x] done` | `NORMAL_TEXT` + checkbox preset | Preset: `BULLET_CHECKBOX` |
| **Page Break** | `---` / `***` (horizontal rule) | `pageBreak` element | Hard page break inserted into the tape |
| **Paragraph** | Regular paragraph text | `NORMAL_TEXT` paragraph | Multiple paragraphs separated by blank lines |
| **Table** | `\| Col 1 \| Col 2 \|` | Native `Table` | First row bolded as table header; cell styles preserved |

---

## Supported Inline Syntax

Inline markup is stripped of delimiters and converted into Google Docs API `updateTextStyle` ranges.

| Style / Element | Markdown Syntax | Docs Style Applied | Notes |
|---|---|---|---|
| **Autolink** | `<https://example.com>`, `https://example.com` | `link: { url: "..." }` | GFM bare URL or bracketed autolink |
| **Bold** | `**bold**` or `__bold__` | `bold: true` | Combines with other styles |
| **Inline Code** | `` `code` `` | `fontFamily: "Courier New"`, `fontSize: 10` | Inline monospace run |
| **Inline Link** | `[label](https://example.com)` | `link: { url: "..." }` | Standard inline link |
| **Italic** | `*italic*` or `_italic_` | `italic: true` | Combines with other styles |
| **Strikethrough** | `~~strikethrough~~` | `strikethrough: true` | CommonMark / GFM strikethrough |

---

## Custom Font Styles via `markdownStyles`

Agents define reusable typographic styles on the insert/replace step (`markdownStyles`), then apply them inline with `::styleName[content]::` directives. Do not put a YAML `---` block in the markdown string — `---` is a page break. Distinct from native `style` (Docs paragraph/run patch on an existing node).

### Syntax Example

```yaml
steps:
  - kind: markdownInsert
    doc: spec
    after: h.arch.9a1b
    markdownStyles:
      footnote:
        style: italic
        color: "#6b7280"
        size: 9
      alert:
        style: bold
        color: "#e11d48"
      pill:
        background: "#f3f4f6"
        font: "Courier New"
        size: 9
    markdown: |
      # Migration RFC

      Status: ::pill[IN_PROGRESS]::

      ::alert[Warning: Breaking change affects all v1 clients.]::

      See the ::footnote[architecture notes in [Reference Spec](https://internal.corp/spec)]:: for details.
```

### Supported Style Properties

| Property | Aliases | Expected Value | Example |
|---|---|---|---|
| Background Color | `background`, `backgroundColor`, `highlight` | Hex color string (`#rrggbb`) | `"#fef08a"` |
| Font Family | `font`, `fontFamily` | Font name string | `"Courier New"`, `"Roboto"` |
| Font Size | `size`, `fontSize` | Number (PT) or string | `9`, `"10.5pt"` |
| Foreground Color | `color`, `foregroundColor` | Hex color string (`#rrggbb`) | `"#e11d48"` |
| Text Style | `style`, `bold`, `italic`, `underline`, `strike` | Comma-delimited keywords or booleans | `"bold, italic"`, `bold: true` |

### Balanced Bracket & Nesting Rules
- **Balanced Brackets**: Custom parser handles escaped brackets (`\[`, `\]`) and nested bracket pairs without breaking.
- **Directive Inheritance**: Standard markdown modifiers inside a directive merge with the directive's base style (e.g. bolding text within a gray italic directive produces gray, bold, italic text).
- **Nested Markdown**: Content inside directive brackets supports full inline markdown formatting:
  `::alert[Alert: **Bold text** and a [link](https://example.com)]::`
- **Unmapped Fallback**: Directives referencing undeclared style names safely render as plain text without crashing.

---

## Unsupported & Degraded Syntax

These CommonMark/GFM features are currently not supported or degrade when written to Google Docs:

| Feature | Syntax | Behavior in Google Docs | Workaround / Solution |
|---|---|---|---|
| **Definition Lists** | `Term\n: Definition` | Rendered as separate plain text paragraphs | Use bold prefix: `**Term**: Definition` |
| **Footnotes** | `[^1]` / `[^1]: Note` | Emitted as literal text (`[^1]`) | Use surgical step `insertFootnote`, custom directive `::footnote[Note]`, or plain italic |
| **Internal Anchor Links** | `[Section](#heading-id)` | Emitted as web link URL `#heading-id` (not a Docs jump) | Docs REST API requires internal bookmark/heading IDs |
| **Markdown Images** | `![alt](https://example.com/img.png)` | CommonMark image tags not directly embedded in doc body | Use surgical step `insertImage` (public HTTPS) or Drive upload + Apps Script (see [docs/images.md](images.md)) |
| **Raw HTML** | `<a href="...">`, `<b>`, `<div style="...">` | Emitted as literal plaintext string (e.g. `<b>bold</b>`) | Use standard Markdown (`**bold**`, `[link](url)`) |
| **Reference Link Tags** | `[label][ref]` + `[ref]: url` | `[label][ref]` emitted as literal plain text | Use standard inline links: `[label](url)` |
| **Smart Chips** | `@person`, `@file` | Emitted as plain text or standard hyperlinks | Standard markdown lexer does not emit chips; use surgical steps: `insertPerson`, `insertRichLink`, or `insertDate` |
| **Task List Toggling** | Clicking checkbox in Docs | Creates standard Docs interactive checkbox | Checkboxes can be checked/unchecked in the Google Docs UI |
