/* High-level markdown DOM insertion workflows. */

import { docCache } from "./cache/docCache.ts";
import {
  applyDom,
  applyOps,
  type DomOp,
  DomWriter,
  type ElementSpec,
  findNodeAt,
  type InsertPosition,
  missingNodeIdMsg,
  parseDocument,
} from "./dom/index.ts";
import {
  chunkMarkdownElements,
  customStyleNormalize,
  listIndentationNormalize,
  type MarkdownChunk,
  type MarkdownParseOptions,
  markdownElementsChunk,
  markdownStylesParse,
  markdownToElementsParse,
  normalizeCustomStyle,
  normalizeListIndentation,
  parseMarkdownToElements,
} from "./dom/markdownParser.ts";
import { Gdoc } from "./gdoc.ts";
import { type GwsClient, gws } from "./gws.ts";
import { type CustomTextStyle, InlineMarkup } from "./inline.ts";
import { DriveRevisions } from "./revisions.ts";
import { resolveTab } from "./tabs.ts";
import type { GoogleDoc } from "./types.ts";

export {
  chunkMarkdownElements,
  customStyleNormalize,
  listIndentationNormalize,
  type MarkdownChunk,
  type MarkdownParseOptions,
  markdownElementsChunk,
  markdownStylesParse,
  markdownToElementsParse,
  normalizeCustomStyle,
  normalizeListIndentation,
  parseMarkdownToElements,
};

/** Parameters for executing a generic ElementSpec array insertion. */
export type ExecuteElementsInsertParams = {
  anchorId?: number | string;
  client?: GwsClient;
  customStyles?: Record<string, CustomTextStyle>;
  documentId: string;
  elements: ElementSpec[];
  force?: boolean;
  position?: InsertPosition;
  tabHint?: string;
};

/** Parameters for executing a markdown insertion. */
export type ExecuteMarkdownInsertParams = {
  anchorId?: number | string;
  client?: GwsClient;
  customStyles?: Record<string, CustomTextStyle>;
  doc?: GoogleDoc;
  documentId: string;
  force?: boolean;
  h1IsTitle?: boolean;
  linkResolver?: (href: string) => string;
  markdown: string;
  position?: InsertPosition;
  tabHint?: string;
};

/** Result of executing a markdown insertion. */
export type MarkdownInsertResult = {
  appliedChunks: number;
  elementsInserted: number;
  insertedRange?: {
    count: number;
    endId: number;
    startId: number;
  };
  message: string;
  tabId?: string;
};

/** Executes insertion of generic ElementSpec array across one or more chunks. */
export async function elementsInsertExecute(params: ExecuteElementsInsertParams): Promise<MarkdownInsertResult> {
  const client = params.client ?? gws;
  const elements = params.elements;
  const effectiveStyles = params.customStyles ?? {};

  if (!elements.length) {
    return {
      appliedChunks: 0,
      elementsInserted: 0,
      message: "No elements found to insert.",
    };
  }

  const chunks = chunkMarkdownElements(elements);

  let freshDoc = await Gdoc.load(params.documentId, client, { forceFetch: true });
  const tabResolution = freshDoc.data.tabs?.length ? resolveTab(freshDoc.data, params.tabHint) : {};
  const tabId = tabResolution.tabId;
  let gdoc = tabId ? freshDoc.withTab(tabId) : freshDoc;
  let parsedDoc = parseDocument(gdoc);

  let currentAnchorId: number;
  let replaceAnchor = false;

  if (params.anchorId != null) {
    const hit = findNodeAt(parsedDoc.nodes, params.anchorId);
    if (!hit) {
      throw new Error(missingNodeIdMsg(params.anchorId, parsedDoc.nodes.length));
    }
    currentAnchorId = hit.tapeIndex;
  } else {
    const contentNodes = parsedDoc.nodes.filter((n) => n.kind !== "sectionBreak");
    if (contentNodes.length === 1 && contentNodes[0]?.kind === "paragraph" && !contentNodes[0]?.text) {
      currentAnchorId = contentNodes[0]?.tapeIndex;
      replaceAnchor = true;
    } else {
      const target = contentNodes[contentNodes.length - 1] ?? parsedDoc.nodes[parsedDoc.nodes.length - 1];
      if (!target) {
        throw new Error("Document has no nodes to insert content into.");
      }
      currentAnchorId = target.tapeIndex;
    }
  }

  const effectivePosition: InsertPosition = params.position ?? "afterend";
  const originalAnchorId = currentAnchorId;
  const originalReplaceAnchor = replaceAnchor;

  return await InlineMarkup.withStyles(effectiveStyles, async () => {
    await DriveRevisions.pinHead(params.documentId, params.client ?? gws);

    let chunksApplied = 0;
    let chunkPosition: InsertPosition = effectivePosition;

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const chunk = chunks[cIdx]!;

      const writer = new DomWriter(parsedDoc.nodes, {
        force: params.force,
        lists: gdoc.data.lists,
        tabId,
      });

      const isReplacing = cIdx === 0 && replaceAnchor;
      const ops = buildChunkOps(currentAnchorId, chunkPosition, chunk, isReplacing);

      const anchorIdx = parsedDoc.nodes.findIndex((n) => n.tapeIndex === currentAnchorId);
      const effectiveAnchorIdx = anchorIdx >= 0 ? anchorIdx : parsedDoc.nodes.length - 1;
      const tailCount =
        isReplacing || chunkPosition === "afterend"
          ? parsedDoc.nodes.length - (effectiveAnchorIdx + 1)
          : parsedDoc.nodes.length - effectiveAnchorIdx;

      const plan = applyOps(writer, ops);
      await applyDom(params.documentId, writer, {
        client,
        doc: gdoc.data,
        force: params.force,
        plan,
      });

      chunksApplied++;

      if (cIdx < chunks.length - 1) {
        freshDoc = await Gdoc.load(params.documentId, client, { forceFetch: true });
        gdoc = tabId ? freshDoc.withTab(tabId) : freshDoc;
        parsedDoc = parseDocument(gdoc);

        const newAnchorIdx = Math.max(0, parsedDoc.nodes.length - tailCount - 1);
        const lastInsertedNode = parsedDoc.nodes[newAnchorIdx];
        currentAnchorId = lastInsertedNode
          ? lastInsertedNode.tapeIndex
          : (parsedDoc.nodes[parsedDoc.nodes.length - 1]?.tapeIndex ?? 0);
        chunkPosition = "afterend";
      }
    }

    const startId =
      originalReplaceAnchor || effectivePosition === "beforebegin" ? originalAnchorId : originalAnchorId + 1;
    const endId = startId + elements.length - 1;

    docCache.invalidate(params.documentId);

    return {
      appliedChunks: chunksApplied,
      elementsInserted: elements.length,
      insertedRange: {
        count: elements.length,
        endId,
        startId,
      },
      message: `Inserted ${elements.length} element(s) into document (${chunksApplied} batch(es)).`,
      tabId,
    };
  });
}

