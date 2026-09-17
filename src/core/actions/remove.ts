/* Workflow step: remove one tape node. */

import { domOpFromStep } from "./domOpFromStep.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Removes a single targeted node. */
export const removeStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.remove = true;
  await surgicalMutationExecute(runtime, step, mutation);
};
