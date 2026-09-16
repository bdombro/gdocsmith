/*

Unit tests for the sibling-tape parser.

*/
import { describe, expect, test } from "bun:test";
import { Gdoc } from "../gdoc.ts";
import { PARAGRAPH_STYLES } from "../styles.ts";
import { mockDoc } from "../test-fixtures.ts";
import { parseDocument, parseTape } from "./parse.ts";

describe("parseTape", () => {
  test("reads documentId, title, and revisionId from Gdoc", () => {
    const data = mockDoc([]);
    data.title = "Intent";
    data.revisionId = "rev-1";
    const tape = parseTape(new Gdoc(data, "doc-abc"));
    expect(tape.documentId).toBe("doc-abc");
    expect(tape.title).toBe("Intent");
    expect(tape.revisionId).toBe("rev-1");
    expect(tape.nodes).toEqual([]);
  });

  test("keeps empty headings with empty text and API bounds", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 10,
            paragraph: {
              elements: [{ textRun: { content: "Status\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
          {
            endIndex: 20,
            paragraph: {
              elements: [{ textRun: { content: "kept\n" } }],
            },
            startIndex: 10,
          },
          {
            endIndex: 21,
            paragraph: {
              elements: [{ textRun: { content: "\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 20,
          },
          {
            endIndex: 40,
            paragraph: {
              elements: [{ textRun: { content: "after empty\n" } }],
            },
            startIndex: 21,
          },
        ]),
        "doc",
      ),
    );
    const empty = tape.nodes.find((n) => n.start === 20);
    expect(empty).toMatchObject({
      end: 21,
      tapeIndex: 3,
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      start: 20,
      text: "",
    });
    expect(tape.nodes.map((n) => n.tapeIndex)).toEqual([1, 2, 3, 4]);
    expect(tape.nodes).toHaveLength(4);
  });

  test("heading with bullet stays a heading; namedStyleType wins", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 10,
            paragraph: {
              bullet: { glyph: "•", listId: "kix.list", nestingLevel: 0 },
              elements: [{ textRun: { content: "Agenda\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes).toEqual([
      {
        bullet: { listId: "kix.list", nestingLevel: 0 },
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        scopedId: "h.heading_1.f627",
        start: 1,
        text: "Agenda",
      },
    ]);
  });

  test("consecutive bullets stay separate nodes with nestingLevel", () => {
    const data = mockDoc([
      {
        endIndex: 10,
        paragraph: {
          bullet: { glyph: "•", listId: "kix.list", nestingLevel: 0 },
          elements: [{ textRun: { content: "Top\n" } }],
          paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
        },
        startIndex: 1,
      },
      {
        endIndex: 20,
        paragraph: {
          bullet: { glyph: "◦", listId: "kix.list", nestingLevel: 1 },
          elements: [{ textRun: { content: "Nested\n" } }],
          paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
        },
        startIndex: 10,
      },
    ]);
    data.lists = { "kix.list": { listProperties: { nestingLevels: [{}, {}] } } };
    const tape = parseTape(new Gdoc(data, "doc"));
    expect(tape.nodes.map((n) => ({ text: n.text, ...n.bullet }))).toEqual([
      { listId: "kix.list", nestingLevel: 0, text: "Top" },
      { listId: "kix.list", nestingLevel: 1, text: "Nested" },
    ]);
    expect(tape.nodes.every((n) => n.kind === "paragraph")).toBe(true);
  });

  test("fills listId from document.lists when bullet omits it", () => {
    const data = mockDoc([
      {
        endIndex: 10,
        paragraph: {
          bullet: { glyph: "•", nestingLevel: 0 },
          elements: [{ textRun: { content: "Item\n" } }],
        },
        startIndex: 1,
      },
    ]);
    data.lists = { "kix.only": { listProperties: { nestingLevels: [{}] } } };
    const tape = parseTape(new Gdoc(data, "doc"));
    expect(tape.nodes[0]?.bullet).toEqual({
      listId: "kix.only",
      nestingLevel: 0,
    });
  });

  test("surfaces list type (NUMBERED, BULLET, CHECKBOX) from listProperties", () => {
    const data = mockDoc([
      {
        endIndex: 10,
        paragraph: {
          bullet: { listId: "kix.num", nestingLevel: 0 },
          elements: [{ textRun: { content: "First\n" } }],
        },
        startIndex: 1,
      },
      {
        endIndex: 20,
        paragraph: {
          bullet: { listId: "kix.bul", nestingLevel: 0 },
          elements: [{ textRun: { content: "Dot\n" } }],
        },
        startIndex: 10,
      },
      {
        endIndex: 30,
        paragraph: {
          bullet: { listId: "kix.chk", nestingLevel: 0 },
          elements: [{ textRun: { content: "Box\n" } }],
        },
        startIndex: 20,
      },
    ]);
    data.lists = {
      "kix.num": { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } },
      "kix.bul": { listProperties: { nestingLevels: [{ glyphSymbol: "●" }] } },
      "kix.chk": { listProperties: { nestingLevels: [{ glyphSymbol: "❑" }] } },
    };
    const tape = parseTape(new Gdoc(data, "doc"));
    expect(tape.nodes[0]?.bullet?.type).toBe("NUMBERED");
    expect(tape.nodes[1]?.bullet?.type).toBe("BULLET");
    expect(tape.nodes[2]?.bullet?.type).toBe("CHECKBOX");
  });

  test("dumps uniform non-default italic, fontSize, and foregroundColor", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 40,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "Instruction tip.\n",
                    textStyle: {
                      fontSize: { magnitude: 10, unit: "PT" },
                      foregroundColor: {
                        color: { rgbColor: { blue: 0.6, green: 0.6, red: 0.6 } },
                      },
                      italic: true,
                    },
                  },
                },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
            },
            startIndex: 1,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.style).toEqual({
      fontSize: 10,
      foregroundColor: "#999999",
      italic: true,
    });
  });

  test("omits default 11pt black body chrome and mixed italic", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 20,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "Body\n",
                    textStyle: {
                      fontSize: { magnitude: 11, unit: "PT" },
                      foregroundColor: {
                        color: { rgbColor: { blue: 0, green: 0, red: 0 } },
                      },
                    },
                  },
                },
              ],
            },
            startIndex: 1,
          },
          {
            endIndex: 40,
            paragraph: {
              elements: [
                { textRun: { content: "plain ", textStyle: {} } },
                { textRun: { content: "emph\n", textStyle: { italic: true } } },
              ],
            },
            startIndex: 20,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.style).toBeUndefined();
    expect(tape.nodes[1]?.style).toBeUndefined();
  });

  test("includes SUBTITLE and TITLE as heading named styles", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 10,
            paragraph: {
              elements: [{ textRun: { content: "Doc title\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.TITLE },
            },
            startIndex: 1,
          },
          {
            endIndex: 20,
            paragraph: {
              elements: [{ textRun: { content: "Deck\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.SUBTITLE },
            },
            startIndex: 10,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes.map((n) => n.namedStyleType)).toEqual(["TITLE", "SUBTITLE"]);
  });

  test("populates headingId on paragraph nodes when present in paragraphStyle", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 15,
            paragraph: {
              elements: [{ textRun: { content: "Overview\n" } }],
              paragraphStyle: {
                headingId: "h.custom123",
                namedStyleType: PARAGRAPH_STYLES.HEADING_1,
              },
            },
            startIndex: 1,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.headingId).toBe("h.custom123");
  });

  test("copies indentStart as PT and flattens table cells", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 15,
            paragraph: {
              elements: [{ textRun: { content: "Quote\n" } }],
              paragraphStyle: {
                indentFirstLine: { unit: "PT" },
                indentStart: { magnitude: 36, unit: "PT" },
                namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT,
                alignment: "CENTER",
              },
            },
            startIndex: 1,
          },
          {
            endIndex: 50,
            startIndex: 15,
            table: {
              columns: 2,
              rows: 1,
              tableRows: [
                {
                  tableCells: [
                    {
                      content: [
                        {
                          endIndex: 20,
                          paragraph: {
                            elements: [{ textRun: { content: "A\n" } }],
                          },
                          startIndex: 16,
                        },
                      ],
                    },
                    {
                      content: [
                        {
                          endIndex: 26,
                          paragraph: {
                            elements: [{ textRun: { content: "B\n" } }],
                          },
                          startIndex: 20,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          {
            endIndex: 51,
            sectionBreak: {},
            startIndex: 50,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.indentStart).toEqual({ magnitude: 36, unit: "PT" });
    expect(tape.nodes[0]?.indentFirstLine).toEqual({ magnitude: 0, unit: "PT" });
    expect(tape.nodes[0]?.alignment).toBe("CENTER");
    expect(tape.nodes[1]).toMatchObject({
      kind: "table",
      table: {
        cells: [
          [
            { end: 20, start: 16, text: "A" },
            { end: 26, start: 20, text: "B" },
          ],
        ],
      },
    });
    expect(tape.nodes[2]?.kind).toBe("sectionBreak");
  });

  test("attaches table-cell inline images with row/col", () => {
    const data = mockDoc([
      {
        endIndex: 30,
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
                      endIndex: 12,
                      paragraph: {
                        elements: [
                          {
                            endIndex: 11,
                            inlineObjectElement: { inlineObjectId: "kix.cell" },
                            startIndex: 10,
                          },
                        ],
                      },
                      startIndex: 10,
                    },
                  ],
                },
                {
                  content: [
                    {
                      endIndex: 20,
                      paragraph: {
                        elements: [{ textRun: { content: "Name\n" } }],
                      },
                      startIndex: 12,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
    data.inlineObjects = {
      "kix.cell": {
        inlineObjectProperties: {
          embeddedObject: {
            size: { width: { magnitude: 80, unit: "PT" } },
          },
        },
      },
    };
    const tape = parseTape(new Gdoc(data, "doc"));
    expect(tape.nodes[0]).toMatchObject({
      images: [{ col: 0, objectId: "kix.cell", row: 0, widthPt: 80 }],
      kind: "table",
    });
  });

  test("surfaces smart chips in text, markup, and chips[]", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 40,
            paragraph: {
              elements: [
                { endIndex: 10, startIndex: 1, textRun: { content: "From " } },
                {
                  endIndex: 11,
                  richLink: {
                    richLinkId: "kix.chip",
                    richLinkProperties: {
                      mimeType: "application/vnd.google-apps.document",
                      title: "Unit template",
                      uri: "https://docs.google.com/document/d/abc/edit",
                    },
                  },
                  startIndex: 10,
                },
                { endIndex: 40, startIndex: 11, textRun: { content: "\n" } },
              ],
            },
            startIndex: 1,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]).toMatchObject({
      chips: [
        {
          richLinkId: "kix.chip",
          title: "Unit template",
          uri: "https://docs.google.com/document/d/abc/edit",
        },
      ],
      markup: "From [Unit template](https://docs.google.com/document/d/abc/edit)",
      text: "From Unit template",
    });
  });

  test("keeps plain text and adds markup when a run is linked", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 40,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "Project plan",
                    textStyle: { link: { url: "https://example.com/plan" } },
                  },
                },
                { textRun: { content: " (draft)\n" } },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]).toMatchObject({
      markup: "[Project plan](https://example.com/plan) (draft)",
      namedStyleType: "HEADING_2",
      text: "Project plan (draft)",
    });
  });

  test("attaches inline images with size from inlineObjects", () => {
    const data = mockDoc([
      {
        endIndex: 14,
        paragraph: {
          elements: [
            { endIndex: 12, startIndex: 10, textRun: { content: "Hi" } },
            {
              endIndex: 13,
              inlineObjectElement: { inlineObjectId: "kix.img" },
              startIndex: 12,
            },
            { endIndex: 14, startIndex: 13, textRun: { content: "\n" } },
          ],
        },
        startIndex: 10,
      },
    ]);
    data.inlineObjects = {
      "kix.img": {
        inlineObjectProperties: {
          embeddedObject: {
            size: {
              height: { magnitude: 200, unit: "PT" },
              width: { magnitude: 480, unit: "PT" },
            },
          },
        },
      },
    };
    const tape = parseTape(new Gdoc(data, "doc"));
    expect(tape.nodes[0]).toMatchObject({
      images: [{ heightPt: 200, objectId: "kix.img", start: 12, end: 13, widthPt: 480 }],
      text: "Hi",
    });
  });
});

describe("parseDocument", () => {
  test("parses header/footer/footnote as extra tapes with own tapeIndex space", () => {
    const data = mockDoc([
      {
        endIndex: 10,
        paragraph: { elements: [{ textRun: { content: "Body\n" } }] },
        startIndex: 1,
      },
    ]);
    data.documentStyle = { defaultHeaderId: "kix.h", defaultFooterId: "kix.f" };
    data.headers = {
      "kix.h": {
        headerId: "kix.h",
        content: [
          {
            endIndex: 8,
            paragraph: { elements: [{ textRun: { content: "CONFIDENTIAL\n" } }] },
            startIndex: 1,
          },
        ],
      },
    };
    data.footers = {
      "kix.f": {
        footerId: "kix.f",
        content: [
          {
            endIndex: 6,
            paragraph: { elements: [{ textRun: { content: "Page\n" } }] },
            startIndex: 1,
          },
        ],
      },
    };
    data.footnotes = {
      "kix.n": {
        footnoteId: "kix.n",
        content: [
          {
            endIndex: 9,
            paragraph: { elements: [{ textRun: { content: "See ref\n" } }] },
            startIndex: 1,
          },
        ],
      },
    };
    const doc = parseDocument(new Gdoc(data, "doc"));
    expect(doc.nodes[0]).toMatchObject({ tapeIndex: 1, text: "Body" });
    expect(doc.segments).toEqual([
      {
        kind: "header",
        segmentId: "kix.h",
        use: "default",
        nodes: [expect.objectContaining({ tapeIndex: 1, kind: "paragraph", text: "CONFIDENTIAL" })],
      },
      {
        kind: "footer",
        segmentId: "kix.f",
        use: "default",
        nodes: [expect.objectContaining({ tapeIndex: 1, kind: "paragraph", text: "Page" })],
      },
      {
        kind: "footnote",
        segmentId: "kix.n",
        nodes: [expect.objectContaining({ tapeIndex: 1, kind: "paragraph", text: "See ref" })],
      },
    ]);
  });

  test("keeps every paragraph in a table cell", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 40,
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
                          endIndex: 12,
                          paragraph: {
                            elements: [{ textRun: { content: "Photo\n" } }],
                          },
                          startIndex: 5,
                        },
                        {
                          endIndex: 24,
                          paragraph: {
                            elements: [{ textRun: { content: "caption\n" } }],
                          },
                          startIndex: 12,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.table?.cells[0]?.[0]).toMatchObject({
      text: "Photo",
      paragraphs: [
        { start: 5, end: 12, text: "Photo" },
        { start: 12, end: 24, text: "caption" },
      ],
    });
  });

  test("reports columnCount on sectionBreak and pageBreak kind", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 2,
            paragraph: { elements: [{ pageBreak: {}, startIndex: 1, endIndex: 2 }] },
            startIndex: 1,
          },
          {
            endIndex: 4,
            sectionBreak: { sectionStyle: { columnCount: 2 } },
            startIndex: 2,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.kind).toBe("pageBreak");
    expect(tape.nodes[1]).toMatchObject({ columnCount: 2, kind: "sectionBreak" });
  });

  test("parses tableOfContents kind", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 20,
            startIndex: 1,
            tableOfContents: {
              content: [
                {
                  endIndex: 20,
                  paragraph: { elements: [{ textRun: { content: "Heading 1... 1\n" } }] },
                  startIndex: 1,
                },
              ],
            },
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.kind).toBe("tableOfContents");
  });

  test("parses table columnWidth and cell chrome", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 40,
            startIndex: 10,
            table: {
              columns: 1,
              rows: 1,
              tableStyle: {
                tableColumnProperties: [
                  {
                    width: { magnitude: 500, unit: "PT" },
                    widthType: "FIXED_WIDTH",
                  },
                ],
              },
              tableRows: [
                {
                  tableRowStyle: {
                    minRowHeight: { magnitude: 20, unit: "PT" },
                    preventOverflow: true,
                    tableHeader: true,
                  },
                  tableCells: [
                    {
                      content: [
                        {
                          endIndex: 20,
                          paragraph: {
                            elements: [{ textRun: { content: "Status\n" } }],
                          },
                          startIndex: 12,
                        },
                      ],
                      tableCellStyle: {
                        contentAlignment: "TOP",
                        paddingTop: { magnitude: 5, unit: "PT" },
                        borderTop: {
                          color: {
                            color: {
                              rgbColor: { blue: 0.6, green: 0.6, red: 0.6 },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.table).toMatchObject({
      borderColor: "#999999",
      cellPadding: 5,
      columnWidth: 500,
      contentAlignment: "TOP",
      minRowHeight: 20,
      pinnedHeaderRows: 1,
      preventOverflow: true,
    });
  });

  test("detects monospace paragraphs as isCode", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 20,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "const a = 1;\n",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Courier New" },
                    },
                  },
                },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
            },
            startIndex: 1,
          },
          {
            endIndex: 40,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "return a;\n",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Roboto Mono" },
                    },
                  },
                },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
            },
            startIndex: 20,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.isCode).toBe(true);
    expect(tape.nodes[1]?.isCode).toBe(true);
  });

  test("does not flag headings, bullets, or mixed font paragraphs as isCode", () => {
    const tape = parseTape(
      new Gdoc(
        mockDoc([
          {
            endIndex: 20,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "Heading in Courier\n",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Courier New" },
                    },
                  },
                },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
          {
            endIndex: 40,
            paragraph: {
              bullet: { listId: "l1", nestingLevel: 0 },
              elements: [
                {
                  textRun: {
                    content: "Bullet item\n",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Courier New" },
                    },
                  },
                },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
            },
            startIndex: 20,
          },
          {
            endIndex: 70,
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "Run ",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Arial" },
                    },
                  },
                },
                {
                  textRun: {
                    content: "npm test",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Courier New" },
                    },
                  },
                },
                {
                  textRun: {
                    content: " now\n",
                    textStyle: {
                      weightedFontFamily: { fontFamily: "Arial" },
                    },
                  },
                },
              ],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
            },
            startIndex: 40,
          },
        ]),
        "doc",
      ),
    );
    expect(tape.nodes[0]?.isCode).toBeUndefined();
    expect(tape.nodes[1]?.isCode).toBeUndefined();
    expect(tape.nodes[2]?.isCode).toBeUndefined();
  });
});
