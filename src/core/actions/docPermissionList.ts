/* Workflow step: docPermissionList — list access permissions on a Drive document. */

import type { DrivePermission } from "~/core/gws.ts";
import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Lists permissions for the backing Drive document into dumped. */
export const docPermissionListStep: WorkflowStepHandler = async (
  /** Mutable runtime state shared across workflow steps. */
  runtime,
  /** Zero-based index of the current step in the workflow. */
  _stepIndex,
  /** Workflow step input configuration. */
  step,
) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const as = step.as ?? `${targetDoc.alias}Permissions`;

  let permissions: DrivePermission[];

  if (runtime.dryRun || targetDoc.isVirtual) {
    if (!targetDoc.permissions) {
      targetDoc.permissions = [
        {
          displayName: "Document Owner",
          id: "simulated:owner",
          role: "owner",
          type: "user",
        },
      ];
    }
    permissions = [...targetDoc.permissions];
  } else {
    permissions = await gwsDrive.listPermissions(targetDoc.docId);
  }

  runtime.dumped[as] = permissions;
  runtime.dumpStore.set(as, permissions);
  runtime.stepsExecuted++;
};
