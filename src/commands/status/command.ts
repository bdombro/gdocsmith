/*
Status leaf — print app version.
*/

import { type CliLeaf, CliOptionKind } from "argsbarg";
import { StatusJsonOutputSchema } from "./__generated__";
import type { StatusJsonOutput } from "./types.ts";

export const statusCommand = {
  key: "status",
  description: "Show app version.",
  options: [
    {
      name: "json",
      description: "Emit JSON.",
      kind: CliOptionKind.Presence,
    },
  ],
  outputSchema: StatusJsonOutputSchema,
  handler: (ctx) => {
    const out: StatusJsonOutput = { version: ctx.program.version };
    if (ctx.hasFlag("json")) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`version=${out.version}`);
    }
  },
} satisfies CliLeaf;
