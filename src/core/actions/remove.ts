/* Workflow step: remove one tape node or section. */

import { domOpFromStep } from "./domOpFromStep.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Removes a single targeted node or heading section. */
export const removeStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  if (step.dangerousRemoveSection || step.kind === "dangerousRemoveSection") {
    mutation.dangerousRemoveSection = true;
    delete mutation.remove;
  } else {
    mutation.remove = true;
    delete mutation.dangerousRemoveSection;
  }
  await surgicalMutationExecute(runtime, step, mutation);
};
