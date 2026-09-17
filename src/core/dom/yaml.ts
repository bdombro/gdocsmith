/* YAML DOM tree serialization and deserialization for lossless exports and structural imports. */

import YAML from "yaml";
import {
  asBulletPreset,
  type BulletPreset,
  createCodeBlock,
  createElement,
  type ElementSpec,
  type ParagraphSpec,
} from "./element.ts";
import { auditDocNodes, type ExportAuditSummary, type ExportTabInput } from "./export.ts";
import type { StylePatch } from "./style.ts";
import {
  asAlignment,
  asNamedStyle,
  type CellContentAlignment,
  type DocNode,
  type NamedStyle,
  type ParagraphAlignment,
} from "./types.ts";

/**
 * Result structure of exporting to YAML including audit and string payload.
 */
export type ExportYamlResult = {
  /** Conversion audit summary. */
  audit: ExportAuditSummary;
  /** Parsed YAML tree payload. */
  data: YamlTreePayload;
  /** Rendered YAML text. */
  yaml: string;
};

/**
 * Serialized YAML code block node specification.
 */
export type YamlCodeBlockSpec = {
  /** Paragraph alignment. */
  alignment?: ParagraphAlignment;
  /** Structural kind discriminator. */
  kind: "codeBlock";
  /** Optional language syntax identifier. */
  language?: string;
  /** Style patch. */
  style?: StylePatch;
  /** Raw text content. */
  text: string;
};

/**
 * Union of serialized YAML node representations.
 */
export type YamlNodeSpec = YamlParagraphSpec | YamlTableSpec | YamlCodeBlockSpec | YamlPageBreakSpec;

/**
 * Serialized YAML page break specification.
 */
export type YamlPageBreakSpec = {
  /** Structural kind discriminator. */
  kind: "pageBreak";
};

/**
 * Serialized YAML paragraph specification.
 */
export type YamlParagraphSpec = {
  /** Text alignment. */
  alignment?: ParagraphAlignment;
  /** Bullet configuration. */
  bullet?: {
    /** Indentation level. */
    nestingLevel?: number;
    /** Bullet glyph preset. */
    preset?: BulletPreset;
  };
  /** Start indentation in points. */
  indentStart?: number;
  /** Structural kind discriminator. */
  kind: "paragraph";
  /** Named style classification. */
  namedStyleType: NamedStyle;
  /** Custom style overrides. */
  style?: StylePatch;
  /** Text content. */
  text: string;
};

/**
 * Serialized YAML table specification.
 */
export type YamlTableSpec = {
  /** Border color hex string. */
  borderColor?: string;
  /** Cell padding in points. */
  cellPadding?: number;
  /** Column width in points. */
  columnWidth?: number;
  /** Vertical content alignment. */
  contentAlignment?: CellContentAlignment;
  /** Structural kind discriminator. */
  kind: "table";
  /** 2D grid of cell string contents. */
  rows: string[][];
};

/**
 * Serialized YAML representation of a single document tab.
 */
export type YamlTabTreePayload = {
  /** Tab conversion audit report. */
  audit?: ExportAuditSummary;
  /** Array of serialized nodes. */
  nodes: YamlNodeSpec[];
  /** Tab ID. */
  tabId?: string;
  /** Tab title. */
  tabTitle?: string;
};

/**
 * Root YAML payload structure for documents.
 */
export type YamlTreePayload = {
  /** Overall document conversion audit report. */
  audit?: ExportAuditSummary;
  /** Target document ID. */
  documentId?: string;
  /** Array of serialized nodes. */
  nodes: YamlNodeSpec[];
  /** Revision string. */
  revision?: string;
  /** Revision ID. */
  revisionId?: string;
  /** Count of tabs. */
  tabCount?: number;
  /** Tab identifier. */
  tabId?: string;
  /** Array of individual tab tree payloads. */
  tabs?: YamlTabTreePayload[];
  /** Tab title. */
  tabTitle?: string;
};

/**
 * Exports one or more document tabs into a lossless YAML DOM tree.
 */
