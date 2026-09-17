/* Workflow step: tabDelete — remove a document tab. */

import { Gdoc } from "~/core/gdoc.ts";
import { gws } from "~/core/gws.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { resolveTab } from "~/core/tabs.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Deletes a tab by id or title hint on an open document. */
export const tabDeleteStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint) throw new Error(`steps[${stepIndex}] tabDelete requires tab: <id|title>`);

  if (!runtime.dryRun) {
    const resolved = resolveTab(targetDoc.gdoc.data, tabHint);
    if (!resolved.tabId) {
      throw new Error(`Cannot delete tab "${tabHint}": resolved tab has no tabId`);
    }
    const req = RequestBuilder.deleteTab(resolved.tabId);
    await gws.batchUpdate(targetDoc.docId, [req]);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  }
  runtime.stepsExecuted++;
};
