/* Export tab DOM to Markdown with degradation auditing. */

import type { DocNode, QueryTextStyle, TableCell } from "./types.ts";

/**
 * Summary of degradation issues and styling statistics produced during export.
 */
export type ExportAuditSummary = {
  /** Document ID being exported. */
  documentId?: string;
  /** List of human-readable warnings and lossy conversion explanations. */
  issues: string[];
  /** True when export has zero lossy omissions or degradations. */
  lossless: boolean;
  /** Total count of nodes processed. */
  nodeCount: number;
  /** Total count of nodes carrying non-default styles. */
  styledNodesCount: number;
  /** Mapped dictionary of custom styles. */
  styles?: Record<string, QueryTextStyle>;
  /** Total tab count in multi-tab documents. */
  tabCount?: number;
  /** Target tab ID. */
  tabId?: string;
  /** Target tab title. */
  tabTitle?: string;
  /** Per-tab breakdown in multi-tab exports. */
  tabs?: Array<{
    /** List of issues in this tab. */
    issues: string[];
    /** True if this tab converted losslessly. */
    lossless: boolean;
    /** Node count in this tab. */
    nodeCount: number;
    /** Tab identifier. */
    tabId: string;
    /** Tab title. */
    tabTitle: string;
  }>;
};

/**
 * Markdown export result containing rendered text and conversion audit.
 */
export type ExportMarkdownResult = {
  /** Conversion audit report. */
  audit: ExportAuditSummary;
  /** Body-only Markdown. Custom styles and omissions live on {@link ExportAuditSummary}. */
  markdown: string;
};

/**
 * Tab input definition for document export.
 */
export type ExportTabInput = {
  /** Array of document nodes on this tab's tape. */
  nodes: DocNode[];
  /** Unique tab identifier. */
  tabId?: string;
  /** Tab title. */
  tabTitle?: string;
};

/**
 * Audits a list of DocNodes for lossy degradations (images, chips, footnotes).
 */
export function docNodesAudit(
  /** Candidate document nodes to audit. */
  nodes: DocNode[],
  /** Audit configuration options. */
  opts: {
    documentId?: string;
    includeStyles?: boolean;
    tabId?: string;
    tabTitle?: string;
  } = {},
): ExportAuditSummary {
  const issues: string[] = [];
  let styledCount = 0;
  const stylesMap: Record<string, QueryTextStyle> = {};

  for (const node of nodes) {
    if (!node.isCode && node.style && Object.keys(node.style).length > 0) {
      styledCount++;
      stylesMap[String(node.tapeIndex)] = node.style;
    }
    if (node.images?.length) {
      issues.push(`Node ${node.tapeIndex}: ${node.images.length} image(s) replaced with [Image] placeholder`);
    }
    if (node.chips?.length) {
      issues.push(`Node ${node.tapeIndex}: ${node.chips.length} smart chip(s) flattened to text/links`);
    }
    if (node.footnoteIds?.length) {
      issues.push(`Node ${node.tapeIndex}: ${node.footnoteIds.length} footnote(s) omitted`);
    }
    if (node.hasEquation) {
      issues.push(`Node ${node.tapeIndex}: Math equation omitted (REST API cannot insert equations)`);
    }
    if (node.hasHorizontalRule) {
      issues.push(`Node ${node.tapeIndex}: Horizontal rule / divider omitted`);
    }
    if (node.kind === "tableOfContents") {
      issues.push(`Node ${node.tapeIndex}: Table of Contents block omitted (REST API cannot create TOC)`);
    }
    if (node.kind === "sectionBreak") {
      issues.push(`Node ${node.tapeIndex}: Section break / page setup omitted (cannot be cloned detachedly)`);
    }
    if (node.kind === "table" && node.table) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (cell.images?.length) {
            issues.push(
              `Node ${node.tapeIndex} table cell: ${cell.images.length} image(s) replaced with [Image] placeholder`,
            );
          }
          if (cell.chips?.length) {
            issues.push(`Node ${node.tapeIndex} table cell: ${cell.chips.length} smart chip(s) flattened`);
          }
        }
      }
    }
  }

  const summary: ExportAuditSummary = {
    documentId: opts.documentId,
    issues,
    lossless: issues.length === 0,
    nodeCount: nodes.length,
    styledNodesCount: styledCount,
    tabId: opts.tabId,
    tabTitle: opts.tabTitle,
  };

  if (opts.includeStyles && styledCount > 0) {
    summary.styles = stylesMap;
  }

  return summary;
}