export function documentExportToYaml(
  /** Array of tab inputs. */
  tabs: ExportTabInput[],
  /** Configuration options. */
  opts: {
    documentId?: string;
    includeStyles?: boolean;
    revision?: string;
    revisionId?: string;
  } = {},
): ExportYamlResult {
  if (tabs.length === 0) {
    const emptyAudit: ExportAuditSummary = {
      documentId: opts.documentId,
      issues: [],
      lossless: true,
      nodeCount: 0,
      styledNodesCount: 0,
    };
    const payload: YamlTreePayload = {
      audit: emptyAudit,
      documentId: opts.documentId,
      nodes: [],
    };
    return {
      audit: emptyAudit,
      data: payload,
      yaml: `${YAML.stringify(payload, { lineWidth: 0 }).trimEnd()}\n`,
    };
  }

  if (tabs.length === 1) {
    const single = tabs[0]!;
    return tabExportToYaml(single.nodes, {
      documentId: opts.documentId,
      includeStyles: opts.includeStyles,
      revision: opts.revision,
      revisionId: opts.revisionId,
      tabId: single.tabId,
      tabTitle: single.tabTitle,
    });
  }

  const tabAudits: ExportAuditSummary[] = [];
  const aggregatedIssues: string[] = [];
  let totalNodeCount = 0;
  let totalStyledCount = 0;

  const yamlTabs: YamlTabTreePayload[] = [];

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

    const label = t.tabTitle || t.tabId || `Tab ${i + 1}`;
    for (const issue of tabAudit.issues) {
      aggregatedIssues.push(`[${label}] ${issue}`);
    }

    const serializableNodes: YamlNodeSpec[] = [];
    for (const node of t.nodes) {
      const spec = yamlSpecFromNode(node);
      if (spec) serializableNodes.push(spec);
    }

    yamlTabs.push({
      audit: tabAudit,
      nodes: serializableNodes,
      tabId: t.tabId,
      tabTitle: t.tabTitle,
    });
  }

  const aggregatedAudit: ExportAuditSummary = {
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

  const payload: YamlTreePayload = {
    audit: aggregatedAudit,
    documentId: opts.documentId,
    nodes: yamlTabs.flatMap((t) => t.nodes),
    tabCount: tabs.length,
    tabs: yamlTabs,
  };

  if (opts.revision) payload.revision = opts.revision;
  if (opts.revisionId) payload.revisionId = opts.revisionId;

  const yaml = `${YAML.stringify(payload, { lineWidth: 0 }).trimEnd()}\n`;

  return {
    audit: aggregatedAudit,
    data: payload,
    yaml,
  };
}

/**
 * Alias for documentExportToYaml.
 */
export const exportDocumentToYaml = documentExportToYaml;

/**
 * Exports a tab's DocNodes into a structured, lossless YAML DOM tree.
 */
export function tabExportToYaml(
  /** Array of document nodes on this tab. */
  nodes: DocNode[],
  /** Configuration options. */
  opts: {
    documentId?: string;
    includeStyles?: boolean;
    revision?: string;
    revisionId?: string;
    tabId?: string;
    tabTitle?: string;
  } = {},
): ExportYamlResult {
  const audit = auditDocNodes(nodes, opts);
  const serializableNodes: YamlNodeSpec[] = [];

  for (const node of nodes) {
    const spec = yamlSpecFromNode(node);
    if (spec) {
      serializableNodes.push(spec);
    }
  }

  const payload: YamlTreePayload = {
    nodes: serializableNodes,
  };

  if (opts.documentId) payload.documentId = opts.documentId;
  if (opts.revision) payload.revision = opts.revision;
  if (opts.revisionId) payload.revisionId = opts.revisionId;
  if (opts.tabId) payload.tabId = opts.tabId;
  if (opts.tabTitle) payload.tabTitle = opts.tabTitle;
  payload.audit = audit;

  const yaml = `${YAML.stringify(payload, { lineWidth: 0 }).trimEnd()}\n`;

  return {
    audit,
    data: payload,
    yaml,
  };
}

/**
 * Alias for tabExportToYaml.
 */
export const exportTabToYaml = tabExportToYaml;

/**
 * Converts a parsed DocNode into a YAML-serializable node spec.
 */
