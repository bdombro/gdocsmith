/*

Unit tests for Apps Script image insert wrapper.

*/

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppsScriptImages } from "./apps-script-images.ts";
import type { GwsClient } from "./gws.ts";

describe("AppsScriptImages", () => {
  let configDir: string;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    prevConfigDir = process.env.GWS_DOCS_EDIT_CONFIG_DIR;
    configDir = mkdtempSync(join(tmpdir(), "gws-docs-edit-config-"));
    process.env.GWS_DOCS_EDIT_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.GWS_DOCS_EDIT_CONFIG_DIR;
    } else {
      process.env.GWS_DOCS_EDIT_CONFIG_DIR = prevConfigDir;
    }
    rmSync(configDir, { recursive: true, force: true });
  });
  test("ensureProject creates and uploads when missing", async () => {
    const calls: string[][] = [];
    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async (args) => {
        calls.push(args);
        if (args[1] === "projects" && args[2] === "create") {
          return JSON.stringify({ scriptId: "script-abc" });
        }
        return "{}";
      },
    };
    const apps = new AppsScriptImages(client, null);
    const id = await apps.ensureProject();
    expect(id).toBe("script-abc");
    expect(calls.some((c) => c.includes("updateContent"))).toBe(true);
  });

  test("insertDriveImage calls scripts.run with devMode", async () => {
    const calls: string[][] = [];
    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async (args) => {
        calls.push(args);
        if (args[1] === "scripts" && args[2] === "run") {
          return JSON.stringify({ done: true, response: { result: 42 } });
        }
        return "{}";
      },
    };
    const apps = new AppsScriptImages(client, "script-xyz");
    await apps.insertDriveImage("doc1", "file1", 10, {
      align: "center",
      widthPt: 480,
    });
    const run = calls.find((c) => c[2] === "run");
    expect(run).toBeDefined();
    const jsonIdx = run?.indexOf("--json");
    if (!run || jsonIdx === undefined || jsonIdx < 0) throw new Error("missing --json");
    const body = JSON.parse(String(run[jsonIdx + 1]));
    expect(body.function).toBe("insertImageFromDrive");
    expect(body.devMode).toBe(true);
    expect(body.parameters).toEqual(["doc1", "file1", 10, { align: "center", widthPt: 480 }]);
  });

  test("ensureProject maps 403 to a permission message", async () => {
    const client: GwsClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => ({ body: { content: [] } }),
      run: async () => {
        throw new Error("HTTP 403 Forbidden: Script API has not been used");
      },
    };
    const apps = new AppsScriptImages(client, null);
    await expect(apps.ensureProject()).rejects.toThrow(/Apps Script API is not enabled/);
  });
});
