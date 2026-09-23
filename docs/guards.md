# Why these guards exist

For human maintainers and developers. (AI agents follow [runbook-diagram.md](runbook-diagram.md) and `skills/gdocsmith/SKILL.md`).

gdocsmith is designed for surgical Google Docs authoring, primarily driven by LLM agents. Ensuring reliable, non-destructive document automation requires guarding against three distinct sources of failure:
1. **Agent Misconceptions (`skills/gdocsmith/SKILL.md`):** LLM agents naturally guess parameters, assume state persists across turns, hallucinate raw character offsets, or attempt coarse "demolish and rebuild" overwrites that destroy document metadata.
2. **Engine Validation & Safety Invariants (`src/core/`):** The local runtime enforces fail-fast preflights, session isolation, AST diff preservation, and automatic hoisting/workarounds so unsafe operations are intercepted or corrected before touching the wire.
3. **Upstream Google Docs REST API Quirks:** The Google Docs platform lacks transactions/rollback, operates on brittle UTF-16 character offsets, throws unhandled HTTP 500 errors when specific internal tab structures are missing, requires trailing newlines, and hides link URLs from text search.

This document serves as the **living institutional memory** for why each guard exists, where it is enforced, and what failure mode or upstream quirk necessitated it.

---

## Defense Layers

Every guard operates across one or more defense layers:
- **`Skill`**: Prompt-level guardrail and workflow recipes in `skills/gdocsmith/SKILL.md` preventing the agent from constructing problematic operations.
- **`Engine`**: Runtime validation, AST diffing, or automated optimization in `src/core/` that catches errors or transparently fixes them.
- **`API Quirk`**: The underlying Google Docs platform behavior or wire constraint that makes the operation dangerous.

---

## 1. Workflow, Session & Preflight

| Agent Pattern / Mistake | Layer | gdocsmith Engine & Skill Guard | Root Cause / Google API Quirk |
|---|---|---|---|
| **Invalid document ID later in workflow** | `Engine` | Eager Preflight Validation scans all `docOpen` and `docCopy` targets upfront before step 0; aborts immediately on 404/403. | Google Docs API has no cross-document transaction or rollback. If step 1 mutates Doc A and step 2 fails on Doc B, Doc A remains partially mutated and corrupted. |
| **Using query alias as mutation anchor** | `Skill + Engine` | `SKILL.md` instructs agents to target scoped node IDs; engine throws if a query alias (which holds an array or markdown string) is passed to `nodeAt`, `nodeBefore`, `nodeAfter`, or `nodeUnder`. | Agents frequently passed `${q}` directly into mutation anchors instead of discovering and referencing concrete AST node IDs. |
| **Missing `doc` parameter on write steps** | `Skill + Engine` | `SKILL.md` Rule 1 mandates `doc: <alias>`; engine `openDocResolve` throws if `doc` is omitted. | gdocsmith is stateless per run and supports multi-document workflows. There is no implicit active document across distinct steps. |
| **Cross-document anchor leakage** | `Skill + Engine` | `SKILL.md` Rule 2 mandates target-scoped anchors; engine validates that anchor node IDs exist on the target document's tape. | Agents querying a source/template document often passed those discovered node IDs directly into mutations targeting a newly created destination document. |
| **Assumed session persistence across calls** | `Skill + Engine` | `SKILL.md` Rule 1 emphasizes single-run scoping; runtime state (aliases, open docs) resets completely between CLI/MCP invocations. | Stateless MCP execution prevents phantom document state leaks and concurrency hazards from one `run` call to the next. |
| **Stale document read after external edit** | `Skill + Engine` | The document snapshot cache (separate from per-call runtime state, see above) persists across calls for up to ~5min; `SKILL.md` Rule 11 instructs agents to pass `forceFetch: true` on `docOpen`/`docCreate` when a doc may have changed outside gdocsmith. | Google Docs may be edited concurrently by other users or tools between `run` calls; the SWR cache trades a small staleness window for fewer redundant fetches, so an explicit bypass is needed for guaranteed-fresh reads. |

