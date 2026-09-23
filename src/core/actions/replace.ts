/* Workflow step: alias for in-place replace (kind: replace). */

import { domOpFromStep } from "./domOpFromStep.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** In-place text replacement (`kind: replace`). */
export const replaceStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.replace = step.replace ?? step.text ?? step.innerText;
  await surgicalMutationExecute(runtime, step, mutation, stepIndex);
};
