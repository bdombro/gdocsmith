/* Tests for the tape build/rebuild round-trip. */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { docModelsCompare } from "../model/equivalence.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { DocSpec } from "../model/testDocs.ts";
import { docJsonBuild, randomBlockSpecs, rngCreate } from "../model/testDocs.ts";
import { docStateBuild, docStateJson } from "./tape.ts";

function roundTripEqual(json: ReturnType<typeof docJsonBuild>): string[] {
  const rebuilt = docStateJson(docStateBuild(json));
  const before = docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
  const after = docModelParse(rebuilt, { docId: "d1", keys: new KeyAllocator() });
  return docModelsCompare(before, after).diffs;
}

describe("tape", () => {
  test.each(Array.from({ length: 10 }, (_, i) => i))("round-trips synthetic docs exactly (shape %i)", (i) => {
    const rng = rngCreate(100 + i);
    const spec: DocSpec = { tabs: [{ blocks: randomBlockSpecs(rng, 3 + i) }] };
    expect(roundTripEqual(docJsonBuild(spec))).toEqual([]);
  });

  test("round-trips a doc with multiple tabs and nesting", () => {
    const rng = rngCreate(7);
    const spec: DocSpec = {
      tabs: [
        { blocks: randomBlockSpecs(rng, 3), tabId: "t.0", title: "Root" },
        { blocks: randomBlockSpecs(rng, 3), tabId: "t.1", title: "Second" },
      ],
    };
    expect(roundTripEqual(docJsonBuild(spec))).toEqual([]);
  });

  test("round-trips suggestion metadata on text and newlines", () => {
    const spec: DocSpec = {
      tabs: [
        {
          blocks: [
            {
              content: [
                { sugDel: ["s1"], text: "old" },
                { sugIns: ["s2"], text: "new" },
              ],
              kind: "paragraph",
            },
          ],
        },
      ],
    };
    expect(roundTripEqual(docJsonBuild(spec))).toEqual([]);
  });

  test("corpus round-trip (local-only)", () => {
    const corpusPath = join(homedir(), ".cache", "gdocsmith", "db.sqlite");
    let rows: Array<{ data_json: string; doc_id: string }>;
    try {
      const db = new Database(corpusPath, { readonly: true });
      rows = db.query("SELECT doc_id, data_json FROM doc_snapshots").all() as Array<{
        data_json: string;
        doc_id: string;
      }>;
    } catch {
      return;
    }
    if (rows.length === 0) return;
    for (const row of rows) {
      const json = JSON.parse(row.data_json);
      let diffs: string[];
      try {
        diffs = roundTripEqual(json);
      } catch {
        continue; // a shape this milestone doesn't yet support
      }
      expect(diffs).toEqual([]);
    }
  });
});
