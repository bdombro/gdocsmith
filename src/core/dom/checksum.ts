/*

Checksum calculation for DocNode and TableCell content/metadata.
Hashes text + all known styles, bullets, alignments, and structural attributes.

*/

import { createHash } from "node:crypto";
import type { CellParagraph, DocNode, TableCell } from "./types.ts";

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
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

/**
 * Computes a deterministic 4-character hex checksum over a DocNode's or ElementSpec's
 * text, style, alignment, bullet, and metadata.
 */
export function computeNodeChecksum(node: Partial<DocNode> | Record<string, unknown>): string {
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
  const imagesCount = Array.isArray(node.images) ? node.images.length : 0;
  const chipsCount = Array.isArray(node.chips) ? node.chips.length : 0;
  let tableShape = "";
  if (node.table && typeof node.table === "object") {
    const t = node.table as Record<string, unknown>;
    if (Array.isArray(t.cells)) {
      tableShape = `${t.cells.length}x${(t.cells[0] as unknown[])?.length ?? 0}`;
    } else if (Array.isArray(t.rows)) {
      tableShape = `${t.rows.length}x${(t.rows[0] as unknown[])?.length ?? 0}`;
    }
  }

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
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 4);
}

/**
 * Computes a deterministic 4-character hex checksum over a TableCell or CellParagraph.
 */
export function computeCellChecksum(cell: TableCell | CellParagraph): string {
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
