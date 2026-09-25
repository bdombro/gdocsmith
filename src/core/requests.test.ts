/* Unit tests for RequestBuilder batchUpdate payload construction. */

import { describe, expect, test } from "bun:test";
import { RequestBuilder } from "./requests.ts";

describe("RequestBuilder", () => {
  test("buildTableFill inserts cell text in reverse index order", () => {
    const requests = RequestBuilder.buildTableFill(true, [["A", "B"]], {
      endIndex: 20,
      startIndex: 1,
      table: {
        columns: 2,
        rows: 1,
        tableRows: [
          {
            tableCells: [
              {
                content: [
                  {
                    endIndex: 8,
                    paragraph: { elements: [{ textRun: { content: "\n" } }] },
                    startIndex: 2,
                  },
                ],
              },
              {
                content: [
                  {
                    endIndex: 14,
                    paragraph: { elements: [{ textRun: { content: "\n" } }] },
                    startIndex: 8,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(requests.length).toBeGreaterThan(0);
  });

  test("buildTableFill inserts cell specials at cell start plus offset", () => {
    const requests = RequestBuilder.buildTableFill(
      false,
      [[""]],
      {
        endIndex: 20,
        startIndex: 1,
        table: {
          columns: 1,
          rows: 1,
          tableRows: [
            {
              tableCells: [
                {
                  content: [
                    {
                      endIndex: 8,
                      paragraph: { elements: [{ textRun: { content: "\n" } }] },
                      startIndex: 2,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      undefined,
      undefined,
      [[[{ email: "a@x.com", kind: "person", offset: 0 }]]],
    );
    expect(requests.some((r) => r && typeof r === "object" && "insertPerson" in r)).toBe(true);
  });

  test("deleteParagraphBullets stamps a range", () => {
    expect(RequestBuilder.deleteParagraphBullets(8, 19, "kix.h")).toEqual({
      deleteParagraphBullets: {
        range: { endIndex: 19, segmentId: "kix.h", startIndex: 8 },
      },
    });
  });

  test("replaceInnerText and applyStyle stamp segmentId", () => {
    expect(RequestBuilder.replaceInnerText(1, 8, "Hi", "kix.h")).toEqual([
      { deleteContentRange: { range: { endIndex: 7, segmentId: "kix.h", startIndex: 1 } } },
      { insertText: { location: { index: 1, segmentId: "kix.h" }, text: "Hi" } },
    ]);
  });

  test("addDocumentTab creates addDocumentTab request", () => {
    expect(RequestBuilder.addDocumentTab("New Tab", { index: 0 })).toEqual({
      addDocumentTab: {
        tabProperties: {
          index: 0,
          title: "New Tab",
        },
      },
    });
  });

  test("renameTab creates updateDocumentTabProperties request", () => {
    expect(RequestBuilder.renameTab("t.123", "Renamed")).toEqual({
      updateDocumentTabProperties: {
        fields: "title",
        tabProperties: {
          tabId: "t.123",
          title: "Renamed",
        },
      },
    });
  });

  test("moveTab creates updateDocumentTabProperties request with index", () => {
    expect(RequestBuilder.moveTab("t.123", 2)).toEqual({
      updateDocumentTabProperties: {
        fields: "index",
        tabProperties: {
          index: 2,
          tabId: "t.123",
        },
      },
    });
  });

  test("deleteTab creates deleteTab request", () => {
    expect(RequestBuilder.deleteTab("t.123")).toEqual({
      deleteTab: {
        tabId: "t.123",
      },
    });
  });

  test("replaceAllText creates replaceAllText request with and without tabIds", () => {
    expect(RequestBuilder.replaceAllText("{{NAME}}", "Alice")).toEqual({
      replaceAllText: {
        containsText: {
          matchCase: true,
          text: "{{NAME}}",
        },
        replaceText: "Alice",
      },
    });

    expect(
      RequestBuilder.replaceAllText("{{NAME}}", "Alice", {
        matchCase: false,
        tabIds: ["t.1", "t.2"],
      }),
    ).toEqual({
      replaceAllText: {
        containsText: {
          matchCase: false,
          text: "{{NAME}}",
        },
        replaceText: "Alice",
        tabsCriteria: {
          tabIds: ["t.1", "t.2"],
        },
      },
    });
  });

  test("applyStyle stamps segmentId", () => {
    expect(
      RequestBuilder.applyStyle({
        end: 8,
        patch: { alignment: "CENTER" },
        segmentId: "kix.h",
        start: 1,
      }),
    ).toEqual([
      {
        updateParagraphStyle: {
          fields: "alignment",
          paragraphStyle: { alignment: "CENTER" },
          range: { endIndex: 8, segmentId: "kix.h", startIndex: 1 },
        },
      },
    ]);
  });

  test("replaceInnerText and loc/rng stamp tabId", () => {
    expect(RequestBuilder.replaceInnerText(1, 8, "Hi", undefined, "t.0")).toEqual([
      { deleteContentRange: { range: { endIndex: 7, startIndex: 1, tabId: "t.0" } } },
      { insertText: { location: { index: 1, tabId: "t.0" }, text: "Hi" } },
    ]);
    expect(
      RequestBuilder.applyStyle({
        end: 8,
        patch: { alignment: "CENTER" },
        start: 1,
        tabId: "t.0",
      }),
    ).toEqual([
      {
        updateParagraphStyle: {
          fields: "alignment",
          paragraphStyle: { alignment: "CENTER" },
          range: { endIndex: 8, startIndex: 1, tabId: "t.0" },
        },
      },
    ]);
  });

  test("applyStyle hanging indent on bullets", () => {
    expect(
      RequestBuilder.applyStyle({
        end: 20,
        isBullet: true,
        patch: { indentStart: 18 },
        start: 1,
      }),
    ).toEqual([
      {
        updateParagraphStyle: {
          fields: "indentStart,indentFirstLine",
          paragraphStyle: {
            indentFirstLine: { magnitude: 0, unit: "PT" },
            indentStart: { magnitude: 18, unit: "PT" },
          },
          range: { endIndex: 20, startIndex: 1 },
        },
      },
    ]);
    expect(
      RequestBuilder.applyStyle({
        end: 20,
        isBullet: false,
        patch: { indentStart: 36 },
        start: 1,
      }),
    ).toEqual([
      {
        updateParagraphStyle: {
          fields: "indentStart",
          paragraphStyle: {
            indentStart: { magnitude: 36, unit: "PT" },
          },
          range: { endIndex: 20, startIndex: 1 },
        },
      },
    ]);
  });

  test("table-wide chrome uses tableStartLocation and FIXED_WIDTH", () => {
    expect(
      RequestBuilder.applyStyle({
        cellRanges: [{ end: 20, start: 12 }],
        end: 50,
        patch: {
          alignment: "START",
          borderColor: "#999999",
          columnWidth: 500,
          pinnedHeaderRows: 1,
          preventOverflow: true,
        },
        start: 10,
        tableStart: 10,
        tableWide: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          updateParagraphStyle: {
            fields: "alignment",
            paragraphStyle: { alignment: "START" },
            range: { endIndex: 20, startIndex: 12 },
          },
        },
        {
          updateTableColumnProperties: {
            fields: "widthType,width",
            tableColumnProperties: {
              width: { magnitude: 500, unit: "PT" },
              widthType: "FIXED_WIDTH",
            },
            tableStartLocation: { index: 10 },
          },
        },
        {
          pinTableHeaderRows: {
            pinnedHeaderRowsCount: 1,
            tableStartLocation: { index: 10 },
          },
        },
        {
          updateTableRowStyle: {
            fields: "preventOverflow",
            tableRowStyle: { preventOverflow: true },
            tableStartLocation: { index: 10 },
          },
        },
      ]),
    );
  });

  test("new REST methods create expected payloads", () => {
    expect(
      RequestBuilder.insertTableRow({
        columnIndex: 0,
        insertBelow: true,
        rowIndex: 1,
        tableStart: 10,
      }),
    ).toEqual({
      insertTableRow: {
        insertBelow: true,
        tableCellLocation: {
          columnIndex: 0,
          rowIndex: 1,
          tableStartLocation: { index: 10 },
        },
      },
    });

    expect(
      RequestBuilder.deleteTableRow({
        columnIndex: 0,
        rowIndex: 1,
        tableStart: 10,
      }),
    ).toEqual({
      deleteTableRow: {
        tableCellLocation: {
          columnIndex: 0,
          rowIndex: 1,
          tableStartLocation: { index: 10 },
        },
      },
    });

    expect(
      RequestBuilder.insertTableColumn({
        columnIndex: 1,
        insertRight: true,
        tableStart: 10,
      }),
    ).toEqual({
      insertTableColumn: {
        insertRight: true,
        tableCellLocation: {
          columnIndex: 1,
          rowIndex: 0,
          tableStartLocation: { index: 10 },
        },
      },
    });

    expect(
      RequestBuilder.deleteTableColumn({
        columnIndex: 1,
        tableStart: 10,
      }),
    ).toEqual({
      deleteTableColumn: {
        tableCellLocation: {
          columnIndex: 1,
          rowIndex: 0,
          tableStartLocation: { index: 10 },
        },
      },
    });

    expect(
      RequestBuilder.insertSectionBreak({
        index: 50,
        sectionType: "NEXT_PAGE",
      }),
    ).toEqual({
      insertSectionBreak: {
        location: { index: 50 },
        sectionType: "NEXT_PAGE",
      },
    });

    expect(
      RequestBuilder.insertPerson({
        email: "alice@example.com",
        index: 25,
      }),
    ).toEqual({
      insertPerson: {
        location: { index: 25 },
        personProperties: {
          email: "alice@example.com",
        },
      },
    });

    expect(
      RequestBuilder.insertRichLink({
        index: 30,
        uri: "https://docs.google.com",
      }),
    ).toEqual({
      insertRichLink: {
        location: { index: 30 },
        richLinkProperties: {
          uri: "https://docs.google.com",
        },
      },
    });

    expect(
      RequestBuilder.insertDate({
        dateFormat: "yyyy-MM-dd",
        displayText: "2026-09-15",
        index: 35,
        timestamp: "2026-09-15T00:00:00Z",
      }),
    ).toEqual({
      insertDate: {
        dateElementProperties: {
          dateFormat: "yyyy-MM-dd",
          displayText: "2026-09-15",
          timestamp: "2026-09-15T00:00:00Z",
        },
        location: { index: 35 },
      },
    });

    expect(
      RequestBuilder.createFootnote({
        index: 40,
      }),
    ).toEqual({
      createFootnote: {
        location: { index: 40 },
      },
    });

    expect(
      RequestBuilder.insertInlineImage({
        heightPt: 200,
        index: 45,
        uri: "https://example.com/logo.png",
        widthPt: 300,
      }),
    ).toEqual({
      insertInlineImage: {
        location: { index: 45 },
        objectSize: {
          height: { magnitude: 200, unit: "PT" },
          width: { magnitude: 300, unit: "PT" },
        },
        uri: "https://example.com/logo.png",
      },
    });

    expect(
      RequestBuilder.updateDocumentStyle({
        documentStyle: {
          marginTop: { magnitude: 72, unit: "PT" },
        },
        fields: "marginTop",
      }),
    ).toEqual({
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 72, unit: "PT" },
        },
        fields: "marginTop",
      },
    });
  });
});

describe("RequestBuilder v2 builders", () => {
  test("every location and range carries tabId; tab updates name the tab inside tabProperties", () => {
    const table = { columnIndex: 1, columnSpan: 2, rowIndex: 0, rowSpan: 1, tabId: "t.0", tableStart: 5 };
    expect(RequestBuilder.tableCellsMerge(table)).toEqual({
      mergeTableCells: {
        tableRange: {
          columnSpan: 2,
          rowSpan: 1,
          tableCellLocation: { columnIndex: 1, rowIndex: 0, tableStartLocation: { index: 5, tabId: "t.0" } },
        },
      },
    });
    expect(
      RequestBuilder.sectionStyleUpdate(0, 1, { marginTop: { magnitude: 1, unit: "PT" } }, ["marginTop"], "t.0"),
    ).toEqual({
      updateSectionStyle: {
        fields: "marginTop",
        range: { endIndex: 1, startIndex: 0, tabId: "t.0" },
        sectionStyle: { marginTop: { magnitude: 1, unit: "PT" } },
      },
    });
    expect(RequestBuilder.documentTabPropertiesUpdate("t.1", { title: "New" }, ["title"])).toEqual({
      updateDocumentTabProperties: { fields: "title", tabProperties: { tabId: "t.1", title: "New" } },
    });
    expect(RequestBuilder.documentTabAdd("Kid", { parentTabId: "t.0" })).toEqual({
      addDocumentTab: { tabProperties: { parentTabId: "t.0", title: "Kid" } },
    });
    expect(RequestBuilder.tableInsert(3, 2, 2, "t.0")).toEqual({
      insertTable: { columns: 2, location: { index: 3, tabId: "t.0" }, rows: 2 },
    });
  });
});
