/* Scan document nodes for Google Docs REST API uncreatable primitives during tab copy. */

import { unclonableFromNode } from "~/core/dom/inlineSpecials.ts";
import type { DocNode } from "~/core/dom/types.ts";

/** Counts of REST-uncreatable primitives found while scanning a source tab. */
export type LossyTabCounts = {
  /** Display titles of smart chips in scan order. */
  chipTitles: string[];
  /** Number of math equations. */
  equations: number;
  /** Number of footnote references. */
  footnotes: number;
  /** Number of horizontal rules. */
  horizontalRules: number;
  /** Number of inline images. */
  images: number;
  /** Number of Table of Contents nodes. */
  toc: number;
};

/** Per-node issue list plus a one-line summary for MCP first-line truncation. */
export type LossyTabScan = {
  /** Human-readable per-node issue lines. */
  details: string[];
  /** Compact count summary safe to put on the error's first line. */
  summary: string;
};

/** Detects elements in source tab nodes that cannot be losslessly recreated by the Google Docs REST API. */
export function detectLossyTabElements(
  /** Parsed source document tab nodes. */
  nodes: DocNode[],
): LossyTabScan {
  const counts: LossyTabCounts = {
    chipTitles: [],
    equations: 0,
    footnotes: 0,
    horizontalRules: 0,
    images: 0,
    toc: 0,
  };
  const details: string[] = [];
  for (const node of nodes) {
    const msgs = unclonableFromNode(node);
    details.push(...msgs);
    for (const msg of msgs) {
      const chip = msg.match(/(?:person chip|date chip|rich link chip|unsupported smart chip) "([^"]*)"/);
      if (chip) counts.chipTitles.push(chip[1] || "chip");
      else if (msg.includes("inline image")) counts.images++;
      else if (msg.includes("math equation")) counts.equations++;
      else if (msg.includes("footnote")) counts.footnotes++;
      else if (msg.includes("Table of Contents")) counts.toc++;
      else if (msg.includes("horizontal rule")) counts.horizontalRules++;
    }
  }
  return { details, summary: lossyTabScanSummary(counts, details.length) };
}

/** Builds the fail-closed tab copy error; first line stays actionable after MCP first-line truncation. */
export function lossyTabCopyError(
  /** Zero-based workflow step index. */
  stepIndex: number,
  /** Source tab title shown to the caller. */
  sourceTitle: string,
  /** Scan of uncreatable primitives. */
  scan: LossyTabScan,
  /** Step operation name ("tabCreate" or "tabPopulate"). */
  stepKind = "tabCreate",
): string {
  const issueList = scan.details.map((msg) => `  • ${msg}`).join("\n");
  return (
    `steps[${stepIndex}] ${stepKind}: cannot copy tab "${sourceTitle}" losslessly (${scan.summary}). Use the Google Docs UI (right-click the tab > Duplicate) or pass force: true for lossy conversion.\n` +
    `${issueList}\n\n` +
    `Google Docs REST API has no native tab duplication endpoint. Person, date, and rich-link chips and public https images are reconstructed; Drive-only images, footnotes, equations, unsupported chips, TOC, and horizontal rules cannot.`
  );
}

/** Formats a compact one-line summary of uncreatable primitives. */
function lossyTabScanSummary(
  /** Accumulated counts from the source-tab scan. */
  counts: LossyTabCounts,
  /** Total unclonable detail lines, used when no category matched. */
  detailCount: number,
): string {
  const parts: string[] = [];
  if (counts.chipTitles.length > 0) {
    const titles = counts.chipTitles.map((t) => `"${t}"`).join(", ");
    parts.push(`${counts.chipTitles.length} smart chip(s): ${titles}`);
  }
  if (counts.images > 0) parts.push(`${counts.images} inline image(s)`);
  if (counts.equations > 0) parts.push(`${counts.equations} math equation(s)`);
  if (counts.footnotes > 0) parts.push(`${counts.footnotes} footnote(s)`);
  if (counts.horizontalRules > 0) parts.push(`${counts.horizontalRules} horizontal rule(s)`);
  if (counts.toc > 0) parts.push(`${counts.toc} table of contents`);
  if (parts.length === 0 && detailCount > 0) parts.push(`${detailCount} uncreatable element(s)`);
  return parts.join("; ");
}
