/* Flush pending in-memory DomWriter mutations to Google Docs via single batchUpdate. */

import { applyDom } from "~/core/dom/applyBatch.ts";
import { Gdoc } from "~/core/gdoc.ts";
import type { ApplyScriptRuntime, OpenDocContext } from "./types.ts";

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
      await applyDom(docCtx.docId, writersWithMutations, {
        client: runtime.client,
        doc: docCtx.gdoc.data,
        dryRun: false,
        force: runtime.force,
        plan: allPlans,
      });
      docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client);
    }

    docCtx.pendingWriters.clear();
  }
}