export function yamlSpecFromNode(
  /** Document node to convert. */
  node: DocNode,
): YamlNodeSpec | null {
  if (node.kind === "sectionBreak" || node.kind === "tableOfContents") {
    return null;
  }

  if (node.kind === "pageBreak") {
    return { kind: "pageBreak" };
  }

  if (node.kind === "table" && node.table) {
    const rows: string[][] = node.table.cells.map((row) =>
      row.map((cell) => {
        const paras = cell.paragraphs && cell.paragraphs.length > 0 ? cell.paragraphs : [cell];
        let cellText = paras.map((p) => p.markup ?? p.text ?? "").join("\n");
        if (cell.images?.length && !cellText.includes("[Image]")) {
          cellText = cellText.trim() ? `${cellText} [Image]` : "[Image]";
        }
        return cellText;
      }),
    );

    const spec: YamlTableSpec = {
      kind: "table",
      rows,
    };
    if (node.table.columnWidth != null) spec.columnWidth = node.table.columnWidth;
    if (node.table.borderColor) spec.borderColor = node.table.borderColor;
    if (node.table.cellPadding != null) spec.cellPadding = node.table.cellPadding;
    if (node.table.contentAlignment) spec.contentAlignment = node.table.contentAlignment;
    return spec;
  }

  if (node.kind === "paragraph") {
    let text = node.markup ?? node.text ?? "";
    if (node.images?.length && !text.includes("[Image]")) {
      text = text.trim() ? `${text} [Image]` : "[Image]";
    }

    const namedStyleType = node.namedStyleType ?? "NORMAL_TEXT";
    const spec: YamlParagraphSpec = {
      kind: "paragraph",
      namedStyleType,
      text,
    };

    if (node.alignment) spec.alignment = node.alignment;

    if (node.bullet) {
      const preset: BulletPreset =
        node.bullet.type === "CHECKBOX"
          ? "BULLET_CHECKBOX"
          : node.bullet.type === "NUMBERED"
            ? "NUMBERED_DECIMAL_NESTED"
            : "BULLET_DISC_CIRCLE_SQUARE";
      spec.bullet = {
        nestingLevel: node.bullet.nestingLevel ?? 0,
        preset,
      };
    }

    if (node.indentStart?.magnitude != null) {
      spec.indentStart = node.indentStart.magnitude;
    }

    const stylePatch: StylePatch = { ...(node.style ?? {}) };
    if (node.shading) stylePatch.shading = node.shading;
    if (node.spaceAbove != null) stylePatch.spaceAbove = node.spaceAbove;
    if (node.spaceBelow != null) stylePatch.spaceBelow = node.spaceBelow;
    if (node.lineSpacing != null) stylePatch.lineSpacing = node.lineSpacing;
    if (node.indentEnd?.magnitude != null) stylePatch.indentEnd = node.indentEnd.magnitude;
    if (node.indentFirstLine?.magnitude != null) {
      stylePatch.indentFirstLine = node.indentFirstLine.magnitude;
    }
    if (Object.keys(stylePatch).length > 0) {
      spec.style = stylePatch;
    }

    return spec;
  }

  return null;
}

/**
 * Alias for yamlSpecFromNode.
 */
export const nodeToYamlSpec = yamlSpecFromNode;

/**
 * Parses and normalizes a YAML string or object into typed ElementSpecs.
 */