/**
 * Alias for docNodesAudit.
 */
export const auditDocNodes = docNodesAudit;

/**
 * Exports one or more document tabs into unified Markdown.
 * Lossy conversions and custom run styles live on {@link ExportMarkdownResult.audit}, not in the markdown string.
 */
export function documentExportToMarkdown(
  /** Array of tabs to export. */
  tabs: ExportTabInput[],
  /** Export configuration options. */
  opts: {
    documentId?: string;
    includeStyles?: boolean;
  } = {},
): ExportMarkdownResult {
  if (tabs.length === 0) {
    return {
      audit: {
        documentId: opts.documentId,
        issues: [],
        lossless: true,
        nodeCount: 0,
        styledNodesCount: 0,
      },
      markdown: "",
    };
  }

  if (tabs.length === 1) {
    const single = tabs[0]!;
    const audit = docNodesAudit(single.nodes, {
      documentId: opts.documentId,
      includeStyles: opts.includeStyles,
      tabId: single.tabId,
      tabTitle: single.tabTitle,
    });

    const bodyLines = nodesRenderToMarkdown(single.nodes);

    return {
      audit,
      markdown: `${bodyLines.join("\n\n")}\n`,
    };
  }

  const tabAudits: ExportAuditSummary[] = [];
  const aggregatedIssues: string[] = [];
  let totalNodeCount = 0;
  let totalStyledCount = 0;
  const mergedStyles: Record<string, QueryTextStyle> = {};

  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i]!;
    const tabAudit = docNodesAudit(t.nodes, {
      documentId: opts.documentId,
      includeStyles: opts.includeStyles,
      tabId: t.tabId,
      tabTitle: t.tabTitle,
    });
    tabAudits.push(tabAudit);
    totalNodeCount += tabAudit.nodeCount;
    totalStyledCount += tabAudit.styledNodesCount;
    if (tabAudit.styles) {
      Object.assign(mergedStyles, tabAudit.styles);
    }
    const tabLabel = t.tabTitle || t.tabId || `Tab ${i + 1}`;
    for (const issue of tabAudit.issues) {
      aggregatedIssues.push(`[${tabLabel}] ${issue}`);
    }
  }

  const tabBodies: string[] = [];
  for (const t of tabs) {
    const bodyLines = nodesRenderToMarkdown(t.nodes);

    const firstMeaningful = t.nodes.find((n) => n.kind === "paragraph" && (n.text?.trim() || n.markup?.trim()));
    const firstText = (firstMeaningful?.text ?? "").trim().toLowerCase();
    const titleText = (t.tabTitle ?? "").trim().toLowerCase();
    const hasMatchingTitle =
      firstMeaningful &&
      (firstMeaningful.namedStyleType === "TITLE" || firstMeaningful.namedStyleType === "HEADING_1") &&
      firstText === titleText;

    let content = bodyLines.join("\n\n");
    if (!hasMatchingTitle && t.tabTitle?.trim()) {
      content = `# ${t.tabTitle.trim()}${content ? `\n\n${content}` : ""}`;
    }
    tabBodies.push(content);
  }

  const audit: ExportAuditSummary = {
    documentId: opts.documentId,
    issues: aggregatedIssues,
    lossless: aggregatedIssues.length === 0,
    nodeCount: totalNodeCount,
    styledNodesCount: totalStyledCount,
    tabCount: tabs.length,
    tabs: tabs.map((t, idx) => ({
      issues: tabAudits[idx]?.issues ?? [],
      lossless: tabAudits[idx]?.lossless ?? true,
      nodeCount: tabAudits[idx]?.nodeCount ?? 0,
      tabId: t.tabId ?? "",
      tabTitle: t.tabTitle ?? "",
    })),
  };

  if (opts.includeStyles && totalStyledCount > 0) {
    audit.styles = mergedStyles;
  }

  return {
    audit,
    markdown: `${tabBodies.join("\n\n---\n\n")}\n`,
  };
}

