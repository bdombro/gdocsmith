/* Workflow step: docClose — drop a document from the runtime session. */

import type { WorkflowStepHandler } from "./types.ts";

/** Closes an open document alias without mutating the remote file. */
export const closeStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  runtime.openDocs.delete(targetDoc.alias);
  runtime.docIdToAlias.delete(targetDoc.docId);
  runtime.aliasMap.delete(targetDoc.alias);
  if (runtime.activeDocAlias === targetDoc.alias) {
    runtime.activeDocAlias = runtime.openDocs.keys().next().value;
  }
  runtime.stepsExecuted++;
};
