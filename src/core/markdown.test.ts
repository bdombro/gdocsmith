/* Unit tests for markdown ingestion to Google Docs DOM ElementSpec. */

import { describe, expect, test } from "bun:test";
import { compileDom, DomWriter, type ElementSpec, type ParagraphSpec, parseDocument } from "./dom/index.ts";
import {
  buildChunkOps,
  chunkMarkdownElements,
  executeMarkdownInsert,
  markdownStylesParse,
  normalizeCustomStyle,
  parseMarkdownToElements,
} from "./markdown.ts";

function asParagraph(spec?: ElementSpec): ParagraphSpec {
  if (spec?.kind !== "paragraph") throw new Error("Expected paragraph");
  return spec;
}

describe("markdown parser", () => {
  test("parses headings to HEADING_* by default", () => {
    const md = `
# Main Section
## Subsection
### Deep Dive
`;
    const elements = parseMarkdownToElements(md);
    expect(elements).toHaveLength(3);
    expect(elements[0]).toEqual({
      kind: "paragraph",
      namedStyleType: "HEADING_1",
      text: "Main Section",
    });
    expect(elements[1]).toEqual({
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      text: "Subsection",
    });
    expect(elements[2]).toEqual({
      kind: "paragraph",
      namedStyleType: "HEADING_3",
      text: "Deep Dive",
    });
  });

  test("h1IsTitle maps first # to TITLE and subsequent # to HEADING_1", () => {
    const md = `
# Doc Title
# First Chapter
## Section
`;
    const elements = parseMarkdownToElements(md, { h1IsTitle: true });
    expect(asParagraph(elements[0]).namedStyleType).toBe("TITLE");
    expect(asParagraph(elements[0]).text).toBe("Doc Title");

    expect(asParagraph(elements[1]).namedStyleType).toBe("HEADING_1");
    expect(asParagraph(elements[1]).text).toBe("First Chapter");

    expect(asParagraph(elements[2]).namedStyleType).toBe("HEADING_2");
  });

  test("parses unordered, ordered, task, and nested lists", () => {
    const md = `
- Bullet 1
  - Nested bullet
- Bullet 2
- [ ] Task incomplete
- [x] Task done

1. Step 1
   1. Substep 1
2. Step 2
`;
    const elements = parseMarkdownToElements(md);

    // Unordered
    expect(asParagraph(elements[0]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements[0]).bullet?.nestingLevel).toBe(0);
    expect(asParagraph(elements[0]).text).toBe("Bullet 1");

    // Nested unordered
    expect(asParagraph(elements[1]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements[1]).bullet?.nestingLevel).toBe(1);
    expect(asParagraph(elements[1]).text).toBe("Nested bullet");

    expect(asParagraph(elements[2]).text).toBe("Bullet 2");

    // Task items
    expect(asParagraph(elements[3]).bullet?.preset).toBe("BULLET_CHECKBOX");
    expect(asParagraph(elements[3]).bullet?.nestingLevel).toBe(0);
    expect(asParagraph(elements[3]).text).toBe("Task incomplete");

    expect(asParagraph(elements[4]).bullet?.preset).toBe("BULLET_CHECKBOX");
    expect(asParagraph(elements[4]).text).toBe("Task done");

    // Numbered items
    expect(asParagraph(elements[5]).bullet?.preset).toBe("NUMBERED_DECIMAL_NESTED");
    expect(asParagraph(elements[5]).bullet?.nestingLevel).toBe(0);
    expect(asParagraph(elements[5]).text).toBe("Step 1");

    expect(asParagraph(elements[6]).bullet?.preset).toBe("NUMBERED_DECIMAL_NESTED");
    expect(asParagraph(elements[6]).bullet?.nestingLevel).toBe(1);
    expect(asParagraph(elements[6]).text).toBe("Substep 1");

    expect(asParagraph(elements[7]).bullet?.preset).toBe("NUMBERED_DECIMAL_NESTED");
    expect(asParagraph(elements[7]).bullet?.nestingLevel).toBe(0);
    expect(asParagraph(elements[7]).text).toBe("Step 2");
  });

  test("translates nested unordered list under ordered list with automatic preset and indentStart (2-space and 4-space)", () => {
    const md2 = `
1. Title
  - Depends on: None
  - Objective: Main goal
`;
    const elements2 = parseMarkdownToElements(md2);
    expect(elements2).toHaveLength(3);
    expect(asParagraph(elements2[0]).text).toBe("Title");
    expect(asParagraph(elements2[0]).bullet?.preset).toBe("NUMBERED_DECIMAL_NESTED");
    expect(asParagraph(elements2[0]).bullet?.nestingLevel).toBe(0);
    expect(asParagraph(elements2[0]).indentStart).toBeUndefined();

    expect(asParagraph(elements2[1]).text).toBe("Depends on: None");
    expect(asParagraph(elements2[1]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements2[1]).bullet?.nestingLevel).toBe(1);
    expect(asParagraph(elements2[1]).indentStart).toEqual({ magnitude: 72, unit: "PT" });

    expect(asParagraph(elements2[2]).text).toBe("Objective: Main goal");
    expect(asParagraph(elements2[2]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements2[2]).bullet?.nestingLevel).toBe(1);
    expect(asParagraph(elements2[2]).indentStart).toEqual({ magnitude: 72, unit: "PT" });

    const md4 = `
1. Title
    - Depends on: None
    - Objective: Main goal
`;
    const elements4 = parseMarkdownToElements(md4);
    expect(elements4).toHaveLength(3);
    expect(asParagraph(elements4[1]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements4[1]).bullet?.nestingLevel).toBe(1);
    expect(asParagraph(elements4[1]).indentStart).toEqual({ magnitude: 72, unit: "PT" });
  });

  test("translates multi-level nested list with progressive indentStart", () => {
    const md = `
1. Top Level
  - Level 1 Bullet
    - Level 2 Bullet
      1. Level 3 Ordered
`;
    const elements = parseMarkdownToElements(md);
    expect(elements).toHaveLength(4);
    expect(asParagraph(elements[0]).bullet?.nestingLevel).toBe(0);
    expect(asParagraph(elements[0]).bullet?.preset).toBe("NUMBERED_DECIMAL_NESTED");
    expect(asParagraph(elements[0]).indentStart).toBeUndefined();

    expect(asParagraph(elements[1]).bullet?.nestingLevel).toBe(1);
    expect(asParagraph(elements[1]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements[1]).indentStart).toEqual({ magnitude: 72, unit: "PT" });

    expect(asParagraph(elements[2]).bullet?.nestingLevel).toBe(2);
    expect(asParagraph(elements[2]).bullet?.preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(asParagraph(elements[2]).indentStart).toEqual({ magnitude: 108, unit: "PT" });

    expect(asParagraph(elements[3]).bullet?.nestingLevel).toBe(3);
    expect(asParagraph(elements[3]).bullet?.preset).toBe("NUMBERED_DECIMAL_NESTED");
    expect(asParagraph(elements[3]).indentStart).toEqual({ magnitude: 144, unit: "PT" });
  });

  test("compiles sub-list after ordered item with separate createParagraphBullets and indentStart", () => {
    const md = `1. Title\n    - Depends on: None\n    - Objective: ...`;
    const elements = parseMarkdownToElements(md);

    const doc = {
      body: {
        content: [
          { endIndex: 1, sectionBreak: {}, startIndex: 0 },
          {
            endIndex: 20,
            paragraph: { elements: [{ textRun: { content: "Heading\n" } }] },
            startIndex: 1,
          },
        ],
      },
      documentId: "test-nested-compile",
      revisionId: "rev-1",
      title: "Test",
    };

    const parsed = parseDocument(doc as any);
    const writer = new DomWriter(parsed.nodes);
    const anchor = parsed.nodes.find((n) => n.kind === "paragraph")!;
    let cur = anchor;
    for (const el of elements) {
      cur = writer.insertAdjacentElement(cur, "afterend", el);
    }

    const { requests } = compileDom(writer);

    // Numbered bullet creation for Title
    const numberedBullets = requests.filter(
      (r: any) => r.createParagraphBullets?.bulletPreset === "NUMBERED_DECIMAL_NESTED",
    );
    expect(numberedBullets).toHaveLength(1);

    // Unordered bullet creation for child items (not merged into numbered list)
    const discBullets = requests.filter(
      (r: any) => r.createParagraphBullets?.bulletPreset === "BULLET_DISC_CIRCLE_SQUARE",
    );
    expect(discBullets).toHaveLength(1);

    // Indentation style for nested items
    const indentRequests = requests.filter((r: any) => {
      const p = r.updateParagraphStyle?.paragraphStyle;
      return p?.indentStart?.magnitude === 72;
    });
    expect(indentRequests.length).toBeGreaterThanOrEqual(1);
  });

  test("parses code blocks into multiple 0-margin lines", () => {
    const md = `
\`\`\`typescript
const a = 1;
const b = 2;
\`\`\`
`;
    const elements = parseMarkdownToElements(md);
    expect(elements).toHaveLength(2);
    expect(asParagraph(elements[0]).text).toBe("const a = 1;");
    expect(asParagraph(elements[0]).style?.fontFamily).toBe("Courier New");
    expect(asParagraph(elements[0]).style?.fontSize).toBe(10);
    expect(asParagraph(elements[0]).style?.lineSpacing).toBe(100);
    expect(asParagraph(elements[0]).style?.spaceBelow).toBe(0);

    expect(asParagraph(elements[1]).text).toBe("const b = 2;");
    expect(asParagraph(elements[1]).style?.spaceBelow).toBeUndefined();
  });

  test("parses tables into table ElementSpec", () => {
    const md = `
| Header A | Header B |
| :--- | :--- |
| Val 1 | Val 2 |
| Val 3 | Val 4 |
`;
    const elements = parseMarkdownToElements(md);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.kind).toBe("table");
    if (elements[0]?.kind === "table") {
      expect(elements[0].table.rows).toEqual([
        ["Header A", "Header B"],
        ["Val 1", "Val 2"],
        ["Val 3", "Val 4"],
      ]);
    }
  });

  test("parses blockquotes with indentStart", () => {
    const md = `
> This is a quote.
> Second line of quote.
`;
    const elements = parseMarkdownToElements(md);
    expect(elements).toHaveLength(1);
    expect(asParagraph(elements[0]).style?.indentStart).toBe(18);
  });

  test("parses hr into pageBreak", () => {
    const md = `
First section

---

Second section
`;
    const elements = parseMarkdownToElements(md);
    expect(elements).toHaveLength(3);
    expect(elements[0]?.kind).toBe("paragraph");
    expect(elements[1]?.kind).toBe("pageBreak");
    expect(elements[2]?.kind).toBe("paragraph");
  });

  test("chunks elements into non-table runs and tables", () => {
    const md = `
# Intro
Paragraph 1.

| Col A | Col B |
| --- | --- |
| 1 | 2 |

Paragraph 2.
`;
    const elements = parseMarkdownToElements(md);
    const chunks = chunkMarkdownElements(elements);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.kind).toBe("elements");
    if (chunks[0]?.kind === "elements") {
      expect(chunks[0].specs).toHaveLength(2); // Heading + Para 1
    }
    expect(chunks[1]?.kind).toBe("table");
    expect(chunks[2]?.kind).toBe("elements");
    if (chunks[2]?.kind === "elements") {
      expect(chunks[2].specs).toHaveLength(1); // Para 2
    }
  });

  test("buildChunkOps replaces anchor when replaceAnchor is true", () => {
    const chunk = {
      kind: "elements" as const,
      specs: [
        {
          kind: "paragraph" as const,
          namedStyleType: "HEADING_1" as const,
          text: "Title",
        },
        {
          kind: "paragraph" as const,
          namedStyleType: "NORMAL_TEXT" as const,
          text: "Para",
        },
      ],
    };
    const ops = buildChunkOps(1, "afterend", chunk, true);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      at: 1,
      innerText: "Title",
      namedStyleType: "HEADING_1",
    });
    expect(ops[1]?.at).toBe(1);
    expect(ops[1]?.insertAdjacentElement?.position).toBe("afterend");
  });

  test("buildChunkOps inserts adjacent when replaceAnchor is false", () => {
    const chunk = {
      kind: "elements" as const,
      specs: [
        {
          kind: "paragraph" as const,
          namedStyleType: "NORMAL_TEXT" as const,
          text: "Para",
        },
      ],
    };
    const ops = buildChunkOps(12, "afterend", chunk, false);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.at).toBe(12);
    expect(ops[0]?.insertAdjacentElement?.position).toBe("afterend");
  });

  test("buildChunkOps handles table chunk", () => {
    const chunk = {
      kind: "table" as const,
      spec: { kind: "table" as const, table: { rows: [["A"]] } },
    };
    const ops = buildChunkOps(5, "afterend", chunk, false);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.at).toBe(5);
    expect(ops[0]?.insertAdjacentElement?.element).toEqual({
      kind: "table",
      table: { rows: [["A"]] },
    });
  });

  test("executeMarkdownInsert inserts into blank document replacing initial paragraph", async () => {
    const mockDoc = {
      documentId: "doc-test-1",
      revisionId: "rev-1",
      body: {
        content: [
          { endIndex: 1, startIndex: 0, sectionBreak: {} },
          {
            endIndex: 2,
            paragraph: {
              elements: [{ textRun: { content: "\n" } }],
            },
            startIndex: 1,
          },
        ],
      },
    };
    const mockClient = {
      run: async () => JSON.stringify(mockDoc),
      getDocument: async () => mockDoc,
      batchUpdate: async () => JSON.stringify({ replies: [] }),
    };
    const result = await executeMarkdownInsert({
      client: mockClient as any,
      documentId: "doc-test-1",
      markdown: "# Hello World\nSome text.",
    });
    expect(result.elementsInserted).toBe(2);
    expect(result.appliedChunks).toBe(1);
    const startId = result.insertedRange?.startId;
    if (startId === undefined) throw new Error("missing insertedRange.startId");
    expect(result.insertedRange).toEqual({
      count: 2,
      endId: startId + 1,
      startId,
    });
  });

  test("executeMarkdownInsert executes multi-chunk insertions sequentially", async () => {
    let batchUpdateCalls = 0;
    const docWithContent = {
      documentId: "doc-test-2",
      revisionId: "rev-1",
      body: {
        content: [
          {
            endIndex: 2,
            paragraph: {
              elements: [{ textRun: { content: "\n" } }],
            },
            startIndex: 1,
          },
        ],
      },
    };
    const mockClient = {
      run: async () => JSON.stringify(docWithContent),
      getDocument: async () => docWithContent,
      batchUpdate: async () => {
        batchUpdateCalls++;
        return JSON.stringify({ replies: [] });
      },
    };
    const md = `
# Title
Paragraph text.

| Col 1 | Col 2 |
| --- | --- |
| A | B |

Final paragraph.
`;
    const result = await executeMarkdownInsert({
      client: mockClient as any,
      documentId: "doc-test-2",
      markdown: md,
    });
    expect(result.elementsInserted).toBe(4);
    expect(result.appliedChunks).toBe(3);
    expect(batchUpdateCalls).toBe(3);
  });

  test("markdownStylesParse reads a flattened named-style map", () => {
    const styles = markdownStylesParse({
      myStyle: {
        italic: true,
        color: "#999999",
      },
    });
    expect(styles.myStyle).toEqual({
      foregroundColor: "#999999",
      italic: true,
    });
  });

  test("markdownStylesParse does not unwrap a nested styles key", () => {
    expect(
      markdownStylesParse({
        styles: { alert: { color: "#e11d48" } },
      }).alert,
    ).toBeUndefined();
  });

  test("normalizeCustomStyle normalizes friendly style keys", () => {
    const style1 = normalizeCustomStyle({
      color: "#ff0000",
      highlight: "#ffff00",
      size: "11pt",
      style: "bold, italic",
      font: "Roboto",
    });
    expect(style1).toEqual({
      backgroundColor: "#ffff00",
      bold: true,
      fontFamily: "Roboto",
      fontSize: 11,
      foregroundColor: "#ff0000",
      italic: true,
    });

    const style2 = normalizeCustomStyle({
      strike: true,
      underline: true,
      size: 10,
    });
    expect(style2).toEqual({
      fontSize: 10,
      strikethrough: true,
      underline: true,
    });
  });

  test("parseMarkdownToElements treats leading --- as a page break, not YAML styles", () => {
    const md = `---
styles:
  alert:
    color: "#e11d48"
---
# First Heading
`;
    const elements = parseMarkdownToElements(md);
    expect(elements[0]?.kind).toBe("pageBreak");
    expect(elements.some((el) => el.kind === "paragraph" && asParagraph(el).text === "First Heading")).toBe(true);
    expect(elements.length).toBeGreaterThan(2);
  });

  test("parseMarkdownToElements applies ::styleName[]:: from customStyles, not from markdown YAML", () => {
    const md = `# First Heading
A paragraph with ::alert[critical alert]:: here.
`;
    const elements = parseMarkdownToElements(md, {
      customStyles: markdownStylesParse({
        alert: {
          color: "#e11d48",
          bold: true,
        },
      }),
    });
    expect(elements).toHaveLength(2);
    expect(asParagraph(elements[0]).namedStyleType).toBe("HEADING_1");
    expect(asParagraph(elements[1]).text).toBe("A paragraph with ::alert[critical alert]:: here.");
    expect(asParagraph(elements[1]).runs?.length).toBeGreaterThan(0);
  });

  test("executeMarkdownInsert applies custom style directives from customStyles", async () => {
    const batchRequests: object[][] = [];
    const docWithContent = {
      documentId: "doc-test-styles",
      revisionId: "rev-1",
      body: {
        content: [
          {
            endIndex: 2,
            paragraph: {
              elements: [{ textRun: { content: "\n" } }],
            },
            startIndex: 1,
          },
        ],
      },
    };
    const mockClient = {
      run: async () => JSON.stringify(docWithContent),
      getDocument: async () => docWithContent,
      batchUpdate: async (_id: string, reqs: object[]) => {
        batchRequests.push(reqs);
        return JSON.stringify({ replies: [] });
      },
    };

    const md = `# Welcome
Here is a ::greyNote[subtle grey footnote]::.
`;

    const result = await executeMarkdownInsert({
      client: mockClient as any,
      customStyles: markdownStylesParse({
        greyNote: {
          style: "italic",
          color: "#6b7280",
          size: 9,
        },
      }),
      documentId: "doc-test-styles",
      markdown: md,
    });

    expect(result.elementsInserted).toBe(2);
    expect(batchRequests.length).toBeGreaterThan(0);

    // Look for text style request with custom foregroundColor and fontSize
    const allReqs = batchRequests.flat();
    const styleReq = allReqs.find((r: any) => {
      const ts = r?.updateTextStyle?.textStyle;
      return (
        ts?.foregroundColor?.color?.rgbColor?.red !== undefined && ts?.fontSize?.magnitude === 9 && ts?.italic === true
      );
    });
    expect(styleReq).toBeDefined();
  });

  test("executeMarkdownInsert throws actionable missingNodeIdMsg when anchorId looks like a raw character offset", async () => {
    const doc = {
      documentId: "doc-offset-guard",
      revisionId: "rev-1",
      body: {
        content: [
          { endIndex: 1, sectionBreak: {}, startIndex: 0 },
          { endIndex: 20, paragraph: { elements: [{ textRun: { content: "Heading 1\n" } }] }, startIndex: 1 },
        ],
      },
    };

    const mockClient = {
      run: async () => JSON.stringify(doc),
      getDocument: async () => doc,
      batchUpdate: async () => {},
    };

    await expect(
      executeMarkdownInsert({
        anchorId: 4520,
        client: mockClient as any,
        documentId: "doc-offset-guard",
        markdown: "Hello world",
      }),
    ).rejects.toThrow(/No node with id 4520.*leftover startIndex \/ raw character offset/);
  });

  test("executeMarkdownInsert appends to end of non-empty document when anchorId is omitted", async () => {
    const docWithContent = {
      documentId: "doc-append-test",
      revisionId: "rev-1",
      body: {
        content: [
          { endIndex: 1, sectionBreak: {}, startIndex: 0 },
          {
            endIndex: 15,
            paragraph: {
              elements: [{ textRun: { content: "First heading\n" } }],
            },
            startIndex: 1,
          },
          {
            endIndex: 30,
            paragraph: {
              elements: [{ textRun: { content: "Second paragraph\n" } }],
            },
            startIndex: 15,
          },
        ],
      },
    };

    let batchUpdatePayload: any[] = [];
    const mockClient = {
      run: async () => JSON.stringify(docWithContent),
      getDocument: async () => docWithContent,
      batchUpdate: async (_docId: string, reqs: any[]) => {
        batchUpdatePayload = reqs;
        return JSON.stringify({ replies: [] });
      },
    };

    const result = await executeMarkdownInsert({
      client: mockClient as any,
      documentId: "doc-append-test",
      markdown: "Appended paragraph.",
    });

    expect(result.elementsInserted).toBe(1);
    expect(batchUpdatePayload.length).toBeGreaterThan(0);
    // Verifies splitAfter was called at index 30 (end of second paragraph)
    const splitReq = batchUpdatePayload.find((r) => r.insertText?.location?.index === 29);
    expect(splitReq).toBeDefined();
  });

  /** Tests that chunkOpsBuild handles replaceAnchor on nested bullets by inserting and removing empty anchor. */
  test("chunkOpsBuild handles replaceAnchor on nested bullets by inserting and removing empty anchor", () => {
    const chunk = {
      kind: "elements" as const,
      specs: [
        {
          bullet: { nestingLevel: 1, preset: "BULLET_DISC_CIRCLE_SQUARE" as const },
          kind: "paragraph" as const,
          namedStyleType: "NORMAL_TEXT" as const,
          text: "Nested first item",
        },
      ],
    };
    const ops = buildChunkOps(1, "afterend", chunk, true);
    expect(ops).toHaveLength(2);
    expect(ops[0]?.insertAdjacentElement).toBeDefined();
    expect(ops[1]?.remove).toBe(true);
  });
});