/**
 * Alias for documentExportToMarkdown.
 */
export const exportDocumentToMarkdown = documentExportToMarkdown;

/**
 * Exports a single tab's DocNodes into Markdown.
 */
export function tabExportToMarkdown(
  /** Array of nodes on the tab tape. */
  nodes: DocNode[],
  /** Configuration options. */
  opts: {
    documentId?: string;
    includeStyles?: boolean;
    tabId?: string;
    tabTitle?: string;
  } = {},
): ExportMarkdownResult {
  return documentExportToMarkdown([{ nodes, tabId: opts.tabId, tabTitle: opts.tabTitle }], opts);
}

/**
 * Alias for tabExportToMarkdown.
 */
export const exportTabToMarkdown = tabExportToMarkdown;

function bridgingEmptyLineCountGet(nodes: DocNode[], fromIndex: number, maxEmpty = 2): number {
  let count = 0;
  for (let k = fromIndex; k < nodes.length; k++) {
    const candidate = nodes[k]!;
    if (
      candidate.kind === "paragraph" &&
      !candidate.text?.trim() &&
      !candidate.images?.length &&
      !candidate.chips?.length &&
      !candidate.bullet
    ) {
      count++;
      if (count > maxEmpty) return 0;
    } else if (candidate.isCode) {
      return count;
    } else {
      return 0;
    }
  }
  return 0;
}