export function yamlTreeParse(
  /** Raw YAML string or pre-parsed object. */
  input: unknown,
): {
  elements: ElementSpec[];
  meta: Record<string, unknown>;
} {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = YAML.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse YAML tree: ${(err as Error).message}`);
    }
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid YAML tree: expected an object with `nodes` or a bare array of node specs");
  }

  const meta: Record<string, unknown> = {};
  let rawNodes: unknown[] = [];

  if (Array.isArray(raw)) {
    rawNodes = raw;
  } else {
    const record = raw as Record<string, unknown>;
    for (const [key, val] of Object.entries(record)) {
      if (key !== "nodes") {
        meta[key] = val;
      }
    }
    if (Array.isArray(record.nodes)) {
      rawNodes = record.nodes;
    } else {
      throw new Error("Invalid YAML tree: missing `nodes` array");
    }
  }

  const elements: ElementSpec[] = [];

  for (let idx = 0; idx < rawNodes.length; idx++) {
    const item = rawNodes[idx];
    if (!item || typeof item !== "object") {
      continue;
    }
    const node = item as Record<string, unknown>;
    const parsed = singleYamlNodeParse(node, idx);
    if (parsed) {
      if (Array.isArray(parsed)) {
        elements.push(...parsed);
      } else {
        elements.push(parsed);
      }
    }
  }

  return { elements, meta };
}

/**
 * Alias for yamlTreeParse.
 */
export const parseYamlTree = yamlTreeParse;

function singleYamlNodeParse(node: Record<string, unknown>, _index: number): ElementSpec | ElementSpec[] | null {
  if (node.kind === "pageBreak" || node.pageBreak === true) {
    return createElement("pageBreak");
  }

  if (node.kind === "table" || Array.isArray(node.rows) || Array.isArray(node.table)) {
    let rawRows = (node.rows ?? node.table) as unknown;
    if (node.table && typeof node.table === "object" && Array.isArray((node.table as Record<string, unknown>).rows)) {
      rawRows = (node.table as Record<string, unknown>).rows;
    }
    if (!Array.isArray(rawRows)) {
      throw new Error(`Node at index ${_index}: table requires a 2D rows array`);
    }

    const rows: string[][] = (rawRows as unknown[]).map((r) => {
      if (!Array.isArray(r)) return [String(r ?? "")];
      return r.map((c) => (c == null ? "" : String(c)));
    });
    return createElement("table", { rows });
  }

  if (node.kind === "codeBlock" || typeof node.codeBlock === "string" || typeof node.code === "string") {
    const text = typeof node.codeBlock === "string" ? node.codeBlock : String(node.text ?? node.code ?? "");
    const language = typeof node.language === "string" ? node.language : undefined;
    const alignment = asAlignment(node.alignment as string | undefined);
    const style = node.style && typeof node.style === "object" ? (node.style as StylePatch) : undefined;
    return createCodeBlock({ alignment, language, style, text });
  }

  let namedStyleType: NamedStyle = "NORMAL_TEXT";
  let text = "";

  if (typeof node.title === "string") {
    namedStyleType = "TITLE";
    text = node.title;
  } else if (typeof node.subtitle === "string") {
    namedStyleType = "SUBTITLE";
    text = node.subtitle;
  } else if (node.heading != null) {
    const lvl = Number(node.heading);
    if (lvl === 0) {
      namedStyleType = "TITLE";
    } else if (lvl >= 1 && lvl <= 6) {
      namedStyleType = `HEADING_${lvl}` as NamedStyle;
    }
    text = String(node.text ?? "");
  } else if (typeof node.h1 === "string") {
    namedStyleType = "HEADING_1";
    text = node.h1;
  } else if (typeof node.h2 === "string") {
    namedStyleType = "HEADING_2";
    text = node.h2;
  } else if (typeof node.h3 === "string") {
    namedStyleType = "HEADING_3";
    text = node.h3;
  } else if (typeof node.h4 === "string") {
    namedStyleType = "HEADING_4";
    text = node.h4;
  } else if (typeof node.h5 === "string") {
    namedStyleType = "HEADING_5";
    text = node.h5;
  } else if (typeof node.h6 === "string") {
    namedStyleType = "HEADING_6";
    text = node.h6;
  } else if (typeof node.paragraph === "string") {
    namedStyleType = "NORMAL_TEXT";
    text = node.paragraph;
  } else {
    if (typeof node.namedStyleType === "string") {
      namedStyleType = asNamedStyle(node.namedStyleType) ?? "NORMAL_TEXT";
    }
    text = String(node.text ?? "");
  }

  const alignment = asAlignment(node.alignment as string | undefined);
  const style = node.style && typeof node.style === "object" ? (node.style as StylePatch) : undefined;
  const indentStart = typeof node.indentStart === "number" ? node.indentStart : undefined;

  let bullet: ParagraphSpec["bullet"] | undefined;
  if (node.bullet != null) {
    if (typeof node.bullet === "string") {
      bullet = {
        nestingLevel: typeof node.nestingLevel === "number" ? node.nestingLevel : 0,
        preset: "BULLET_DISC_CIRCLE_SQUARE",
      };
      text = node.bullet;
    } else if (typeof node.bullet === "object") {
      const bObj = node.bullet as Record<string, unknown>;
      const presetStr = typeof bObj.preset === "string" ? bObj.preset : "BULLET_DISC_CIRCLE_SQUARE";
      const preset = asBulletPreset(presetStr) ?? "BULLET_DISC_CIRCLE_SQUARE";
      const nestingLevel = typeof bObj.nestingLevel === "number" ? bObj.nestingLevel : 0;
      bullet = { nestingLevel, preset };
      if (typeof bObj.text === "string" && !text) {
        text = bObj.text;
      }
    } else if (node.bullet === true) {
      bullet = {
        nestingLevel: typeof node.nestingLevel === "number" ? node.nestingLevel : 0,
        preset: "BULLET_DISC_CIRCLE_SQUARE",
      };
    }
  }

  return createElement("paragraph", {
    alignment,
    bullet,
    indentStart,
    namedStyleType,
    style,
    text,
  });
}
