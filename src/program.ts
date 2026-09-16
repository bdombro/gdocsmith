/*
gdocsmith CliProgram — command registration only.

Regenerate docs: just docgen
*/

import type { CliProgram } from "argsbarg";
import readmeText from "../README.md" with { type: "text" };
import { createIdentity } from "../scripts/create-identity.ts";
import { runCommand } from "./commands/run/command.ts";
import { statusCommand } from "./commands/status/command.ts";

export const program = {
  commands: [runCommand, statusCommand],
  description: createIdentity.desc,
  docs: {
    topics: {
      readme: {
        text: readmeText,
      },
    },
  },
  key: createIdentity.key,
  mcpServer: { enabled: true },
  version: "1.0.0",
} satisfies CliProgram;
