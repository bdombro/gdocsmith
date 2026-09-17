/* Clone / copy node utility for insertAdjacentElement. */

import { Gdoc } from "~/core/gdoc.ts";
import { resolveApplyTab } from "~/core/tabs.ts";
import type { ElementSpec, ParagraphSpec, TableSpec } from "./element.ts";
import type { DomOp } from "./ops.ts";
import { parseDocument } from "./parse.ts";
import { findNodeAt, missingNodeIdMsg } from "./query.ts";
import type { StylePatch } from "./style.ts";
import type { DocNode, TableCell } from "./types.ts";

/**
 * Reference pointing to an existing node to clone.
 */
export type CloneNodeRef = {
  /** Optional document ID to clone from. */
  fromDoc?: string;
  /** Alias for nodeId. */
  fromNode?: number | string;
  /** Optional tab ID to clone from. */
  fromTab?: string;
  /** Replacement text content. */
  innerText?: string;
  /** Scoped ID or tape index of the node to clone. */
  nodeId?: number | string;
};

/**
 * Context required to resolve cross-document or cross-tab node clones.
 */
export type CloneResolutionContext = {
  /** Pre-loaded default document instance. */
  defaultDoc?: Gdoc;
  /** Default document ID. */
  defaultDocumentId: string;
  /** Default tab ID. */
  defaultTabId?: string;
};

/**
 * Normalizes cloneNode/cloneNodes specs on ops and resolves cross-document and cross-tab references.
 * Mutates ops so that op.insertAdjacentElement.elements contains the resolved ElementSpecs.
 */
export async function cloneNodeOpsResolve(
  /** Array of DOM operations to resolve. */
  ops: DomOp[],
  /** Resolution context containing active document and tab. */
  context: CloneResolutionContext,
): Promise<void> {
  const docCache = new Map<string, Gdoc>();
  if (context.defaultDoc) {
    docCache.set(context.defaultDocumentId, context.defaultDoc);
  }

  async function getDoc(docId: string): Promise<Gdoc> {
    if (!docCache.has(docId)) {
      const loaded = await Gdoc.load(docId);
      docCache.set(docId, loaded);
    }
    return docCache.get(docId)!;
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (!op.insertAdjacentElement) continue;

    const adj = op.insertAdjacentElement;
    const refs: CloneNodeRef[] = [];

    if (adj.cloneNode != null) {
      if (typeof adj.cloneNode === "object") {
        refs.push(adj.cloneNode as CloneNodeRef);
      } else {
        refs.push({ nodeId: adj.cloneNode });
      }
    }

    if (Array.isArray(adj.cloneNodes)) {
      for (const item of adj.cloneNodes) {
        if (typeof item === "object") {
          refs.push(item as CloneNodeRef);
        } else {
          refs.push({ nodeId: item });
        }
      }
    }

    if (!refs.length) continue;

    const resolvedSpecs: Array<Record<string, unknown>> = [];

    for (const ref of refs) {
      const docId = ref.fromDoc ?? context.defaultDocumentId;
      const rawGdoc = await getDoc(docId);
      const tabRef = ref.fromTab ?? (docId === context.defaultDocumentId ? context.defaultTabId : undefined);
      const liveTab = resolveApplyTab(rawGdoc.data, tabRef);
      const targetGdoc = liveTab.tabId ? rawGdoc.withTab(liveTab.tabId) : rawGdoc;
      const parsed = parseDocument(targetGdoc);

      const targetId = ref.nodeId ?? ref.fromNode;
      if (targetId == null) {
        throw new Error(`ops[${i}] cloneNode requires a heading-scoped id, got ${JSON.stringify(ref)}`);
      }

      const node = findNodeAt(parsed.nodes, targetId);
      if (!node) {
        throw new Error(
          `ops[${i}] cloneNode: ${missingNodeIdMsg(targetId, parsed.nodes.length)} (doc "${docId}" tab "${liveTab.tabId ?? "default"}")`,
        );
      }

      const spec = elementSpecFromNode(node, { innerText: ref.innerText });
      resolvedSpecs.push(spec as unknown as Record<string, unknown>);
    }

    const existingElements = Array.isArray(adj.elements) ? adj.elements : adj.element ? [adj.element] : [];

    adj.elements = [...existingElements, ...resolvedSpecs];
    delete adj.element;
    delete adj.cloneNode;
    delete adj.cloneNodes;
  }
}

/**
 * Alias for cloneNodeOpsResolve.
 */
export const resolveCloneNodeOps = cloneNodeOpsResolve;

/**
 * Converts a parsed DocNode into an insertable ElementSpec preserving styles and structure.
 */
