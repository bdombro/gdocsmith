/* Local-only lens corpus test: every cached document's tabs obey GetPut in both modes, and random markdown edits read back as written with a self-checking plan. Skips when the cache is empty; never writes or prints document content. */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { rngCreate } from "../model/testDocs.ts";
import type { DocModel } from "../model/types.ts";
import { docPlanSelfCheck, docReconcile } from "../reconcile/reconcile.ts";
import { tabMarkdownExport } from "./export.ts";
import { markdownPut } from "./put.ts";

const CORPUS_PATH = join(homedir(), ".cache", "gdocsmith", "db.sqlite");

/** Every cached snapshot (none when the cache is missing). */
function snapshots(): Array<{ data_json: string; doc_id: string }> {
  try {
    return new Database(CORPUS_PATH, { readonly: true })
      .query("SELECT doc_id, data_json FROM doc_snapshots")
      .all() as Array<{ data_json: string; doc_id: string }>;
  } catch {
    return [];
  }
}

describe("lens corpus (local-only)", () => {
  test("GetPut on every cached tab, and 20 random edits that self-check", () => {
    const failures: string[] = [];
    let edits = 0;
    for (const row of snapshots()) {
      const json = JSON.parse(row.data_json);
      let original: DocModel;
      try {
        original = docModelParse(json, { docId: row.doc_id, keys: new KeyAllocator() });
      } catch {
        continue;
      }
      original.tabs.forEach((_, t) => {
        for (const plain of [false, true]) {
          const keys = new KeyAllocator();
          const final = structuredClone(original);
          const tab = final.tabs[t];
          const target = { ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab };
          const range = { containerRef: { kind: "body" as const }, from: 0, to: tab.blocks.length };
          try {
            const md = tabMarkdownExport(final, tab, range, { skipFrontmatter: plain }).markdown;
            if (markdownPut(target, final, { kind: "replace", range: { kind: "tab" } }, md).changed)
              failures.push(`${row.doc_id} tab ${t}: GetPut changed the model`);
          } catch (err) {
            failures.push(`${row.doc_id} tab ${t}: GetPut threw ${(err as Error).message}`);
          }
        }
      });
      const rng = rngCreate(row.doc_id.length);
      for (let e = 0; e < 20 && edits < 20; e++, edits++) {
        const final = structuredClone(original);
        const tab = final.tabs[Math.floor(rng() * final.tabs.length)];
        const range = { containerRef: { kind: "body" as const }, from: 0, to: tab.blocks.length };
        const lines = tabMarkdownExport(final, tab, range).markdown.split("\n");
        const i = lines.findIndex((l, k) => k > 0 && /^[A-Za-z]/.test(l) && rng() < 0.3);
        if (i < 0) continue;
        lines[i] = `${lines[i]} edited`;
        try {
          markdownPut(
            { ctx: { keys: new KeyAllocator(), stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab },
            final,
            { kind: "replace", range: { kind: "tab" } },
            lines.join("\n"),
          );
          const input = { final, original, originalJson: json };
          const diffs = docPlanSelfCheck(docReconcile(input), input).diffs;
          if (diffs.length) failures.push(`${row.doc_id}: self-check ${diffs.slice(0, 2).join("; ")}`);
        } catch (err) {
          if (!(err instanceof CoreError) || err.code === "internal")
            failures.push(`${row.doc_id}: edit threw ${(err as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
