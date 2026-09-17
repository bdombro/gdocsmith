/* Workflow step: dump — copy a bound alias value into the response payload. */

import type { WorkflowStepHandler } from "./types.ts";

/** Writes a previously bound alias into `dumped` on the script result. */
export const dumpStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const name = step.as;
  if (!name) throw new Error(`steps[${stepIndex}] dump requires as: <alias>`);
  if (runtime.dumpStore.has(name)) {
    runtime.dumped[name] = runtime.dumpStore.get(name);
  } else if (runtime.aliasMap.has(name)) {
    runtime.dumped[name] = runtime.aliasMap.get(name);
  } else if (runtime.openDocs.has(name)) {
    const ctx = runtime.openDocs.get(name)!;
    runtime.dumped[name] = { id: ctx.docId, title: ctx.title };
  } else {
    throw new Error(`steps[${stepIndex}] dump: alias "${name}" is not bound`);
  }
  runtime.stepsExecuted++;
};
