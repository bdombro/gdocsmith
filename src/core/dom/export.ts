/*

Export tab DOM to Markdown with frontmatter styles, directives, and degradation auditing.

*/

import type { DocNode, QueryTextStyle, TableCell } from "./types.ts";

export type ExportAuditSummary = {
  documentId?: string;
  issues: string[];
  lossless: boolean;
  nodeCount: number;
  styledNodesCount: number;
  styles?: Record<string, QueryTextStyle>;
  tabCount?: number;
  tabId?: string;
  tabTitle?: string;
  tabs?: Array<{
    issues: string[];
    lossless: boolean;
    nodeCount: number;
    tabId: string;
    tabTitle: string;
  }>;
};

export type ExportTabInput = {
  nodes: DocNode[];
  tabId?: string;
  tabTitle?: string;
};

export type ExportMarkdownResult = {
  audit: ExportAuditSummary;
  markdown: string;
};

/** Audits a list of DocNodes for lossy degradations (images, chips, footnotes). */
export function auditDocNodes(
  nodes: DocNode[],
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

/** Formats a table node into CommonMark pipe table. */
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

function buildFrontmatterLines(
  styleDefs: Map<string, { name: string; style: QueryTextStyle }>,
  issues: string[],
): string[] {
  const lines: string[] = [];
  if (styleDefs.size > 0 || issues.length > 0) {
    lines.push("---");
    if (styleDefs.size > 0) {
      lines.push("styles:");
      for (const { name, style } of styleDefs.values()) {
        lines.push(`  ${name}:`);
        if (style.fontSize != null) {
          lines.push(`    fontSize: ${style.fontSize}`);
        }
        if (style.foregroundColor != null) {
          lines.push(`    foregroundColor: "${style.foregroundColor}"`);
        }
        if (style.italic != null) {
          lines.push(`    italic: ${style.italic}`);
        }
      }
    }
    if (issues.length > 0) {
      lines.push("omissions:");
      for (const issue of issues) {
        lines.push(`  - "${issue.replace(/"/g, '\\"')}"`);
      }
    }
    lines.push("---");
  }
  return lines;
}

function renderNodesToMarkdown(
  nodes: DocNode[],
  styleDefs: Map<string, { name: string; style: QueryTextStyle }>,
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
            const bridgeCount = getBridgingEmptyLineCount(nodes, j);
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

        const fence = getCodeFence(codeLines);
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

      const styleDef = node.style ? styleDefs.get(JSON.stringify(node.style)) : undefined;
      const text = styleDef ? `::${styleDef.name}[${rawText}]::` : rawText;

      const named = node.namedStyleType ?? "NORMAL_TEXT";
      if (named === "TITLE" || named === "HEADING_1") {
        bodyLines.push(`# ${text}`);
      } else if (named === "SUBTITLE" || named === "HEADING_2") {
        bodyLines.push(`## ${text}`);
      } else if (named === "HEADING_3") {
        bodyLines.push(`### ${text}`);
      } else if (named === "HEADING_4") {
        bodyLines.push(`#### ${text}`);
      } else if (named === "HEADING_5") {
        bodyLines.push(`##### ${text}`);
      } else if (named === "HEADING_6") {
        bodyLines.push(`###### ${text}`);
      } else if (node.bullet) {
        const indent = "  ".repeat(node.bullet.nestingLevel ?? 0);
        if (node.bullet.type === "CHECKBOX") {
          bodyLines.push(`${indent}- [ ] ${text}`);
        } else if (node.bullet.type === "NUMBERED") {
          bodyLines.push(`${indent}1. ${text}`);
        } else {
          bodyLines.push(`${indent}- ${text}`);
        }
      } else {
        bodyLines.push(text);
      }
    }
  }

  return bodyLines;
}

