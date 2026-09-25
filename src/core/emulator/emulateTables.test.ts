/* Tests for table structural request emulation: insert, delete, merge/unmerge, and style. */

import { describe, expect, test } from "bun:test";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import type { TableBlock } from "../model/types.ts";
import { requestsEmulate } from "./emulate.ts";

function parse(json: ReturnType<typeof docJsonBuild>) {
  return docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
}

function tableIn(json: ReturnType<typeof docJsonBuild>): TableBlock {
  const doc = parse(json);
  const table = doc.tabs[0].blocks.find((b) => b.kind === "table");
  if (!table) throw new Error("no table found");
  return table as TableBlock;
}

const twoByTwo = docJsonBuild({
  tabs: [
    {
      blocks: [
        {
          cells: [
            [[{ content: ["a1"] }], [{ content: ["b1"] }]],
            [[{ content: ["a2"] }], [{ content: ["b2"] }]],
          ],
          kind: "table",
        },
        { content: ["after"], kind: "paragraph" },
      ],
    },
  ],
});

const tableStartIndex = 1;

describe("emulateTables", () => {
  test("insertTable creates the right row/column indices", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["before"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [{ insertTable: { columns: 3, location: { index: 4 }, rows: 2 } }]);
    const table = tableIn(out);
    expect(table.rows).toHaveLength(2);
    expect(table.columns).toHaveLength(3);
    const doc = parse(out);
    expect(doc.tabs[0].blocks.map((b) => b.kind)).toEqual(["paragraph", "table", "paragraph"]);
  });

  test("insertTableRow below copies the reference row's and cells' style", () => {
    const { json: out } = requestsEmulate(twoByTwo, [
      {
        insertTableRow: {
          insertBelow: true,
          tableCellLocation: { rowIndex: 0, tableStartLocation: { index: tableStartIndex } },
        },
      },
    ]);
    const table = tableIn(out);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1].cells).toHaveLength(2);
  });

  test("insertTableColumn right copies the reference cell's style", () => {
    const { json: out } = requestsEmulate(twoByTwo, [
      {
        insertTableColumn: {
          insertRight: true,
          tableCellLocation: { columnIndex: 0, tableStartLocation: { index: tableStartIndex } },
        },
      },
    ]);
    const table = tableIn(out);
    expect(table.columns).toHaveLength(3);
    expect(table.rows[0].cells).toHaveLength(3);
    expect(table.rows[1].cells).toHaveLength(3);
  });

  test("deleteTableRow removes the row", () => {
    const { json: out } = requestsEmulate(twoByTwo, [
      { deleteTableRow: { tableCellLocation: { rowIndex: 0, tableStartLocation: { index: tableStartIndex } } } },
    ]);
    const table = tableIn(out);
    expect(table.rows).toHaveLength(1);
  });

  test("deleteTableColumn removes the column", () => {
    const { json: out } = requestsEmulate(twoByTwo, [
      { deleteTableColumn: { tableCellLocation: { columnIndex: 0, tableStartLocation: { index: tableStartIndex } } } },
    ]);
    const table = tableIn(out);
    expect(table.rows[0].cells).toHaveLength(1);
    expect(table.rows[1].cells).toHaveLength(1);
  });

  test("mergeTableCells then unmergeTableCells round-trips the span", () => {
    const merged = requestsEmulate(twoByTwo, [
      {
        mergeTableCells: {
          tableRange: {
            columnSpan: 2,
            rowSpan: 1,
            tableCellLocation: { columnIndex: 0, rowIndex: 0, tableStartLocation: { index: tableStartIndex } },
          },
        },
      },
    ]);
    const mergedTable = tableIn(merged.json);
    expect(mergedTable.rows[0].cells[0].style).toMatchObject({ columnSpan: 2, rowSpan: 1 });

    const unmerged = requestsEmulate(merged.json, [
      {
        unmergeTableCells: {
          tableRange: {
            columnSpan: 2,
            rowSpan: 1,
            tableCellLocation: { columnIndex: 0, rowIndex: 0, tableStartLocation: { index: tableStartIndex } },
          },
        },
      },
    ]);
    const unmergedTable = tableIn(unmerged.json);
    expect(unmergedTable.rows[0].cells[0].style.columnSpan).toBeUndefined();
    expect(unmergedTable.rows[0].cells[0].style.rowSpan).toBeUndefined();
  });

  test("updateTableCellStyle, updateTableRowStyle, updateTableColumnProperties, pinTableHeaderRows", () => {
    const step1 = requestsEmulate(twoByTwo, [
      {
        updateTableCellStyle: {
          fields: "backgroundColor",
          tableCellStyle: { backgroundColor: { color: { rgbColor: { blue: 0, green: 1, red: 0 } } } },
          tableRange: {
            columnSpan: 1,
            rowSpan: 1,
            tableCellLocation: { columnIndex: 0, rowIndex: 0, tableStartLocation: { index: tableStartIndex } },
          },
        },
      },
    ]);
    expect(tableIn(step1.json).rows[0].cells[0].style).toMatchObject({ backgroundColor: expect.anything() });

    const step2 = requestsEmulate(twoByTwo, [
      {
        updateTableRowStyle: {
          fields: "minRowHeight",
          rowIndices: [0],
          tableRowStyle: { minRowHeight: { magnitude: 30, unit: "PT" } },
          tableStartLocation: { index: tableStartIndex },
        },
      },
    ]);
    expect(tableIn(step2.json).rows[0].style).toMatchObject({ minRowHeight: { magnitude: 30, unit: "PT" } });

    const step3 = requestsEmulate(twoByTwo, [
      {
        updateTableColumnProperties: {
          columnIndices: [0],
          fields: "width",
          tableColumnProperties: { width: { magnitude: 200, unit: "PT" } },
          tableStartLocation: { index: tableStartIndex },
        },
      },
    ]);
    expect(tableIn(step3.json).columns[0].props).toMatchObject({ width: { magnitude: 200, unit: "PT" } });

    const step4 = requestsEmulate(twoByTwo, [
      { pinTableHeaderRows: { pinnedHeaderRowsCount: 1, tableStartLocation: { index: tableStartIndex } } },
    ]);
    expect(tableIn(step4.json)).toBeDefined();
  });
});
