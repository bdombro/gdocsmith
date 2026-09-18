/* Unit tests for DriveClient permission REST methods. */

import { describe, expect, test } from "bun:test";
import { DriveClient } from "./gws.ts";

describe("DriveClient permissions", () => {
  test("createPermission sends correct URL, headers, and body", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";

    const client = new DriveClient(async (url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          displayName: "Alice",
          emailAddress: "alice@example.com",
          id: "perm-123",
          role: "writer",
          type: "user",
        }),
        { status: 200 },
      );
    });

    const res = await client.createPermission(
      "doc-abc",
      {
        emailAddress: "alice@example.com",
        role: "writer",
        type: "user",
      },
      {
        emailMessage: "Welcome to the doc!",
        sendNotificationEmail: true,
      },
    );

    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toContain("/files/doc-abc/permissions?");
    expect(capturedUrl).toContain("supportsAllDrives=true");
    expect(capturedUrl).toContain("sendNotificationEmail=true");
    expect(capturedUrl).toContain("emailMessage=Welcome+to+the+doc%21");
    expect(JSON.parse(capturedBody)).toEqual({
      emailAddress: "alice@example.com",
      role: "writer",
      type: "user",
    });
    expect(res.id).toBe("perm-123");
    expect(res.role).toBe("writer");
  });

  test("deletePermission sends DELETE request to file permission endpoint", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    const client = new DriveClient(async (url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      return new Response(null, { status: 204 });
    });

    await client.deletePermission("doc-abc", "perm-123");
    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toBe(
      "https://www.googleapis.com/drive/v3/files/doc-abc/permissions/perm-123?supportsAllDrives=true",
    );
  });

  test("listPermissions queries file permissions and returns array", async () => {
    let capturedUrl = "";

    const client = new DriveClient(async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          permissions: [
            { id: "owner-1", role: "owner", type: "user" },
            { displayName: "Anyone with link", id: "anyoneWithLink", role: "reader", type: "anyone" },
          ],
        }),
        { status: 200 },
      );
    });

    const list = await client.listPermissions("doc-abc");
    expect(capturedUrl).toContain("/files/doc-abc/permissions?");
    expect(capturedUrl).toContain("pageSize=100");
    expect(capturedUrl).toContain("supportsAllDrives=true");
    expect(list.length).toBe(2);
    expect(list[0]?.id).toBe("owner-1");
    expect(list[1]?.type).toBe("anyone");
  });

  test("createPermission formats GWS error on failure", async () => {
    const client = new DriveClient(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "The user does not have sufficient permissions for this file.",
          },
        }),
        { status: 403 },
      );
    });

    await expect(
      client.createPermission("doc-xyz", {
        role: "reader",
        type: "anyone",
      }),
    ).rejects.toThrow(/Permission denied/);
  });

  test("userDomainGet extracts domain from authenticated workspace user email", async () => {
    const client = new DriveClient(async () => {
      return new Response(
        JSON.stringify({
          user: {
            displayName: "Dev User",
            emailAddress: "dev@acme-corp.com",
          },
        }),
        { status: 200 },
      );
    });

    const domain = await client.userDomainGet();
    expect(domain).toBe("acme-corp.com");
  });

  test("userDomainGet throws for personal Gmail accounts", async () => {
    const client = new DriveClient(async () => {
      return new Response(
        JSON.stringify({
          user: {
            displayName: "Personal User",
            emailAddress: "someone@gmail.com",
          },
        }),
        { status: 200 },
      );
    });

    await expect(client.userDomainGet()).rejects.toThrow(/Cannot auto-detect workspace domain from personal account/);
  });

  test("headRevisionIdGet fetches and returns headRevisionId", async () => {
    let capturedUrl = "";
    const client = new DriveClient(async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ headRevisionId: "rev-abc-123" }), { status: 200 });
    });

    const rev = await client.headRevisionIdGet("doc-123");
    expect(rev).toBe("rev-abc-123");
    expect(capturedUrl).toContain("/files/doc-123?");
    expect(capturedUrl).toContain("fields=headRevisionId");
  });

  test("headRevisionIdGet returns undefined when API call fails", async () => {
    const client = new DriveClient(async () => {
      return new Response("Not Found", { status: 404 });
    });

    const rev = await client.headRevisionIdGet("nonexistent");
    expect(rev).toBeUndefined();
  });
});
