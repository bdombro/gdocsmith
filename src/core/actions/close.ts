/* Workflow step: close — drop a document from the runtime session. */

import type { WorkflowStepHandler } from "./types.ts";

/** Closes an open document alias without mutating the remote file. */
export const closeStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const as = step.as ?? step.doc;
  if (!as) throw new Error(`steps[${stepIndex}] close requires "as: <alias>" or "doc: <alias>"`);
  const resolved = runtime.aliasResolve(as) ?? as;
  const entry =
    runtime.openDocs.get(resolved) ?? Array.from(runtime.openDocs.values()).find((d) => d.docId === resolved);
  if (entry) {
    runtime.openDocs.delete(entry.alias);
    runtime.docIdToAlias.delete(entry.docId);
    runtime.aliasMap.delete(entry.alias);
    if (runtime.activeDocAlias === entry.alias) {
      runtime.activeDocAlias = runtime.openDocs.keys().next().value;
    }
  }
  runtime.stepsExecuted++;
};
