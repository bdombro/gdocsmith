/*

Shared CLI output formatter & input parser (YAML default, JSON optional).

*/

import type { CliContext } from "argsbarg";
import YAML from "yaml";

/**
 * Formats data as pretty YAML without artificial line-wrapping.
 */
export function formatYaml(data: unknown): string {
  return YAML.stringify(data, { lineWidth: 0 }).trimEnd();
}

/**
 * Formats data as indented JSON.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Formats a payload as YAML by default, or JSON if `--json` is set on the context.
 */
export function formatOutput(ctx?: Pick<CliContext, "hasFlag">, data?: unknown): string {
  if (ctx?.hasFlag("json")) {
    return formatJson(data);
  }
  return formatYaml(data);
}

/**
 * Prints a payload to stdout using formatOutput.
 */
export function printOutput(ctx: Pick<CliContext, "hasFlag"> | undefined, data: unknown): void {
  console.log(formatOutput(ctx, data));
}

/**
 * Parses structured input string (accepts both YAML and JSON).
 */
export function parseInput(content: string): unknown {
  return YAML.parse(content);
}
