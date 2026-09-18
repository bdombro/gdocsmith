/* Workflow step: docTrash — move a document to Drive trash. */

import { docCache } from "~/core/cache/docCache.ts";
import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Trashes the backing Drive file and removes it from the session. */
export const docTrashStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  if (!runtime.dryRun) {
    await gwsDrive.updateFile(targetDoc.docId, { trashed: true });
    docCache.invalidate(targetDoc.docId);
  }
  runtime.openDocs.delete(targetDoc.alias);
  runtime.stepsExecuted++;
};
