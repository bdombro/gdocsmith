/* Checksum calculation for DocNode and TableCell content/metadata. */

import { createHash } from "node:crypto";
import { InlineMarkup, type TextRun } from "~/core/inline.ts";
import type { CellParagraph, DocNode, TableCell } from "./types.ts";

/** Minimal shape shared by TextRun (parsed DocNode side) and InlineRunInput (incoming spec side). */
type RunLike = {
  backgroundColor?: string;
  bold?: boolean;
  code?: boolean;
  end?: number;
  fontFamily?: string;
  fontSize?: number;
  foregroundColor?: string;
  italic?: boolean;
  link?: string;
  start?: number;
  strikethrough?: boolean;
  underline?: boolean;
};

/**
 * Normalizes a list of styled inline runs (from either a parsed DocNode or an incoming
 * ElementSpec) into a stable, order-independent string. Two run lists that describe the
 * same effective styling produce the same signature regardless of which side they came from.
 */
function runsSignature(runs: RunLike[] | undefined): string {
  if (!runs || runs.length === 0) return "";
  return runs
    .map((r) =>
      [
        r.start ?? 0,
        r.end ?? 0,
        r.bold ? 1 : 0,
        r.italic ? 1 : 0,
        r.code ? 1 : 0,
        r.underline ? 1 : 0,
        r.strikethrough ? 1 : 0,
        r.link ?? "",
        r.foregroundColor ?? "",
        r.backgroundColor ?? "",
        r.fontFamily ?? "",
        r.fontSize ?? "",
      ].join(":"),
    )
    .sort()
    .join(",");
}

/**
 * Resolves the effective inline runs for a checksum candidate. Incoming ElementSpecs carry
 * `runs: InlineRunInput[]` directly. Parsed DocNodes never carry `runs` — instead, when a
 * paragraph's inline styling is non-uniform (mixed bold/code/link spans), the parser records
 * a reconstructed `markup` string (only set when it differs from plain `text`). Re-parsing
 * that markup recovers the same run structure `InlineMarkup.serialize` produced it from,
 * since parse/serialize are designed as inverses.
 */
function effectiveRuns(node: Record<string, unknown>): RunLike[] | undefined {
  if (Array.isArray(node.runs)) return node.runs as RunLike[];
  if (typeof node.markup === "string" && node.markup) {
    return InlineMarkup.parse(node.markup).runs as TextRun[];
  }
  return undefined;
}

/**
 * Computes a deterministic 4-character hex checksum over a TableCell or CellParagraph.
 */
export function cellChecksumCompute(
  /** Cell or cell paragraph to checksum. */
  cell: TableCell | CellParagraph,
): string {
  const normText = (cell.text ?? "").trim().replace(/\r\n/g, "\n");
  const styleStr = cell.style ? JSON.stringify(sortObjectKeys(cell.style as unknown as Record<string, unknown>)) : "";
  const alignStr = cell.alignment ?? "";
  const shadingStr = cell.shading ?? ("backgroundColor" in cell ? (cell.backgroundColor ?? "") : "");
  const imagesCount = cell.images?.length ?? 0;
  const chipsCount = cell.chips?.length ?? 0;

  const payload = [
    "cell",
    normText,
    alignStr,
    shadingStr,
    styleStr,
    imagesCount ? `img:${imagesCount}` : "",
    chipsCount ? `chips:${chipsCount}` : "",
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 4);
}

/**
 * Alias for cellChecksumCompute.
 */
export const computeCellChecksum = cellChecksumCompute;

/**
 * Computes a deterministic 4-character hex checksum over a DocNode's or ElementSpec's
 * text, style, alignment, bullet, inline run styling, and metadata.
 */
export function nodeChecksumCompute(
  /** Candidate node or spec to checksum. */
  node: Partial<DocNode> | Record<string, unknown>,
): string {
  const normText = (typeof node.text === "string" ? node.text : "").trim().replace(/\r\n/g, "\n");
  const styleStr = node.style ? JSON.stringify(sortObjectKeys(node.style as unknown as Record<string, unknown>)) : "";
  const bullet = (node as Record<string, unknown>).bullet as
    | { listId?: string; nestingLevel?: number; preset?: string; type?: string }
    | undefined;
  let bulletStr = "";
  if (bullet) {
    const nesting = typeof bullet.nestingLevel === "number" ? bullet.nestingLevel : 0;
    const type = bullet.type ?? (bullet.preset?.startsWith("NUMBERED") ? "NUMBERED" : "BULLET");
    bulletStr = `${type}:${nesting}`;
  }
  const alignStr = typeof node.alignment === "string" ? node.alignment : "";
  const rawSpecials = Array.isArray((node as Record<string, unknown>).specials)
    ? ((node as Record<string, unknown>).specials as Array<{ kind?: string }>)
    : undefined;
  const imagesCount = Array.isArray(node.images)
    ? node.images.length
    : (rawSpecials?.filter((s) => s.kind === "inlineImage").length ?? 0);
  const chipsCount = Array.isArray(node.chips)
    ? node.chips.length
    : (rawSpecials?.filter((s) => s.kind !== "inlineImage").length ?? 0);
  let tableShape = "";
  if (node.table && typeof node.table === "object") {
    const t = node.table as Record<string, unknown>;
    if (Array.isArray(t.cells)) {
      tableShape = `${t.cells.length}x${(t.cells[0] as unknown[])?.length ?? 0}`;
    } else if (Array.isArray(t.rows)) {
      tableShape = `${t.rows.length}x${(t.rows[0] as unknown[])?.length ?? 0}`;
    }
  }

  const runsStr = runsSignature(effectiveRuns(node as Record<string, unknown>));

  const payload = [
    node.kind ?? "paragraph",
    node.namedStyleType ?? "",
    normText,
    alignStr,
    bulletStr,
    styleStr,
    tableShape,
    imagesCount ? `img:${imagesCount}` : "",
    chipsCount ? `chips:${chipsCount}` : "",
    runsStr,
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 4);
}

/**
 * Alias for nodeChecksumCompute.
 */
export const computeNodeChecksum = nodeChecksumCompute;

/**
 * Recursively sorts object keys alphabetically for stable checksumming.
 */
function sortObjectKeys(
  /** Object whose keys should be sorted. */
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      if (typeof val === "object" && !Array.isArray(val)) {
        sorted[key] = sortObjectKeys(val as Record<string, unknown>);
      } else {
        sorted[key] = val;
      }
    }
  }
  return sorted;
}
