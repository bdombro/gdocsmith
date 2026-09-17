/* Shared CLI output formatting and input parsing. */

import type { CliContext } from "argsbarg";
import YAML from "yaml";

/**
 * Formats data as pretty YAML without artificial line-wrapping.
 */
export function yamlFormat(data: unknown): string {
  return YAML.stringify(data, { lineWidth: 0 }).trimEnd();
}

/** Formats data as pretty YAML without artificial line-wrapping (alias for yamlFormat). */
export const formatYaml = yamlFormat;

/**
 * Formats data as indented JSON.
 */
export function jsonFormat(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Formats data as indented JSON (alias for jsonFormat). */
export const formatJson = jsonFormat;

/**
 * Formats a payload as YAML by default, or JSON if `--json` is set on the context.
 */
export function outputFormat(ctx?: Pick<CliContext, "hasFlag">, data?: unknown): string {
  if (ctx?.hasFlag("json")) {
    return jsonFormat(data);
  }
  return yamlFormat(data);
}

/** Formats a payload as YAML by default, or JSON if `--json` is set (alias for outputFormat). */
export const formatOutput = outputFormat;

/**
 * Prints a payload to stdout using formatOutput.
 */
export function outputPrint(ctx: Pick<CliContext, "hasFlag"> | undefined, data: unknown): void {
  console.log(outputFormat(ctx, data));
}

/** Prints a payload to stdout using formatOutput (alias for outputPrint). */
export const printOutput = outputPrint;

/**
 * Parses structured input string (accepts both YAML and JSON).
 */
export function inputParse(content: string): unknown {
  return YAML.parse(content);
}

/** Parses structured input string (alias for inputParse). */
export const parseInput = inputParse;
