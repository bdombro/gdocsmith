/* Workflow step: docRename — rename a document in Drive. */

import { docCache } from "~/core/cache/docCache.ts";
import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Renames the backing Drive file for an open document alias. */
export const docRenameStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const newTitle = step.title;
  if (!newTitle) throw new Error(`steps[${stepIndex}] docRename requires title: <string>`);

  if (!runtime.dryRun) {
    await gwsDrive.updateFile(targetDoc.docId, { name: newTitle });
    targetDoc.gdoc.data.title = newTitle;
    docCache.invalidate(targetDoc.docId);
  }
  targetDoc.title = newTitle;
  runtime.stepsExecuted++;
};
