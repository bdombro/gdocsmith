/* Workflow step kind resolution. */

import type { GdocsmithStepInput, WorkflowStepKind } from "~/core/workflowTypes.ts";

/** Reads the explicit step `kind` (trimmed). */
export function stepKindRead(step: GdocsmithStepInput): WorkflowStepKind | undefined {
  const raw = step.kind;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw.trim() as WorkflowStepKind;
}
