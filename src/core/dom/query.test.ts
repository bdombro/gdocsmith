/* Unit tests for tape querySelector / siblings / findHeadingsByText. */

import { describe, expect, test } from "bun:test";
import { Gdoc } from "../gdoc.ts";
import { PARAGRAPH_STYLES } from "../styles.ts";
import { mockDoc } from "../testFixtures.ts";
import { DocDom, followingSiblingsFormat, neighborhoodFrom } from "./query.ts";
import type { DocNode } from "./types.ts";

function sampleDom() {
  return DocDom.from(
    new Gdoc(
      mockDoc([
        {
          endIndex: 2,
          sectionBreak: {},
          startIndex: 1,
        },
        {
          endIndex: 12,
          paragraph: {
            elements: [{ textRun: { content: "Intent\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.TITLE },
          },
          startIndex: 2,
        },
        {
          endIndex: 22,
          paragraph: {
            elements: [{ textRun: { content: "Status\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
          },
          startIndex: 12,
        },
        {
          endIndex: 40,
          paragraph: {
            elements: [{ textRun: { content: "In progress.\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
          },
          startIndex: 22,
        },
        {
          endIndex: 50,
          paragraph: {
            bullet: { glyph: "•", listId: "kix.list", nestingLevel: 0 },
            elements: [{ textRun: { content: "Field\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
          },
          startIndex: 40,
        },
        {
          endIndex: 60,
          paragraph: {
            bullet: { glyph: "◦", listId: "kix.list", nestingLevel: 1 },
            elements: [{ textRun: { content: "Nested\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
          },
          startIndex: 50,
        },
        {
          endIndex: 70,
          paragraph: {
            elements: [{ textRun: { content: "Approach\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
          },
          startIndex: 60,
        },
        {
          endIndex: 90,
          paragraph: {
            elements: [{ textRun: { content: "Design details.\n" } }],
            paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
          },
          startIndex: 70,
        },
        {
          endIndex: 120,
          startIndex: 90,
          table: {
            columns: 1,
            rows: 1,
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        endIndex: 100,
                        paragraph: {
                          elements: [{ textRun: { content: "cell\n" } }],
                        },
                        startIndex: 91,
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
}

describe("DocDom query", () => {
  test("HEADING_2 + NORMAL_TEXT selects the paragraph after the heading", () => {
    const dom = sampleDom();
    const hits = dom.querySelectorAll("HEADING_2 + NORMAL_TEXT");
    expect(hits.map((n) => n.text)).toEqual(["In progress.", "Design details."]);
    expect(dom.querySelector("HEADING_2 + NORMAL_TEXT")?.start).toBe(22);
  });

  test("NORMAL_TEXT[bullet] selects list items, not grouped ul nodes", () => {
    const dom = sampleDom();
    const hits = dom.querySelectorAll("NORMAL_TEXT[bullet]");
    expect(hits.map((n) => ({ text: n.text, nest: n.bullet?.nestingLevel }))).toEqual([
      { nest: 0, text: "Field" },
      { nest: 1, text: "Nested" },
    ]);
  });

  test("heading matches TITLE, SUBTITLE, and HEADING_*", () => {
    const dom = sampleDom();
    expect(dom.querySelectorAll("heading").map((n) => n.text)).toEqual(["Intent", "Status", "Approach"]);
    expect(dom.querySelector("TITLE")?.text).toBe("Intent");
  });

  test(":not([bullet]) and [bullet] filter paragraphs", () => {
    const dom = sampleDom();
    expect(dom.querySelectorAll("NORMAL_TEXT:not([bullet])").map((n) => n.text)).toEqual([
      "In progress.",
      "Design details.",
    ]);
    expect(dom.querySelectorAll("[bullet]")).toHaveLength(2);
  });

  test(":first-of-type and :nth-of-type among body siblings", () => {
    const dom = sampleDom();
    expect(dom.querySelector("HEADING_2:first-of-type")?.text).toBe("Status");
    expect(dom.querySelector("HEADING_2:nth-of-type(2)")?.text).toBe("Approach");
    expect(dom.querySelector("paragraph:nth-of-type(1)")?.text).toBe("Intent");
    expect(dom.querySelector("table:first-of-type")?.kind).toBe("table");
  });

  test("nextElementSibling and previousElementSibling walk the tape", () => {
    const dom = sampleDom();
    const status = dom.querySelector("HEADING_2")!;
    const next = dom.nextElementSibling(status);
    expect(next?.text).toBe("In progress.");
    expect(dom.previousElementSibling(next!)?.text).toBe("Status");
    expect(dom.previousElementSibling(dom.nodes[0]!)).toBeNull();
  });

  test("chained + walks further siblings after a heading", () => {
    const dom = sampleDom();
    expect(dom.querySelector("HEADING_2 + NORMAL_TEXT + NORMAL_TEXT")?.text).toBe("Field");
  });

  test(":nth-sibling is heading-relative, not document-global", () => {
    const dom = sampleDom();
    expect(dom.querySelector("HEADING_2 + NORMAL_TEXT:nth-sibling(3)")?.text).toBe("Nested");
    const status = dom.findHeadingsByText("Status");
    expect(dom.queryFrom(status, "HEADING_2 + NORMAL_TEXT:nth-sibling(2)").map((n) => n.text)).toEqual(["Field"]);
  });

  test("~ skips non-matching siblings until the next same-or-higher heading", () => {
    const dom = sampleDom();
    expect(dom.querySelectorAll("HEADING_2 ~ NORMAL_TEXT[bullet]:nth(1)").map((n) => n.text)).toEqual(["Field"]);
    expect(dom.querySelectorAll("HEADING_2 ~ NORMAL_TEXT:nth(1)").map((n) => n.text)).toEqual([
      "In progress.",
      "Design details.",
    ]);
    const status = dom.findHeadingsByText("Status");
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT[bullet]:nth(1)").map((n) => n.text)).toEqual(["Field"]);
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT[bullet]").map((n) => n.text)).toEqual(["Field", "Nested"]);
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT:nth(4)")).toEqual([]);
    expect(dom.querySelector("HEADING_2~NORMAL_TEXT:nth(1)")?.text).toBe("In progress.");
  });

  /** Tests filtering bullets by nestingLevel using [bullet:N], [level=N], or :level(N). */
  test("filters bullets by nestingLevel using [bullet:N], [level=N], or :level(N)", () => {
    const dom = sampleDom();
    const status = dom.findHeadingsByText("Status");
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT[bullet:1]").map((n) => n.text)).toEqual(["Nested"]);
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT[level=1]").map((n) => n.text)).toEqual(["Nested"]);
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT:level(1)").map((n) => n.text)).toEqual(["Nested"]);
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT[level=0]").map((n) => n.text)).toEqual(["Field"]);
  });

  test("~ does not leak into the next same-level heading", () => {
    const dom = sampleDom();
    const status = dom.findHeadingsByText("Status");
    expect(dom.queryFrom(status, "HEADING_2 ~ NORMAL_TEXT").map((n) => n.text)).toEqual([
      "In progress.",
      "Field",
      "Nested",
    ]);
    expect(dom.querySelectorAll("HEADING_2 ~ HEADING_2")).toEqual([]);
  });

  test("~ from a heading includes nested deeper headings", () => {
    const nested = new DocDom([
      {
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 1,
        text: "Parent",
      },
      {
        end: 20,
        tapeIndex: 10,
        kind: "paragraph",
        namedStyleType: "HEADING_3",
        start: 10,
        text: "Child",
      },
      {
        end: 30,
        tapeIndex: 20,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "Body",
      },
      {
        end: 40,
        tapeIndex: 30,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 30,
        text: "Next",
      },
    ]);
    expect(nested.querySelectorAll("HEADING_2 ~ HEADING_3:nth(1)").map((n) => n.text)).toEqual(["Child"]);
    expect(
      nested.queryFrom(nested.findHeadingsByText("Parent"), "HEADING_2 ~ NORMAL_TEXT:nth(1)").map((n) => n.text),
    ).toEqual(["Body"]);
  });

  test("~ rejects :nth-sibling; + rejects :nth", () => {
    const dom = sampleDom();
    expect(() => dom.querySelector("HEADING_2 ~ NORMAL_TEXT:nth-sibling(2)")).toThrow(
      /:nth-sibling\(n\) counts every following sibling/,
    );
    expect(() => dom.querySelector("HEADING_2 + NORMAL_TEXT:nth(1)")).toThrow(/:nth\(n\) is for ~/);
    expect(() => dom.querySelector("NORMAL_TEXT:nth(1)")).toThrow(/relative to the previous combinator/);
  });

  test(":contains matches body text; :empty matches blank paragraphs", () => {
    const dom = sampleDom();
    expect(dom.querySelector("NORMAL_TEXT:contains(Design details)")?.text).toBe("Design details.");
    expect(dom.querySelectorAll(":contains(Status)").map((n) => n.namedStyleType)).toEqual(["HEADING_2"]);

    const blank: DocNode = {
      end: 3,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 2,
      text: "",
    };
    const heading: DocNode = {
      end: 12,
      tapeIndex: 3,
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      start: 3,
      text: "Status",
    };
    const emptyDom = new DocDom([heading, blank]);
    expect(emptyDom.querySelectorAll("NORMAL_TEXT:empty")).toHaveLength(1);
    expect(emptyDom.querySelector("heading:empty")).toBeNull();
  });

  test("[image] matches paragraphs with inline images; :empty does not", () => {
    const withImage: DocNode = {
      end: 12,
      tapeIndex: 1,
      images: [{ end: 11, objectId: "kix.img", start: 10 }],
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 10,
      text: "",
    };
    const blank: DocNode = {
      end: 14,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 12,
      text: "",
    };
    const dom = new DocDom([withImage, blank]);
    expect(dom.querySelectorAll("[image]").map((n) => n.tapeIndex)).toEqual([1]);
    expect(dom.querySelectorAll(":not([image])").map((n) => n.tapeIndex)).toEqual([2]);
    expect(dom.querySelectorAll("NORMAL_TEXT:empty").map((n) => n.tapeIndex)).toEqual([2]);
  });

  test(":last-child and * match tape nodes", () => {
    const dom = sampleDom();
    expect(dom.querySelector(":last-child")?.kind).toBe("table");
    expect(dom.querySelector("HEADING_2 + *")?.text).toBe("In progress.");
  });

  test("rejects descendant combinator", () => {
    const dom = sampleDom();
    expect(() => dom.querySelector("HEADING_2 NORMAL_TEXT")).toThrow(/Descendant combinator/);
  });

  test("heading with bullet matches heading, not a list group", () => {
    const dom = DocDom.from(
      new Gdoc(
        mockDoc([
          {
            endIndex: 10,
            paragraph: {
              bullet: { glyph: "•", nestingLevel: 0 },
              elements: [{ textRun: { content: "Agenda\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
          {
            endIndex: 20,
            paragraph: {
              bullet: { glyph: "•", nestingLevel: 0 },
              elements: [{ textRun: { content: "Item\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.NORMAL_TEXT },
            },
            startIndex: 10,
          },
        ]),
        "doc",
      ),
    );
    expect(dom.querySelector("heading[bullet]")?.text).toBe("Agenda");
    expect(dom.querySelector("HEADING_2")?.namedStyleType).toBe("HEADING_2");
    expect(dom.querySelectorAll("NORMAL_TEXT[bullet]").map((n) => n.text)).toEqual(["Item"]);
  });

  /** Tests that followingSiblingsFormat formats nested bullet levels accurately. */
  test("followingSiblingsFormat includes nestingLevel annotation for nested bullets", () => {
    const dom = sampleDom();
    const status = dom.findHeadingsByText("Status");
    const dump = followingSiblingsFormat(dom.nodes, status);
    expect(dump).toContain('NORMAL_TEXT[bullet] "Field"');
    expect(dump).toContain('NORMAL_TEXT[bullet:1] "Nested"');
  });
});

describe("findHeadingsByText", () => {
  test("matches unique substring and exact title", () => {
    const dom = sampleDom();
    expect(dom.findHeadingsByText("Status").text).toBe("Status");
    expect(dom.findHeadingsByText("approach", { match: "substr" }).text).toBe("Approach");
  });

  test("throws on same-level duplicate titles unless at is passed", () => {
    const dom = DocDom.from(
      new Gdoc(
        mockDoc([
          {
            endIndex: 10,
            paragraph: {
              elements: [{ textRun: { content: "The three templates\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
          {
            endIndex: 20,
            paragraph: {
              elements: [{ textRun: { content: "The three templates\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 10,
          },
        ]),
        "doc",
      ),
    );
    expect(() => dom.findHeadingsByText("The three templates")).toThrow(/Duplicate heading/);
    expect(dom.findHeadingsByText("The three templates", { at: 2 }).tapeIndex).toBe(2);
    expect(dom.findHeadingsByText("The three templates", { at: 2 }).start).toBe(10);
    expect(() => dom.findHeadingsByText("The three templates", { at: 10 })).toThrow(/No heading with id 10/);
  });

  test("throws on ambiguous substring matches", () => {
    const dom = DocDom.from(
      new Gdoc(
        mockDoc([
          {
            endIndex: 10,
            paragraph: {
              elements: [{ textRun: { content: "Translation Status\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 1,
          },
          {
            endIndex: 20,
            paragraph: {
              elements: [{ textRun: { content: "Build Status\n" } }],
              paragraphStyle: { namedStyleType: PARAGRAPH_STYLES.HEADING_2 },
            },
            startIndex: 10,
          },
        ]),
        "doc",
      ),
    );
    expect(() => dom.findHeadingsByText("Status", { match: "substr" })).toThrow(/Ambiguous heading/);
  });
});

describe("findNodesByText", () => {
  test("matches any unique paragraph, not just headings", () => {
    const dom = sampleDom();
    expect(dom.findNodesByText("In progress").text).toBe("In progress.");
    expect(dom.findNodesByText("Status").namedStyleType).toBe("HEADING_2");
  });

  test("throws on duplicate body text unless at is passed", () => {
    const a: DocNode = {
      end: 10,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "In progress",
    };
    const b: DocNode = {
      end: 20,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 10,
      text: "In progress",
    };
    const dom = new DocDom([a, b]);
    expect(() => dom.findNodesByText("In progress")).toThrow(/Ambiguous text/);
    expect(dom.findNodesByText("In progress", { at: 2 }).tapeIndex).toBe(2);
  });
});

describe("neighborhoodFrom", () => {
  test("walks contiguous siblings until the next same-or-higher heading", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 1,
        text: "Status",
      },
      {
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Body",
      },
      {
        end: 21,
        tapeIndex: 3,
        kind: "sectionBreak",
        start: 20,
      },
      {
        end: 40,
        tapeIndex: 4,
        kind: "table",
        start: 21,
        table: { cells: [[{ end: 30, start: 22, text: "A" }]] },
      },
      {
        end: 50,
        tapeIndex: 5,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 40,
        text: "Approach",
      },
    ];
    expect(neighborhoodFrom(nodes, 1).map((n) => n.tapeIndex)).toEqual([1, 2, 3, 4]);
  });

  test("filters unsafe nodes correctly with equation, chips, and TOC", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 1,
        text: "Safe section",
      },
      {
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Just normal text",
      },
      {
        end: 30,
        hasEquation: true,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "Math formula",
      },
      {
        chips: [{ end: 40, start: 30, title: "Alice", uri: "alice@example.com" }],
        end: 40,
        tapeIndex: 4,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        text: "Approver",
      },
    ];

    const unsafeNodes = nodes.filter(
      (n) =>
        Boolean(n.hasEquation) ||
        Boolean(n.chips?.length) ||
        Boolean(n.hasHorizontalRule) ||
        n.kind === "tableOfContents",
    );
    expect(unsafeNodes.map((n) => n.tapeIndex)).toEqual([3, 4]);
  });
});
