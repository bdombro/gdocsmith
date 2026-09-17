/* Run leaf — sequential Google Docs workflow (YAML or JSON document body). */

import type { CliLeaf } from "argsbarg";
import { printOutput } from "~/cli/format.ts";
import { applyScriptExecute } from "~/core/applyScript.ts";
import { GdocsmithDocumentSchema, GdocsmithJsonOutputSchema } from "./__generated__";
import type { GdocsmithDocument, GdocsmithJsonOutput } from "./types.ts";

/** Command definition for sequential Google Docs workflow execution. */
export const runCommand = {
  /** One-line summary describing the purpose of the command. */
  description: "Execute an ordered Google Docs workflow from YAML or JSON (`steps` with `kind`).",
  /** Executes the Google Docs workflow document and formats output based on invocation context. */
  handler: async (ctx) => {
    const doc = ctx.inputsAs<GdocsmithDocument>();
    const result = await applyScriptExecute(doc, { force: Boolean(doc.force) });
    const json = Boolean(doc.json) || ctx.hasFlag("json");
    const quiet = Boolean(doc.quiet);

    /** Structured JSON response payload. */
    const payload: GdocsmithJsonOutput = {
      ...(result.diff ? { diff: result.diff } : {}),
      ...(doc.dryRun ? { dryRun: true } : {}),
      ...(Object.keys(result.dumped).length > 0 ? { dumped: result.dumped } : {}),
      ...(result.highlights.length > 0 ? { highlights: result.highlights } : {}),
      ok: true,
      stepsCount: result.stepsCount,
    };

    if (quiet && !doc.dryRun && Object.keys(result.dumped).length === 0) {
      return payload;
    }

    if (json || ctx.invocation !== "cli") {
      if (ctx.invocation === "cli") printOutput({ hasFlag: () => true }, payload);
      return payload;
    }

    if (doc.dryRun && result.diff) {
      console.log(result.diff);
      return payload;
    }

    if (Object.keys(result.dumped).length > 0 || result.highlights.length > 0) {
      const { ok: _ok, stepsCount: _stepsCount, ...rest } = payload;
      printOutput(ctx, rest);
      return payload;
    }

    console.log(`Applied ${result.stepsCount} step(s).`);
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
    "• Pipe stdin or pass one document (`run < file.yaml`). Knobs live in the document (`dryRun`, `force`, `json`, `quiet`).\n" +
    "• Each step requires `kind` (e.g. open|close|docCreate|docCopy|query|dump|markdownInsert|replaceSection|…).\n" +
    "• Raw IDs only: extract between `/document/d/` and `/edit`. Full URLs are rejected.\n" +
    "• Surgical targeting: copy heading-scoped ids from `kind: query` into `at`, `after`, or `before` (e.g. `h.arch.9a1b`). NEVER compute startIndex/endIndex or write raw batchUpdate scripts.\n" +
    "• In-place updates: prefer `replaceSection`, `replaceMarkdown`, or `replace` over deleting and re-inserting content (no demolish-and-rebuild).\n" +
    "• Real headings only (`TITLE`, `HEADING_1`–`HEADING_3`). No bullet glyphs in surgical text; use run-in bold (`**Label**: value`).\n" +
    "• Bindings: only `open` and `query` set aliases. `query` with `as:` writes `dumped[as]` (use `output: markdown` or `yaml` to serialize a doc/tab/section). `dump` re-emits an alias; dump of an open alias is `{ id, title }` only.\n" +
    "• Prefer one `run` per phase until step kinds are proven; then batch related steps. Chip/table/clone writes use `kind: surgical`.\n" +
    "• Dry run: `dryRun: true` returns a unified git diff without writing.",
  /** JSON schema defining structured output returned by this command. */
  outputSchema: GdocsmithJsonOutputSchema,
} satisfies CliLeaf;
