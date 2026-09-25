/* The canonical form parsed markdown is compared in (PutGet law, G3 D33, M14). */

import type { ParsedBlock, ParsedSpan } from "./parse.ts";
import type { DirectiveAttrs } from "./project.ts";

/** A block in canonical form: plain JSON, stable key order. */
export type CanonicalBlock = Record<string, unknown>;

/**
 * Canonicalizes parsed blocks: directive names become their attributes, adjacent spans with equal
 * formatting merge, trailing spaces go, code fences lose their grouping identity, and adjacent lists of
 * the same kind merge (their group numbers renumbered), so equivalent markdown compares equal.
 */
export function parsedCanonical(
  /** Parsed blocks. */
  blocks: readonly ParsedBlock[],
  /** Directive definitions (from frontmatter). */
  styles: Record<string, DirectiveAttrs> = {},
): CanonicalBlock[] {
  const out: CanonicalBlock[] = [];
  let group = 0;
  let prevList: string | undefined;
  for (const block of blocks) {
    if (block.kind === "listItem" && block.list) {
      // Consecutive list items of the same kind are one list, whatever marker each used.
      if (prevList !== block.list.kind) group++;
      prevList = block.list.kind;
      out.push({
        depth: block.list.depth,
        group,
        kind: "listItem",
        listKind: block.list.kind,
        spans: spansCanonical(block.spans, styles),
      });
      continue;
    }
    prevList = undefined;
    if (block.kind === "codeLine") {
      out.push({
        kind: "codeLine",
        text: block.spans
          .map((s) => (s.kind === "text" ? s.text : ""))
          .join("")
          .replace(/[ \t]+$/, ""),
      });
    } else if (block.kind === "table" && block.table) {
      out.push({
        alignments: block.table.alignments,
        kind: "table",
        rows: block.table.rows.map((row) => row.map((cell) => spansCanonical(cell, styles))),
      });
    } else if (block.kind === "token") {
      out.push({ kind: "token", token: block.token });
    } else {
      out.push({ headingLevel: block.headingLevel, kind: block.kind, spans: spansCanonical(block.spans, styles) });
    }
  }
  return out;
}

/** Spans with directives resolved to attributes, equal neighbors merged, and edges trimmed. */
function spansCanonical(spans: readonly ParsedSpan[], styles: Record<string, DirectiveAttrs>): unknown[] {
  const out: Array<Record<string, unknown>> = [];
  for (const span of spans) {
    const attrs = span.kind === "text" && span.directive ? styles[span.directive] : undefined;
    const format = JSON.stringify({ attrs, marks: span.marks });
    if (span.kind === "text") {
      const last = out.at(-1);
      if (last?.kind === "text" && last.format === format) last.text = `${last.text}${span.text}`;
      else out.push({ format, kind: "text", text: span.text });
    } else out.push({ format, kind: "token", token: span.token });
  }
  if (out[0]?.kind === "text") out[0].text = String(out[0].text).replace(/^\s+/, "");
  const last = out.at(-1);
  if (last?.kind === "text") last.text = String(last.text).replace(/\s+$/, "");
  return out.filter((s) => s.kind !== "text" || s.text !== "");
}