---

## 2. Document Tree, Headings & AST Structure

| Agent Pattern / Mistake | Layer | gdocsmith Engine & Skill Guard | Root Cause / Google API Quirk |
|---|---|---|---|
| **Passing UTF-16 character offsets as `at`** | `Skill + Engine` | `SKILL.md` warns never to calculate offsets; engine rejects raw numeric offsets like `4457` with an instructive error; query never prints raw character offsets. | Character offsets shift on every single insertion or deletion. Only snapshot node IDs (`p.12`, `h.slug.ab34`) remain stable within an apply pass. |
| **Demolishing entire outline with `replaceSection`** | `Skill + Engine` | `SKILL.md` Rule 3 forbids `replaceSection` on Title/H1; Anti-Demolition Guard blocks deleting child headings under top-level headings. Use `replace` or `replaceMarkdown` to rename headings. | In Google Docs, headings do not wrap child elements. `replaceSection` diffs and replaces the entire neighborhood until the next heading of equal or shallower depth. Using it on an H1 deletes the entire document body. |
| **Subheading overwriting parent section title** | `Engine` | When incoming markdown starts with a deeper heading (e.g. `### D1` into `## Decisions`), the parent heading is preserved and the body is replaced. | AST level comparison: a deeper heading (`level > targetLevel`) represents a subsection, not an in-place replacement for the section header. |
| **Demolish-and-rebuild (delete & recreate)** | `Engine` | Anti-Demolition Guard compares diff nodes and refuses deletion when inserted text is identical or near-identical. | Deleting and re-inserting unchanged content destroys Google Docs revision history, comments, and deep links unnecessarily. |
| **Deleting the last paragraph** | `Engine` | Engine refuses `remove` on the final paragraph; transparently converts to clearing `innerText`. | The Google Docs REST API requires every document and tab body to terminate with a trailing newline (`\n`). Deleting the final segment returns HTTP 400. |
| **Assuming headings wrap body (`afterbegin`)** | `Engine` | Refuses `insertAdjacentElement("afterbegin")` on headings; requires sibling inserts (`beforebegin` / `afterend`). | Google Docs is a flat sequence of structural elements (`body.content[]`), not a nested HTML/XML DOM. Headings cannot have children. |
| **Fake bullet glyphs (`- item` or `1. item`)** | `Skill + Engine` | `SKILL.md` guides native Markdown lists; engine `assertWritable` rejects literal bullet/numbering prefixes in paragraph text. | Google Docs renders bullets via paragraph bullet styling metadata (`createParagraphBullets`), not literal characters in the text run. Literal bullets cause double-bullet rendering or irregular indents. |
| **Changing nesting level on existing item** | `Engine` | Refuses `nestingLevel` changes on existing items; requires inserting a new item at the target level. | Google Docs REST API tabs are stripped during text extraction; restyling an existing item's nesting without re-indenting creates visual drift. |

---

## 3. Tabs & Document Lifecycle

