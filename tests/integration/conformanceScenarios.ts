/* Live conformance scenarios (G3 M5): each builds a scratch doc, then sends one test batch whose result the emulator must reproduce. */

import { PARAGRAPH_STYLE_FIELDS } from "~/core/model/styleValues.ts";

/** Raw Docs API JSON, navigated loosely by scenarios. */
type Doc = any;
/** One request. */
type Req = Record<string, unknown>;

/** One scenario: setup batches (each built from the doc as it stands), then the batch under test. */
export interface Scenario {
  /** Fixture id. */ id: string;
  /** What the scenario checks. */ name: string;
  /** Setup batches, applied in order. */ setup?: Array<(j: Doc) => Req[]>;
  /** The batch under test, built from the doc after setup. */ test: (j: Doc) => Req[];
}

// --- request helpers ---
const ins = (index: number, text: string): Req => ({ insertText: { location: { index }, text } });
const del = (startIndex: number, endIndex: number): Req => ({
  deleteContentRange: { range: { endIndex, startIndex } },
});
const named = (startIndex: number, endIndex: number, namedStyleType: string): Req => ({
  updateParagraphStyle: {
    fields: "namedStyleType",
    paragraphStyle: { namedStyleType },
    range: { endIndex, startIndex },
  },
});
const bullets = (startIndex: number, endIndex: number, bulletPreset = "BULLET_DISC_CIRCLE_SQUARE"): Req => ({
  createParagraphBullets: { bulletPreset, range: { endIndex, startIndex } },
});
const unbullet = (startIndex: number, endIndex: number): Req => ({
  deleteParagraphBullets: { range: { endIndex, startIndex } },
});
const text = (startIndex: number, endIndex: number, textStyle: Req, fields: string): Req => ({
  updateTextStyle: { fields, range: { endIndex, startIndex }, textStyle },
});
const body = (j: Doc, tab = 0) => j.tabs[tab].documentTab.body.content;
const paras = (j: Doc) => body(j).filter((e: Doc) => e.paragraph);
const P = (j: Doc, i: number) => paras(j)[i];
const T = (j: Doc) => body(j).find((e: Doc) => e.table);
const cellLoc = (j: Doc, rowIndex: number, columnIndex: number) => ({
  columnIndex,
  rowIndex,
  tableStartLocation: { index: T(j).startIndex },
});
/** Styles paragraph i with namedStyles[i] (null = leave alone). */
const headings =
  (...names: (string | null)[]) =>
  (j: Doc): Req[] =>
    names.flatMap((n, i) => (n ? [named(P(j, i).startIndex, P(j, i).endIndex, n)] : []));
/** Fills every cell of the first table with the given texts (row-major), inserting from the end. */
const fillCells =
  (texts: string[]) =>
  (j: Doc): Req[] => {
    const cells = T(j).table.tableRows.flatMap((r: Doc) => r.tableCells);
    return cells.map((c: Doc, i: number) => ins(c.content[0].startIndex, texts[i])).reverse();
  };
const tableBase = [() => [ins(1, "Before"), { insertTable: { columns: 2, location: { index: 7 }, rows: 2 } }]];

const HW = [() => [ins(1, "Hello World"), named(1, 12, "HEADING_1")]];
const ABC = [() => [ins(1, "AAA\nBBB\nCCC")], headings("HEADING_1", "HEADING_2", "HEADING_3")];
const ABCD = [() => [ins(1, "AAA\nBBB\nCCC\nDDD")], headings("HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4")];

