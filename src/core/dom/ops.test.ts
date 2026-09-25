/* Unit tests for DOM mutation JSON → DomWriter. */

import { describe, expect, test } from "bun:test";
import { formatOutput, parseInput } from "../../cli/format.ts";
import { compileDom } from "./apply.ts";
import type { ParagraphSpec } from "./element.ts";
import { CHIP_MUTATE_MSG, EXISTING_NEST_MSG } from "./guards.ts";
import {
  applyOps,
  assertDomDocument,
  type DomOp,
  elementFromJson,
  executeDangerousClear,
  extractPageSetup,
  formatUnrecoverableWarning,
  liveDump,
  matchSnippet,
  parseDomOps,
  parseWriteAt,
  resolveTarget,
  summarizeNode,
  TAPE_ECHO_CAP,
  WRITE_AT_ONLY_MSG,
} from "./ops.ts";
import { DocDom } from "./query.ts";
import type { DocNode } from "./types.ts";
import { DomWriter } from "./write.ts";

function tape(): DocNode[] {
  return [
    {
      end: 12,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "TITLE",
      start: 1,
      text: "Intent",
    },
    {
      end: 22,
      tapeIndex: 12,
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      start: 12,
      text: "Status",
    },
    {
      end: 40,
      tapeIndex: 22,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 22,
      text: "In progress.",
    },
    {
      end: 50,
      tapeIndex: 40,
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      start: 40,
      text: "Approach",
    },
    {
      end: 70,
      tapeIndex: 50,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 50,
      text: "Design details.",
    },
  ];
}

describe("parseDomOps", () => {
  test("accepts { ops }, { tabs }, or a bare array", () => {
    const op = { select: "TITLE", innerText: "X" };
    expect(parseDomOps({ ops: [op] })).toEqual({ ops: [op] });
    expect(parseDomOps([op])).toEqual({ ops: [op] });
    expect(parseDomOps({ ops: [op], documentId: "doc-a" })).toEqual({
      documentId: "doc-a",
      ops: [op],
    });
    expect(parseDomOps({ ops: [op], documentId: "doc-a", tabId: "t.0" })).toEqual({
      documentId: "doc-a",
      ops: [op],
      tabId: "t.0",
    });
    expect(
      parseDomOps({
        tabs: [{ tabId: "t.0", ops: [op] }],
      }),
    ).toEqual({
      ops: [],
      tabs: [{ dangerousClear: false, ops: [op], tabId: "t.0" }],
    });
  });

  test("accepts JSON strings via parseInput", () => {
    const jsonString = JSON.stringify({
      documentId: "doc-xyz",
      ops: [{ at: 14, innerText: "Hello JSON" }],
      tabId: "t.1",
    });
    expect(parseDomOps(parseInput(jsonString))).toEqual({
      documentId: "doc-xyz",
      ops: [{ at: 14, innerText: "Hello JSON" }],
      tabId: "t.1",
    });

    const jsonTabs = JSON.stringify({
      tabs: [{ tabId: "t.1", ops: [{ at: 14, innerText: "Hello tabs" }] }],
    });
    expect(parseDomOps(parseInput(jsonTabs)).tabs).toEqual([
      { dangerousClear: false, ops: [{ at: 14, innerText: "Hello tabs" }], tabId: "t.1" },
    ]);
  });

  test("ignores leftover revision fields on apply files", () => {
    const parsed = parseDomOps({
      documentId: "doc-xyz",
      ops: [{ at: 14, innerText: "Hello" }],
      revision: "r_12345678",
      revisionId: "rev-999",
    });
    expect(parsed).toEqual({
      documentId: "doc-xyz",
      ops: [{ at: 14, innerText: "Hello" }],
    });
  });

  test("refuses other shapes", () => {
    expect(() => parseDomOps({ mutations: [] })).toThrow(/ops/);
  });
});

describe("assertDomDocument", () => {
  test("requires documentId", () => {
    expect(() => assertDomDocument({})).toThrow(/documentId required/);
    expect(assertDomDocument({ documentId: "doc" })).toBe("doc");
  });
});

describe("summarizeNode", () => {
  test("emits id first; never prints start", () => {
    expect(
      summarizeNode({
        bullet: { listId: "kix.x", nestingLevel: 1 },
        end: 20,
        tapeIndex: 8,
        indentFirstLine: { magnitude: 0, unit: "PT" },
        indentStart: { magnitude: 18, unit: "PT" },
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 8,
        text: "hello",
      }),
    ).toEqual({
      bullet: { nestingLevel: 1 },
      id: 8,
      indentFirstLine: 0,
      indentStart: 18,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "hello",
    });
    expect(
      summarizeNode({
        bullet: { listId: "kix.x", nestingLevel: 0, type: "NUMBERED" },
        end: 20,
        tapeIndex: 9,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 8,
        text: "step 1",
      }),
    ).toEqual({
      bullet: { nestingLevel: 0, type: "NUMBERED" },
      id: 9,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "step 1",
    });
    expect(
      summarizeNode(
        {
          end: 20,
          tapeIndex: 8,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 8,
          text: "hello",
        },
        { full: true },
      ),
    ).not.toHaveProperty("start");
  });

  test("includes image count without object indexes", () => {
    expect(
      summarizeNode({
        end: 14,
        tapeIndex: 3,
        images: [{ end: 13, objectId: "kix.img", start: 12, widthPt: 480 }],
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "",
      }),
    ).toEqual({
      id: 3,
      image: { count: 1, widthPt: 480 },
      kind: "paragraph",
      lossWarning: "FRAGILE: Contains 1 inline image(s). Removing or rewriting this node deletes them.",
      namedStyleType: "NORMAL_TEXT",
    });
  });

  test("liveDump is apply-ready query JSON without revision or empty ops", () => {
    const dump = liveDump({
      documentId: "doc-a",
      nodes: [
        {
          end: 12,
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "HEADING_2",
          start: 1,
          text: "Status",
        },
      ],
    });
    expect(dump.documentId).toBe("doc-a");
    expect(dump).not.toHaveProperty("revision");
    expect(dump).not.toHaveProperty("revisionId");
    expect(dump).not.toHaveProperty("nodes");
    expect(dump.ops).toEqual([]);
    expect(dump.tabs[0]?.ops).toEqual([]);
    expect(dump.tabs[0]?.nodes[0]).toEqual({
      id: 1,
      kind: "paragraph",
      namedStyleType: "HEADING_2",
      text: "Status",
    });
    expect(dump.tabs[0]?.nodes[0]).not.toHaveProperty("start");

    const json = formatOutput(undefined, dump);
    expect(json).not.toContain("revision");
    expect(JSON.parse(json).ops).toEqual([]);
    expect(JSON.parse(json).tabs[0]?.ops).toEqual([]);
  });

  test("compact liveDump over cap echoes headings only", () => {
    const nodes: DocNode[] = [
      {
        end: 2,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 1,
        text: "Section",
      },
      ...Array.from({ length: TAPE_ECHO_CAP }, (_, i) => ({
        end: i + 3,
        tapeIndex: i + 2,
        kind: "paragraph" as const,
        namedStyleType: "NORMAL_TEXT" as const,
        start: i + 2,
        text: `p${i + 2}`,
      })),
    ];
    const dump = liveDump({ nodes });
    expect(dump.truncated).toBe(true);
    expect(dump.tabs[0]?.nodes).toEqual([
      {
        id: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        text: "Section",
      },
    ]);
  });

  test("--full liveDump over cap keeps every node", () => {
    const nodes: DocNode[] = [
      {
        end: 2,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 1,
        text: "Section",
      },
      ...Array.from({ length: TAPE_ECHO_CAP }, (_, i) => ({
        end: i + 3,
        tapeIndex: i + 2,
        kind: "paragraph" as const,
        namedStyleType: "NORMAL_TEXT" as const,
        start: i + 2,
        text: `p${i + 2}`,
      })),
    ];
    const dump = liveDump({ full: true, nodes });
    expect(dump.truncated).toBeUndefined();
    expect(dump.tabs[0]?.nodes).toHaveLength(TAPE_ECHO_CAP + 1);
    expect(dump.tabs[0]?.nodes[1]?.text).toBe("p2");
  });

  describe("matchSnippet", () => {
    test("brackets the hit so an over-broad term is visible", () => {
      expect(matchSnippet("Batching is more efficient.", "ci")).toBe("Batching is more effi[ci]ent.");
    });

    test("is case-insensitive and reports the text as written", () => {
      expect(matchSnippet("See Decisions D1-D5.", "decisions")).toBe("See [Decisions] D1-D5.");
    });

    test("windows long text around the hit", () => {
      const snippet = matchSnippet(`${"a".repeat(80)} needle ${"b".repeat(80)}`, "needle");
      expect(snippet?.startsWith("…")).toBe(true);
      expect(snippet?.endsWith("…")).toBe(true);
      expect(snippet).toContain("[needle]");
      expect(snippet?.length).toBeLessThan(80);
    });

    test("collapses whitespace and returns undefined when absent or empty", () => {
      expect(matchSnippet("wrapped\n  text", "wrapped text")).toBe("[wrapped text]");
      expect(matchSnippet("hello", "zzz")).toBeUndefined();
      expect(matchSnippet("hello", "")).toBeUndefined();
    });
  });

  test("summarizeNode --full keeps empty and long text", () => {
    const long = "x".repeat(120);
    expect(
      summarizeNode(
        {
          end: 10,
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 1,
          text: long,
        },
        { full: true },
      ).text,
    ).toBe(long);
    expect(
      summarizeNode(
        {
          end: 3,
          tapeIndex: 2,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 2,
          text: "",
        },
        { full: true },
      ).text,
    ).toBe("");
  });

  test("summarizeNode compact dump includes non-default text style", () => {
    expect(
      summarizeNode({
        end: 40,
        tapeIndex: 8,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 8,
        style: { fontSize: 10, foregroundColor: "#999999", italic: true },
        text: "Instruction tip.",
      }),
    ).toEqual({
      id: 8,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: { fontSize: 10, foregroundColor: "#999999", italic: true },
      text: "Instruction tip.",
    });
  });

  test("summarizeNode includes markup when it differs from text", () => {
    expect(
      summarizeNode({
        end: 40,
        tapeIndex: 8,
        kind: "paragraph",
        markup: "[Project plan](https://example.com/plan) (draft)",
        namedStyleType: "HEADING_2",
        start: 8,
        text: "Project plan (draft)",
      }).markup,
    ).toBe("[Project plan](https://example.com/plan) (draft)");
  });

  test("does not dump table cell text unless --full", () => {
    const table: DocNode = {
      end: 30,
      tapeIndex: 10,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            { end: 12, start: 10, text: "a" },
            { end: 16, start: 12, text: "b" },
          ],
          [
            { end: 20, start: 16, text: "c" },
            { end: 24, start: 20, text: "d" },
          ],
        ],
      },
    };
    expect(summarizeNode(table)).toEqual({
      id: 10,
      kind: "table",
      table: { cols: 2, rows: 2 },
    });
    expect(summarizeNode(table, { full: true }).table?.cells).toEqual([
      [
        { id: "10.0.0", text: "a" },
        { id: "10.0.1", text: "b" },
      ],
      [
        { id: "10.1.0", text: "c" },
        { id: "10.1.1", text: "d" },
      ],
    ]);
    expect(JSON.stringify(summarizeNode(table, { full: true }))).not.toMatch(/"start"/);
  });
});

