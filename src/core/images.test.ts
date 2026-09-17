/* Unit tests for Drive image helpers. */

import { describe, expect, test } from "bun:test";
import type { GwsClient } from "./gws.ts";
import { DRIVE_IMAGE_ROOT, DriveImages } from "./images.ts";

describe("DriveImages", () => {
  test("publishAndUri builds drive export URL when publish succeeds", async () => {
    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async () => "{}",
    };
    const images = new DriveImages(client);
    const result = await images.publishAndUri("file123");
    expect(result.uri).toBe("https://drive.google.com/uc?export=view&id=file123");
    expect(result.published).toBe(true);
  });

  test("publishAndUri reports failure without throwing", async () => {
    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async () => {
        throw new Error("publishOutNotPermitted");
      },
    };
    const images = new DriveImages(client);
    const result = await images.publishAndUri("file123");
    expect(result.published).toBe(false);
    expect(result.publishError).toContain("publishOutNotPermitted");
  });

  test("ensureDocFolder uses cached folder id", async () => {
    let listCalls = 0;
    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async () => {
        listCalls++;
        throw new Error("should not list when cache hit");
      },
    };
    const images = new DriveImages(client);
    const id = await images.ensureDocFolder("doc", "cached-folder");
    expect(id).toBe("cached-folder");
    expect(listCalls).toBe(0);
  });

  test("ensureDocFolder creates folder hierarchy using DRIVE_IMAGE_ROOT when not cached", async () => {
    const listQueries: string[] = [];
    const createdFolders: Array<{ name: string; parents?: string[] }> = [];

    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async (args) => {
        if (args[1] === "files" && args[2] === "list") {
          const params = JSON.parse(args[4]) as { q: string };
          listQueries.push(params.q);
          return JSON.stringify({ files: [] });
        }
        if (args[1] === "files" && args[2] === "create") {
          const body = JSON.parse(args[6]) as { name: string; parents?: string[] };
          createdFolders.push(body);
          return JSON.stringify({ id: `id-${body.name}` });
        }
        return "{}";
      },
    };

    const images = new DriveImages(client);
    const targetDocId = "doc-xyz";
    const folderId = await images.ensureDocFolder(targetDocId);

    expect(folderId).toBe(`id-${targetDocId}`);
    expect(DRIVE_IMAGE_ROOT).toEqual(["googleworkspace-cli", "gdocsmith", "images"]);
    expect(createdFolders.map((f) => f.name)).toEqual(["googleworkspace-cli", "gdocsmith", "images", targetDocId]);
    expect(listQueries.some((q) => q.includes("name='gdocsmith'"))).toBe(true);
  });
});
