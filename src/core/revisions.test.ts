/* Unit tests for Drive revision pin + restore hint. */

import { describe, expect, test } from "bun:test";
import type { GwsClient } from "./gws.ts";
import { DriveRevisions } from "./revisions.ts";
import type { GoogleDoc } from "./types.ts";

function mockClient(run: GwsClient["run"]): GwsClient {
  return {
    batchUpdate: async () => "{}",
    getDocument: async () => ({ body: { content: [] } }) as GoogleDoc,
    run,
  };
}

describe("DriveRevisions", () => {
  test("pinHead keeps newest revision and attempts keepForever", async () => {
    const calls: string[][] = [];
    const client = mockClient(async (args) => {
      calls.push(args);
      if (args[2] === "list") {
        return JSON.stringify({
          revisions: [
            { id: "1", modifiedTime: "2026-01-01T00:00:00Z" },
            { id: "99", modifiedTime: "2026-08-13T12:00:00Z" },
          ],
        });
      }
      return "{}";
    });

    const pin = await DriveRevisions.pinHead("doc-id", client);
    expect(pin).toEqual({
      id: "99",
      keepForever: true,
      modifiedTime: "2026-08-13T12:00:00Z",
    });
    expect(calls[0]?.slice(0, 3)).toEqual(["drive", "revisions", "list"]);
    expect(calls[1]?.slice(0, 3)).toEqual(["drive", "revisions", "update"]);
    expect(calls[1]?.at(-1)).toContain("keepForever");
  });

  test("pinHead still returns the revision id when keepForever is rejected", async () => {
    const client = mockClient(async (args) => {
      if (args[2] === "list") {
        return JSON.stringify({
          revisions: [{ id: "rev-abc", modifiedTime: "2026-08-13T00:00:00Z" }],
        });
      }
      throw new Error("keepForever not supported for Google Docs");
    });

    const pin = await DriveRevisions.pinHead("doc-id", client);
    expect(pin?.id).toBe("rev-abc");
    expect(pin?.keepForever).toBeUndefined();
  });

  test("pinHead returns null when list fails or is empty", async () => {
    const failing = mockClient(async () => {
      throw new Error("403");
    });
    expect(await DriveRevisions.pinHead("doc-id", failing)).toBeNull();

    const empty = mockClient(async () => JSON.stringify({ revisions: [] }));
    expect(await DriveRevisions.pinHead("doc-id", empty)).toBeNull();

    const junk = mockClient(async () => "not json");
    expect(await DriveRevisions.pinHead("doc-id", junk)).toBeNull();
  });

  test("restoreHint names the revision and Version history URL", () => {
    const hint = DriveRevisions.restoreHint("abc123", "rev-9");
    expect(hint).toContain("rev-9");
    expect(hint).toContain("Version history");
    expect(hint).toContain("https://docs.google.com/document/d/abc123/revisions/revisions");
  });
});
