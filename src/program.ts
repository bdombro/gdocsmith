/* gdocsmith CliProgram — command registration only. */

import type { CliProgram } from "argsbarg";
import readmeText from "../README.md" with { type: "text" };
import { createIdentity } from "../scripts/createIdentity.ts";
import { runCommand } from "./commands/run/command.ts";
import { statusCommand } from "./commands/status/command.ts";

/** Root CLI program configuration for gdocsmith. */
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
  version: "1.0.3",
} satisfies CliProgram;
