/* Loads documents (through the snapshot cache when there is one) and their comments, and maps comment quotes back to document ranges (G3 D37, M17). */

import type { DocCache } from "~/core/cache/docCache.ts";
import type { DocsClient, DriveApi, DriveComment } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { docModelParse } from "../model/fromJson.ts";
import type { KeyAllocator } from "../model/keys.ts";
import type { Block, DocModel, ParagraphBlock, Range } from "../model/types.ts";

/** A loaded document: its JSON and its model. */
export interface LoadedDoc {
  /** `documents.get` JSON (a private copy). */ json: GoogleDoc;
  /** Parsed model. */ model: DocModel;
}

/** One comment and every place its quote occurs. */
export interface CommentAnchor {
  /** Comment id. */ commentId: string;
  /** True when the quote occurs more than once (each occurrence is treated as anchored). */ ambiguous: boolean;
  /** Where the quote occurs, in original document indices. */ occurrences: Array<{ range: Range; tabId: string }>;
  /** The quoted text. */ quote: string;
}

/** Loads a document through the cache (or straight from the API) and parses it. */
export async function docLoad(
  /** Document id. */
  docId: string,
  /** Client, optional cache, and key allocator. */
  opts: { cache?: DocCache; client: DocsClient; forceFetch?: boolean; keys: KeyAllocator },
): Promise<LoadedDoc> {
  const json = opts.cache
    ? (await opts.cache.get(docId, opts.client, { forceFetch: opts.forceFetch })).data
    : structuredClone(await opts.client.getDocument(docId));
  return { json, model: docModelParse(json, { docId, keys: opts.keys }) };
}

/** A document's live comments: unresolved, not deleted, with a non-empty quote (HTML entities decoded). */
export async function commentsLoad(
  /** Document id. */
  docId: string,
  /** Drive client. */
  drive: DriveApi,
): Promise<DriveComment[]> {
  const comments = await drive.commentsList(docId);
  return comments
    .filter((c) => !c.resolved && !c.deleted && c.quotedFileContent?.value)
    .map((c) => ({ ...c, quotedFileContent: { value: entitiesDecode(c.quotedFileContent?.value ?? "") } }));
}

/**
 * Finds every occurrence of each comment's quote in each tab's text (paragraphs joined by `\n`,
 * table cells in order, atoms as U+FFFC) and maps it back to original indices. A quote found more
 * than once keeps every occurrence (the guard treats all of them as anchored, D37).
 */
export function commentAnchorsMatch(
  /** The document as loaded. */
  model: DocModel,
  /** Its comments. */
  comments: readonly DriveComment[],
): CommentAnchor[] {
  const tabs = model.tabs.map((tab) => ({ tabId: tab.tabId, ...tabText(tab.blocks) }));
  return comments.flatMap((comment) => {
    const quote = comment.quotedFileContent?.value ?? "";
    if (!quote) return [];
    const occurrences: CommentAnchor["occurrences"] = [];
    for (const tab of tabs) {
      for (let at = tab.text.indexOf(quote); at >= 0; at = tab.text.indexOf(quote, at + 1)) {
        const start = tab.index[at];
        const end = tab.index[at + quote.length - 1] + 1;
        occurrences.push({ range: { end, start }, tabId: tab.tabId });
      }
    }
    return [{ ambiguous: occurrences.length > 1, commentId: comment.id, occurrences, quote }];
  });
}

/** A tab's plain text and, per text offset, the document index of that character. */
function tabText(blocks: readonly Block[]): { index: number[]; text: string } {
  let text = "";
  const index: number[] = [];
  let lastNewline: number | undefined;
  const paragraph = (p: ParagraphBlock) => {
    if (!p.origin) return;
    if (lastNewline !== undefined) {
      text += "\n";
      index.push(lastNewline);
    }
    lastNewline = p.origin.end - 1;
    let pos = p.origin.start;
    for (const inline of p.inlines) {
      if (inline.kind === "atom") {
        text += "￼";
        index.push(pos);
        pos += inline.length;
        continue;
      }
      for (let i = 0; i < inline.text.length; i++) {
        text += inline.text[i];
        index.push(pos + i);
      }
      pos += inline.text.length;
    }
  };
  for (const block of blocks) {
    if (block.kind === "paragraph") paragraph(block);
    else if (block.kind === "table")
      for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(paragraph);
  }
  return { index, text };
}

/** Decodes the HTML entities Drive uses in quotes. */
function entitiesDecode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
