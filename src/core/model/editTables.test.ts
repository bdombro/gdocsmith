/* Tests for table, section-break, and page-break editing primitives. */

import { describe, expect, test } from "bun:test";
import type { EditTarget } from "./edit.ts";
import { paragraphsInsert } from "./edit.ts";
import {
  cellStyleSet,
  cellsMerge,
  cellsUnmerge,
  columnsDelete,
  columnsInsert,
  headerRowsPin,
  pageBreakParagraphInsert,
  rowsDelete,
  rowsInsert,
  sectionBreakInsert,
  tableCreate,
} from "./editTables.ts";
import { docModelParse } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { type BlockSpec, docJsonBuild } from "./testDocs.ts";
import type { ParagraphBlock, TableBlock } from "./types.ts";

function targetBuild(blocks: BlockSpec[]): EditTarget {
  const keys = new KeyAllocator();
  const tab = docModelParse(docJsonBuild({ tabs: [{ blocks }] }), { docId: "d", keys }).tabs[0];
  return { ctx: { keys, stamp: { force: false, stepIndex: 2 }, tombstones: [] }, tab };
}

const twoByTwo: BlockSpec[] = [
  { content: ["a"], kind: "paragraph" },
  {
    cells: [
      [[{ content: ["a1"] }], [{ content: ["b1"] }]],
      [[{ content: ["a2"] }], [{ content: [] }]],
    ],
    kind: "table",
  },
  { content: ["z"], kind: "paragraph" },
];

describe("tableCreate", () => {
  test("after a kept paragraph, a new empty paragraph goes before the table (S1); defaults are the API's", () => {
    const target = targetBuild([{ content: ["kept"], kind: "paragraph" }]);
    tableCreate(target, 1, { alignments: [undefined, "CENTER"], rows: [[[{ ch: "x" }], [{ ch: "y" }]]] });
    expect(target.tab.blocks.map((b) => [b.kind, b.key[0]])).toEqual([
      ["paragraph", "o"],
      ["paragraph", "n"],
      ["table", "n"],
      ["paragraph", "n"],
    ]);
    const table = target.tab.blocks[2] as TableBlock;
    expect(table.columns.map((c) => c.props.width)).toEqual([
      { magnitude: 250, unit: "PT" },
      { magnitude: 250, unit: "PT" },
    ]);
    expect(table.rows[0].style).toEqual({ minRowHeight: { unit: "PT" } });
    expect(table.rows[0].cells[0].style).toMatchObject({ columnSpan: 1, contentAlignment: "TOP" });
    const cellParagraph = table.rows[0].cells[1].blocks[0];
    expect(cellParagraph).toMatchObject({ inlines: [{ text: "y" }], style: { alignment: "CENTER", lineSpacing: 100 } });
  });

  test("directly after a new paragraph, no extra paragraph is added", () => {
    const target = targetBuild([{ content: ["kept"], kind: "paragraph" }]);
    const [fresh] = paragraphsInsert(target, { kind: "body" }, 1, [{ syms: [{ ch: "intro" }] }]);
    tableCreate(target, 2, { rows: [[[]]] });
    expect(target.tab.blocks.map((b) => b.key)[1]).toBe(fresh);
    expect(target.tab.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "table", "paragraph"]);
  });
});

describe("table structure", () => {
  test("rowsInsert copies the reference row's and cells' styles; rowsDelete removes rows", () => {
    const target = targetBuild(twoByTwo);
    const table = target.tab.blocks[1] as TableBlock;
    cellStyleSet(target, table.key, { column: 0, row: 0 }, { backgroundColor: { color: { rgbColor: { red: 1 } } } });
    rowsInsert(target, table.key, 1, 1);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1].cells[0].style.backgroundColor).toEqual({
      color: { rgbColor: { blue: 0, green: 0, red: 1 } },
    });
    expect(table.rows[1].cells[0].blocks[0].inlines).toEqual([]);
    rowsDelete(target, table.key, [1]);
    expect(table.rows).toHaveLength(2);
    expect(() => rowsDelete(target, table.key, [0, 1])).toThrow(/blocksDelete/);
  });

  test("columnsInsert copies column props and cell styles; columnsDelete tombstones cell atoms", () => {
    const target = targetBuild(twoByTwo);
    const table = target.tab.blocks[1] as TableBlock;
    columnsInsert(target, table.key, 1, 2);
    expect(table.columns).toHaveLength(4);
    expect(table.rows.every((r) => r.cells.length === 4)).toBe(true);
    columnsDelete(target, table.key, [1, 2]);
    expect(
      table.rows[0].cells.map((c) =>
        (c.blocks[0] as ParagraphBlock).inlines.map((i) => (i.kind === "text" ? i.text : "")).join(""),
      ),
    ).toEqual(["a1", "b1"]);
  });

  test("merge refuses non-empty covered cells; merges set spans and the 21pt row height; unmerge writes 1x1", () => {
    const target = targetBuild(twoByTwo);
    const table = target.tab.blocks[1] as TableBlock;
    expect(() => cellsMerge(target, table.key, { column: 0, columnSpan: 2, row: 0 })).toThrow(/top-left/);
    expect(() => cellsMerge(target, table.key, { column: 0, row: 0, rowSpan: 2 })).toThrow(/top-left/);
    const merged = targetBuild(twoByTwo);
    const t2 = merged.tab.blocks[1] as TableBlock;
    cellsMerge(merged, t2.key, { column: 0, columnSpan: 2, row: 1 });
    expect(t2.rows[1].cells[0].style).toMatchObject({ columnSpan: 2, rowSpan: 1 });
    expect(t2.rows[1].style.minRowHeight).toEqual({ magnitude: 21, unit: "PT" });
    cellsUnmerge(merged, t2.key, { column: 0, row: 1 });
    expect(t2.rows[1].cells[0].style).toMatchObject({ columnSpan: 1, rowSpan: 1 });
  });

  test("headerRowsPin marks leading rows", () => {
    const target = targetBuild(twoByTwo);
    const table = target.tab.blocks[1] as TableBlock;
    headerRowsPin(target, table.key, 1);
    expect(table.rows.map((r) => r.style.tableHeader)).toEqual([true, undefined]);
  });
});

describe("breaks", () => {
  test("sectionBreakInsert adds its default style and a preceding new paragraph", () => {
    const target = targetBuild([{ content: ["a"], kind: "paragraph" }]);
    sectionBreakInsert(target, 1, "NEXT_PAGE");
    expect(target.tab.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "sectionBreak", "paragraph"]);
    expect(target.tab.blocks[2]).toMatchObject({
      create: { sectionType: "NEXT_PAGE" },
      sectionStyle: { columnSeparatorStyle: "NONE", contentDirection: "LEFT_TO_RIGHT", sectionType: "NEXT_PAGE" },
    });
  });

  test("a page break is its own paragraph, and a section break after it gets a fresh paragraph", () => {
    const target = targetBuild([{ content: ["a"], kind: "paragraph" }]);
    const key = pageBreakParagraphInsert(target, 1);
    expect((target.tab.blocks[1] as ParagraphBlock).inlines).toMatchObject([
      { create: { type: "pageBreak" }, type: "pageBreak" },
    ]);
    sectionBreakInsert(target, 2, "CONTINUOUS");
    expect(target.tab.blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "sectionBreak",
      "paragraph",
    ]);
    expect(target.tab.blocks[1].key).toBe(key);
  });
});
