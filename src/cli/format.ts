/* Shared CLI output formatting and JSON input parsing. */

import type { CliContext } from "argsbarg";

/**
 * Formats data as indented JSON.
 */
export function jsonFormat(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Formats data as indented JSON (alias for jsonFormat). */
export const formatJson = jsonFormat;

/**
 * Formats a payload as JSON for stdout.
 */
export function outputFormat(_ctx?: Pick<CliContext, "hasFlag">, data?: unknown): string {
  return jsonFormat(data);
}

/** Formats a payload as JSON (alias for outputFormat). */
export const formatOutput = outputFormat;

/**
 * Prints a payload to stdout as JSON.
 */
export function outputPrint(_ctx: Pick<CliContext, "hasFlag"> | undefined, data: unknown): void {
  console.log(outputFormat(undefined, data));
}

/** Prints a payload to stdout (alias for outputPrint). */
export const printOutput = outputPrint;

/**
 * Parses a JSON document string (run input, surgical ops files).
 */
export function inputParse(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new SyntaxError("Expected JSON document");
  }
  return JSON.parse(trimmed);
}

/** Parses JSON input (alias for inputParse). */
export const parseInput = inputParse;
