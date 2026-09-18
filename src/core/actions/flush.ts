/* Flush pending in-memory DomWriter mutations to Google Docs via single batchUpdate. */

import { docCache } from "~/core/cache/docCache.ts";
import { applyDom, isRevisionMismatchError } from "~/core/dom/applyBatch.ts";
import { type TapeMutation, tapeMutationsApply } from "~/core/dom/ops.ts";
import { assignScopedIds, parseDocument } from "~/core/dom/parse.ts";
import { DomWriter } from "~/core/dom/write.ts";
import { Gdoc } from "~/core/gdoc.ts";
import type { ApplyScriptRuntime, OpenDocContext } from "./types.ts";

/** Exponential backoff schedule totaling approximately 2 minutes. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];

/** Flushes buffered DomWriter mutations across open documents or for a specific document. */
export async function pendingWritersFlush(
  /** Script runtime context. */
  runtime: ApplyScriptRuntime,
  /** Optional specific document alias or ID to flush. If omitted, flushes all open documents. */
  docRef?: string,
): Promise<void> {
  const docsToFlush: OpenDocContext[] = [];
  if (docRef) {
    const doc = runtime.openDocResolve(docRef);
    if (doc) docsToFlush.push(doc);
  } else {
    docsToFlush.push(...runtime.openDocs.values());
  }

  for (const docCtx of docsToFlush) {
    if (!docCtx.pendingWriters || docCtx.pendingWriters.size === 0) continue;
    if (runtime.dryRun || docCtx.docId.startsWith("virtual:")) {
      docCtx.pendingWriters.clear();
      continue;
    }

    const entries = Array.from(docCtx.pendingWriters.values());
    const writersWithMutations = entries.map((e) => e.writer).filter((w) => w.mutations().length > 0);

    if (writersWithMutations.length > 0) {
      const allPlans = entries.flatMap((e) => e.plans);
      try {
        await applyDom(docCtx.docId, writersWithMutations, {
          client: runtime.client,
          doc: docCtx.gdoc.data,
          dryRun: false,
          force: runtime.force,
          plan: allPlans,
        });
        docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client, { forceFetch: true });
      } catch (err) {
        if (!isRevisionMismatchError(err)) {
          throw err;
        }
        await replayPendingMutations(runtime, docCtx, RETRY_DELAYS_MS);
      }
    }

    docCtx.pendingWriters.clear();
  }
}

/** Replays pending mutations against fresh document state across backoff retry intervals. */
async function replayPendingMutations(
  /** Script runtime context. */
  runtime: ApplyScriptRuntime,
  /** Open document context whose mutations collided. */
  docCtx: OpenDocContext,
  /** Backoff delay intervals in milliseconds. */
  delays: number[],
): Promise<void> {
  docCache.invalidate(docCtx.docId);

  for (let attempt = 0; attempt < delays.length; attempt++) {
    await sleep(delays[attempt]!);

    docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client, { forceFetch: true });

    if (!docCtx.pendingWriters) break;

    for (const [tabKey, entry] of docCtx.pendingWriters.entries()) {
      const tabId = tabKey === "default" ? undefined : tabKey;
      const gdoc = tabId ? docCtx.gdoc.withTab(tabId) : docCtx.gdoc;
      const parsed = parseDocument(gdoc);
      const writer = new DomWriter(parsed.nodes, {
        doc: docCtx.gdoc.data,
        force: runtime.force,
        lists: gdoc.data.lists,
        tabId,
      });

      entry.afterendTails = new Map();
      entry.doc = gdoc.data;
      entry.namedAnchors = new Map();
      entry.plans = [];
      entry.rootAnchors = new Map();
      entry.writer = writer;

      for (const item of entry.steps) {
        const op = item.op as TapeMutation;
        const plans = tapeMutationsApply(entry.writer, [op], entry.writer.mutations().length, {
          afterendTails: entry.afterendTails,
          force: runtime.force || Boolean(op.force),
          namedAnchors: entry.namedAnchors,
          rootAnchors: entry.rootAnchors,
        });
        if (plans?.length) {
          entry.plans.push(...plans);
        }
        assignScopedIds(entry.writer.nodes);
        const stepAs = (item.step as { as?: string })?.as;
        if (stepAs) {
          const namedNode = entry.namedAnchors.get(stepAs);
          if (namedNode?.scopedId) {
            runtime.aliasMap.set(stepAs, namedNode.scopedId);
          }
        }
      }
    }

    const entries = Array.from(docCtx.pendingWriters.values());
    const writersWithMutations = entries.map((e) => e.writer).filter((w) => w.mutations().length > 0);
    const allPlans = entries.flatMap((e) => e.plans);

    try {
      await applyDom(docCtx.docId, writersWithMutations, {
        client: runtime.client,
        doc: docCtx.gdoc.data,
        dryRun: false,
        force: runtime.force,
        plan: allPlans,
      });
      docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client, { forceFetch: true });
      return;
    } catch (retryErr) {
      if (!isRevisionMismatchError(retryErr)) {
        throw retryErr;
      }
      docCache.invalidate(docCtx.docId);
    }
  }

  throw new Error(`Document "${docCtx.docId}" was modified externally and remained busy after retry attempts.`);
}

/** Pauses execution for the specified milliseconds. */
function sleep(
  /** Duration in milliseconds. */
  ms: number,
): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
