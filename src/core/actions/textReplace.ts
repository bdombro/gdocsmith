/* Workflow step: find/replace text within a targeted node. */

import { domOpFromStep } from "./domOpFromStep.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Replaces matched text via the tape `replace` field (innerText alias). */
export const textReplaceStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.replace = step.replace ?? step.text;
  await surgicalMutationExecute(runtime, step, mutation);
};
