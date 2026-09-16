/*

Run leaf — sequential Google Docs workflow (YAML or JSON document body).

*/

import type { CliLeaf } from "argsbarg";
import { printOutput } from "../../cli/format.ts";
import { executeApplyScript } from "../../core/apply-script.ts";
import { GdocsmithDocumentSchema, GdocsmithJsonOutputSchema } from "./__generated__";
import type { GdocsmithDocument, GdocsmithJsonOutput } from "./types.ts";

export const runCommand = {
  key: "run",
  kind: "document",
  description: "Execute an ordered Google Docs workflow from YAML or JSON (`steps` with `kind`).",
  notes:
    "• Pipe stdin or pass one document (`run < file.yaml`). Knobs live in the document (`dryRun`, `force`, `json`, `quiet`).\n" +
    "• Canonical list: `steps: [{ kind: open|close|createDoc|copyDoc|query|dump|insertMarkdown|… }]`. `ops`/`op`/`action`/`step` are aliases.\n" +
    "• `kind: dump` with `as:` copies that alias into `dumped` in the response.\n" +
    "• Dry run: `dryRun: true` returns a unified git diff without writing.",
  inputSchema: GdocsmithDocumentSchema,
  outputSchema: GdocsmithJsonOutputSchema,
  handler: async (ctx) => {
    const doc = ctx.inputsAs<GdocsmithDocument>();
    const result = await executeApplyScript(doc, { force: Boolean(doc.force) });
    const json = Boolean(doc.json) || ctx.hasFlag("json");
    const quiet = Boolean(doc.quiet);

    const payload: GdocsmithJsonOutput = {
      ...(doc.dryRun ? { dryRun: true } : {}),
      ...(result.diff ? { diff: result.diff } : {}),
      ...(Object.keys(result.dumped).length > 0 ? { dumped: result.dumped } : {}),
      ...(result.highlights.length > 0 ? { highlights: result.highlights } : {}),
      ok: true,
      opsCount: result.opsCount,
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
      const { ok: _ok, opsCount: _opsCount, ...rest } = payload;
      printOutput(ctx, rest);
      return payload;
    }

    console.log(`Applied ${result.opsCount} step(s).`);
    return payload;
  },
} satisfies CliLeaf;
