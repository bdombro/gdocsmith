/*

Unit tests for Drive image helpers.

*/

import { describe, expect, test } from "bun:test";
import type { GwsClient } from "./gws.ts";
import { DriveImages } from "./images.ts";

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
});
