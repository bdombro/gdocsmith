# Google Docs Style & Taste Guide

Load before writing. Op syntax: [mechanics.md](mechanics.md). Markdown: [markdown.md](markdown.md).

Source: surgical writes in `src/core/dom/`; markdown ingestion in `src/core/markdown.ts`.

## Core Taste Rules

### 1. Headings & Document Structure
- **Real headings only:** Use native `TITLE` / `HEADING_1`–`HEADING_3` (`#`, `##`, `###`).
- **Never fake headings:** Do not use bolded or enlarged `NORMAL_TEXT` (`**Heading**`).
- **Hierarchy:** Never skip levels (`H1` → `H3`). Never put bullets on headings.
- **Templates:** Fill `<placeholders>`; never add, rename, or delete structural headings.

### 2. Lists & Bullets
- **Native lists:** Use `bullet: { preset, nestingLevel }` (DOM) or standard `-` / `1.` (Markdown).
- **No typed glyphs in text:** In surgical `replace` / `element` steps, never put `-`, `*`, or `•` inside the text string (rejected by guards).
- **Checklists:** Use `BULLET_CHECKBOX` or `- [ ]`.
- **Punctuation:** Full-sentence list items end with a period; short fragments do not.
- **Flush level-0 (DOM):** Set `style: { indentStart: 18, indentFirstLine: 0 }`.

### 3. Code Blocks & Diagrams
- **Monospace snippets:** Set `style: { spaceBelow: 0, lineSpacing: 100 }` on snippet lines to eliminate Google Docs' default 10pt paragraph gap.
- **ASCII art & diagrams:** Must be formatted as backtick monospace / fenced code blocks, never plain wrapped text or tables.

### 4. Tables & Callouts
- **Structured data:** Use tables for comparison matrices and schedules (row 0 bolds as header).
- **No page layout:** Avoid using tables for multi-column page layout.
- **Table alignment:** Google Docs tables default to full page width (left-aligned under the hood). REST API cannot set page-level table alignment (center/right is UI-only). Narrow tables with fixed `columnWidth` hug the left margin. Use `cellTextAlignment` for cell text.
- **Callouts:** 1×1 table with `columnWidth` + `borderColor`.
- **Order of operations (DOM):** Set table chrome before cell `innerText` so `namedStyleType` does not clear inline bold.

### 5. Inline Emphasis & Scannability
- **Run-in bold:** Colon goes **outside** bold (`**Label**: value`, not `**Label: value**`).
- **Italics:** For definitions and titles; never italicize code identifiers.
- **Density:** Break paragraphs longer than 5–6 lines. Match live doc spacing.
- **3-second scan:** Purpose, main headings, and key conclusions must be visible at a glance.
