/* Run leaf — sequential Google Docs workflow (JSON document body). */

import type { CliLeaf } from "argsbarg";
import { applyScriptExecute } from "~/core/applyScript.ts";
import { GdocsmithDocumentSchema, GdocsmithJsonOutputSchema } from "./__generated__";
import type { GdocsmithDocument, GdocsmithJsonOutput } from "./types.ts";

/** Command definition for sequential Google Docs workflow execution. */
export const runCommand = {
  /** One-line summary describing the purpose of the command. */
  description: "Declarative Google Docs workflow engine for queries, dry-run diff previews, and document updates.",
  /** Executes the Google Docs workflow document and returns structured JSON. */
  handler: async (ctx) => {
    const doc = ctx.inputsAs<GdocsmithDocument>();
    const result = await applyScriptExecute(doc, { force: Boolean(doc.force) });
    const quiet = Boolean(doc.quiet);

    /** Structured JSON response payload. */
    const payload: GdocsmithJsonOutput = {
      ...(doc.dryRun ? { diff: result.diff ?? "", dryRun: true } : result.diff ? { diff: result.diff } : {}),
      ...(Object.keys(result.dumped).length > 0 ? { dumped: result.dumped } : {}),
      ...(result.highlights.length > 0 ? { highlights: result.highlights } : {}),
      ok: true,
      stepsCount: result.stepsCount,
    };

    if (quiet && !doc.dryRun && Object.keys(result.dumped).length === 0) {
      return { ok: true, stepsCount: result.stepsCount };
    }

    return payload;
  },
  /** JSON schema defining valid workflow document structure. */
  inputSchema: GdocsmithDocumentSchema,
  /** Command name identifier. */
  key: "run",
  /** Indicates this leaf accepts a structured document on stdin or as an argument. */
  kind: "document",
  /** Operational notes, execution guidelines, and hard rules displayed in help and MCP tool description. */
  notes:
    "• Pipe stdin or pass one JSON document. Knobs: `dryRun`, `force`, `quiet` on the document.\n" +
    "• Each step requires `kind` (e.g. docOpen|docClose|docCreate|tabCreate|query|markdownInsert|replaceSection|…).\n" +
    "• File-touching steps require `doc:` (raw id or open alias). `docCreate` binds `as` (optional `fromDoc:` to clone). There is no run-level documentId.\n" +
    "• Raw IDs only: extract between `/document/d/` and `/edit`. Full URLs are rejected.\n" +
    "• Surgical targeting: copy heading-scoped ids from `kind: query` into `nodeAt`, `nodeAfter`, or `nodeBefore` (e.g. `h.arch.9a1b`). NEVER compute startIndex/endIndex or write raw batchUpdate scripts.\n" +
    "• In-place updates: prefer `replaceSection`, `replaceMarkdown`, or `replace` over deleting and re-inserting content (no demolish-and-rebuild). `replaceSection` replaces all subsections under that heading (e.g. H1 replaces H2s, H2 replaces H3s); guards reject deleting child subsections without `force: true`. To update a placeholder or body paragraph under a parent heading while preserving child subsections, use `replaceMarkdown` with `find: <placeholder>` or `nodeAt: <scopedId|text>` to insert formatted markdown, or `textReplace` for plain string edits.\n" +
    "• Real headings only (`TITLE`, `HEADING_1`–`HEADING_3`). No bullet glyphs in surgical text; use run-in bold (`**Label**: value`).\n" +
    "• Tab setup & bindings: `docOpen`, `docCreate`, `tabCreate`, and `tabPopulate` set aliases. When creating documents with templates, use `docCreate` with `fromDoc` + `fromTab` to seed and rename the initial root `t.0` tab in one step (`docCreate: as, title, fromDoc, fromTab, tabTitle, tabAs`), leaving no orphan tabs and keeping root `t.0` intact. Use `tabCreate` for subsequent tabs (`title, as, afterTab, fromDoc, fromTab`). Always specify final tab `title` at creation time because tabRename fails on docs without root `t.0`. Every `run` call is stateless; aliases do not persist across multiple `run` invocations. `dump: true` dumps metadata into `dumped[as]`. `query` with `as:` writes matches into `dumped[as]`. Query aliases cannot be used as mutation anchors.\n" +
    "• Cache: bypass 5m cache-reads on `docOpen`/`docCreate` with `forceFetch: true` when a doc may have changed externally.\n" +
    "• Cross-doc transfers: use `kind: sectionCopy` with `fromDoc:` and `fromSection:` to transfer sections server-side without streaming markdown, or query source with `output: markdown` and write with `replaceSection`. Anchors must always belong to the target `doc:`.\n" +
    "• Symbolic links: use `[Label](tab:TabTitle#HeadingTitle)`, `[Label](tab:TabTitle)`, or `[Label](#HeadingTitle)` in markdown; gdocsmith automatically resolves them to native Docs deep links (`?tab=...#heading=...`).\n" +
    "• Prefer one `run` per phase until step kinds are proven; then batch related steps. Chip/table writes use `kind: surgical`.\n" +
    "• Dry run: optional `dryRun: true` returns a unified git diff without writing. Run mutations directly without requiring dry-run first; use dryRun only when you need to inspect an expected diff.",
  /** JSON schema defining structured output returned by this command. */
  outputSchema: GdocsmithJsonOutputSchema,
} satisfies CliLeaf;