export function elementSpecFromNode(
  /** Parsed source node. */
  node: DocNode,
  /** Optional override options such as replacement innerText. */
  options?: { innerText?: string },
): ElementSpec {
  if (node.kind === "paragraph") {
    const warnings: string[] = [];
    let text = options?.innerText ?? node.markup ?? node.text ?? "";
    if (node.images?.length) {
      if (!text.includes("[Image]")) {
        text = text.trim() ? `${text} [Image]` : "[Image]";
      }
      warnings.push(
        `Node ${node.tapeIndex}: ${node.images.length} image(s) replaced with [Image] placeholder because Google Docs API does not support inserting internal image URLs.`,
      );
    }
    if (node.chips?.length) {
      warnings.push(
        `Node ${node.tapeIndex}: ${node.chips.length} smart chip(s) flattened to text/link because Google Docs API cannot create native smart chips.`,
      );
    }
    if (node.footnoteIds?.length) {
      warnings.push(
        `Node ${node.tapeIndex}: ${node.footnoteIds.length} footnote(s) omitted because Google Docs API cannot clone footnote bodies atomically.`,
      );
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

    const spec: ParagraphSpec = {
      kind: "paragraph",
      namedStyleType: node.namedStyleType ?? "NORMAL_TEXT",
      text,
    };

    if (node.alignment) spec.alignment = node.alignment;
    if (Object.keys(stylePatch).length > 0) spec.style = stylePatch;
    if (node.indentStart?.magnitude != null) {
      spec.indentStart = {
        magnitude: node.indentStart.magnitude,
        unit: "PT",
      };
    }
    if (node.bullet) {
      const preset =
        node.bullet.type === "CHECKBOX"
          ? "BULLET_CHECKBOX"
          : node.bullet.type === "NUMBERED"
            ? "NUMBERED_DECIMAL_NESTED"
            : "BULLET_DISC_CIRCLE_SQUARE";
      spec.bullet = {
        nestingLevel: node.bullet.nestingLevel,
        preset,
      };
    }
    if (warnings.length > 0) spec.warnings = warnings;

    return spec;
  }

  if (node.kind === "table" && node.table) {
    const warnings: string[] = [];
    let imageCount = 0;
    let chipCount = 0;
    for (const row of node.table.cells) {
      for (const cell of row) {
        if (cell.images?.length) imageCount += cell.images.length;
        if (cell.chips?.length) chipCount += cell.chips.length;
      }
    }
    if (imageCount > 0) {
      warnings.push(`Node ${node.tapeIndex} table: ${imageCount} image(s) replaced with [Image] placeholder.`);
    }
    if (chipCount > 0) {
      warnings.push(`Node ${node.tapeIndex} table: ${chipCount} smart chip(s) flattened.`);
    }

    const rows: string[][] = node.table.cells.map((row: TableCell[]) =>
      row.map((cell) => {
        const paras = cell.paragraphs && cell.paragraphs.length > 0 ? cell.paragraphs : [cell];
        return paras.map((p) => p.markup ?? p.text ?? "").join("\n");
      }),
    );
    const spec: TableSpec = {
      kind: "table",
      table: { rows },
    };
    if (warnings.length > 0) spec.warnings = warnings;
    return spec;
  }

  if (node.kind === "pageBreak") {
    return { kind: "pageBreak" };
  }

  if (node.kind === "tableOfContents") {
    throw new Error(
      `Cannot clone node ${node.tapeIndex} of kind "tableOfContents": Google Docs REST API does not support inserting or duplicating Table of Contents. Create it via Insert > Table of contents in Google Docs UI.`,
    );
  }

  if (node.kind === "sectionBreak") {
    throw new Error(
      `Cannot clone node ${node.tapeIndex} of kind "sectionBreak": Section breaks cannot be cloned detachedly via insertAdjacentElement because they govern page setups, margins, and header/footer bindings.`,
    );
  }

  throw new Error(`Cannot clone node ${node.tapeIndex} of unsupported kind "${node.kind}"`);
}

/**
 * Alias for elementSpecFromNode.
 */
export const nodeToElementSpec = elementSpecFromNode;

/**
 * Resolves a CloneNodeRef from a local list of DocNodes.
 */
export function intraDocCloneNodeResolve(
  /** Node reference to resolve. */
  ref: number | string | CloneNodeRef,
  /** Array of candidate document nodes. */
  nodes: DocNode[],
): ElementSpec {
  const idRaw = typeof ref === "object" ? (ref.nodeId ?? ref.fromNode) : ref;
  if (idRaw == null) {
    throw new Error(`cloneNode requires a heading-scoped id, got: ${JSON.stringify(ref)}`);
  }
  const found = findNodeAt(nodes, idRaw);
  if (!found) {
    throw new Error(`cloneNode: ${missingNodeIdMsg(idRaw, nodes.length)}`);
  }
  const innerText = typeof ref === "object" ? ref.innerText : undefined;
  return elementSpecFromNode(found, { innerText });
}

/**
 * Alias for intraDocCloneNodeResolve.
 */
export const resolveIntraDocCloneNode = intraDocCloneNodeResolve;
