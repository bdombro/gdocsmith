/* Workflow step: in-place paragraph text (innerText). */

import { domOpFromStep } from "./domOpFromStep.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Sets paragraph inner text on a targeted node. */
export const innerTextStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  if (step.innerText !== undefined) mutation.innerText = step.innerText;
  if (step.text !== undefined && mutation.innerText === undefined) mutation.innerText = step.text;
  await surgicalMutationExecute(runtime, step, mutation);
};
