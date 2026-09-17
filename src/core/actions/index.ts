/* Workflow step handler registry (canonical kinds, alphabetical). */

import type { GdocsmithStepInput } from "~/core/workflowTypes.ts";
import { closeStep } from "./close.ts";
import { docCopyStep } from "./docCopy.ts";
import { docCreateStep } from "./docCreate.ts";
import { docDeleteStep } from "./docDelete.ts";
import { docRenameStep } from "./docRename.ts";
import { docTrashStep } from "./docTrash.ts";
import { dumpStep } from "./dump.ts";
import { innerTextStep } from "./innerText.ts";
import { markdownInsertStep } from "./markdownInsert.ts";
import { openStep } from "./open.ts";
import { queryStep } from "./query.ts";
import { removeStep } from "./remove.ts";
import { replaceStep } from "./replace.ts";
import { stepKindRead } from "./stepKind.ts";
import { surgicalStep } from "./surgical.ts";
import { tabAddStep } from "./tabAdd.ts";
import { tabDeleteStep } from "./tabDelete.ts";
import { tabRenameStep } from "./tabRename.ts";
import { textReplaceStep } from "./textReplace.ts";
import type { ApplyScriptRuntime, WorkflowStepHandler, WorkflowStepKind } from "./types.ts";

/** Handlers for explicit workflow step kinds (alphabetical by kind). */
export const STEP_HANDLERS: Partial<Record<WorkflowStepKind, WorkflowStepHandler>> = {
  close: closeStep,
  docCopy: docCopyStep,
  docCreate: docCreateStep,
  docDelete: docDeleteStep,
  docRename: docRenameStep,
  docTrash: docTrashStep,
  dump: dumpStep,
  innerText: innerTextStep,
  markdownInsert: markdownInsertStep,
  open: openStep,
  query: queryStep,
  remove: removeStep,
  replace: replaceStep,
  replaceMarkdown: surgicalStep,
  replaceSection: surgicalStep,
  surgical: surgicalStep,
  tabAdd: tabAddStep,
  tabDelete: tabDeleteStep,
  tabRename: tabRenameStep,
  textReplace: textReplaceStep,
};

/** Resolves and runs one workflow step. */
export async function stepRun(runtime: ApplyScriptRuntime, stepIndex: number, step: GdocsmithStepInput): Promise<void> {
  const kind = stepKindRead(step);
  if (!kind) {
    throw new Error(`steps[${stepIndex}] requires kind: <WorkflowStepKind>`);
  }
  const handler = STEP_HANDLERS[kind];
  if (!handler) {
    throw new Error(`steps[${stepIndex}] unknown kind: ${kind}`);
  }
  await handler(runtime, stepIndex, step);
}

export { stepKindRead } from "./stepKind.ts";
export type { ApplyScriptRuntime, OpenDocContext, WorkflowStepKind } from "./types.ts";