/** Executes insertion of generic ElementSpec array (alias for elementsInsertExecute). */
export const executeElementsInsert = elementsInsertExecute;

/** Executes markdown insertion across one or more chunks. */
export async function markdownInsertExecute(params: ExecuteMarkdownInsertParams): Promise<MarkdownInsertResult> {
  const elements = parseMarkdownToElements(params.markdown, {
    customStyles: params.customStyles,
    h1IsTitle: params.h1IsTitle,
    linkResolver: params.linkResolver,
  });

  return executeElementsInsert({
    anchorId: params.anchorId,
    client: params.client,
    customStyles: params.customStyles,
    documentId: params.documentId,
    elements,
    force: params.force,
    position: params.position,
    tabHint: params.tabHint,
  });
}

/** Executes markdown insertion across one or more chunks (alias for markdownInsertExecute). */
export const executeMarkdownInsert = markdownInsertExecute;

/** Builds DomOp array for a single markdown chunk. */
export function chunkOpsBuild(
  anchorId: number,
  position: InsertPosition,
  chunk: MarkdownChunk,
  replaceAnchor: boolean,
): DomOp[] {
  const ops: DomOp[] = [];

  if (chunk.kind === "table") {
    ops.push({
      at: anchorId,
      insertAdjacentElement: {
        element: chunk.spec as unknown as Record<string, unknown>,
        position: replaceAnchor ? "afterend" : position,
      },
    });
    if (replaceAnchor) {
      ops.push({
        at: anchorId,
        remove: true,
      });
    }
    return ops;
  }

  const specs = chunk.specs;
  if (!specs.length) return ops;

  const first = specs[0];
  if (
    replaceAnchor &&
    first &&
    first.kind === "paragraph" &&
    (!first.bullet || (first.bullet.nestingLevel ?? 0) === 0)
  ) {
    const op: DomOp = {
      at: anchorId,
      innerText: first.text,
    };
    if (first.namedStyleType && first.namedStyleType !== "NORMAL_TEXT") {
      op.namedStyleType = first.namedStyleType;
    }
    if (first.style) {
      op.style = first.style;
    }
    if (first.bullet) {
      op.bullet = first.bullet;
    }
    if (first.runs?.length) {
      op.runs = first.runs;
    }
    ops.push(op);

    const remaining = specs.slice(1);
    if (remaining.length > 0) {
      ops.push({
        at: anchorId,
        insertAdjacentElement: {
          elements: remaining as unknown as Record<string, unknown>[],
          position: "afterend",
        },
      });
    }
  } else if (replaceAnchor) {
    ops.push({
      at: anchorId,
      insertAdjacentElement: {
        elements: specs as unknown as Record<string, unknown>[],
        position: "afterend",
      },
    });
    ops.push({
      at: anchorId,
      remove: true,
    });
  } else {
    ops.push({
      at: anchorId,
      insertAdjacentElement: {
        elements: specs as unknown as Record<string, unknown>[],
        position,
      },
    });
  }

  return ops;
}

/** Builds DomOp array for a single markdown chunk (alias for chunkOpsBuild). */
export const buildChunkOps = chunkOpsBuild;
