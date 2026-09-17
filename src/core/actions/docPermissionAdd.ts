/* Workflow step: docPermissionAdd — grant access permissions on a Drive document. */

import type { DrivePermission, DrivePermissionRole, DrivePermissionScope } from "~/core/gws.ts";
import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Grants a file permission on the backing Drive document. */
export const docPermissionAddStep: WorkflowStepHandler = async (
  /** Mutable runtime state shared across workflow steps. */
  runtime,
  /** Zero-based index of the current step in the workflow. */
  stepIndex,
  /** Workflow step input configuration. */
  step,
) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const emailAddress = step.emailAddress ?? step.email;
  let domain = step.domain;
  const rawScope = step.scope;
  const scope: DrivePermissionScope =
    rawScope === "internal" ? "domain" : (rawScope ?? (emailAddress ? "user" : domain ? "domain" : "anyone"));
  const role: DrivePermissionRole = step.role ?? "reader";

  if ((scope === "user" || scope === "group") && !emailAddress) {
    throw new Error(`steps[${stepIndex}] docPermissionAdd requires emailAddress (or email) when scope is "${scope}"`);
  }
  if (scope === "domain" && !domain) {
    if (runtime.dryRun || targetDoc.isVirtual) {
      domain = "example.com";
    } else {
      domain = await gwsDrive.userDomainGet();
    }
  }
  if (step.transferOwnership && role !== "owner") {
    throw new Error(`steps[${stepIndex}] docPermissionAdd requires role: "owner" when transferOwnership is true`);
  }

  let permission: DrivePermission;

  if (runtime.dryRun || targetDoc.isVirtual) {
    permission = {
      displayName: emailAddress ?? domain ?? "Anyone with link",
      domain,
      emailAddress,
      id: `simulated:perm:${stepIndex}`,
      role,
      type: scope,
    };
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
    targetDoc.permissions.push(permission);
  } else {
    permission = await gwsDrive.createPermission(
      targetDoc.docId,
      {
        domain,
        emailAddress,
        role,
        type: scope,
      },
      {
        emailMessage: step.emailMessage,
        moveToNewOwnersRoot: step.moveToNewOwnersRoot,
        sendNotificationEmail: step.sendNotificationEmail,
        transferOwnership: step.transferOwnership,
      },
    );
  }

  if (step.as) {
    runtime.dumped[step.as] = permission;
    runtime.dumpStore.set(step.as, permission);
  }

  runtime.stepsExecuted++;
};
