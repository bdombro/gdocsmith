/* Workflow step: docPermissionRemove — revoke access permissions from a Drive document. */

import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Revokes a permission from the backing Drive document. */
export const docPermissionRemoveStep: WorkflowStepHandler = async (
  /** Mutable runtime state shared across workflow steps. */
  runtime,
  /** Zero-based index of the current step in the workflow. */
  stepIndex,
  /** Workflow step input configuration. */
  step,
) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const permissionId = step.permissionId;
  const email = step.email;
  const domain = step.domain;
  const rawScope = step.scope;
  const scope = rawScope === "internal" ? "domain" : rawScope;

  if (!permissionId && !email && !domain && scope !== "anyone" && scope !== "domain") {
    throw new Error(
      `steps[${stepIndex}] docPermissionRemove requires permissionId, email, domain, or scope ("anyone" | "domain" | "internal")`,
    );
  }

  if (runtime.dryRun || targetDoc.isVirtual) {
    if (targetDoc.permissions) {
      targetDoc.permissions = targetDoc.permissions.filter((p) => {
        if (permissionId && p.id === permissionId) return false;
        if (email && p.emailAddress?.toLowerCase() === email.toLowerCase()) return false;
        if (domain && p.domain?.toLowerCase() === domain.toLowerCase()) return false;
        if (scope === "anyone" && p.type === "anyone") return false;
        if (scope === "domain" && p.type === "domain") return false;
        return true;
      });
    }
  } else {
    let targetPermissionId = permissionId;
    if (!targetPermissionId) {
      const perms = await gwsDrive.listPermissions(targetDoc.docId);
      if (email) {
        const match = perms.find((p) => p.emailAddress?.toLowerCase() === email.toLowerCase());
        if (!match) {
          throw new Error(`steps[${stepIndex}] docPermissionRemove: no permission found matching email "${email}"`);
        }
        targetPermissionId = match.id;
      } else if (domain || scope === "domain") {
        const match = domain
          ? perms.find((p) => p.type === "domain" && p.domain?.toLowerCase() === domain.toLowerCase())
          : perms.find((p) => p.type === "domain");
        if (!match) {
          throw new Error(`steps[${stepIndex}] docPermissionRemove: no domain permission found on document`);
        }
        targetPermissionId = match.id;
      } else if (scope === "anyone") {
        const match = perms.find((p) => p.type === "anyone");
        if (!match) {
          throw new Error(`steps[${stepIndex}] docPermissionRemove: no "anyone" permission found on document`);
        }
        targetPermissionId = match.id;
      }
    }
    if (targetPermissionId) {
      await gwsDrive.deletePermission(targetDoc.docId, targetPermissionId);
    }
  }

  runtime.stepsExecuted++;
};
