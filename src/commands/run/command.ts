/* Run leaf — sequential Google Docs workflow (JSON document body). */

import type { CliLeaf } from "argsbarg";
import { runExecute } from "~/core/steps/run.ts";
import { GdocsmithRunResultSchema, GdocsmithRunSchema } from "./__generated__";
import type { GdocsmithRun } from "./types.ts";

/** Command definition for sequential Google Docs workflow execution. */
export const runCommand = {
  /** One-line summary describing the purpose of the command. */
  description:
    "Read and edit Google Docs with batched steps: query, write, edit, remove, style, table, tab, doc, share, page.",
  /** Executes the Google Docs workflow document and returns structured JSON. */
  handler: async (ctx) => {
    const run = ctx.inputsAs<GdocsmithRun>();
    const result = await runExecute(run);
    if (ctx.invocation === "cli") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    return result;
  },
  /** JSON schema defining valid workflow document structure. */
  inputSchema: GdocsmithRunSchema,
  /** Command name identifier. */
  key: "run",
  /** Indicates this leaf accepts a structured document on stdin or as an argument. */
  kind: "document",
  /** Operational notes, execution guidelines, and hard rules displayed in help and MCP tool description. */
  notes:
    "• Read the gdocsmith skill before the first run in a session.\n" +
    "• Every step is checked and applied to an in-memory copy first; nothing is sent unless all steps and guards pass. dryRun: true returns the same result without sending. Sending happens in phases; a failure names the phases that landed.\n" +
    "• Target content with anchors: {section} (heading text or ID), {node} (node/cell ID from query), {text} (unique substring), {body: true} (whole tab). Change the smallest scope that covers the edit.\n" +
    "• `doc` is a raw doc ID (between /d/ and /edit) or an alias set by a doc step's `as` earlier in the same run.\n" +
    '• Content is markdown only. query output "markdown" is an editable copy: keep its frontmatter and tokens when writing it back.\n' +
    "• Large results are saved to files; the response gives the paths and an outline.\n" +
    "• Refusals list what a step would break (comments, suggestions, named ranges, heading links, chips, images). Use force: true on that step only with the user's consent.\n" +
    "• Never compute character offsets or call the Docs API directly.",
  /** JSON schema defining structured output returned by this command. */
  outputSchema: GdocsmithRunResultSchema,
} satisfies CliLeaf;
