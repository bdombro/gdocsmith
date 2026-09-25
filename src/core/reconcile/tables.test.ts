/* Differential tests for table and section-break reconcile. */

import { describe, expect, test } from "bun:test";
import { blocksDelete, paragraphSplice, paragraphsInsert } from "../model/edit.ts";
import {
  cellStyleSet,
  cellsMerge,
  columnPropsSet,
  columnsDelete,
  columnsInsert,
  headerRowsPin,
  rowStyleSet,
  rowsDelete,
  rowsInsert,
  sectionBreakInsert,
  tableCreate,
} from "../model/editTables.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { SectionBreakBlock, TableBlock } from "../model/types.ts";
import { differentialRun } from "./testHarness.ts";

const para = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });
const doc = (blocks: BlockSpec[]) => docJsonBuild({ tabs: [{ blocks }] });
const kinds = (requests: JsonObject[]) => requests.map((r) => Object.keys(r)[0]);
const cellSpec = (text: string) => [{ content: text ? [text] : [] }];
const twoByTwo: BlockSpec = {
  cells: [
    [cellSpec("a1"), cellSpec("b1")],
    [cellSpec("a2"), cellSpec("b2")],
  ],
  kind: "table",
};
const tableOf = (t: { tab: { blocks: unknown[] } }) =>
  t.tab.blocks.find((b) => (b as TableBlock).kind === "table") as TableBlock;
const red = { color: { rgbColor: { red: 1 } } };

describe("new tables", () => {
  test("a new 2×3 table with content, after a kept paragraph (which keeps its empty paragraph before the table)", () => {
    const r = differentialRun(doc([para("before"), para("after")]), (t) =>
      tableCreate(t, 1, {
        rows: [
          [[{ ch: "a" }], [{ ch: "b" }], [{ ch: "c" }]],
          [[{ ch: "d" }], [], [{ ch: "f" }]],
        ],
      }),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toContain("insertTable");
  });

  test("a new paragraph right before a new table fills the paragraph the insert splits off", () => {
    const r = differentialRun(doc([para("before"), para("after")]), (t) => {
      paragraphsInsert(t, { kind: "body" }, 1, [{ syms: [{ ch: "intro" }] }]);
      tableCreate(t, 2, { rows: [[[{ ch: "x" }]]] });
    });
    expect(r.compare.diffs).toEqual([]);
    expect(r.final.tabs[0].blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "table", "paragraph"]);
  });

  test("a new table at the end of the body", () => {
    const r = differentialRun(doc([para("only")]), (t) =>
      tableCreate(t, 1, { rows: [[[{ ch: "x" }], [{ ch: "y" }]]] }),
    );
    expect(r.compare.diffs).toEqual([]);
  });

  test("merges, widths, cell and row styles, and header rows on a new table", () => {
    const r = differentialRun(doc([para("before"), para("after")]), (t) => {
      const key = tableCreate(t, 1, {
        rows: [
          [[{ ch: "h1" }], [{ ch: "h2" }]],
          [[{ ch: "x" }], []],
        ],
      });
      cellsMerge(t, key, { column: 0, columnSpan: 2, row: 1 });
      columnPropsSet(t, key, 0, { width: { magnitude: 120, unit: "PT" } });
      cellStyleSet(t, key, { column: 1, row: 0 }, { backgroundColor: red });
      headerRowsPin(t, key, 1);
    });
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual(
      expect.arrayContaining([
        "mergeTableCells",
        "updateTableColumnProperties",
        "updateTableCellStyle",
        "pinTableHeaderRows",
      ]),
    );
  });
});

describe("kept tables", () => {
  test("editing cells", () => {
    const r = differentialRun(doc([para("a"), twoByTwo, para("z")]), (t) => {
      const table = tableOf(t);
      paragraphSplice(t, table.rows[0].cells[1].blocks[0].key, 2, 0, [{ ch: "!" }]);
      paragraphSplice(t, table.rows[1].cells[0].blocks[0].key, 0, 2, [{ ch: "A2" }]);
    });
    expect(r.compare.diffs).toEqual([]);
  });

  test("row and column inserts and deletes, with the new cells filled", () => {
    const r = differentialRun(doc([para("a"), twoByTwo, para("z")]), (t) => {
      const table = tableOf(t);
      cellStyleSet(t, table.key, { column: 0, row: 0 }, { backgroundColor: red });
      rowsDelete(t, table.key, [1]);
      rowsInsert(t, table.key, 1, 2);
      columnsInsert(t, table.key, 0, 1);
      columnsDelete(t, table.key, [2]);
      paragraphSplice(t, table.rows[2].cells[0].blocks[0].key, 0, 0, [{ ch: "new" }]);
      paragraphSplice(t, table.rows[0].cells[0].blocks[0].key, 0, 0, [{ ch: "left" }]);
    });
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual(
      expect.arrayContaining(["deleteTableRow", "insertTableRow", "insertTableColumn", "deleteTableColumn"]),
    );
  });

  test("merging empty cells", () => {
    const empty: BlockSpec = {
      cells: [
        [cellSpec("head"), cellSpec("")],
        [cellSpec("a2"), cellSpec("b2")],
      ],
      kind: "table",
    };
    const r = differentialRun(doc([para("a"), empty, para("z")]), (t) =>
      cellsMerge(t, tableOf(t).key, { column: 0, columnSpan: 2, row: 0 }),
    );
    expect(r.compare.diffs).toEqual([]);
  });

  test("widths, cell styles, and row styles change in place", () => {
    const r = differentialRun(doc([para("a"), twoByTwo, para("z")]), (t) => {
      const key = tableOf(t).key;
      columnPropsSet(t, key, 1, { width: { magnitude: 80, unit: "PT" }, widthType: "FIXED_WIDTH" });
      cellStyleSet(t, key, { column: 0, columnSpan: 2, row: 1 }, { backgroundColor: red });
      rowStyleSet(t, key, [0], { minRowHeight: { magnitude: 30, unit: "PT" } });
    });
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual([
      "updateTableRowStyle",
      "updateTableCellStyle",
      "updateTableCellStyle",
      "updateTableColumnProperties",
    ]);
  });

  test("deleting a table", () => {
    const r = differentialRun(doc([para("a"), twoByTwo, para("z")]), (t, k) => blocksDelete(t, [k[1]]));
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual(["deleteContentRange"]);
  });
});

describe("section breaks", () => {
  test("inserting a continuous section break", () => {
    const r = differentialRun(doc([para("a"), para("b")]), (t) => sectionBreakInsert(t, 1, "CONTINUOUS"));
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toContain("insertSectionBreak");
  });

  test("changing a kept section break's columns", () => {
    const withBreak: BlockSpec[] = [
      para("a"),
      {
        kind: "sectionBreak",
        sectionStyle: { columnSeparatorStyle: "NONE", contentDirection: "LEFT_TO_RIGHT", sectionType: "CONTINUOUS" },
      },
      para("b"),
    ];
    const r = differentialRun(doc(withBreak), (t) => {
      const sb = t.tab.blocks[1] as SectionBreakBlock;
      sb.sectionStyle = { ...sb.sectionStyle, columnSeparatorStyle: "BETWEEN_EACH_COLUMN" };
    });
    expect(r.compare.diffs).toEqual([]);
    expect(r.requests).toMatchObject([
      { updateSectionStyle: { fields: "columnSeparatorStyle", range: { endIndex: 4, startIndex: 3 } } },
    ]);
  });
});
