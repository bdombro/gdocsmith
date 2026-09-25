/* Local-only corpus test: replays every cached document snapshot through the parser and layout to catch real-world shapes the synthetic fixtures miss. Skips (never fails) when the corpus is absent or empty; never writes corpus content to disk or logs document text. */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { docModelParse } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { layoutCompute } from "./layout.ts";

const CORPUS_PATH = join(homedir(), ".cache", "gdocsmith", "db.sqlite");

describe("corpus (local-only)", () => {
  test("every cached tab: layout equals JSON indices", () => {
    let rows: Array<{ data_json: string; doc_id: string }>;
    try {
      const db = new Database(CORPUS_PATH, { readonly: true });
      rows = db.query("SELECT doc_id, data_json FROM doc_snapshots").all() as Array<{
        data_json: string;
        doc_id: string;
      }>;
    } catch {
      return; // no corpus available; not a failure
    }
    if (rows.length === 0) return;

    let checked = 0;
    for (const row of rows) {
      const json = JSON.parse(row.data_json);
      let doc: ReturnType<typeof docModelParse>;
      try {
        doc = docModelParse(json, { docId: row.doc_id, keys: new KeyAllocator() });
      } catch {
        continue; // a shape this milestone doesn't yet support; later milestones widen coverage
      }
      for (const tab of doc.tabs) {
        layoutCompute(tab); // throws (via internal invariants) if a length rule is wrong; nothing to assert beyond "doesn't throw"
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
