/* Unit tests for composite image store (Drive / https). SAS is gone. */

import { describe, expect, test } from "bun:test";
import { AppsScriptImages } from "./appsScriptImages.ts";
import { CompositeImageStore } from "./imageStore.ts";

describe("CompositeImageStore", () => {
  test("resolve passes through https URLs", async () => {
    const store = new CompositeImageStore({ mode: "drive" });
    const uri = await store.resolve("https://example.com/x.png", "doc");
    expect(uri).toBe("https://example.com/x.png");
  });

  test("resolve drive: throws — use blob insert instead", async () => {
    const store = new CompositeImageStore({ mode: "drive" });
    await expect(store.resolve("drive:abc", "doc")).rejects.toThrow(/Apps Script blob/);
  });

  test("resolve sas: is unsupported", async () => {
    const store = new CompositeImageStore({ mode: "drive" });
    await expect(store.resolve("sas:/old/path.png", "doc")).rejects.toThrow(/Unsupported image src/);
  });

  test("insertDriveBlob delegates to Apps Script", async () => {
    const calls: string[][] = [];
    const apps = new AppsScriptImages(
      {
        batchUpdate: async () => "{}",
        getDocument: async () => ({ body: { content: [] } }),
        run: async (args) => {
          calls.push(args);
          if (args[2] === "run") {
            return JSON.stringify({ done: true });
          }
          return JSON.stringify({ scriptId: "s1" });
        },
      },
      null,
    );
    const store = new CompositeImageStore({ appsScript: apps, mode: "drive" });
    await store.insertDriveBlob?.("doc", "file9", 5, { widthPt: 100 });
    expect(calls.some((c) => c[2] === "run")).toBe(true);
  });

  test("upload reports Drive failure instead of asking for script bootstrap", async () => {
    const failingApps = new AppsScriptImages(
      {
        batchUpdate: async () => "{}",
        getDocument: async () => ({ body: { content: [] } }),
        run: async () => {
          throw new Error("script unavailable");
        },
      },
      null,
    );
    const store = new CompositeImageStore({
      appsScript: failingApps,
      client: {
        batchUpdate: async () => "{}",
        getDocument: async () => ({ body: { content: [] } }),
        run: async () => {
          throw new Error("drive unavailable");
        },
      },
      mode: "auto",
    });
    await expect(store.upload("doc1", `${import.meta.dir}/../../package.json`)).rejects.toThrow(
      /Drive image upload failed/,
    );
  });
});
