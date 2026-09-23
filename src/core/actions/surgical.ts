/* Workflow step: surgical DOM mutations (default path for DomOp-shaped steps). */

import { domOpFromStep } from "./domOpFromStep.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Applies a DomOp-shaped workflow step when no explicit kind handler matched. */
export const surgicalStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  await surgicalMutationExecute(runtime, step, domOpFromStep(step, runtime.aliasResolve), stepIndex);
};
