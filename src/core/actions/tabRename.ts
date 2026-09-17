/* Workflow step: tabRename — rename a document tab. */

import { Gdoc } from "~/core/gdoc.ts";
import { gws } from "~/core/gws.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { resolveTab } from "~/core/tabs.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Renames a tab by id or title hint on an open document. */
export const tabRenameStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint) throw new Error(`steps[${stepIndex}] tabRename requires tab: <id|title>`);
  const title = step.title;
  if (!title) throw new Error(`steps[${stepIndex}] tabRename requires title: <string>`);

  if (!runtime.dryRun) {
    const resolved = resolveTab(targetDoc.gdoc.data, tabHint);
    if (!resolved.tabId) {
      throw new Error(`Cannot rename tab "${tabHint}": resolved tab has no tabId`);
    }
    const req = RequestBuilder.renameTab(resolved.tabId, title);
    await gws.batchUpdate(targetDoc.docId, [req]);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  }
  runtime.stepsExecuted++;
};