function codeFenceGet(lines: string[]): string {
  let maxTicks = 0;
  for (const line of lines) {
    const matches = line.match(/`+/g);
    if (matches) {
      for (const m of matches) {
        if (m.length > maxTicks) {
          maxTicks = m.length;
        }
      }
    }
  }
  return "`".repeat(Math.max(3, maxTicks + 1));
}

/**
 * Renders tape nodes to Markdown body lines (no YAML frontmatter, no style directives).
 */
function nodesRenderToMarkdown(
  /** Tape nodes to serialize. */
  nodes: DocNode[],
): string[] {
  const bodyLines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    if (node.kind === "sectionBreak") {
      continue;
    }

    if (node.kind === "pageBreak") {
      bodyLines.push("---");
      continue;
    }

    if (node.kind === "table" && node.table) {
      bodyLines.push(tableToMarkdown(node.table.cells));
      continue;
    }

    if (node.kind === "paragraph") {
      if (node.isCode) {
        const codeLines: string[] = [node.text ?? ""];
        let j = i + 1;
        while (j < nodes.length) {
          const next = nodes[j]!;
          if (next.isCode) {
            codeLines.push(next.text ?? "");
            j++;
          } else if (
            next.kind === "paragraph" &&
            !next.text?.trim() &&
            !next.images?.length &&
            !next.chips?.length &&
            !next.bullet
          ) {
            const bridgeCount = bridgingEmptyLineCountGet(nodes, j);
            if (bridgeCount > 0) {
              for (let b = 0; b < bridgeCount; b++) {
                codeLines.push(nodes[j + b]?.text ?? "");
              }
              j += bridgeCount;
            } else {
              break;
            }
          } else {
            break;
          }
        }
        i = j - 1;

        const fence = codeFenceGet(codeLines);
        const bqPrefix =
          node.indentStart?.magnitude && node.indentStart.magnitude >= 18
            ? "> ".repeat(Math.round(node.indentStart.magnitude / 18))
            : "";
        const blockContent = [fence, ...codeLines, fence];
        bodyLines.push(blockContent.map((line) => (bqPrefix ? `${bqPrefix}${line}` : line)).join("\n"));
        continue;
      }

      let rawText = node.markup ?? node.text ?? "";
      if (node.images?.length && !rawText.includes("[Image]")) {
        rawText = rawText.trim() ? `${rawText} [Image]` : "[Image]";
      }

      const named = node.namedStyleType ?? "NORMAL_TEXT";
      if (named === "TITLE" || named === "HEADING_1") {
        bodyLines.push(`# ${rawText}`);
      } else if (named === "SUBTITLE" || named === "HEADING_2") {
        bodyLines.push(`## ${rawText}`);
      } else if (named === "HEADING_3") {
        bodyLines.push(`### ${rawText}`);
      } else if (named === "HEADING_4") {
        bodyLines.push(`#### ${rawText}`);
      } else if (named === "HEADING_5") {
        bodyLines.push(`##### ${rawText}`);
      } else if (named === "HEADING_6") {
        bodyLines.push(`###### ${rawText}`);
      } else if (node.bullet) {
        const listCounters = new Map<number, number>();
        const listLines: string[] = [];
        let j = i;
        while (j < nodes.length) {
          const itemNode = nodes[j]!;
          if (itemNode.kind !== "paragraph" || !itemNode.bullet) {
            break;
          }
          let rawItemText = itemNode.markup ?? itemNode.text ?? "";
          if (itemNode.images?.length && !rawItemText.includes("[Image]")) {
            rawItemText = rawItemText.trim() ? `${rawItemText} [Image]` : "[Image]";
          }
          const level = itemNode.bullet.nestingLevel ?? 0;
          const indent = "  ".repeat(level);
          const isCheckbox = itemNode.bullet.type === "CHECKBOX" || itemNode.bullet.preset === "BULLET_CHECKBOX";
          const isNumbered =
            itemNode.bullet.type === "NUMBERED" || Boolean(itemNode.bullet.preset?.startsWith("NUMBERED"));

          for (const key of Array.from(listCounters.keys())) {
            if (key > level) {
              listCounters.delete(key);
            }
          }

          if (isCheckbox) {
            listCounters.delete(level);
            listLines.push(`${indent}- [ ] ${rawItemText}`);
          } else if (isNumbered) {
            const nextCount = (listCounters.get(level) ?? 0) + 1;
            listCounters.set(level, nextCount);
            listLines.push(`${indent}${nextCount}. ${rawItemText}`);
          } else {
            listCounters.delete(level);
            listLines.push(`${indent}- ${rawItemText}`);
          }
          j++;
        }
        i = j - 1;
        bodyLines.push(listLines.join("\n"));
      } else {
        bodyLines.push(rawText);
      }
    }
  }

  return bodyLines;
}

function tableToMarkdown(cells: TableCell[][]): string {
  if (!cells.length) return "";
  const lines: string[] = [];
  const colCount = Math.max(...cells.map((r) => r.length));

  for (let r = 0; r < cells.length; r++) {
    const row = cells[r]!;
    const rowContent = Array.from({ length: colCount }, (_, c) => {
      const cell = row[c];
      if (!cell) return "";
      const text = (cell.paragraphs && cell.paragraphs.length > 0 ? cell.paragraphs : [cell])
        .map((p) => p.markup ?? p.text ?? "")
        .join(" ")
        .replace(/\|/g, "\\|")
        .replace(/\n+/g, " ");
      return text;
    });
    lines.push(`| ${rowContent.join(" | ")} |`);

    if (r === 0) {
      const divider = Array.from({ length: colCount }, () => "---");
      lines.push(`| ${divider.join(" | ")} |`);
    }
  }

  return lines.join("\n");
}
