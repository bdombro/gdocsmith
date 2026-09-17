/* Workflow step: docDelete — trash or permanently delete a document. */

import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Deletes or trashes the backing Drive file and removes it from the session. */
export const docDeleteStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  if (!runtime.dryRun) {
    if (step.permanent) {
      await gwsDrive.deleteFile(targetDoc.docId);
    } else {
      await gwsDrive.updateFile(targetDoc.docId, { trashed: true });
    }
  }
  runtime.openDocs.delete(targetDoc.alias);
  runtime.stepsExecuted++;
};
