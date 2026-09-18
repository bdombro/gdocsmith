/* Unit tests for docPermissionAdd, docPermissionList, and docPermissionRemove workflow steps. */

import { describe, expect, test } from "bun:test";
import type { GdocsmithDocument } from "~/commands/run/types.ts";
import { applyScriptExecute } from "~/core/applyScript.ts";
import type { DrivePermission } from "~/core/gws.ts";

describe("docPermission workflow steps", () => {
  test("docPermissionAdd rejects missing email when scope is user or group", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        { as: "testDoc", kind: "docCreate", title: "Test" },
        { doc: "testDoc", kind: "docPermissionAdd", role: "writer", scope: "user" },
      ],
    };

    await expect(applyScriptExecute(doc)).rejects.toThrow(/requires email/);
  });

  test("docPermissionAdd auto-resolves domain when scope is internal or domain in dryRun", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        { as: "testDoc", kind: "docCreate", title: "Test" },
        { as: "internalPerm", doc: "testDoc", kind: "docPermissionAdd", role: "reader", scope: "internal" },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const perm = res.dumped?.internalPerm as DrivePermission;
    expect(perm.type).toBe("domain");
    expect(perm.domain).toBe("example.com");
  });

  test("docPermissionAdd rejects transferOwnership when role is not owner", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        { as: "testDoc", kind: "docCreate", title: "Test" },
        {
          doc: "testDoc",
          email: "bob@example.com",
          kind: "docPermissionAdd",
          role: "writer",
          transferOwnership: true,
        },
      ],
    };

    await expect(applyScriptExecute(doc)).rejects.toThrow(/requires role: "owner" when transferOwnership is true/);
  });

  test("docPermissionRemove rejects when no identifier or valid scope is provided", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        { as: "testDoc", kind: "docCreate", title: "Test" },
        { doc: "testDoc", kind: "docPermissionRemove" },
      ],
    };

    await expect(applyScriptExecute(doc)).rejects.toThrow(/requires permissionId, email, domain, or scope/);
  });

  test("simulates permission lifecycle in dry-run (add, list, remove)", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        { as: "testDoc", kind: "docCreate", title: "Test Doc" },
        // 1. Initial list has simulated owner
        { as: "initialPerms", doc: "testDoc", kind: "docPermissionList" },
        // 2. Add collaborator Alice
        {
          as: "alicePerm",
          doc: "testDoc",
          email: "alice@example.com",
          kind: "docPermissionAdd",
          role: "writer",
        },
        // 3. Add public reader
        {
          doc: "testDoc",
          kind: "docPermissionAdd",
          role: "reader",
          scope: "anyone",
        },
        // 4. Add company domain reader
        {
          doc: "testDoc",
          domain: "example.com",
          kind: "docPermissionAdd",
          role: "commenter",
          scope: "domain",
        },
        // 5. List perms after additions
        { as: "afterAddPerms", doc: "testDoc", kind: "docPermissionList" },
        // 6. Remove Alice by email
        {
          doc: "testDoc",
          email: "alice@example.com",
          kind: "docPermissionRemove",
        },
        // 7. Remove anyone by scope
        {
          doc: "testDoc",
          kind: "docPermissionRemove",
          scope: "anyone",
        },
        // 8. Remove domain by domain name
        {
          doc: "testDoc",
          domain: "example.com",
          kind: "docPermissionRemove",
        },
        // 9. Final list
        { as: "finalPerms", doc: "testDoc", kind: "docPermissionList" },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(10);

    const initial = res.dumped?.initialPerms as DrivePermission[];
    expect(initial.length).toBe(1);
    expect(initial[0]?.role).toBe("owner");

    const alicePerm = res.dumped?.alicePerm as DrivePermission;
    expect(alicePerm.emailAddress).toBe("alice@example.com");
    expect(alicePerm.role).toBe("writer");
    expect(alicePerm.type).toBe("user");

    const afterAdd = res.dumped?.afterAddPerms as DrivePermission[];
    expect(afterAdd.length).toBe(4); // owner, alice, anyone, domain

    const final = res.dumped?.finalPerms as DrivePermission[];
    expect(final.length).toBe(1); // only owner remaining
    expect(final[0]?.role).toBe("owner");
  });
});
