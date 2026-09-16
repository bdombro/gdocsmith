/*

Apps Script image insert — private Drive blobs without public URLs.

Bootstrap: gws script projects create + updateContent, then scripts.run.

*/

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSkillConfig, saveSkillConfig } from "./config.ts";
import type { GwsClient } from "./gws.ts";
import { gws } from "./gws.ts";
import { wrapScriptError } from "./script-permission.ts";

const PROJECT_TITLE = "gdocsmith-images";
const APPS_SCRIPT_DIR = join(import.meta.dir, "..", "..", "apps-script");

export type DriveImageInsertOpts = {
  widthPt?: number;
  heightPt?: number;
  align?: string;
};

type ScriptOperation = {
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: { result?: unknown };
};

/** Manages the Apps Script project and inserts Drive images via blob. */
export class AppsScriptImages {
  private scriptId?: string;

  constructor(
    private readonly client: GwsClient = gws,
    scriptId?: string | null,
  ) {
    this.scriptId = scriptId === null ? undefined : (scriptId ?? loadSkillConfig().appsScriptId);
  }

  get projectId(): string | undefined {
    return this.scriptId;
  }

  /** Creates or updates the Apps Script project; returns script id. */
  async ensureProject(opts: { forceUpload?: boolean } = {}): Promise<string> {
    if (this.scriptId && !opts.forceUpload) return this.scriptId;

    try {
      if (!this.scriptId) {
        const out = await this.client.run([
          "script",
          "projects",
          "create",
          "--json",
          JSON.stringify({ title: PROJECT_TITLE }),
        ]);
        const created = JSON.parse(out) as { scriptId?: string };
        if (!created.scriptId) {
          throw new Error(`Apps Script project create failed: ${out}`);
        }
        this.scriptId = created.scriptId;
        saveSkillConfig({ appsScriptId: this.scriptId });
      }

      await this.#uploadContent(this.scriptId);
      return this.scriptId;
    } catch (err) {
      throw wrapScriptError(err, "script bootstrap");
    }
  }

  /** Inserts a private Drive image at a Docs body index. */
  async insertDriveImage(
    documentId: string,
    fileId: string,
    index: number,
    opts: DriveImageInsertOpts = {},
  ): Promise<void> {
    const scriptId = await this.ensureProject();
    const runOpts: Record<string, number | string> = {};
    if (opts.widthPt !== undefined) runOpts.widthPt = opts.widthPt;
    if (opts.heightPt !== undefined) runOpts.heightPt = opts.heightPt;
    if (opts.align) {
      const align = opts.align.toLowerCase();
      if (align === "left" || align === "center" || align === "right") {
        runOpts.align = align;
      }
    }

    const parameters: unknown[] = [documentId, fileId, index, Object.keys(runOpts).length ? runOpts : {}];

    let out: string;
    try {
      out = await this.client.run([
        "script",
        "scripts",
        "run",
        "--params",
        JSON.stringify({ scriptId }),
        "--json",
        JSON.stringify({
          devMode: true,
          function: "insertImageFromDrive",
          parameters,
        }),
      ]);
    } catch (err) {
      throw wrapScriptError(err, "image insert");
    }

    const op = JSON.parse(out) as ScriptOperation;
    if (op.error) {
      throw wrapScriptError(new Error(op.error.message ?? JSON.stringify(op.error)), "image insert");
    }
    if (!op.done) {
      throw new Error("Apps Script execution did not complete");
    }
  }

  async #uploadContent(scriptId: string): Promise<void> {
    const code = readFileSync(join(APPS_SCRIPT_DIR, "Code.gs"), "utf8");
    const manifest = readFileSync(join(APPS_SCRIPT_DIR, "appsscript.json"), "utf8");
    await this.client.run([
      "script",
      "projects",
      "updateContent",
      "--params",
      JSON.stringify({ scriptId }),
      "--json",
      JSON.stringify({
        files: [
          { name: "Code", source: code, type: "SERVER_JS" },
          { name: "appsscript", source: manifest, type: "JSON" },
        ],
      }),
    ]);
  }
}