/** Every live conformance scenario, in recording order. */
export const SCENARIOS: Scenario[] = [
  // --- text + split identity ---
  {
    id: "C01a",
    name: "insert at bold/plain run boundary",
    setup: [() => [ins(1, "Hello"), text(1, 3, { bold: true }, "bold")]],
    test: () => [ins(3, "X")],
  },
  {
    id: "C01b",
    name: "insert at paragraph start before a bold run",
    setup: [() => [ins(1, "Hello"), text(1, 3, { bold: true }, "bold")]],
    test: () => [ins(1, "X")],
  },
  { id: "C02", name: "split heading mid", setup: HW, test: () => [ins(7, "\n")] },
  { id: "C03", name: "X\\n at heading start", setup: HW, test: () => [ins(1, "X\n")] },
  { id: "C04", name: "\\nX at heading end-1", setup: HW, test: () => [ins(12, "\nX")] },
  { id: "C04b", name: "two newlines mid heading", setup: HW, test: () => [ins(7, "\nmid\n")] },
  // --- merge identity (the four open questions + neighbors) ---
  {
    id: "C05",
    name: "delete mid-A through mid-B",
    setup: ABC,
    test: (j) => [del(P(j, 0).startIndex + 2, P(j, 1).startIndex + 1)],
  },
  {
    id: "C06",
    name: "delete whole middle paragraph B",
    setup: ABC,
    test: (j) => [del(P(j, 1).startIndex, P(j, 2).startIndex)],
  },
  {
    id: "M1",
    name: "delete whole first paragraph A",
    setup: ABC,
    test: (j) => [del(P(j, 0).startIndex, P(j, 1).startIndex)],
  },
  {
    id: "M2",
    name: "delete A.start through mid-B",
    setup: ABC,
    test: (j) => [del(P(j, 0).startIndex, P(j, 1).startIndex + 1)],
  },
  {
    id: "M3",
    name: "delete only A's newline (A non-empty)",
    setup: ABC,
    test: (j) => [del(P(j, 0).endIndex - 1, P(j, 0).endIndex)],
  },
  {
    id: "M4",
    name: "delete empty heading paragraph A (its only char is its newline)",
    setup: [() => [ins(1, "\nBBB\nCCC")], headings("HEADING_1", "HEADING_2", "HEADING_3")],
    test: (j) => [del(P(j, 0).startIndex, P(j, 0).endIndex)],
  },
  {
    id: "M5",
    name: "delete mid-A through mid-C (two boundaries)",
    setup: ABCD,
    test: (j) => [del(P(j, 0).startIndex + 1, P(j, 2).startIndex + 1)],
  },
  {
    id: "M6",
    name: "delete A.start through mid-C (two boundaries)",
    setup: ABCD,
    test: (j) => [del(P(j, 0).startIndex, P(j, 2).startIndex + 1)],
  },
  { id: "M7", name: "delete whole A and B", setup: ABCD, test: (j) => [del(P(j, 0).startIndex, P(j, 2).startIndex)] },
  {
    id: "M8",
    name: "delete mid-A through end of B's text (keep B's newline)",
    setup: ABC,
    test: (j) => [del(P(j, 0).startIndex + 1, P(j, 1).endIndex - 1)],
  },
  {
    id: "C07",
    name: "delete-last-paragraph trick (A.end-1 .. B.end-1, B last)",
    setup: [() => [ins(1, "AAA\nBBB")], headings("HEADING_1", "HEADING_2")],
    test: (j) => [del(P(j, 0).endIndex - 1, P(j, 1).endIndex - 1)],
  },
  // --- invalid deletes ---
  {
    id: "C08",
    name: "delete newline before a table (expect 400)",
    setup: [() => [ins(1, "A"), { insertTable: { columns: 1, location: { index: 2 }, rows: 1 } }]],
    test: (j) => [del(P(j, 0).endIndex - 1, P(j, 0).endIndex)],
  },
  {
    id: "C34",
    name: "split a surrogate pair (expect 400)",
    setup: [() => [ins(1, "a\u{1F600}b")]],
    test: () => [del(2, 3)],
  },
  {
    id: "C10d",
    name: "insertText at segment end (expect 400)",
    setup: [() => [ins(1, "A")]],
    test: () => [ins(3, "x")],
  },
  // --- style ranges / resets ---
  {
    id: "C09",
    name: "text style reset by omission incl. newline-only range",
    setup: [() => [ins(1, "AB"), text(1, 4, { bold: true, italic: true, underline: true }, "bold,italic,underline")]],
    test: () => [text(1, 3, {}, "bold"), text(3, 4, {}, "italic")],
  },
  {
    id: "C10a",
    name: "text style range to segment end",
    setup: [() => [ins(1, "A")]],
    test: () => [text(1, 3, { bold: true }, "bold")],
  },
  { id: "C10b", name: "bullets on the lone empty paragraph", test: () => [bullets(1, 2)] },
  {
    id: "C10c",
    name: "paragraph style on the lone empty paragraph",
    test: () => [
      {
        updateParagraphStyle: {
          fields: "alignment",
          paragraphStyle: { alignment: "CENTER" },
          range: { endIndex: 2, startIndex: 1 },
        },
      },
    ],
  },
  ...(["C11a", "C11b"] as const).map(
    (id): Scenario => ({
      id,
      name:
        id === "C11a"
          ? "paragraph full-mask reset with {}"
          : "paragraph full-mask reset with {namedStyleType: NORMAL_TEXT}",
      setup: [
        () => [
          ins(1, "Hello"),
          {
            updateParagraphStyle: {
              fields: "namedStyleType,alignment,spaceAbove,indentStart,lineSpacing",
              paragraphStyle: {
                alignment: "CENTER",
                indentStart: { magnitude: 30, unit: "PT" },
                lineSpacing: 150,
                namedStyleType: "HEADING_2",
                spaceAbove: { magnitude: 20, unit: "PT" },
              },
              range: { endIndex: 7, startIndex: 1 },
            },
          },
        ],
      ],
      test: () => [
        {
          updateParagraphStyle: {
            fields: PARAGRAPH_STYLE_FIELDS.join(","),
            paragraphStyle: id === "C11a" ? {} : { namedStyleType: "NORMAL_TEXT" },
            range: { endIndex: 7, startIndex: 1 },
          },
        },
      ],
    }),
  ),
  {
    id: "C12a",
    name: "heading -> SUBTITLE -> TITLE -> HEADING_2",
    setup: [() => [ins(1, "Hello"), named(1, 7, "HEADING_1")]],
    test: () => [named(1, 7, "SUBTITLE"), named(1, 7, "TITLE"), named(1, 7, "HEADING_2")],
  },
  {
    id: "C12b",
    name: "heading -> NORMAL_TEXT -> HEADING_3",
    setup: [() => [ins(1, "Hello"), named(1, 7, "HEADING_1")]],
    test: () => [named(1, 7, "NORMAL_TEXT"), named(1, 7, "HEADING_3")],
  },
  { id: "C30", name: "vertical tab (line break) inside a paragraph", test: () => [ins(1, "A\u000bB")] },
  // --- lists ---
  {
    id: "C14a",
    name: "bullets join preceding same-preset list",
    setup: [() => [ins(1, "A\nB\nC")], (j) => [bullets(P(j, 0).startIndex, P(j, 0).endIndex)]],
    test: (j) => [bullets(P(j, 1).startIndex, P(j, 1).endIndex)],
  },
  {
    id: "C14b",
    name: "bullets with a different preset start a new list",
    setup: [() => [ins(1, "A\nB\nC")], (j) => [bullets(P(j, 0).startIndex, P(j, 0).endIndex)]],
    test: (j) => [bullets(P(j, 1).startIndex, P(j, 1).endIndex, "NUMBERED_DECIMAL_ALPHA_ROMAN")],
  },
  {
    id: "C14c",
    name: "bullets join the FOLLOWING same-preset list?",
    setup: [() => [ins(1, "A\nB\nC")], (j) => [bullets(P(j, 1).startIndex, P(j, 1).endIndex)]],
    test: (j) => [bullets(P(j, 0).startIndex, P(j, 0).endIndex)],
  },
  {
    id: "C15",
    name: "split inside a list item keeps its bullet",
    setup: [() => [ins(1, "Hello World\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 0).endIndex)]],
    test: () => [ins(7, "\n")],
  },
  {
    id: "C16",
    name: "deleteParagraphBullets on nesting 2",
    setup: [() => [ins(1, "\t\tItem\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 0).endIndex)]],
    test: (j) => [unbullet(P(j, 0).startIndex, P(j, 0).endIndex)],
  },
  {
    id: "C17",
    name: "nest middle item via delete + tab + create; rejoins the list?",
    setup: [() => [ins(1, "A\nB\nC\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)]],
    test: (j) => [
      unbullet(P(j, 1).startIndex, P(j, 1).endIndex),
      ins(P(j, 1).startIndex, "\t"),
      bullets(P(j, 1).startIndex, P(j, 1).endIndex + 1),
    ],
  },
  {
    id: "C35",
    name: "bullets on an empty paragraph before a heading",
    setup: [() => [ins(1, "\nHeading")], headings(null, "HEADING_1")],
    test: () => [bullets(1, 2)],
  },
  // --- tables ---
  {
    id: "C18a",
    name: "insertTable at a heading's start",
    setup: HW,
    test: () => [{ insertTable: { columns: 1, location: { index: 1 }, rows: 1 } }],
  },
  {
    id: "C18b",
    name: "insertTable at start, then fill the cell in the same batch",
    setup: HW,
    test: () => [{ insertTable: { columns: 1, location: { index: 1 }, rows: 1 } }, ins(5, "X")],
  },
  {
    id: "C19",
    name: "insertTable at a heading's end-1",
    setup: HW,
    test: () => [{ insertTable: { columns: 1, location: { index: 12 }, rows: 1 } }],
  },
  {
    id: "C18c",
    name: "insertTable 2x2 structure + default styles",
    setup: [() => [ins(1, "Before")]],
    test: () => [{ insertTable: { columns: 2, location: { index: 7 }, rows: 2 } }],
  },
  ...(
    [
      [
        "C20a",
        "insertTableRow below row 0",
        (j: Doc) => [{ insertTableRow: { insertBelow: true, tableCellLocation: cellLoc(j, 0, 0) } }],
      ],
      [
        "C20b",
        "insertTableColumn right of col 0",
        (j: Doc) => [{ insertTableColumn: { insertRight: true, tableCellLocation: cellLoc(j, 0, 0) } }],
      ],
      ["C20c", "deleteTableRow 0", (j: Doc) => [{ deleteTableRow: { tableCellLocation: cellLoc(j, 0, 0) } }]],
      ["C20d", "deleteTableColumn 0", (j: Doc) => [{ deleteTableColumn: { tableCellLocation: cellLoc(j, 0, 0) } }]],
      [
        "C20e",
        "insertTableRow above row 1",
        (j: Doc) => [{ insertTableRow: { insertBelow: false, tableCellLocation: cellLoc(j, 1, 0) } }],
      ],
    ] as const
  ).map(
    ([id, name, test]): Scenario => ({
      id,
      name,
      setup: [
        ...tableBase,
        fillCells(["a1", "b1", "a2", "b2"]),
        (j) => [
          {
            updateTableCellStyle: {
              fields: "backgroundColor",
              tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 1 } } } },
              tableRange: { columnSpan: 1, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 0) },
            },
          },
          {
            updateTableCellStyle: {
              fields: "backgroundColor",
              tableCellStyle: { backgroundColor: { color: { rgbColor: { blue: 1 } } } },
              tableRange: { columnSpan: 1, rowSpan: 1, tableCellLocation: cellLoc(j, 1, 1) },
            },
          },
        ],
      ],
      test,
    }),
  ),
  {
    id: "C21a",
    name: "merge empty cells",
    setup: tableBase,
    test: (j) => [
      { mergeTableCells: { tableRange: { columnSpan: 2, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 0) } } },
    ],
  },
  {
    id: "C21b",
    name: "merge non-empty cells",
    setup: [...tableBase, fillCells(["a1", "b1", "a2", "b2"])],
    test: (j) => [
      { mergeTableCells: { tableRange: { columnSpan: 2, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 0) } } },
    ],
  },
  {
    id: "C21c",
    name: "unmerge",
    setup: [
      ...tableBase,
      fillCells(["a1", "b1", "a2", "b2"]),
      (j) => [{ mergeTableCells: { tableRange: { columnSpan: 2, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 0) } } }],
    ],
    test: (j) => [
      { unmergeTableCells: { tableRange: { columnSpan: 2, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 0) } } },
    ],
  },
  {
    id: "C22a",
    name: "updateTableCellStyle background",
    setup: tableBase,
    test: (j) => [
      {
        updateTableCellStyle: {
          fields: "backgroundColor",
          tableCellStyle: { backgroundColor: { color: { rgbColor: { green: 1 } } } },
          tableRange: { columnSpan: 1, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 1) },
        },
      },
    ],
  },
  {
    id: "C22b",
    name: "updateTableColumnProperties width",
    setup: tableBase,
    test: (j) => [
      {
        updateTableColumnProperties: {
          columnIndices: [0],
          fields: "width,widthType",
          tableColumnProperties: { width: { magnitude: 200, unit: "PT" }, widthType: "FIXED_WIDTH" },
          tableStartLocation: { index: T(j).startIndex },
        },
      },
    ],
  },
  {
    id: "C22c",
    name: "updateTableRowStyle minRowHeight",
    setup: tableBase,
    test: (j) => [
      {
        updateTableRowStyle: {
          fields: "minRowHeight",
          rowIndices: [0],
          tableRowStyle: { minRowHeight: { magnitude: 30, unit: "PT" } },
          tableStartLocation: { index: T(j).startIndex },
        },
      },
    ],
  },
  {
    id: "C22d",
    name: "pinTableHeaderRows",
    setup: tableBase,
    test: (j) => [{ pinTableHeaderRows: { pinnedHeaderRowsCount: 1, tableStartLocation: { index: T(j).startIndex } } }],
  },
  {
    id: "C32",
    name: "delete a whole table",
    setup: [
      () => [ins(1, "AA"), { insertTable: { columns: 1, location: { index: 3 }, rows: 1 } }],
      (j) => [ins(paras(j).at(-1).startIndex, "BB")],
    ],
    test: (j) => [del(T(j).startIndex, T(j).endIndex)],
  },
  {
    id: "C33a",
    name: "delete a table plus neighboring paragraph text",
    setup: [
      () => [ins(1, "AA"), { insertTable: { columns: 1, location: { index: 3 }, rows: 1 } }],
      (j) => [ins(paras(j).at(-1).startIndex, "BB")],
    ],
    test: (j) => [del(P(j, 0).startIndex + 1, paras(j).at(-1).startIndex + 1)],
  },
  {
    id: "C33b",
    name: "delete the newline before a table together with the table",
    setup: [
      () => [ins(1, "AA"), { insertTable: { columns: 1, location: { index: 3 }, rows: 1 } }],
      (j) => [ins(paras(j).at(-1).startIndex, "BB")],
    ],
    test: (j) => [del(P(j, 0).endIndex - 1, T(j).endIndex)],
  },
  // --- page / section breaks ---
  {
    id: "C23a",
    name: "insertPageBreak at heading start",
    setup: HW,
    test: () => [{ insertPageBreak: { location: { index: 1 } } }],
  },
  {
    id: "C23b",
    name: "insertPageBreak at heading end-1",
    setup: HW,
    test: () => [{ insertPageBreak: { location: { index: 12 } } }],
  },
  {
    id: "C24a",
    name: "insertSectionBreak CONTINUOUS at heading start",
    setup: HW,
    test: () => [{ insertSectionBreak: { location: { index: 1 }, sectionType: "CONTINUOUS" } }],
  },
  {
    id: "C24b",
    name: "insertSectionBreak NEXT_PAGE at heading end-1",
    setup: HW,
    test: () => [{ insertSectionBreak: { location: { index: 12 }, sectionType: "NEXT_PAGE" } }],
  },
  {
    id: "C24c",
    name: "updateSectionStyle columnCount (v1 shape)",
    setup: [
      () => [ins(1, "Hello World"), { insertSectionBreak: { location: { index: 6 }, sectionType: "CONTINUOUS" } }],
    ],
    test: (j) => {
      const sb = body(j)
        .slice(1)
        .find((e: Doc) => e.sectionBreak);
      return [
        {
          updateSectionStyle: {
            fields: "columnCount",
            range: { endIndex: sb.endIndex, startIndex: sb.startIndex },
            sectionStyle: { columnCount: 2 },
          },
        },
      ];
    },
  },
  {
    id: "C24d",
    name: "updateSectionStyle columnProperties",
    setup: [
      () => [ins(1, "Hello World"), { insertSectionBreak: { location: { index: 6 }, sectionType: "CONTINUOUS" } }],
    ],
    test: (j) => {
      const sb = body(j)
        .slice(1)
        .find((e: Doc) => e.sectionBreak);
      return [
        {
          updateSectionStyle: {
            fields: "columnProperties",
            range: { endIndex: sb.endIndex, startIndex: sb.startIndex },
            sectionStyle: { columnProperties: [{}, {}] },
          },
        },
      ];
    },
  },
  // --- atoms ---
  {
    id: "C25a",
    name: "insertPerson",
    setup: [() => [ins(1, "x")]],
    test: () => [{ insertPerson: { location: { index: 2 }, personProperties: { email: "someone@example.com" } } }],
  },
  {
    id: "C25b",
    name: "insertDate (v1 shape: dateElementProperties)",
    setup: [() => [ins(1, "x")]],
    test: () => [
      { insertDate: { dateElementProperties: { timestamp: "2026-01-15T00:00:00Z" }, location: { index: 2 } } },
    ],
  },
  {
    id: "C25c",
    name: "insertRichLink to a Drive doc",
    setup: [() => [ins(1, "x")]],
    test: (j) => [
      {
        insertRichLink: {
          location: { index: 2 },
          richLinkProperties: { uri: `https://docs.google.com/document/d/${j.documentId}/edit` },
        },
      },
    ],
  },
  {
    id: "C25d",
    name: "insertInlineImage from a public URL",
    setup: [() => [ins(1, "x")]],
    test: () => [
      {
        insertInlineImage: {
          location: { index: 2 },
          uri: "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png",
        },
      },
    ],
  },
  // --- links ---
  ...(
    [
      ["C26a", "link {url}", () => ({ url: "https://example.com" })],
      ["C26b", "link {tabId}", () => ({ tabId: "t.0" })],
      [
        "C26c",
        "link {heading: {id, tabId}}",
        (j: Doc) => ({ heading: { id: P(j, 0).paragraph.paragraphStyle.headingId, tabId: "t.0" } }),
      ],
      ["C26d", "link {headingId}", (j: Doc) => ({ headingId: P(j, 0).paragraph.paragraphStyle.headingId })],
    ] as const
  ).map(
    ([id, name, link]): Scenario => ({
      id,
      name,
      setup: [() => [ins(1, "Target\nLink"), named(1, 8, "HEADING_1")]],
      test: (j) => [text(P(j, 1).startIndex, P(j, 1).endIndex - 1, { link: link(j) }, "link")],
    }),
  ),
  // --- tabs / document style ---
  {
    id: "C27a",
    name: "addDocumentTab as child of t.0",
    test: () => [{ addDocumentTab: { tabProperties: { parentTabId: "t.0", title: "Child" } } }],
  },
  {
    id: "C27b",
    name: "rename a tab (tabId inside tabProperties)",
    setup: [() => [{ addDocumentTab: { tabProperties: { title: "Second" } } }]],
    test: (j) => [
      {
        updateDocumentTabProperties: {
          fields: "title",
          tabProperties: { tabId: j.tabs[1].tabProperties.tabId, title: "Renamed" },
        },
      },
    ],
  },
  {
    id: "C27c",
    name: "move a tab to index 0",
    setup: [() => [{ addDocumentTab: { tabProperties: { title: "Second" } } }]],
    test: (j) => [
      {
        updateDocumentTabProperties: {
          fields: "index",
          tabProperties: { index: 0, tabId: j.tabs[1].tabProperties.tabId },
        },
      },
    ],
  },
  {
    id: "C27d",
    name: "delete a tab that has a child",
    setup: [
      () => [{ addDocumentTab: { tabProperties: { title: "Parent" } } }],
      (j) => [{ addDocumentTab: { tabProperties: { parentTabId: j.tabs[1].tabProperties.tabId, title: "Kid" } } }],
    ],
    test: (j) => [{ deleteTab: { tabId: j.tabs[1].tabProperties.tabId } }],
  },
  {
    id: "C28",
    name: "updateDocumentStyle dotted + plain fields",
    test: () => [
      {
        updateDocumentStyle: {
          documentStyle: {
            marginTop: { magnitude: 100, unit: "PT" },
            pageSize: { width: { magnitude: 500, unit: "PT" } },
          },
          fields: "pageSize.width,marginTop",
        },
      },
    ],
  },

  // ===== follow-up probes =====
  // nesting change mechanics (C17 follow-ups): goal = B at nesting 1 in the same list as A and C
  {
    id: "N1",
    name: "nest B: separate batches (unbullet; tab; bullet B)",
    setup: [
      () => [ins(1, "A\nB\nC\nZ")],
      (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)],
      (j) => [unbullet(P(j, 1).startIndex, P(j, 1).endIndex)],
      (j) => [ins(P(j, 1).startIndex, "\t")],
    ],
    test: (j) => [bullets(P(j, 1).startIndex, P(j, 1).endIndex)],
  },
  {
    id: "N2",
    name: "nest B: tab only, no unbullet, bullet B",
    setup: [() => [ins(1, "A\nB\nC\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)]],
    test: (j) => [ins(P(j, 1).startIndex, "\t"), bullets(P(j, 1).startIndex, P(j, 1).endIndex + 1)],
  },
  {
    id: "N3",
    name: "nest B: tab, re-bullet the whole list range",
    setup: [() => [ins(1, "A\nB\nC\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)]],
    test: (j) => [ins(P(j, 1).startIndex, "\t"), bullets(P(j, 0).startIndex, P(j, 2).endIndex + 1)],
  },
  {
    id: "N4",
    name: "nest B: unbullet whole list, tab, re-bullet whole list",
    setup: [() => [ins(1, "A\nB\nC\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)]],
    test: (j) => [
      unbullet(P(j, 0).startIndex, P(j, 2).endIndex),
      ins(P(j, 1).startIndex, "\t"),
      bullets(P(j, 0).startIndex, P(j, 2).endIndex + 1),
    ],
  },
  {
    id: "N5",
    name: "nest B: two tabs, unbullet B, bullet B",
    setup: [() => [ins(1, "A\nB\nC\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)]],
    test: (j) => [
      unbullet(P(j, 1).startIndex, P(j, 1).endIndex),
      ins(P(j, 1).startIndex, "\t\t"),
      bullets(P(j, 1).startIndex, P(j, 1).endIndex + 2),
    ],
  },
  {
    id: "N6",
    name: "new tabbed item appended after a list (C, then new \\tD bulleted)",
    setup: [() => [ins(1, "A\nB\nC\nZ")], (j) => [bullets(P(j, 0).startIndex, P(j, 2).endIndex)]],
    test: (j) => [ins(P(j, 2).endIndex - 1, "\n\tD"), bullets(P(j, 2).endIndex, P(j, 2).endIndex + 3)],
  },
  // text style: when does a range restyle the paragraph's newline?
  {
    id: "S1",
    name: "unbold only the first char (does the newline keep bold?)",
    setup: [() => [ins(1, "AB"), text(1, 4, { bold: true }, "bold")]],
    test: () => [text(1, 2, {}, "bold")],
  },
  {
    id: "S2",
    name: "bold all text but not the newline (does the newline become bold?)",
    setup: [() => [ins(1, "AB")]],
    test: () => [text(1, 3, { bold: true }, "bold")],
  },
  {
    id: "S3",
    name: "bold all text of a middle paragraph",
    setup: [() => [ins(1, "AB\nCD\nEF")]],
    test: (j) => [text(P(j, 1).startIndex, P(j, 1).endIndex - 1, { bold: true }, "bold")],
  },
  // link chrome
  {
    id: "L1",
    name: "link with explicit underline:false + black color in the same mask",
    setup: [() => [ins(1, "Link")]],
    test: () => [
      text(
        1,
        5,
        { foregroundColor: { color: { rgbColor: {} } }, link: { url: "https://example.com" }, underline: false },
        "link,underline,foregroundColor",
      ),
    ],
  },
  {
    id: "L2",
    name: "link on text that already has explicit underline:false",
    setup: [() => [ins(1, "Link"), text(1, 5, { underline: false }, "underline")]],
    test: () => [text(1, 5, { link: { url: "https://example.com" } }, "link")],
  },
  {
    id: "L3",
    name: "remove a link (mask link, no value): does chrome stay?",
    setup: [() => [ins(1, "Link"), text(1, 5, { link: { url: "https://example.com" } }, "link")]],
    test: () => [text(1, 5, {}, "link")],
  },
  // merge survivor carries the bullet too?
  {
    id: "B1",
    name: "merge bulleted A with plain B from mid-A",
    setup: [() => [ins(1, "AAA\nBBB\nCCC")], (j) => [bullets(P(j, 0).startIndex, P(j, 0).endIndex)]],
    test: (j) => [del(P(j, 0).startIndex + 1, P(j, 1).startIndex + 1)],
  },
  {
    id: "B2",
    name: "merge plain A with bulleted B from A.start",
    setup: [() => [ins(1, "AAA\nBBB\nCCC")], (j) => [bullets(P(j, 1).startIndex, P(j, 1).endIndex)]],
    test: (j) => [del(P(j, 0).startIndex, P(j, 1).startIndex + 1)],
  },
  // section columns
  {
    id: "K1",
    name: "updateSectionStyle two columns with padding",
    setup: [
      () => [ins(1, "Hello World"), { insertSectionBreak: { location: { index: 6 }, sectionType: "CONTINUOUS" } }],
    ],
    test: (j) => {
      const sb = body(j)
        .slice(1)
        .find((e: Doc) => e.sectionBreak);
      return [
        {
          updateSectionStyle: {
            fields: "columnProperties",
            range: { endIndex: sb.endIndex, startIndex: sb.startIndex },
            sectionStyle: {
              columnProperties: [
                { paddingEnd: { magnitude: 36, unit: "PT" } },
                { paddingEnd: { magnitude: 0, unit: "PT" } },
              ],
            },
          },
        },
      ];
    },
  },
  {
    id: "K2",
    name: "updateSectionStyle on the leading section (index 0..1)",
    setup: [() => [ins(1, "Hello")]],
    test: () => [
      {
        updateSectionStyle: {
          fields: "marginTop",
          range: { endIndex: 1, startIndex: 0 },
          sectionStyle: { marginTop: { magnitude: 20, unit: "PT" } },
        },
      },
    ],
  },
  // table inserted into styled text: what do the new cells inherit?
  {
    id: "T1",
    name: "insertTable at end-1 of a bold normal paragraph",
    setup: [() => [ins(1, "Hello"), text(1, 7, { bold: true }, "bold")]],
    test: () => [{ insertTable: { columns: 1, location: { index: 6 }, rows: 1 } }],
  },
  {
    id: "T2",
    name: "merge 3 non-empty cells incl. a multi-paragraph one",
    setup: [
      () => [ins(1, "Before"), { insertTable: { columns: 3, location: { index: 7 }, rows: 1 } }],
      (j) => {
        const cells = T(j).table.tableRows[0].tableCells;
        return [
          ins(cells[2].content[0].startIndex, "c1\nc2"),
          ins(cells[1].content[0].startIndex, "b"),
          ins(cells[0].content[0].startIndex, "a"),
        ];
      },
    ],
    test: (j) => [
      { mergeTableCells: { tableRange: { columnSpan: 3, rowSpan: 1, tableCellLocation: cellLoc(j, 0, 0) } } },
    ],
  },
];