| Agent Pattern / Mistake | Layer | gdocsmith Engine & Skill Guard | Root Cause / Google API Quirk |
|---|---|---|---|
| **Duplicate tab titles** | `Skill + Engine` | `SKILL.md` Rule 4 requires unique titles; engine validates title uniqueness upfront across `tabCreate` and `tabRename`. | Google Docs REST API requires unique tab titles within a document; duplicate titles fail with HTTP 400. |
| **Post-hoc `tabMove` / `tabRename` on template copies** | `Skill + Engine` | `SKILL.md` Rule 4 encourages creation-time positioning; workflow optimizer hoists `afterTab`, `beforeTab`, `index`, and `title` directly into `tabCreate`, bypassing subsequent `updateDocumentTabProperties`. | Google Docs REST API has an unhandled backend bug: calling `updateDocumentTabProperties` on documents lacking a root `t.0` tab (common in copied Drive templates) crashes with HTTP 500 Internal error. |
| **Referencing root tab as `t.0`** | `Engine` | `tabResolve` auto-resolves `t.0`, `0`, or `root` to the top-most tab (`flat[0]`) when literal `t.0` is missing. | Users and agents expect `t.0` to mean "the default/first tab" based on Google Docs web URLs (`?tab=t.0`). In copied templates where `t.0` was deleted, strict ID matching previously failed. |
| **Moving a tab to its current position** | `Engine` | `tabMove` checks if `currentIdx === targetIndex` and skips calling Google Docs API. | Moving a tab to its existing position is a no-op; avoiding the redundant API call prevents hitting the Google 500 bug on docs without `t.0`. |
| **Multi-tab writes missing `tab:`** | `Skill + Engine` | `SKILL.md` recipes explicitly specify `tab:`; engine `tabResolve` fails closed with known tabs if a multi-tab document write omits `tab:`. | Modifying a multi-tab document without specifying a tab leads to unintended edits on the default tab. |
| **Tab duplication fidelity (no native API)** | `Engine` | `tabCreate` with `fromTab:` transfers structured AST nodes. Recreatable person/date/richLink chips and public https images are inserted natively. Fails closed if leftovers cannot be reconstructed (Drive-only images, footnotes, equations, unsupported chips, TOC, horizontal rules) and instructs the caller to duplicate in the Docs UI or pass `force: true` for lossy conversion. | Google Docs REST API has no `duplicateTab` or `copyTab` request. Tabs must be created empty via `addDocumentTab` and populated via element insertion (`insertPerson` / `insertDate` / `insertRichLink` / `insertInlineImage` for in-paragraph specials). |

---

## 4. Tables & Complex Elements

| Agent Pattern / Mistake | Layer | gdocsmith Engine & Skill Guard | Root Cause / Google API Quirk |
|---|---|---|---|
| **Setting table page alignment** | `Engine` | Refuses `tableAlignment` with an actionable error to use fixed column widths. | The Google Docs REST API has no table-level page alignment property. The `alignment` property only styles text within cells. |
| **Inserting table immediately after heading** | `Engine` | Emits plan warning when inserting a table `afterend` of an `HEADING_*` node. | Inserting a table directly after a heading causes Google Docs to split an empty heading paragraph above the table that cannot easily be removed via API. |
| **Table insert + node delete in single apply** | `Engine` | Refuses combining table insertion and sibling node deletion in a single `apply` pass. | A table insertion introduces dozens of internal character offsets, making simultaneous range deletions in the same `batchUpdate` misaligned. |
| **Overwriting smart chips or math equations** | `Engine` | Refuses mutating or removing smart chips or math equations unless `force: true` is passed. | The Google Docs REST API cannot construct or restore rich smart chips or LaTeX equations; replacing paragraph text destroys them permanently. |
| **Inserting unsupported element types** | `Engine` | Refuses `columnBreak`, `horizontalRule`, or `tableOfContents` in `createElement`. | The Google Docs REST API lacks insert requests for these element kinds. |

---

## 5. Text Replacement, Links & Styling

| Agent Pattern / Mistake | Layer | gdocsmith Engine & Skill Guard | Root Cause / Google API Quirk |
|---|---|---|---|
| **Using `textReplace` to mutate link URLs** | `Skill + Engine` | `SKILL.md` directs agents to symbolic links; docs explain that `textReplace` operates on visible text only. | Google Docs' native `replaceAllText` API scans visible `textRun.content` only. Link URLs are metadata properties on the text run and cannot be matched or replaced by text search. |
| **Symbolic links in code blocks** | `Engine` | Regex for resolving symbolic links (`[Label](tab:Tab#H)`) explicitly shields fenced code blocks (` ``` `) and inline backticks. | Prevents corrupting code examples, Markdown documentation, and technical documentation that happen to contain link-like syntax. |
| **Inheriting styles from template placeholders** | `Engine` | Clear inline styles on insert/innerText before applying markup. | Google Docs text runs inherit style from the character immediately preceding the insertion point. Replacing a `[Bold Placeholder]` would otherwise leave new text bolded. |
