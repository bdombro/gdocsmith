/* Status leaf — print app version. */

import { type CliLeaf, CliOptionKind } from "argsbarg";
import { StatusJsonOutputSchema } from "./__generated__";
import type { StatusJsonOutput } from "./types.ts";

/** Command leaf that reports the application version. */
export const statusCommand = {
  description: "Show app version.",
  handler: (ctx) => {
    const out: StatusJsonOutput = { version: ctx.program.version };
    if (ctx.invocation === "cli") {
      if (ctx.hasFlag("json")) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(`version=${out.version}`);
      }
      return;
    }
    return out;
  },
  key: "status",
  options: [
    {
      description: "Emit JSON.",
      kind: CliOptionKind.Presence,
      name: "json",
    },
  ],
  outputSchema: StatusJsonOutputSchema,
} satisfies CliLeaf;
