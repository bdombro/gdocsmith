/* Sends a plan's phases to Google: revision-locked content chunks, tab operations, deferred heading links, permissions, and lifecycle; then verifies what landed (G3 D23, D38, M19). */

import type { DocsClient } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { type CompareResult, docModelsCompare } from "../model/equivalence.ts";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { layoutCompute } from "../model/layout.ts";
import type { JsonObject } from "../model/rawJson.ts";
import type { DocModel, ParagraphBlock, TabModel } from "../model/types.ts";
import type { PlannedDoc } from "./plan.ts";

/** Most requests per `batchUpdate` (larger plans are chained, D23). */
export const MAX_REQUESTS_PER_BATCH = 2000;

/** The flush phases, in order (D38). */
export type PhaseName = "content" | "create" | "links" | "permissions" | "tabs";

/** What one phase did per document. */
export interface PhaseReport {
  /** Per document. */ docs: Array<{
    docId: string;
    error?: string;
    landed: boolean;
    requestCount: number;
    requests?: object[];
    revisionAfter?: string;
  }>;
  /** Phase. */ phase: PhaseName;
}

/** A failure after something may have landed. */
export class TransactionError extends Error {
  /** The underlying failure. */ override cause: Error;
  /** What landed before it. */ partial: { created: string[]; landed: string[] };
  /** The phase that failed. */ phase: PhaseName;
  /** The step whose request failed, when known. */ stepIndex?: number;

  constructor(
    /** Phase. */
    phase: PhaseName,
    /** Underlying failure. */
    cause: Error,
    /** What landed. */
    partial: { created: string[]; landed: string[] },
    /** Failing step. */
    stepIndex?: number,
  ) {
    super(`send failed in phase "${phase}": ${cause.message}`);
    this.name = "TransactionError";
    this.cause = cause;
    this.partial = partial;
    this.phase = phase;
    this.stepIndex = stepIndex;
  }
}

/** A revision conflict on the first chunk of a document's content: nothing of it landed. */
export class RevisionConflict extends Error {
  /** The document. */ docId: string;

  constructor(
    /** The document. */
    docId: string,
  ) {
    super(`document ${docId} changed since it was loaded`);
    this.docId = docId;
  }
}

/** True when an API error means the required revision is stale (F18). */
export function revisionConflictIs(
  /** The error. */
  err: unknown,
): boolean {
  return /does not match the latest revision|required revision/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * Sends a document's content requests in chunks, each locked to the revision the previous one left
 * (the first to the loaded revision). A conflict on the first chunk throws `RevisionConflict` (nothing
 * landed); any later failure throws with the failing request's step.
 */
export async function contentSend(
  /** Docs client. */
  client: DocsClient,
  /** The document's plan. */
  doc: PlannedDoc,
): Promise<{ requestCount: number; revisionAfter?: string }> {
  const requests = doc.plan.contentRequests;
  let revision = (doc.input.originalJson as unknown as { revisionId?: string }).revisionId;
  for (let offset = 0; offset < requests.length; offset += MAX_REQUESTS_PER_BATCH) {
    const chunk = requests.slice(offset, offset + MAX_REQUESTS_PER_BATCH);
    try {
      const response = JSON.parse(
        await client.batchUpdate(doc.docId, chunk, revision ? { requiredRevisionId: revision } : {}),
      );
      revision = response.writeControl?.requiredRevisionId ?? revision;
    } catch (err) {
      if (offset === 0 && revisionConflictIs(err)) throw new RevisionConflict(doc.docId);
      const index = requestIndexOf(err);
      const stepIndex = index === undefined ? undefined : doc.plan.origins[offset + index]?.stepIndex;
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
        landedChunks: offset / MAX_REQUESTS_PER_BATCH,
        stepIndex,
      });
    }
  }
  return { requestCount: requests.length, revisionAfter: revision };
}

