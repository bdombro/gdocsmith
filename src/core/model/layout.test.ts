/* Tests for layoutCompute: verifies its independently-derived index ranges against testDocs.ts's independently-computed raw JSON indices. */

import { describe, expect, test } from "bun:test";
import { docModelParse } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { blockLength, layoutCompute } from "./layout.ts";
import type { BlockSpec, DocSpec } from "./testDocs.ts";
import { docJsonBuild, randomBlockSpecs, rngCreate } from "./testDocs.ts";
import type { TableBlock } from "./types.ts";

/** Recomputes every block/row/cell's JSON range straight from the raw doc's own startIndex/endIndex (ground truth, independent of both layout.ts and testDocs.ts's internal bookkeeping). */
function rawRangesCollect(json: ReturnType<typeof docJsonBuild>): { end: number; start: number }[] {
  const ranges: { end: number; start: number }[] = [];
  const tabs = (json as unknown as { tabs: Array<{ documentTab: { body: { content: unknown[] } } }> }).tabs;
  const walk = (content: unknown[]) => {
    for (const raw of content as Array<Record<string, unknown>>) {
      if (raw.startIndex !== undefined && raw.endIndex !== undefined) {
        ranges.push({ end: raw.endIndex as number, start: raw.startIndex as number });
      }
      const table = raw.table as { tableRows?: Array<Record<string, unknown>> } | undefined;
      for (const row of table?.tableRows ?? []) {
        if (row.startIndex !== undefined && row.endIndex !== undefined) {
          ranges.push({ end: row.endIndex as number, start: row.startIndex as number });
        }
        for (const cell of (row.tableCells as Array<Record<string, unknown>> | undefined) ?? []) {
          if (cell.startIndex !== undefined && cell.endIndex !== undefined) {
            ranges.push({ end: cell.endIndex as number, start: cell.startIndex as number });
          }
          walk((cell.content as unknown[] | undefined) ?? []);
        }
      }
    }
  };
  for (const tab of tabs) walk(tab.documentTab.body.content);
  return ranges;
}

function checkShape(spec: DocSpec) {
  const json = docJsonBuild(spec);
  const doc = docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
  const tab = doc.tabs[0];
  const layout = layoutCompute(tab);
  const gotRanges = [...layout.blockRanges.values(), ...layout.rowRanges.values(), ...layout.cellRanges.values()]
    .map((r) => `${r.start}-${r.end}`)
    .sort();
  const wantRanges = rawRangesCollect(json)
    .filter((r) => r.start !== 0)
    .map((r) => `${r.start}-${r.end}`)
    .sort();
  expect(gotRanges).toEqual(wantRanges);
}

describe("layoutCompute", () => {
  const rng = rngCreate(42);

  test.each(Array.from({ length: 10 }, (_, i) => i))("layout equals JSON indices (synthetic shape %i)", (i) => {
    checkShape({ tabs: [{ blocks: randomBlockSpecs(rng, 3 + i) }] });
  });

  test("empty 2x3 table length = 16", () => {
    const spec: BlockSpec = {
      cells: Array.from({ length: 2 }, () =>
        Array.from({ length: 3 }, () => [{ content: [], kind: "paragraph" as const }]),
      ),
      kind: "table",
    };
    const json = docJsonBuild({ tabs: [{ blocks: [spec] }] });
    const doc = docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
    expect(blockLength(doc.tabs[0].blocks[0])).toBe(16);
    expect((doc.tabs[0].blocks[0] as TableBlock).rows).toHaveLength(2);
  });
});