describe("resolveTarget", () => {
  test("at is snapshot id only — not startIndex", () => {
    const dom = new DocDom(tape());
    expect(resolveTarget(dom, { at: 12 }).text).toBe("Status");
    expect(resolveTarget(dom, { at: 22 }).text).toBe("In progress.");
    expect(() => resolveTarget(dom, { at: 4457 })).toThrow(/No node with id 4457.*leftover startIndex/);
  });

  test("requires at; extra keys are ignored", () => {
    const dom = new DocDom(tape());
    expect(resolveTarget(dom, { at: 22, select: "ignored" }).text).toBe("In progress.");
    expect(() => resolveTarget(dom, { text: "In progress" })).toThrow(WRITE_AT_ONLY_MSG);
    expect(() => resolveTarget(dom, {})).toThrow(WRITE_AT_ONLY_MSG);
  });

  test("parseWriteAt reads body ids and cell ids", () => {
    expect(parseWriteAt(18)).toEqual({ nodeId: 18 });
    expect(parseWriteAt("18")).toEqual({ nodeId: 18 });
    expect(parseWriteAt("18.0.1")).toEqual({ cell: [0, 1], nodeId: 18 });
    expect(parseWriteAt("18.0.1.1")).toEqual({
      cell: [0, 1],
      nodeId: 18,
      para: 1,
    });
  });

  test("namedStyleType op demotes a heading", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [{ at: 40, namedStyleType: "NORMAL_TEXT" }]);
    const { requests } = compileDom(writer);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "updateParagraphStyle" in r &&
          (r as { updateParagraphStyle: { paragraphStyle: { namedStyleType?: string } } }).updateParagraphStyle
            .paragraphStyle.namedStyleType === "NORMAL_TEXT",
      ),
    ).toBe(true);
  });
});