/** Sends one batch (tab operations or links), locked to `revision`; returns the new revision. */
export async function batchSend(
  /** Docs client. */
  client: DocsClient,
  /** Document id. */
  docId: string,
  /** Requests. */
  requests: readonly object[],
  /** Required revision. */
  revision: string | undefined,
): Promise<string | undefined> {
  if (!requests.length) return revision;
  const response = JSON.parse(
    await client.batchUpdate(docId, [...requests], revision ? { requiredRevisionId: revision } : {}),
  );
  return response.writeControl?.requiredRevisionId ?? revision;
}

/**
 * Builds the links-phase requests of a document: each pending link's target heading is found at its
 * planned position in the reloaded target document (its text must match), and the linked text at its
 * planned position in the reloaded source (its text must match too).
 */
export function linkRequests(
  /** The document with pending links. */
  doc: PlannedDoc,
  /** Reloaded documents, by id (the source and every link target). */
  reloaded: ReadonlyMap<string, DocModel>,
  /** Final models, by id. */
  finals: ReadonlyMap<string, DocModel>,
  /** Provisional → real tab ids of a document. */
  tabIds: (docId: string) => ReadonlyMap<string, string>,
): { headingIds: Map<string, string>; requests: object[] } {
  const requests: object[] = [];
  const headingIds = new Map<string, string>();
  const source = reloaded.get(doc.docId);
  const sourceFinal = finals.get(doc.docId);
  if (!source || !sourceFinal) throw new CoreError("internal", `no reloaded copy of ${doc.docId}`);
  for (const link of doc.plan.pendingLinks) {
    const targetDocId = link.docId ?? doc.docId;
    const targetFinal = finals.get(targetDocId);
    const targetNow = reloaded.get(targetDocId);
    const finalTabId = link.tabId;
    const realTabId = tabIds(targetDocId).get(finalTabId) ?? finalTabId;
    const finalTab = targetFinal?.tabs.find((t) => t.tabId === finalTabId);
    const nowTab = targetNow?.tabs.find((t) => t.tabId === realTabId);
    if (!finalTab || !nowTab) throw new CoreError("linkTargetNotFound", "a linked heading's tab is gone");
    const range = layoutCompute(finalTab).blockRanges.get(link.headingKey);
    const finalHeading = finalTab.blocks.find((b) => b.key === link.headingKey) as ParagraphBlock | undefined;
    const heading = nowTab.blocks.find(
      (b): b is ParagraphBlock => b.kind === "paragraph" && b.origin?.start === range?.start,
    );
    if (!heading?.headingId || !finalHeading || plain(heading) !== plain(finalHeading)) {
      throw new CoreError(
        "linkTargetNotFound",
        `couldn't find the new heading "${finalHeading ? plain(finalHeading) : link.headingKey}" to link to`,
      );
    }
    headingIds.set(link.headingKey, heading.headingId);
    const sourceTabId = tabOfParagraph(sourceFinal, link.paragraphKey);
    const sourceTab = sourceFinal.tabs.find((t) => t.tabId === sourceTabId) as TabModel;
    const start = (layoutCompute(sourceTab).blockRanges.get(link.paragraphKey)?.start ?? 0) + link.offset;
    const sameDoc = targetDocId === doc.docId;
    const target = sameDoc
      ? { heading: { id: heading.headingId, tabId: realTabId } }
      : { url: `https://docs.google.com/document/d/${targetDocId}/edit?tab=${realTabId}#heading=${heading.headingId}` };
    const style = linkedStyle(sourceTab, link.paragraphKey, link.offset);
    const tabId = tabIds(doc.docId).get(sourceTabId) ?? sourceTabId;
    requests.push({
      updateTextStyle: {
        fields: "foregroundColor,link,underline",
        range: { endIndex: start + link.length, startIndex: start, tabId },
        textStyle: { ...style, link: target },
      },
    });
    // A range covering the paragraph's whole text also restyles its newline (F10): put it back.
    const paragraph = sourceTab.blocks.find((b) => b.key === link.paragraphKey) as ParagraphBlock;
    const textLength = paragraph.inlines.reduce((n, i) => n + (i.kind === "text" ? i.text.length : i.length), 0);
    if (link.offset === 0 && link.length === textLength) {
      const newline = paragraph.newline.style;
      const fix: JsonObject = {};
      if (newline.underline !== undefined) fix.underline = newline.underline;
      if (newline.foregroundColor !== undefined) fix.foregroundColor = newline.foregroundColor;
      requests.push({
        updateTextStyle: {
          fields: "foregroundColor,underline",
          range: { endIndex: start + textLength + 1, startIndex: start + textLength, tabId },
          textStyle: fix,
        },
      });
    }
  }
  return { headingIds, requests };
}

