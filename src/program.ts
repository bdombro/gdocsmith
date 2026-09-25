/* gdocsmith CliProgram — command registration only. */

import type { CliProgram } from "argsbarg";
import readmeText from "../README.md" with { type: "text" };
import { createIdentity } from "../scripts/createIdentity.ts";
import skillText from "../skills/gdocsmith/SKILL.md" with { type: "text" };
import { runCommand } from "./commands/run/command.ts";
import { statusCommand } from "./commands/status/command.ts";

/** MCP server instructions (G4 D9). */
export const MCP_INSTRUCTIONS =
  'gdocsmith reads and edits Google Docs through its run tool. Before the first run in a session, read the gdocsmith skill (Claude Code: skill "gdocsmith"; other clients: resource gdocsmith://docs/skill). Use run for all Google Docs work; never compute character offsets or call the Docs API directly.';

/** Root CLI program configuration for gdocsmith. */
export const program = {
  commands: [runCommand, statusCommand],
  description: createIdentity.desc,
  docs: {
    topics: {
      readme: {
        text: readmeText,
      },
      skill: {
        text: skillText,
      },
    },
  },
  key: createIdentity.key,
  mcpServer: {
    enabled: true,
    instructions: MCP_INSTRUCTIONS,
  },
  version: "2.0.0",
} satisfies CliProgram;