/** CommonMark fence string (``` or ```` if content contains backticks). */
function getCodeFence(lines: string[]): string {
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
 * Counts consecutive empty paragraphs that can be bridged inside a code block,
 * provided they are followed by another code paragraph (at most maxEmpty).
 */
function getBridgingEmptyLineCount(nodes: DocNode[], fromIndex: number, maxEmpty = 2): number {
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

/**
 * Exports one or more document tabs into unified Markdown with YAML frontmatter
 * for custom styles and lossy degradation auditing.
 */
export function exportDocumentToMarkdown(
  tabs: ExportTabInput[],
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

  // Single tab fast-path / exact backwards compatibility
  if (tabs.length === 1) {
    const single = tabs[0]!;
    const audit = auditDocNodes(single.nodes, {
      documentId: opts.documentId,
      includeStyles: opts.includeStyles,
      tabId: single.tabId,
      tabTitle: single.tabTitle,
    });

    const styleDefs = new Map<string, { name: string; style: QueryTextStyle }>();
    let styleCounter = 1;

    for (const node of single.nodes) {
      if (!node.isCode && node.style && Object.keys(node.style).length > 0) {
        const key = JSON.stringify(node.style);
        if (!styleDefs.has(key)) {
          const name = `style${styleCounter++}`;
          styleDefs.set(key, { name, style: node.style });
        }
      }
    }

    const frontmatterLines = buildFrontmatterLines(styleDefs, audit.issues);
    const bodyLines = renderNodesToMarkdown(single.nodes, styleDefs);

    const markdownParts: string[] = [];
    if (frontmatterLines.length > 0) {
      markdownParts.push(frontmatterLines.join("\n"));
    }
    markdownParts.push(bodyLines.join("\n\n"));

    return {
      audit,
      markdown: `${markdownParts.join("\n\n")}\n`,
    };
  }

  // Multi-tab document
  const tabAudits: ExportAuditSummary[] = [];
  const aggregatedIssues: string[] = [];
  let totalNodeCount = 0;
  let totalStyledCount = 0;
  const mergedStyles: Record<string, QueryTextStyle> = {};

  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i]!;
    const tabAudit = auditDocNodes(t.nodes, {
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

  const styleDefs = new Map<string, { name: string; style: QueryTextStyle }>();
  let styleCounter = 1;
  for (const t of tabs) {
    for (const node of t.nodes) {
      if (!node.isCode && node.style && Object.keys(node.style).length > 0) {
        const key = JSON.stringify(node.style);
        if (!styleDefs.has(key)) {
          const name = `style${styleCounter++}`;
          styleDefs.set(key, { name, style: node.style });
        }
      }
    }
  }

  const frontmatterLines = buildFrontmatterLines(styleDefs, aggregatedIssues);

  const tabBodies: string[] = [];
  for (const t of tabs) {
    const bodyLines = renderNodesToMarkdown(t.nodes, styleDefs);

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
      issues: tabAudits[idx]?.issues,
      lossless: tabAudits[idx]?.lossless,
      nodeCount: tabAudits[idx]?.nodeCount,
      tabId: t.tabId ?? "",
      tabTitle: t.tabTitle ?? "",
    })),
  };

  if (opts.includeStyles && totalStyledCount > 0) {
    audit.styles = mergedStyles;
  }

  const markdownParts: string[] = [];
  if (frontmatterLines.length > 0) {
    markdownParts.push(frontmatterLines.join("\n"));
  }
  markdownParts.push(tabBodies.join("\n\n---\n\n"));

  return {
    audit,
    markdown: `${markdownParts.join("\n\n")}\n`,
  };
}

/** Exports a tab's DocNodes into Markdown with YAML frontmatter for custom styles. */
export function exportTabToMarkdown(
  nodes: DocNode[],
  opts: {
    documentId?: string;
    includeStyles?: boolean;
    tabId?: string;
    tabTitle?: string;
  } = {},
): ExportMarkdownResult {
  return exportDocumentToMarkdown([{ nodes, tabId: opts.tabId, tabTitle: opts.tabTitle }], opts);
}