describe("applyOps", () => {
  test("innerText on a snapshot id", () => {
    const nodes = tape();
    const writer = new DomWriter(nodes);
    const plan = applyOps(writer, [
      {
        at: 22,
        innerText: "Shipped",
      },
    ]);
    expect(plan).toEqual([
      {
        action: "innerText",
        index: 0,
        innerText: "Shipped",
        target: {
          id: 22,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          text: "In progress.",
        },
      },
    ]);
    expect(writer.wrap(nodes[2]!).innerText).toBe("Shipped");
    const { requests } = compileDom(writer);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "insertText" in r &&
          (r as { insertText: { text: string } }).insertText.text === "Shipped",
      ),
    ).toBe(true);
  });

  test("refuses tabId on an individual op", () => {
    const writer = new DomWriter(tape());
    expect(() => applyOps(writer, [{ at: 22, innerText: "X", tabId: "t.0" } as never])).toThrow(/tabId/);
  });

  test("insertAdjacentElement then a follow-up insert on the new sibling", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Alpha",
          },
          position: "afterend",
        },
      },
      {
        at: 51,
        insertAdjacentElement: {
          element: {
            bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Beta",
          },
          position: "afterend",
        },
      },
    ]);
    const { requests } = compileDom(writer);
    const bullets = requests.filter((r) => r && typeof r === "object" && "createParagraphBullets" in r);
    expect(bullets).toHaveLength(1);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "insertText" in r &&
          (r as { insertText: { text: string } }).insertText.text === "Alpha\nBeta",
      ),
    ).toBe(true);
  });

  test("same-anchor afterend ops preserve natural array order without reversing", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Alpha",
          },
          position: "afterend",
        },
      },
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Beta",
          },
          position: "afterend",
        },
      },
    ]);

    const anchorIdx = writer.nodes.findIndex((n) => n.tapeIndex === 12);
    expect(writer.nodes[anchorIdx + 1]?.text).toBe("Alpha");
    expect(writer.nodes[anchorIdx + 2]?.text).toBe("Beta");

    const { requests } = compileDom(writer);
    const bullets = requests.filter((r) => r && typeof r === "object" && "createParagraphBullets" in r);
    expect(bullets).toHaveLength(1);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "insertText" in r &&
          (r as { insertText: { text: string } }).insertText.text === "Alpha\nBeta",
      ),
    ).toBe(true);
  });

  test("multiple same-anchor afterend ops chain 3+ elements in natural order", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "First",
          },
          position: "afterend",
        },
      },
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Second",
          },
          position: "afterend",
        },
      },
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Third",
          },
          position: "afterend",
        },
      },
    ]);

    const anchorIdx = writer.nodes.findIndex((n) => n.tapeIndex === 12);
    expect(writer.nodes[anchorIdx + 1]?.text).toBe("First");
    expect(writer.nodes[anchorIdx + 2]?.text).toBe("Second");
    expect(writer.nodes[anchorIdx + 3]?.text).toBe("Third");
  });

  test("same-anchor afterend with elements array followed by single element op", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          elements: [
            {
              kind: "paragraph",
              namedStyleType: "NORMAL_TEXT",
              text: "Alpha",
            },
            {
              kind: "paragraph",
              namedStyleType: "NORMAL_TEXT",
              text: "Beta",
            },
          ],
          position: "afterend",
        },
      },
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Gamma",
          },
          position: "afterend",
        },
      },
    ]);

    const anchorIdx = writer.nodes.findIndex((n) => n.tapeIndex === 12);
    expect(writer.nodes[anchorIdx + 1]?.text).toBe("Alpha");
    expect(writer.nodes[anchorIdx + 2]?.text).toBe("Beta");
    expect(writer.nodes[anchorIdx + 3]?.text).toBe("Gamma");
  });

  test("remove deletes that node only", () => {
    const nodes = tape();
    const writer = new DomWriter(nodes);
    applyOps(writer, [{ at: 22, remove: true }]);
    const { requests } = compileDom(writer);
    expect(requests).toEqual([{ deleteContentRange: { range: { endIndex: 40, startIndex: 22 } } }]);
  });

  test("transparently converts remove on the last paragraph to clear innerText and NORMAL_TEXT", () => {
    const nodes = tape();
    const writer = new DomWriter(nodes);
    const plan = applyOps(writer, [{ at: 50, remove: true }]);
    expect(plan[0]?.action).toBe("innerText");
    expect(plan[0]?.innerText).toBe("");
    expect(plan[0]?.namedStyleType).toBe("NORMAL_TEXT");
    const { requests } = compileDom(writer);
    expect(requests.length).toBeGreaterThan(0);
  });

  test("transparently converts remove when all paragraphs are removed in batch", () => {
    const nodes = tape();
    const writer = new DomWriter(nodes);
    const plan = applyOps(writer, [
      { at: 1, remove: true },
      { at: 12, remove: true },
      { at: 22, remove: true },
      { at: 40, remove: true },
      { at: 50, remove: true },
    ]);
    expect(plan[4]?.action).toBe("innerText");
    expect(plan[4]?.innerText).toBe("");
    expect(plan[4]?.namedStyleType).toBe("NORMAL_TEXT");
    const { requests } = compileDom(writer);
    expect(requests.length).toBeGreaterThan(0);
  });

  test("refuses p/q/ul/ol in element JSON", () => {
    expect(() => elementFromJson({ kind: "ul", text: "x" })).toThrow(/No p\/q\/ul\/ol aliases/);
  });

  test("each op needs exactly one action", () => {
    const writer = new DomWriter(tape());
    expect(() => applyOps(writer, [{ at: 1, innerText: "x", remove: true }])).toThrow(/cannot combine/);
  });

  test("allows innerText and namedStyleType to combine on a paragraph", () => {
    const writer = new DomWriter(tape());
    const plan = applyOps(writer, [{ at: 1, innerText: "New Title", namedStyleType: "TITLE" }]);
    expect(plan[0]?.action).toBe("innerText");
    expect(plan[0]?.innerText).toBe("New Title");
    expect(plan[0]?.namedStyleType).toBe("TITLE");

    const node = writer.nodes.find((n) => n.tapeIndex === 1);
    expect(node?.text).toBe("New Title");
    expect(node?.namedStyleType).toBe("TITLE");
  });

  test("automatically splits multiline codeBlock into consecutive 0-margin paragraphs", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [
      {
        at: 1,
        insertAdjacentElement: {
          element: {
            kind: "codeBlock",
            text: "const a = 1;\nconst b = 2;",
          },
          position: "afterend",
        },
      },
    ]);
    const inserted1 = writer.nodes.find((n) => n.text === "const a = 1;");
    const inserted2 = writer.nodes.find((n) => n.text === "const b = 2;");
    expect(inserted1).toBeDefined();
    expect(inserted2).toBeDefined();
    expect(inserted1?.spaceBelow).toBe(0);
    expect(inserted1?.lineSpacing).toBe(100);
    expect(inserted2?.spaceBelow).toBeUndefined();
  });

  test("warns when inserting a paragraph that already sits next door", () => {
    const writer = new DomWriter(tape());
    const plan = applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "In progress.",
          },
          position: "afterend",
        },
      },
    ]);
    expect(plan[0]?.warnings?.some((w) => /already says the same thing/.test(w))).toBe(true);
  });

  test("warns when inserting after a list item without bullet", () => {
    const listNode: DocNode = {
      bullet: { listId: "kix.list", nestingLevel: 0 },
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "Item 1",
    };
    const writer = new DomWriter([listNode]);
    const plan = applyOps(writer, [
      {
        at: 1,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Item 2",
          },
          position: "afterend",
        },
      },
    ]);
    expect(plan[0]?.warnings?.some((w) => /stripped inherited list glyph/.test(w))).toBe(true);
  });

  test("accepts bullet: true to continue list without warning and inherits nestingLevel", () => {
    const listNode: DocNode = {
      bullet: { listId: "kix.list", nestingLevel: 1 },
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "Item 1",
    };
    const writer = new DomWriter([listNode]);
    const plan = applyOps(writer, [
      {
        at: 1,
        insertAdjacentElement: {
          element: {
            bullet: true,
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "Item 2",
          },
          position: "afterend",
        },
      },
    ]);
    expect(Boolean(plan[0]?.warnings?.some((w) => /stripped inherited list glyph/.test(w)))).toBe(false);
    expect(writer.nodes[1]?.bullet?.nestingLevel).toBe(1);
  });

  test("hard-refuses mutating smart chips without force, allows with force", () => {
    const makeWriter = () =>
      new DomWriter([
        {
          chips: [
            {
              end: 11,
              start: 10,
              title: "Unit template",
              uri: "https://docs.google.com/document/d/abc/edit",
            },
          ],
          end: 20,
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 1,
          text: "From Unit template",
        },
      ]);

    const writer1 = makeWriter();
    expect(() => applyOps(writer1, [{ at: 1, innerText: "rewritten" }])).toThrow(
      /Refusing to innerText node 1 \(contains 1 smart chip\(s\): "Unit template"\)/,
    );

    const writer2 = makeWriter();
    const plan = applyOps(writer2, [{ at: 1, force: true, innerText: "rewritten" }]);
    expect(plan[0]?.warnings).toEqual([CHIP_MUTATE_MSG]);
    expect(writer2.nodes[0]?.text).toBe("rewritten");
  });

  test("inserts get the next snapshot id after max(existing)", () => {
    const writer = new DomWriter(tape());
    applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          element: {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            text: "New",
          },
          position: "afterend",
        },
      },
    ]);
    const created = writer.nodes.find((n) => n.text === "New");
    expect(created?.tapeIndex).toBe(51);
    expect(resolveTarget(new DocDom(writer.nodes), { at: 51 }).text).toBe("New");
  });

  test("innerText may combine with style", () => {
    const writer = new DomWriter(tape());
    const plan = applyOps(writer, [{ at: 22, innerText: "Shipped", style: { alignment: "CENTER", spaceAbove: 12 } }]);
    expect(plan[0]?.action).toBe("innerText");
    expect(plan[0]?.style).toEqual({ alignment: "CENTER", spaceAbove: 12 });
    const { requests } = compileDom(writer);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "updateParagraphStyle" in r &&
          (r as { updateParagraphStyle: { paragraphStyle: { alignment?: string } } }).updateParagraphStyle
            .paragraphStyle.alignment === "CENTER",
      ),
    ).toBe(true);
  });

  test("style indentStart on a shared list warns hanging and siblings", () => {
    const writer = new DomWriter([
      {
        bullet: { listId: "kix.x", nestingLevel: 0 },
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 1,
        text: "One",
      },
      {
        bullet: { listId: "kix.x", nestingLevel: 0 },
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Two",
      },
    ]);
    const plan = applyOps(writer, [{ at: 1, style: { indentStart: 18 } }]);
    expect(plan[0]?.warnings?.some((w) => /hanging indentFirstLine 0/.test(w))).toBe(true);
    expect(plan[0]?.warnings?.some((w) => /shared by 1 other/.test(w))).toBe(true);
  });

  test("bullet restyle warns and refuses nestingLevel change", () => {
    const writer = new DomWriter([
      {
        bullet: { listId: "kix.x", nestingLevel: 0 },
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 1,
        text: "One",
      },
      {
        bullet: { listId: "kix.x", nestingLevel: 0 },
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Two",
      },
    ]);
    const plan = applyOps(writer, [{ at: 1, bullet: { preset: "NUMBERED_DECIMAL_ALPHA_ROMAN" } }]);
    expect(plan[0]?.action).toBe("bullets");
    expect(plan[0]?.warnings?.some((w) => /converts 2 item/.test(w))).toBe(true);
    expect(() =>
      applyOps(writer, [{ at: 1, bullet: { nestingLevel: 1, preset: "BULLET_DISC_CIRCLE_SQUARE" } }]),
    ).toThrow(EXISTING_NEST_MSG);
  });

  test("liveDump stamps tape/segmentId for header files, not mixed body dump", () => {
    const dump = liveDump({
      documentId: "doc",
      nodes: [
        {
          end: 8,
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 1,
          text: "CONFIDENTIAL",
        },
      ],
      segmentId: "kix.h",
      tape: "header",
      use: "default",
    });
    expect(dump).toMatchObject({
      documentId: "doc",
      segmentId: "kix.h",
      tape: "header",
      use: "default",
    });
    expect(dump).not.toHaveProperty("headers");
    expect(dump.tabs[0]?.nodes[0]).toMatchObject({ id: 1, text: "CONFIDENTIAL" });
  });

  test("liveDump stamps tabId / tabTitle on body query files", () => {
    const dump = liveDump({
      documentId: "doc",
      nodes: [
        {
          end: 8,
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 1,
          text: "Hello",
        },
      ],
      tabId: "t.0",
      tabTitle: "Intro",
      tape: "body",
    });
    expect(dump).toMatchObject({
      documentId: "doc",
      tape: "body",
      tabs: [{ tabId: "t.0", tabTitle: "Intro" }],
    });
  });

  test("--full dumps cell ids and extra paragraphs without start/end", () => {
    const table: DocNode = {
      end: 40,
      tapeIndex: 10,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            {
              end: 12,
              paragraphs: [
                { end: 12, start: 10, text: "Photo" },
                { end: 24, start: 12, text: "caption" },
              ],
              start: 10,
              text: "Photo",
            },
          ],
        ],
      },
    };
    const cells = summarizeNode(table, { full: true }).table?.cells;
    expect(cells?.[0]?.[0]).toEqual({
      id: "10.0.0",
      text: "Photo",
      paragraphs: [{ id: "10.0.0.1", text: "caption" }],
    });
    expect(JSON.stringify(cells)).not.toMatch(/"start"/);
  });

  test("applyOps writes a cell by namespaced at", () => {
    const table: DocNode = {
      end: 40,
      tapeIndex: 10,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            {
              end: 20,
              paragraphs: [
                { end: 12, start: 10, text: "Photo" },
                { end: 24, start: 12, text: "caption" },
              ],
              start: 10,
              text: "Photo",
            },
          ],
        ],
      },
    };
    const writer = new DomWriter([table]);
    applyOps(writer, [{ at: "10.0.0.1", innerText: "under the photo" }]);
    expect(writer.nodes[0]?.table?.cells[0]?.[0]?.paragraphs?.[1]?.text).toBe("under the photo");
    expect(() => applyOps(writer, [{ at: 10, cell: [0, 0], innerText: "nope" } as never])).toThrow(/cell id/);
  });

  test("elementFromJson accepts pageBreak and checkbox bullets", () => {
    expect(elementFromJson({ kind: "pageBreak" })).toEqual({ kind: "pageBreak" });
    expect(
      elementFromJson({
        bullet: { preset: "BULLET_CHECKBOX" },
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        text: "Done",
      }),
    ).toMatchObject({
      bullet: { preset: "BULLET_CHECKBOX" },
      kind: "paragraph",
    });
  });

  test("elementFromJson table rows are at the element root (nested table.rows also ok)", () => {
    expect(elementFromJson({ kind: "table", rows: [["A", "B"]] })).toEqual({
      kind: "table",
      table: { rows: [["A", "B"]] },
    });
    expect(elementFromJson({ kind: "table", table: { rows: [["A"]] } })).toEqual({
      kind: "table",
      table: { rows: [["A"]] },
    });
    expect(() => elementFromJson({ kind: "table" })).toThrow(/rows/);
  });

  test("elementFromJson accepts codeBlock", () => {
    expect(elementFromJson({ kind: "codeBlock", text: '{"key": "value"}' })).toEqual({
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        lineSpacing: 100,
      },
      text: '{"key": "value"}',
    });
  });

  test("insertAdjacentElement with elements array chains siblings in order", () => {
    const writer = new DomWriter(tape());
    const plan = applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          elements: [
            {
              bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
              kind: "paragraph",
              namedStyleType: "NORMAL_TEXT",
              text: "Alpha",
            },
            {
              bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
              kind: "paragraph",
              namedStyleType: "NORMAL_TEXT",
              text: "Beta",
            },
            {
              kind: "codeBlock",
              text: 'console.log("hello");',
            },
          ],
          position: "afterend",
        },
      },
    ]);

    expect(plan).toHaveLength(3);
    expect(plan[0]?.target.id).toBe(12);
    expect(plan[1]?.target.id).toBe(51);
    expect(plan[2]?.target.id).toBe(52);

    const { requests } = compileDom(writer);
    const bullets = requests.filter((r) => r && typeof r === "object" && "createParagraphBullets" in r);
    expect(bullets).toHaveLength(1);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "insertText" in r &&
          (r as { insertText: { text: string } }).insertText.text === "Alpha\nBeta",
      ),
    ).toBe(true);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "insertText" in r &&
          (r as { insertText: { text: string } }).insertText.text === 'console.log("hello");',
      ),
    ).toBe(true);
  });

  test("insertAdjacentElement with elements array position beforebegin", () => {
    const writer = new DomWriter(tape());
    const plan = applyOps(writer, [
      {
        at: 12,
        insertAdjacentElement: {
          elements: [
            {
              kind: "paragraph",
              namedStyleType: "NORMAL_TEXT",
              text: "First",
            },
            {
              kind: "paragraph",
              namedStyleType: "NORMAL_TEXT",
              text: "Second",
            },
          ],
          position: "beforebegin",
        },
      },
    ]);

    expect(plan).toHaveLength(2);
    expect(plan[0]?.target.id).toBe(12);
    expect(plan[0]?.insertAdjacentElement?.position).toBe("beforebegin");
    expect(plan[1]?.target.id).toBe(51);
    expect(plan[1]?.insertAdjacentElement?.position).toBe("afterend");
  });

  test("insertAdjacentElement with cloneNode copies node structure and styles", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Title",
      },
      {
        end: 30,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        style: {
          fontSize: 10,
          foregroundColor: "#999999",
        },
        text: "Template Metadata Line",
      },
      {
        end: 50,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        text: "Body text",
      },
    ];

    const writer = new DomWriter(nodes);
    const plan = applyOps(writer, [
      {
        at: 3,
        insertAdjacentElement: {
          cloneNode: {
            nodeId: 2,
            innerText: "Cloned & Replaced Metadata",
          },
          position: "afterend",
        },
      },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0]?.action).toBe("insertAdjacentElement");
    expect(plan[0]?.insertAdjacentElement?.kind).toBe("paragraph");
    expect(plan[0]?.insertAdjacentElement?.text).toBe("Cloned & Replaced Metadata");
    const mutations = writer.mutations();
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.type).toBe("insertAdjacent");
    if (mutations[0]?.type === "insertAdjacent") {
      const inserted = mutations[0].spec as ParagraphSpec;
      expect(inserted.text).toBe("Cloned & Replaced Metadata");
      expect(inserted.namedStyleType).toBe("NORMAL_TEXT");
      expect(inserted.style?.fontSize).toBe(10);
      expect(inserted.style?.foregroundColor).toBe("#999999");
    }
  });

  test("cloneNode with images or chips surfaces API degradation warnings in plan", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Title",
      },
      {
        chips: [{ end: 30, start: 10, title: "Brian Dombrowski", uri: "mailto:brian@example.com" }],
        end: 30,
        tapeIndex: 2,
        images: [{ end: 30, heightPt: 100, objectId: "img-1", start: 10, widthPt: 100 }],
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Author profile",
      },
      {
        end: 50,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        text: "Target",
      },
    ];

    const writer = new DomWriter(nodes);
    const plan = applyOps(writer, [
      {
        at: 3,
        insertAdjacentElement: {
          cloneNode: 2,
          position: "afterend",
        },
      },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0]?.warnings).toBeDefined();
    expect(plan[0]?.warnings?.some((w) => w.includes("inline image has no public source URI"))).toBe(true);
    expect(plan[0]?.warnings?.some((w) => w.includes("smart chip(s) flattened"))).toBe(false);
    const mutations = writer.mutations();
    expect(mutations).toHaveLength(1);
    if (mutations[0]?.type === "insertAdjacent") {
      const inserted = mutations[0].spec as ParagraphSpec;
      expect(inserted.specials?.some((s) => s.kind === "person")).toBe(true);
    }
  });

  test("cloneNode throws descriptive errors for unsupported kinds like tableOfContents or sectionBreak", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        tapeIndex: 1,
        kind: "tableOfContents",
        start: 0,
      },
      {
        end: 20,
        tapeIndex: 2,
        kind: "sectionBreak",
        start: 10,
      },
      {
        end: 40,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "Paragraph",
      },
    ];

    const writer = new DomWriter(nodes);
    expect(() => {
      applyOps(writer, [
        {
          at: 3,
          insertAdjacentElement: {
            cloneNode: 1,
            position: "afterend",
          },
        },
      ]);
    }).toThrow(/Google Docs REST API does not support inserting or duplicating Table of Contents/);

    expect(() => {
      applyOps(writer, [
        {
          at: 3,
          insertAdjacentElement: {
            cloneNode: 2,
            position: "afterend",
          },
        },
      ]);
    }).toThrow(/Section breaks cannot be cloned detachedly/);
  });

  test("liveDump surfaces customStyledNodes and --styles dictionary", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Title",
      },
      {
        end: 30,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        style: {
          fontSize: 10,
          foregroundColor: "#999999",
        },
        text: "Custom styled",
      },
    ];

    const defaultDump = liveDump({ nodes });
    expect(defaultDump.customStyledNodes).toEqual([2]);
    expect(defaultDump.styles).toBeUndefined();

    const withStylesDump = liveDump({ includeStyles: true, nodes });
    expect(withStylesDump.customStyledNodes).toEqual([2]);
    expect(withStylesDump.styles).toEqual({
      "2": {
        fontSize: 10,
        foregroundColor: "#999999",
      },
    });
  });

  test("after and before anchors configure insert position", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Title" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Body" },
    ];
    const writer = new DomWriter(nodes);

    // after: 1 -> inserts afterend
    applyOps(writer, [
      {
        after: 1,
        insertAdjacentElement: {
          element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "After Title" },
        },
      },
    ]);
    expect(writer.nodes.map((n) => n.text)).toEqual(["Title", "After Title", "Body"]);

    // before: 1 -> inserts beforebegin
    applyOps(writer, [
      {
        before: 1,
        insertAdjacentElement: {
          element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Preamble" },
        },
      },
    ]);
    expect(writer.nodes.map((n) => n.text)).toEqual(["Preamble", "Title", "After Title", "Body"]);
  });

  test("insertMarkdown parses and inserts markdown at anchor", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Title" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Body" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: 1,
        insertMarkdown: "### Section\nParagraph line.\n- Item A\n- Item B",
      },
    ]);

    expect(writer.nodes.map((n) => n.text)).toEqual([
      "Title",
      "Section",
      "Paragraph line.",
      "Item A",
      "Item B",
      "Body",
    ]);
    expect(writer.nodes[1]?.namedStyleType).toBe("HEADING_3");
    expect(writer.nodes[3]?.bullet).toBeDefined();
  });

  test("replace alias updates innerText", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Old Title" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [{ at: 1, replace: "New Title" }]);
    expect(writer.nodes[0]?.text).toBe("New Title");
  });

  test("replaceMarkdown on a single paragraph updates in-place or expands", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "Old text" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Trailing" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        at: 1,
        replaceMarkdown: "Updated line 1.\n\nUpdated line 2.",
      },
    ]);

    expect(writer.nodes.map((n) => n.text)).toEqual(["Updated line 1.", "Updated line 2.", "Trailing"]);
    // Original node 1 is updated in place, retaining id: 1
    expect(writer.nodes[0]?.tapeIndex).toBe(1);
  });

  test("replaceMarkdown (structured spec form) applies an added inline run even when plain text is unchanged", () => {
    // Regression: diffAndApplyMarkdown's LCS matching keyed solely off checksums that ignored
    // run-level styling. A structured ElementSpec whose plain text matched the existing node
    // but which added a `code` run was treated as an unchanged "match" and silently skipped —
    // the styling edit never reached the document. (Markdown-*string* replaceMarkdown isn't
    // affected by this path: its incoming spec.text retains raw markdown syntax, e.g. backticks,
    // which already differs textually from the old node's plain text.)
    const nodes: DocNode[] = [
      {
        end: 60,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 0,
        tapeIndex: 1,
        text: "Uses AutomatedCampaignMessageQueueItems for sending",
      },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        at: 1,
        replaceMarkdown: [
          {
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            runs: [{ code: true, end: 39, start: 5 }],
            text: "Uses AutomatedCampaignMessageQueueItems for sending",
          },
        ],
      },
    ]);

    // Same node — but the code run must have actually been applied, not silently skipped.
    expect(writer.nodes).toHaveLength(1);

    const mutations = writer.mutations();
    const innerTextMutation = mutations.find((m) => (m as { type?: string }).type === "innerText") as
      | { runs?: Array<{ code?: boolean; end?: number; start?: number }> }
      | undefined;
    expect(innerTextMutation?.runs?.some((r) => r.code === true)).toBe(true);
  });

  test("replaceSection on a section diffs and preserves unchanged nodes", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.arch",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 0,
        text: "Architecture",
      },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Intro paragraph" },
      {
        end: 30,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "Old detail to change",
      },
      {
        end: 40,
        tapeIndex: 4,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        text: "Conclusion paragraph",
      },
      {
        end: 50,
        headingId: "h.next",
        tapeIndex: 5,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 40,
        text: "Next Section",
      },
    ];
    const writer = new DomWriter(nodes);

    // Markdown updates node 3, keeps node 1, 2, 4 unchanged, and adds a new bullet
    const md = `## Architecture

Intro paragraph

Brand new detail

Conclusion paragraph

- Extra point`;

    const plan = applyOps(writer, [{ at: "h.arch", replaceSection: md }]);

    expect(plan[0]?.action).toBe("replaceSection");
    // Heading (id: 1) preserved
    expect(writer.nodes[0]?.tapeIndex).toBe(1);
    expect(writer.nodes[0]?.text).toBe("Architecture");

    // Intro (id: 2) preserved untouched
    expect(writer.nodes[1]?.tapeIndex).toBe(2);
    expect(writer.nodes[1]?.text).toBe("Intro paragraph");

    // Node 3 updated in place
    expect(writer.nodes[2]?.tapeIndex).toBe(3);
    expect(writer.nodes[2]?.text).toBe("Brand new detail");

    // Conclusion (id: 4) preserved untouched
    expect(writer.nodes[3]?.tapeIndex).toBe(4);
    expect(writer.nodes[3]?.text).toBe("Conclusion paragraph");

    // New bullet inserted
    expect(writer.nodes[4]?.text).toBe("Extra point");
    expect(writer.nodes[4]?.bullet).toBeDefined();

    // Next section (id: 5) untouched
    expect(writer.nodes[5]?.tapeIndex).toBe(5);
    expect(writer.nodes[5]?.text).toBe("Next Section");
  });

  test("replaceSection without leading heading preserves the anchor heading and replaces section body", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.mot",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 0,
        text: "Motivation",
      },
      {
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Old placeholder text",
      },
      {
        end: 30,
        headingId: "h.obj",
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 20,
        text: "Objective",
      },
    ];
    const writer = new DomWriter(nodes);

    const plan = applyOps(writer, [{ at: "h.mot", replaceSection: "New motivation body line 1\n\n- Bullet A" }]);

    expect(plan[0]?.action).toBe("replaceSection");
    // Anchor heading preserved as HEADING_2
    expect(writer.nodes[0]?.headingId).toBe("h.mot");
    expect(writer.nodes[0]?.namedStyleType).toBe("HEADING_2");
    expect(writer.nodes[0]?.text).toBe("Motivation");

    // Placeholder replaced by new body
    expect(writer.nodes[1]?.text).toBe("New motivation body line 1");
    expect(writer.nodes[1]?.namedStyleType).toBe("NORMAL_TEXT");
    expect(writer.nodes[2]?.text).toBe("Bullet A");
    expect(writer.nodes[2]?.bullet).toBeDefined();

    // Following section untouched
    expect(writer.nodes[3]?.headingId).toBe("h.obj");
    expect(writer.nodes[3]?.text).toBe("Objective");
  });

  test("replaceSection with subheadings preserves anchor heading and diffs section body", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.dec",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 0,
        text: "Decisions",
      },
      {
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Old placeholder description",
      },
      {
        end: 30,
        headingId: "h.d1old",
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "HEADING_3",
        start: 20,
        text: "D1: Old Decision",
      },
      {
        end: 40,
        tapeIndex: 4,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        text: "Old decision context",
      },
    ];
    const writer = new DomWriter(nodes);

    const md = "### D1: New Decision 1\n\nContext for D1\n\n### D2: New Decision 2\n\nContext for D2";
    const plan = applyOps(writer, [{ at: "h.dec", replaceSection: md }]);

    expect(plan[0]?.action).toBe("replaceSection");
    // Anchor heading Decisions preserved as HEADING_2
    expect(writer.nodes[0]?.headingId).toBe("h.dec");
    expect(writer.nodes[0]?.namedStyleType).toBe("HEADING_2");
    expect(writer.nodes[0]?.text).toBe("Decisions");

    // Body replaced with D1 and D2 subsections
    expect(writer.nodes[1]?.namedStyleType).toBe("HEADING_3");
    expect(writer.nodes[1]?.text).toBe("D1: New Decision 1");
    expect(writer.nodes[2]?.namedStyleType).toBe("NORMAL_TEXT");
    expect(writer.nodes[2]?.text).toBe("Context for D1");
    expect(writer.nodes[3]?.namedStyleType).toBe("HEADING_3");
    expect(writer.nodes[3]?.text).toBe("D2: New Decision 2");
    expect(writer.nodes[4]?.namedStyleType).toBe("NORMAL_TEXT");
    expect(writer.nodes[4]?.text).toBe("Context for D2");
  });

  test("replaceMarkdown on a heading replaces ONLY the heading without touching children", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.arch",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 0,
        text: "Old Architecture",
      },
      {
        end: 20,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Section paragraph 1",
      },
      {
        end: 30,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "Section paragraph 2",
      },
    ];
    const writer = new DomWriter(nodes);

    const plan = applyOps(writer, [{ at: "h.arch", replaceMarkdown: "## Updated Architecture" }]);

    expect(plan[0]?.action).toBe("replaceMarkdown");
    expect(writer.nodes.map((n) => n.text)).toEqual([
      "Updated Architecture",
      "Section paragraph 1",
      "Section paragraph 2",
    ]);
    expect(writer.nodes[0]?.tapeIndex).toBe(1);
    expect(writer.nodes[1]?.tapeIndex).toBe(2);
    expect(writer.nodes[2]?.tapeIndex).toBe(3);
  });

  test("replaceSection requires a heading node target", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "Regular paragraph" },
    ];
    const writer = new DomWriter(nodes);

    expect(() => applyOps(writer, [{ at: 1, replaceSection: "New text" }])).toThrow(
      /replaceSection requires a heading node target/,
    );
  });

  test("replaceSection guards against deleting child headings under top-level heading", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.top",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Top Heading",
      },
      {
        end: 20,
        headingId: "h.sub",
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 10,
        text: "Sub Heading",
      },
      { end: 30, tapeIndex: 3, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, text: "Body text" },
    ];
    const writer = new DomWriter(nodes);

    expect(() => applyOps(writer, [{ at: "h.top", replaceSection: "# New Top Heading\n\nSome body" }])).toThrow(
      /replaceSection on HEADING_1.*would delete 1 child heading\(s\)/,
    );

    // Passes when force: true
    expect(() =>
      applyOps(writer, [{ at: "h.top", force: true, replaceSection: "# New Top Heading\n\nSome body" }]),
    ).not.toThrow();
  });

  test("replaceSection on empty heading body inserts after the heading, not before", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.top",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Top Heading",
      },
      {
        end: 20,
        headingId: "h.next",
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 10,
        text: "Next Heading",
      },
    ];
    const writer = new DomWriter(nodes);
    applyOps(writer, [{ at: "h.top", replaceSection: "New body for top" }]);

    expect(writer.nodes.map((n) => n.text)).toEqual(["Top Heading", "New body for top", "Next Heading"]);
  });

  test("anti-demolition guard blocks deleting and recreating unchanged nodes", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.arch",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 0,
        text: "Architecture",
      },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Component A" },
      { end: 30, tapeIndex: 3, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, text: "Component B" },
      {
        end: 40,
        headingId: "h.next",
        tapeIndex: 4,
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 30,
        text: "Next Section",
      },
    ];

    const lazyOps: DomOp[] = [
      { at: "h.arch", dangerousRemoveSection: true },
      {
        after: 4,
        insertAdjacentElement: {
          elements: [
            { kind: "paragraph", namedStyleType: "HEADING_2", text: "Architecture" },
            { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Component A" },
            { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Component B Modified" },
          ],
        },
      },
    ];

    const writer = new DomWriter(nodes);
    expect(() => applyOps(writer, lazyOps)).toThrow(
      /Lazy replacement rejected: 2 unchanged node\(s\) were deleted and re-created with identical content:/,
    );

    // Bypassed when force: true
    const forceWriter = new DomWriter(nodes);
    expect(() => applyOps(forceWriter, lazyOps, 0, { force: true })).not.toThrow();
  });

  test("replaceSection cleanly removes deleted section nodes", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.sec",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Section",
      },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Keep this" },
      { end: 30, tapeIndex: 3, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, text: "Delete this 1" },
      { end: 40, tapeIndex: 4, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 30, text: "Delete this 2" },
      {
        end: 50,
        headingId: "h.next",
        tapeIndex: 5,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 40,
        text: "Next",
      },
    ];
    const writer = new DomWriter(nodes);

    const md = `# Section\n\nKeep this`;
    applyOps(writer, [{ at: "h.sec", replaceSection: md }]);

    expect(writer.nodes.map((n) => n.text)).toEqual(["Section", "Keep this", "Next"]);
    expect(writer.nodes[0]?.tapeIndex).toBe(1);
    expect(writer.nodes[1]?.tapeIndex).toBe(2);
    expect(writer.nodes[2]?.tapeIndex).toBe(5);
  });

  /** Tests that replaceSection updates nested bullet indentation when item nesting level changes. */
  test("replaceSection updates nested bullet indentation when item nesting level changes", () => {
    const nodes: DocNode[] = [
      {
        end: 15,
        headingId: "h.list",
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 0,
        tapeIndex: 1,
        text: "List Section",
      },
      {
        bullet: { nestingLevel: 0, preset: "BULLET_DISC_CIRCLE_SQUARE", type: "BULLET" },
        end: 30,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 15,
        tapeIndex: 2,
        text: "Parent bullet",
      },
      {
        bullet: { nestingLevel: 0, preset: "BULLET_DISC_CIRCLE_SQUARE", type: "BULLET" },
        end: 45,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        tapeIndex: 3,
        text: "Child bullet",
      },
      {
        end: 60,
        headingId: "h.next",
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 45,
        tapeIndex: 4,
        text: "Next Section",
      },
    ];
    const writer = new DomWriter(nodes);

    const md = `## List Section\n- Parent bullet\n  - Child bullet`;
    applyOps(writer, [{ at: "h.list", replaceSection: md }]);

    expect(writer.nodes.map((n) => n.text)).toEqual(["List Section", "Parent bullet", "Child bullet", "Next Section"]);
    // Parent bullet unchanged (preserved)
    expect(writer.nodes[1]?.tapeIndex).toBe(2);
    expect(writer.nodes[1]?.bullet?.nestingLevel).toBe(0);
    // Child bullet nesting level updated to 1
    expect(writer.nodes[2]?.bullet?.nestingLevel).toBe(1);
  });

  test("anti-demolition guard catches re-creating nodes after dangerousClear", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "Important Note" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Another Note" },
    ];
    const writer = new DomWriter(nodes);
    const cleared = executeDangerousClear(writer);

    const lazyInsert: DomOp[] = [
      {
        after: writer.nodes[0]?.tapeIndex,
        insertAdjacentElement: {
          element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Important Note" },
        },
      },
    ];

    expect(() => applyOps(writer, lazyInsert, 0, { clearedNodes: cleared })).toThrow(
      /Lazy replacement rejected: 1 unchanged node\(s\) were deleted and re-created with identical content:/,
    );
  });

  test("anti-demolition guard passes when inserted nodes are genuinely new", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "Old Note" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Tail" },
    ];
    const writer = new DomWriter(nodes);
    const ops: DomOp[] = [
      { at: 1, remove: true },
      {
        after: 2,
        insertAdjacentElement: {
          element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Brand New Note" },
        },
      },
    ];

    expect(() => applyOps(writer, ops)).not.toThrow();
    expect(writer.nodes.map((n) => n.text)).toEqual(["Tail", "Brand New Note"]);
  });

  test("top-level element and elements work without insertAdjacentElement", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Title" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: 1,
        element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Single element" },
      },
      {
        after: 1,
        elements: [
          { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Array element 1" },
          { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Array element 2" },
        ],
      },
    ]);

    expect(writer.nodes.map((n) => n.text)).toEqual(["Title", "Single element", "Array element 1", "Array element 2"]);
  });

  test("as named anchor allows referring to newly inserted node in subsequent op", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        headingId: "h.intro",
        tapeIndex: 1,
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 0,
        text: "Intro",
      },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Footer" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: "h.intro",
        as: "step1",
        element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Step 1" },
      },
      {
        after: "step1",
        as: "step2",
        element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "Step 2" },
      },
      {
        after: "step2",
        insertMarkdown: "Step 3",
      },
    ]);

    expect(writer.nodes.map((n) => n.text)).toEqual(["Intro", "Step 1", "Step 2", "Step 3", "Footer"]);
  });

  test("as named anchor works with tables and cell targeting", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Report" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: 1,
        as: "myTable",
        element: {
          kind: "table",
          rows: [
            ["Item", "Price"],
            ["Widget", "10"],
          ],
        },
      },
      {
        at: "myTable.0.1",
        innerText: "Cost",
      },
      {
        after: "myTable",
        element: { kind: "paragraph", namedStyleType: "NORMAL_TEXT", text: "End of table" },
      },
    ]);

    expect(writer.nodes.map((n) => n.kind)).toEqual(["paragraph", "table", "paragraph"]);
    const table = writer.nodes[1]!;
    expect(table.table?.cells?.[0]?.[1]?.text).toBe("Cost");
    expect(writer.nodes[2]?.text).toBe("End of table");
  });

  test("as named anchor on multi-element insert chains after the tail", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Title" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Footer" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: 1,
        as: "sectionBlock",
        insertMarkdown: "### Section 1\n\nParagraph A\n\nParagraph B",
      },
      {
        after: "sectionBlock",
        insertMarkdown: "### Section 2",
      },
    ]);

    expect(writer.nodes.map((n) => n.text)).toEqual([
      "Title",
      "Section 1",
      "Paragraph A",
      "Paragraph B",
      "Section 2",
      "Footer",
    ]);
  });

  test("markdownStyles attribute on op applies custom styles", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "TITLE", start: 0, text: "Title" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: 1,
        insertMarkdown: "::alert[Warning:]:: system overload",
        markdownStyles: {
          alert: { bold: true, color: "#ff0000" },
        },
      },
    ]);

    expect(writer.nodes[1]?.kind).toBe("paragraph");
    expect(writer.nodes[1]?.text).toBe("::alert[Warning:]:: system overload");

    const mutations = writer.mutations();
    expect(mutations).toHaveLength(1);
    const spec = (mutations[0] as any)?.spec as { runs?: Array<{ foregroundColor?: string }> };
    expect(spec.runs).toBeDefined();
    expect(spec.runs?.some((r) => r.foregroundColor === "#ff0000")).toBe(true);
  });

  test("h1IsTitle on insertMarkdown maps the first # to TITLE", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "" },
    ];
    const writer = new DomWriter(nodes);

    applyOps(writer, [
      {
        after: 1,
        h1IsTitle: true,
        insertMarkdown: "# Doc Title\n\nBody",
      },
    ]);

    expect(writer.nodes[1]?.namedStyleType).toBe("TITLE");
    expect(writer.nodes[1]?.text).toBe("Doc Title");
    expect(writer.nodes[2]?.text).toBe("Body");
  });

  test("insertMarkdown and replaceSection directly accept file path", () => {
    const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");

    const tmpDir = mkdtempSync(join(tmpdir(), "gws-test-"));
    const insertPath = join(tmpDir, "insert.md");
    const replacePath = join(tmpDir, "replace.md");

    writeFileSync(insertPath, "Inserted from file.");
    writeFileSync(replacePath, "## Replaced from file\n\nNew section body.");

    try {
      const nodes: DocNode[] = [
        {
          end: 10,
          headingId: "h.sec",
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "HEADING_2",
          start: 0,
          text: "Old Heading",
        },
        { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Old body" },
      ];
      const writer = new DomWriter(nodes);

      applyOps(writer, [
        { at: "h.sec", replaceSection: replacePath },
        { after: "h.sec", insertMarkdown: insertPath },
      ]);

      expect(writer.nodes[0]?.text).toBe("Replaced from file");
      expect(writer.nodes[1]?.text).toBe("Inserted from file.");
      expect(writer.nodes[2]?.text).toBe("New section body.");
    } finally {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  test("summarizeNode surfaces hasEquation, hasHorizontalRule, and lossWarning", () => {
    const eqNode: DocNode = {
      end: 20,
      hasEquation: true,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 0,
      text: "x = (-b +- sqrt(b^2 - 4ac)) / 2a",
    };
    const eqSummary = summarizeNode(eqNode);
    expect(eqSummary.hasEquation).toBe(true);
    expect(eqSummary.lossWarning).toContain("IMMUTABLE: Contains math equation");

    const chipNode: DocNode = {
      chips: [{ end: 10, start: 0, title: "Alice", uri: "mailto:alice@example.com" }],
      end: 20,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 0,
      text: "Alice",
    };
    const chipSummary = summarizeNode(chipNode);
    expect(chipSummary.lossWarning).toContain("FRAGILE: Contains 1 smart chip(s)");

    const tocNode: DocNode = {
      end: 10,
      tapeIndex: 3,
      kind: "tableOfContents",
      start: 0,
    };
    const tocSummary = summarizeNode(tocNode);
    expect(tocSummary.lossWarning).toContain("IMMUTABLE: Table of contents cannot be recreated via API");
  });

  test("hard-refuses mutating or removing math equations without force, allows with force", () => {
    const makeWriter = () =>
      new DomWriter([
        {
          end: 20,
          hasEquation: true,
          tapeIndex: 1,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 0,
          text: "x = y + z",
        },
        { end: 40, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, text: "Follow up" },
      ]);

    const w1 = makeWriter();
    expect(() => applyOps(w1, [{ at: 1, innerText: "plain text" }])).toThrow(
      /Refusing to innerText node 1 \(contains a math equation\)/,
    );

    const w2 = makeWriter();
    expect(() => applyOps(w2, [{ at: 1, remove: true }])).toThrow(
      /Refusing to remove node 1 \(contains a math equation\)/,
    );

    const w3 = makeWriter();
    expect(() => applyOps(w3, [{ at: 1, force: true, innerText: "plain text" }])).not.toThrow();
    expect(w3.nodes[0]?.text).toBe("plain text");
  });

  test("hard-refuses removing tableOfContents without force", () => {
    const writer = new DomWriter([
      { end: 10, tapeIndex: 1, kind: "tableOfContents", start: 0 },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "Section body" },
    ]);

    expect(() => applyOps(writer, [{ at: 1, remove: true }])).toThrow(/Refusing to remove node 1 \(tableOfContents\)/);

    expect(() => applyOps(writer, [{ at: 1, force: true, remove: true }])).not.toThrow();
    expect(writer.nodes.length).toBe(1);
  });

  test("hard-refuses removing or rewriting image paragraphs; innerText keeps images", () => {
    const makeWriter = () =>
      new DomWriter([
        {
          end: 14,
          images: [{ end: 13, objectId: "kix.img", start: 12 }],
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 10,
          tapeIndex: 1,
          text: "",
        },
        { end: 40, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 14, text: "Follow up" },
      ]);

    const w1 = makeWriter();
    expect(() => applyOps(w1, [{ at: 1, remove: true }])).toThrow(
      /Refusing to remove node 1 \(contains 1 inline image/,
    );

    const w2 = makeWriter();
    expect(() => applyOps(w2, [{ at: 1, replaceMarkdown: "x" }])).toThrow(/Refusing to replace node 1/);

    const w3 = makeWriter();
    expect(() => applyOps(w3, [{ at: 1, innerText: "Caption" }])).not.toThrow();
    expect(w3.nodes[0]?.text).toBe("Caption");

    const w4 = makeWriter();
    expect(() => applyOps(w4, [{ at: 1, force: true, remove: true }])).not.toThrow();
    expect(w4.nodes.length).toBe(1);
  });

  test("hard-refuses horizontal-rule paragraphs without force", () => {
    const makeWriter = () =>
      new DomWriter([
        {
          end: 12,
          hasHorizontalRule: true,
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 10,
          tapeIndex: 1,
          text: "",
        },
        { end: 30, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 12, text: "Follow up" },
      ]);

    const w1 = makeWriter();
    expect(() => applyOps(w1, [{ at: 1, innerText: "text" }])).toThrow(
      /Refusing to innerText node 1 \(contains a horizontal rule\)/,
    );

    const w2 = makeWriter();
    expect(() => applyOps(w2, [{ at: 1, remove: true }])).toThrow(
      /Refusing to remove node 1 \(contains a horizontal rule\)/,
    );

    const w3 = makeWriter();
    expect(() => applyOps(w3, [{ at: 1, force: true, remove: true }])).not.toThrow();
    expect(w3.nodes.length).toBe(1);
  });

  test("hard-refuses footnote paragraphs without force", () => {
    const makeWriter = () =>
      new DomWriter([
        {
          end: 20,
          footnoteIds: ["fn1"],
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          start: 0,
          tapeIndex: 1,
          text: "See note.",
        },
        { end: 40, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, text: "Follow up" },
      ]);

    const w1 = makeWriter();
    expect(() => applyOps(w1, [{ at: 1, innerText: "text" }])).toThrow(
      /Refusing to innerText node 1 \(contains 1 footnote reference/,
    );

    const w2 = makeWriter();
    expect(() => applyOps(w2, [{ at: 1, remove: true }])).toThrow(
      /Refusing to remove node 1 \(contains 1 footnote reference/,
    );

    const w3 = makeWriter();
    expect(() => applyOps(w3, [{ at: 1, force: true, remove: true }])).not.toThrow();
    expect(w3.nodes.length).toBe(1);
  });

  test("refuses removing a table whose cells hold images", () => {
    const writer = new DomWriter([
      {
        end: 30,
        kind: "table",
        start: 10,
        tapeIndex: 1,
        table: {
          cells: [
            [
              { end: 20, images: [{ end: 15, objectId: "kix.cell-img", start: 14 }], start: 12, text: "" },
              { end: 24, start: 20, text: "caption" },
            ],
          ],
        },
      },
      { end: 40, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 30, text: "Follow up" },
    ]);

    expect(() => applyOps(writer, [{ at: 1, remove: true }])).toThrow(
      /Refusing to remove node 1 \(contains 1 inline image/,
    );

    expect(() => applyOps(writer, [{ at: 1, force: true, remove: true }])).not.toThrow();
    expect(writer.nodes.length).toBe(1);
  });

  test("anti-demolition guard allows moving a single node to another anchor without error", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "Intro paragraph" },
      {
        end: 30,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 10,
        text: "Paragraph that is being moved to another location",
      },
      { end: 50, tapeIndex: 3, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 30, text: "Middle paragraph" },
      { end: 70, tapeIndex: 4, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 50, text: "End paragraph" },
    ];
    const writer = new DomWriter(nodes);

    const moveOps: DomOp[] = [
      { at: 2, remove: true },
      {
        after: 4,
        element: {
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          text: "Paragraph that is being moved to another location",
        },
      },
    ];

    expect(() => applyOps(writer, moveOps)).not.toThrow();
    expect(writer.nodes.map((n) => n.text)).toEqual([
      "Intro paragraph",
      "Middle paragraph",
      "End paragraph",
      "Paragraph that is being moved to another location",
    ]);
  });

  test("anti-demolition guard ignores short repeated text false positives (e.g. N/A)", () => {
    const nodes: DocNode[] = [
      { end: 10, tapeIndex: 1, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 0, text: "Task list" },
      { end: 20, tapeIndex: 2, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, text: "N/A" },
      { end: 30, tapeIndex: 3, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, text: "Other section" },
      { end: 40, tapeIndex: 4, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 30, text: "Summary" },
    ];
    const writer = new DomWriter(nodes);

    const ops: DomOp[] = [
      { at: 2, remove: true },
      {
        after: 4,
        element: {
          kind: "paragraph",
          namedStyleType: "NORMAL_TEXT",
          text: "N/A",
        },
      },
    ];

    expect(() => applyOps(writer, ops)).not.toThrow();
  });

  test("table grid operations: insertTableRow, deleteTableRow, insertTableColumn, deleteTableColumn, duplicateTableRow", () => {
    const tableNode: DocNode = {
      end: 100,
      tapeIndex: 10,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            { end: 20, paragraphs: [{ end: 20, start: 12, text: "H1" }], start: 12, text: "H1" },
            { end: 30, paragraphs: [{ end: 30, start: 22, text: "H2" }], start: 22, text: "H2" },
          ],
          [
            { end: 40, paragraphs: [{ end: 40, start: 32, text: "R1C1" }], start: 32, text: "R1C1" },
            { end: 50, paragraphs: [{ end: 50, start: 42, text: "R1C2" }], start: 42, text: "R1C2" },
          ],
        ],
      },
    };
    const writer = new DomWriter([tableNode]);

    const ops: DomOp[] = [
      {
        at: 10,
        insertTableRow: {
          cells: ["New1", "New2"],
          insertBelow: true,
          row: 1,
        },
      },
      {
        at: 10,
        deleteTableRow: {
          row: 0,
        },
      },
      {
        at: 10,
        insertTableColumn: {
          col: 1,
          insertRight: true,
        },
      },
      {
        at: 10,
        deleteTableColumn: {
          col: 0,
        },
      },
      {
        at: 10,
        duplicateTableRow: {
          insertBelow: true,
          row: 1,
        },
      },
    ];

    const plan = applyOps(writer, ops);
    expect(plan.map((p) => p.action)).toEqual([
      "insertTableRow",
      "deleteTableRow",
      "insertTableColumn",
      "deleteTableColumn",
      "duplicateTableRow",
    ]);

    const mutations = writer.mutations();
    expect(mutations.map((m) => m.type)).toEqual([
      "insertTableRow",
      "deleteTableRow",
      "insertTableColumn",
      "deleteTableColumn",
      "insertTableRow",
    ]);
  });

  test("new insert shortcuts: insertSectionBreak, insertPerson, insertRichLink, insertDate, insertFootnote, insertImage", () => {
    const pNode: DocNode = {
      end: 20,
      tapeIndex: 5,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 0,
      text: "Anchor paragraph",
    };
    const writer = new DomWriter([pNode]);

    const ops: DomOp[] = [
      {
        after: 5,
        insertSectionBreak: { sectionType: "CONTINUOUS" },
      },
      {
        after: 5,
        insertPerson: { email: "alice@example.com" },
      },
      {
        after: 5,
        insertRichLink: { title: "Docs", uri: "https://docs.google.com" },
      },
      {
        after: 5,
        insertDate: { displayText: "Today", timestamp: "2026-09-15" },
      },
      {
        after: 5,
        insertFootnote: { text: "Footnote text" },
      },
      {
        after: 5,
        insertImage: { uri: "https://example.com/logo.png", widthPt: 120 },
      },
    ];

    const plan = applyOps(writer, ops);
    expect(plan.length).toBe(6);
    expect(plan.every((p) => p.action === "insertAdjacentElement")).toBe(true);

    const mutations = writer.mutations();
    expect(mutations.length).toBe(6);
    expect(mutations.every((m) => m.type === "insertAdjacent")).toBe(true);
  });

  test("PageSetup extraction from documentStyle", () => {
    const docStyle = {
      marginBottom: { magnitude: 54, unit: "PT" as const },
      marginLeft: { magnitude: 72, unit: "PT" as const },
      marginRight: { magnitude: 72, unit: "PT" as const },
      marginTop: { magnitude: 54, unit: "PT" as const },
      pageSize: {
        height: { magnitude: 612, unit: "PT" as const },
        width: { magnitude: 792, unit: "PT" as const },
      },
    };
    const setup = extractPageSetup(docStyle);
    expect(setup).toEqual({
      margins: {
        bottom: 54,
        left: 72,
        right: 72,
        top: 54,
      },
      orientation: "LANDSCAPE",
      pageHeight: 612,
      pageSize: "LETTER",
      pageWidth: 792,
    });
  });

  test("PageSetup extraction preserves document layout mode", () => {
    const pagelessStyle = {
      documentFormat: {
        documentMode: "PAGELESS" as const,
      },
      pageSize: {
        height: { magnitude: 792, unit: "PT" as const },
        width: { magnitude: 612, unit: "PT" as const },
      },
    };
    const pagelessSetup = extractPageSetup(pagelessStyle);
    expect(pagelessSetup).toEqual({
      mode: "PAGELESS",
      orientation: "PORTRAIT",
      pageHeight: 792,
      pageSize: "LETTER",
      pageWidth: 612,
      pageless: true,
    });

    const pagesStyle = {
      documentFormat: {
        documentMode: "PAGES" as const,
      },
    };
    const pagesSetup = extractPageSetup(pagesStyle);
    expect(pagesSetup).toEqual({
      mode: "PAGES",
      pageless: false,
    });
  });

  test("rejects tableAlignment in ops and DomWriter with actionable error", () => {
    const tableNode: DocNode = {
      end: 20,
      tapeIndex: 1,
      kind: "table",
      start: 0,
      table: {
        cells: [[{ end: 10, paragraphs: [{ end: 10, start: 0, text: "Cell" }], start: 0, text: "Cell" }]],
      },
    };
    const writer = new DomWriter([tableNode]);

    expect(() => applyOps(writer, [{ at: 1, tableAlignment: "CENTER" } as any])).toThrow(
      "tableAlignment is not supported",
    );

    expect(() => writer.setStyle(tableNode, { tableAlignment: "CENTER" } as any)).toThrow(
      "tableAlignment is not supported",
    );
  });

  test("emits warning when alignment is applied to a table node", () => {
    const tableNode: DocNode = {
      end: 20,
      tapeIndex: 1,
      kind: "table",
      start: 0,
      table: {
        cells: [[{ end: 10, paragraphs: [{ end: 10, start: 0, text: "Cell" }], start: 0, text: "Cell" }]],
      },
    };
    const writer = new DomWriter([tableNode]);

    const plan = applyOps(writer, [{ alignment: "CENTER", at: 1 }]);
    expect(plan[0]?.warnings).toContain(
      "Google Docs REST API lacks page-level table alignment. Setting alignment on a table formats the text inside cells (cellTextAlignment). Tables with fixed columnWidth remain left-aligned on the page.",
    );
  });

  test("formatUnrecoverableWarning surfaces equation, chips, and TOC details", () => {
    const eqNode: DocNode = {
      end: 10,
      hasEquation: true,
      kind: "paragraph",
      scopedId: "h.math.1a2b",
      start: 0,
      tapeIndex: 5,
      text: "f(x) = x^2 + 1\n",
    };
    expect(formatUnrecoverableWarning(eqNode)).toContain(
      'Destroyed math equation at node h.math.1a2b "f(x) = x^2 + 1" (unrecoverable via API)',
    );

    const chipNode: DocNode = {
      chips: [{ end: 20, start: 11, title: "Alice", uri: "user@example.com" }],
      end: 20,
      kind: "paragraph",
      scopedId: "h.team.3c4d",
      start: 11,
      tapeIndex: 6,
    };
    expect(formatUnrecoverableWarning(chipNode)).toContain(
      'Destroyed 1 smart chip(s) at node h.team.3c4d: "Alice" (unrecoverable via API)',
    );
  });
});