/** Compares what landed with the plan's final model (after links resolved), when nobody else edited in between. */
export function verify(
  /** The document's plan. */
  doc: PlannedDoc,
  /** The reloaded JSON. */
  json: GoogleDoc,
  /** The revision our last write left. */
  lastRevision: string | undefined,
  /** Pending-link heading ids learned in the links phase, and tab ids. */
  resolved: { headingIds: ReadonlyMap<string, string>; tabIds: ReadonlyMap<string, string> },
): { diffs?: string[]; status: "match" | "mismatch" | "skipped" } {
  const revision = (json as unknown as { revisionId?: string }).revisionId;
  if (lastRevision && revision !== lastRevision) return { status: "skipped" };
  const expected = pendingLinksResolved(doc.input.final, resolved);
  const actual = docModelParse(json, { docId: doc.docId, keys: new KeyAllocator() });
  const compare: CompareResult = docModelsCompare(expected, actual, {
    identityTransfers: doc.plan.identityTransfers,
    listsRebuilt: new Set(doc.plan.listRebuilds.map((r) => r.listId)),
    tabIdMap: resolved.tabIds,
  });
  return compare.equal ? { status: "match" } : { diffs: compare.diffs.slice(0, 20), status: "mismatch" };
}

/** The `requests[N]` index an API error names. */
function requestIndexOf(err: unknown): number | undefined {
  const match = /requests\[(\d+)\]/.exec(err instanceof Error ? err.message : String(err));
  return match ? Number(match[1]) : undefined;
}

/** A copy of the final model with pending heading links pointing at the headings they resolved to. */
function pendingLinksResolved(
  doc: DocModel,
  resolved: { headingIds: ReadonlyMap<string, string>; tabIds: ReadonlyMap<string, string> },
): DocModel {
  const copy = structuredClone(doc);
  for (const tab of copy.tabs) {
    for (const block of tab.blocks) {
      const paragraphs =
        block.kind === "paragraph"
          ? [block]
          : block.kind === "table"
            ? block.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks))
            : [];
      for (const p of paragraphs) {
        for (const inline of p.inlines) {
          const heading = (inline.style?.link as JsonObject | undefined)?.heading as
            | { key?: string; tabId?: string }
            | undefined;
          if (!heading?.key) continue;
          const id = resolved.headingIds.get(heading.key);
          const style = inline.style as JsonObject;
          if (id) style.link = { heading: { id, tabId: resolved.tabIds.get(heading.tabId ?? "") ?? heading.tabId } };
          else delete style.link;
        }
      }
    }
  }
  return copy;
}

/** The chrome style of the linked text as planned (so the links request sets exactly it). */
function linkedStyle(tab: TabModel, paragraphKey: string, offset: number): JsonObject {
  const p = tab.blocks.find((b) => b.key === paragraphKey) as ParagraphBlock | undefined;
  let units = 0;
  for (const inline of p?.inlines ?? []) {
    const length = inline.kind === "text" ? inline.text.length : inline.length;
    if (offset < units + length) {
      const style = inline.style ?? {};
      return { foregroundColor: style.foregroundColor, underline: style.underline };
    }
    units += length;
  }
  return {};
}

/** The tab holding a paragraph. */
function tabOfParagraph(doc: DocModel, key: string): string {
  for (const tab of doc.tabs) if (tab.blocks.some((b) => b.key === key)) return tab.tabId;
  throw new CoreError("internal", `no paragraph ${key}`);
}

/** A paragraph's trimmed text. */
function plain(p: ParagraphBlock): string {
  return p.inlines
    .map((i) => (i.kind === "text" ? i.text : ""))
    .join("")
    .trim();
}
