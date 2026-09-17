/* Tests for exporting and parsing document and tab YAML DOM trees. */

import { describe, expect, test } from "bun:test";
import type { DocNode } from "./types.ts";
import { exportDocumentToYaml, exportTabToYaml, parseYamlTree } from "./yaml.ts";

describe("YAML DOM export and parsing", () => {
  const sampleNodes: DocNode[] = [
    {
      end: 15,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "TITLE",
      start: 0,
      text: "Architecture Spec",
    },
    {
      end: 35,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "HEADING_1",
      start: 15,
      text: "1. Overview",
    },
    {
      end: 80,
      tapeIndex: 3,
      kind: "paragraph",
      markup: "This service uses **high-throughput** streaming via `Kafka`.",
      namedStyleType: "NORMAL_TEXT",
      start: 35,
      style: {
        fontSize: 11,
      },
      text: "This service uses high-throughput streaming via Kafka.",
    },
    {
      bullet: {
        nestingLevel: 0,
        type: "BULLET",
      },
      end: 110,
      tapeIndex: 4,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 80,
      text: "First bullet item",
    },
    {
      bullet: {
        nestingLevel: 1,
        type: "CHECKBOX",
      },
      end: 140,
      tapeIndex: 5,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 110,
      text: "Pending task",
    },
    {
      end: 180,
      tapeIndex: 6,
      kind: "table",
      start: 140,
      table: {
        borderColor: "#cccccc",
        cellPadding: 6,
        cells: [
          [
            { end: 155, markup: "**Name**", start: 145, text: "Name" },
            { end: 165, markup: "**Type**", start: 155, text: "Type" },
          ],
          [
            { end: 172, markup: "id", start: 165, text: "id" },
            { end: 180, markup: "UUID", start: 172, text: "UUID" },
          ],
        ],
        columnWidth: 200,
        contentAlignment: "MIDDLE",
      },
    },
    {
      end: 181,
      tapeIndex: 7,
      kind: "pageBreak",
      start: 180,
    },
    {
      end: 220,
      tapeIndex: 8,
      images: [{ end: 220, heightPt: 150, objectId: "img_test", start: 181, widthPt: 250 }],
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 181,
      text: "Architecture Diagram",
    },
  ];

  test("exportTabToYaml exports clean, structured YAML DOM tree", () => {
    const { audit, data, yaml } = exportTabToYaml(sampleNodes, {
      documentId: "doc_123",
      revisionId: "rev_456",
      tabId: "t.0",
      tabTitle: "Architecture",
    });

    expect(data.documentId).toBe("doc_123");
    expect(data.revisionId).toBe("rev_456");
    expect(data.tabId).toBe("t.0");
    expect(data.tabTitle).toBe("Architecture");
    expect(audit.lossless).toBe(false); // image in node 8
    expect(audit.issues).toEqual(["Node 8: 1 image(s) replaced with [Image] placeholder"]);

    expect(data.nodes.length).toBe(8);
    expect(data.nodes[0]).toEqual({
      kind: "paragraph",
      namedStyleType: "TITLE",
      text: "Architecture Spec",
    });
    expect(data.nodes[1]).toEqual({
      kind: "paragraph",
      namedStyleType: "HEADING_1",
      text: "1. Overview",
    });
    const node2 = data.nodes[2];
    expect(node2?.kind).toBe("paragraph");
    if (node2?.kind === "paragraph") {
      expect(node2.text).toBe("This service uses **high-throughput** streaming via `Kafka`.");
    }
    expect(data.nodes[3]?.kind).toBe("paragraph");
    if (data.nodes[3]?.kind === "paragraph") {
      expect(data.nodes[3]?.bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
      expect(data.nodes[3]?.bullet?.nestingLevel).toBe(0);
    }
    if (data.nodes[4]?.kind === "paragraph") {
      expect(data.nodes[4]?.bullet?.preset).toBe("BULLET_CHECKBOX");
      expect(data.nodes[4]?.bullet?.nestingLevel).toBe(1);
    }
    if (data.nodes[5]?.kind === "table") {
      expect(data.nodes[5]?.rows).toEqual([
        ["**Name**", "**Type**"],
        ["id", "UUID"],
      ]);
      expect(data.nodes[5]?.columnWidth).toBe(200);
      expect(data.nodes[5]?.borderColor).toBe("#cccccc");
      expect(data.nodes[5]?.cellPadding).toBe(6);
    }
    expect(data.nodes[6]).toEqual({ kind: "pageBreak" });
    const node7 = data.nodes[7];
    expect(node7?.kind).toBe("paragraph");
    if (node7?.kind === "paragraph") {
      expect(node7.text).toBe("Architecture Diagram [Image]");
    }

    expect(yaml).toContain("documentId: doc_123");
    expect(yaml).toContain("tabId: t.0");
    expect(yaml).toContain("Architecture Spec");
  });

  test("parseYamlTree parses canonical exported YAML back into ElementSpecs", () => {
    const { yaml } = exportTabToYaml(sampleNodes.slice(0, 6));
    const { elements } = parseYamlTree(yaml);

    expect(elements.length).toBe(6);
    expect(elements[0]?.kind).toBe("paragraph");
    if (elements[0]?.kind === "paragraph") {
      expect(elements[0].namedStyleType).toBe("TITLE");
      expect(elements[0].text).toBe("Architecture Spec");
    }
    if (elements[3]?.kind === "paragraph") {
      expect(elements[3].bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    }
    if (elements[5]?.kind === "table") {
      expect(elements[5].table.rows).toEqual([
        ["**Name**", "**Type**"],
        ["id", "UUID"],
      ]);
    }
  });

  test("parseYamlTree parses shorthand YAML forms", () => {
    const shorthandYaml = `
nodes:
  - title: "Main Project Title"
  - heading: 1
    text: "Introduction"
  - h2: "Subsection Details"
  - paragraph: "Standard paragraph body."
  - bullet: "Bullet item text"
    nestingLevel: 0
  - bullet:
      text: "Checkbox task item"
      preset: BULLET_CHECKBOX
      nestingLevel: 1
  - codeBlock: |
      const x = 10;
      console.log(x);
  - table:
      - ["Col A", "Col B"]
      - ["Val 1", "Val 2"]
  - pageBreak: true
`;

    const { elements } = parseYamlTree(shorthandYaml);
    expect(elements.length).toBe(10); // 1 title + 1 h1 + 1 h2 + 1 p + 1 bullet + 1 checkbox + 2 lines of codeBlock + 1 table + 1 pageBreak

    expect(elements[0]).toMatchObject({
      kind: "paragraph",
      namedStyleType: "TITLE",
      text: "Main Project Title",
    });
    expect(elements[1]).toMatchObject({
      kind: "paragraph",
      namedStyleType: "HEADING_1",
      text: "Introduction",
    });
    expect(elements[2]).toMatchObject({
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      text: "Subsection Details",
    });
    expect(elements[3]).toMatchObject({
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "Standard paragraph body.",
    });
    expect(elements[4]).toMatchObject({
      bullet: { nestingLevel: 0, preset: "BULLET_DISC_CIRCLE_SQUARE" },
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "Bullet item text",
    });
    expect(elements[5]).toMatchObject({
      bullet: { nestingLevel: 1, preset: "BULLET_CHECKBOX" },
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "Checkbox task item",
    });

    // codeBlock splits into lines with 0-margin style
    expect(elements[6]).toMatchObject({
      kind: "paragraph",
      text: "const x = 10;",
    });
    expect(elements[7]).toMatchObject({
      kind: "paragraph",
      text: "console.log(x);",
    });

    expect(elements[8]).toMatchObject({
      kind: "table",
      table: {
        rows: [
          ["Col A", "Col B"],
          ["Val 1", "Val 2"],
        ],
      },
    });
    expect(elements[9]).toMatchObject({
      kind: "pageBreak",
    });
  });

  test("parseYamlTree accepts bare array of node specs", () => {
    const rawArray = [{ heading: 1, text: "Top Heading" }, { text: "Paragraph text" }];
    const { elements } = parseYamlTree(rawArray);
    expect(elements.length).toBe(2);
    expect(elements[0]?.kind).toBe("paragraph");
    expect(elements[1]?.kind).toBe("paragraph");
  });

  test("parseYamlTree throws informative error on malformed YAML or missing nodes", () => {
    expect(() => parseYamlTree("invalid: [yaml")).toThrow("Failed to parse YAML tree");
    expect(() => parseYamlTree({ foo: "bar" })).toThrow("missing `nodes` array");
    expect(() => parseYamlTree(null)).toThrow("Invalid YAML tree");
  });

  test("exportDocumentToYaml exports multiple tabs with tabs array and aggregated audit", () => {
    const tabs = [
      {
        tabId: "t.1",
        tabTitle: "Tab One",
        nodes: [
          {
            end: 10,
            kind: "paragraph" as const,
            namedStyleType: "HEADING_1" as const,
            start: 0,
            tapeIndex: 1,
            text: "Heading 1",
          },
        ],
      },
      {
        tabId: "t.2",
        tabTitle: "Tab Two",
        nodes: [
          {
            end: 20,
            kind: "paragraph" as const,
            namedStyleType: "NORMAL_TEXT" as const,
            start: 10,
            tapeIndex: 2,
            text: "Paragraph in tab two",
          },
        ],
      },
    ];

    const result = exportDocumentToYaml(tabs, { documentId: "doc_abc" });
    expect(result.data.documentId).toBe("doc_abc");
    expect(result.data.tabCount).toBe(2);
    expect(result.data.tabs).toHaveLength(2);
    expect(result.data.tabs?.[0]?.tabTitle).toBe("Tab One");
    expect(result.data.tabs?.[0]?.nodes).toHaveLength(1);
    expect(result.data.tabs?.[1]?.tabTitle).toBe("Tab Two");
    expect(result.data.tabs?.[1]?.nodes).toHaveLength(1);
    expect(result.data.nodes).toHaveLength(2);
    expect(result.audit.lossless).toBe(true);
    expect(result.audit.nodeCount).toBe(2);
    expect(result.yaml).toContain("documentId: doc_abc");
    expect(result.yaml).toContain("tabTitle: Tab One");
    expect(result.yaml).toContain("tabTitle: Tab Two");
  });
});
