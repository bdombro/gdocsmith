/* Tests for DOM node and cell checksum computation, scoped IDs, and section removal. */

import { describe, expect, test } from "bun:test";
import { computeCellChecksum, computeNodeChecksum } from "./checksum.ts";
import { applyOps, executeDangerousClear, parseDomOps, resolveTarget } from "./ops.ts";
import { assignScopedIds } from "./parse.ts";
import { DocDom, neighborhoodFrom } from "./query.ts";
import type { DocNode, TableCell } from "./types.ts";
import { DomWriter } from "./write.ts";

describe("node checksum", () => {
  test("computes deterministic 4-character hex hash", () => {
    const node: Partial<DocNode> = {
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "System architecture overview",
    };
    const csum = computeNodeChecksum(node);
    expect(csum).toHaveLength(4);
    expect(/^[a-f0-9]{4}$/.test(csum)).toBe(true);
    // Deterministic across calls
    expect(computeNodeChecksum(node)).toBe(csum);
  });

  test("checksum differentiates on text, style, bullet, and alignment", () => {
    const base: Partial<DocNode> = {
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "hello world",
    };
    const styled: Partial<DocNode> = {
      ...base,
      style: { italic: true },
    };
    const bullet: Partial<DocNode> = {
      ...base,
      bullet: { listId: "kix.list1", nestingLevel: 1, type: "BULLET" },
    };
    const aligned: Partial<DocNode> = {
      ...base,
      alignment: "CENTER",
    };

    const cBase = computeNodeChecksum(base);
    const cStyled = computeNodeChecksum(styled);
    const cBullet = computeNodeChecksum(bullet);
    const cAligned = computeNodeChecksum(aligned);

    expect(cBase).not.toBe(cStyled);
    expect(cBase).not.toBe(cBullet);
    expect(cBase).not.toBe(cAligned);
  });

  test("cell checksum differentiates on content and style", () => {
    const cellA: TableCell = {
      end: 10,
      start: 1,
      text: "Cell value A",
    };
    const cellB: TableCell = {
      end: 10,
      start: 1,
      style: { fontSize: 12 },
      text: "Cell value A",
    };
    expect(computeCellChecksum(cellA)).toHaveLength(4);
    expect(computeCellChecksum(cellA)).not.toBe(computeCellChecksum(cellB));
  });
});

describe("assignScopedIds", () => {
  test("assigns heading-scoped IDs and increments duplicate checksums", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 1,
        tapeIndex: 1,
        text: "Preamble note",
      },
      {
        end: 20,
        headingId: "h.arch",
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 10,
        tapeIndex: 2,
        text: "Architecture",
      },
      {
        end: 30,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        tapeIndex: 3,
        text: "Same content",
      },
      {
        end: 40,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        tapeIndex: 4,
        text: "Same content",
      },
    ];

    assignScopedIds(nodes);

    expect(nodes[0]?.scopedId).toMatch(/^_preamble\.[a-f0-9]{4}$/);
    expect(nodes[1]?.scopedId).toMatch(/^h\.arch\.[a-f0-9]{4}$/);
    // Duplicate nodes under the same heading get an incremental .2 suffix
    const csum = nodes[2]?.scopedId?.split(".")[2]!;
    expect(nodes[2]?.scopedId).toBe(`h.arch.${csum}`);
    expect(nodes[3]?.scopedId).toBe(`h.arch.${csum}.2`);
  });

  test("assigns table and cell scoped IDs", () => {
    const nodes: DocNode[] = [
      {
        end: 20,
        headingId: "h.data",
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 1,
        tapeIndex: 1,
        text: "Data Model",
      },
      {
        end: 100,
        kind: "table",
        start: 20,
        table: {
          cells: [
            [
              { end: 40, start: 25, text: "Header 1" },
              { end: 60, start: 45, text: "Header 2" },
            ],
            [
              { end: 80, start: 65, text: "Row 1 Col 1" },
              { end: 100, start: 85, text: "Row 1 Col 2" },
            ],
          ],
        },
        tapeIndex: 2,
      },
    ];

    assignScopedIds(nodes);

    expect(nodes[1]?.scopedId).toMatch(/^h\.data\.table\.[a-f0-9]{4}$/);
    expect(nodes[1]?.table?.cells[0]?.[0]?.scopedId).toMatch(/^h\.data\.table\.0\.0\.[a-f0-9]{4}$/);
    expect(nodes[1]?.table?.cells[1]?.[1]?.scopedId).toMatch(/^h\.data\.table\.1\.1\.[a-f0-9]{4}$/);
  });
});

describe("resolveTarget with scoped IDs", () => {
  function makeSampleDoc(): DocNode[] {
    const nodes: DocNode[] = [
      {
        end: 20,
        headingId: "h.intro",
        kind: "paragraph",
        namedStyleType: "HEADING_1",
        start: 1,
        tapeIndex: 1,
        text: "Introduction",
      },
      {
        end: 40,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        tapeIndex: 2,
        text: "First section intro paragraph",
      },
      {
        end: 60,
        headingId: "h.arch",
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 40,
        tapeIndex: 3,
        text: "Architecture",
      },
      {
        end: 80,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 60,
        tapeIndex: 4,
        text: "Component overview",
      },
    ];
    assignScopedIds(nodes);
    return nodes;
  }

  test("resolves by direct headingId and by scopedId", () => {
    const nodes = makeSampleDoc();
    const dom = new DocDom(nodes);

    // Target by headingId directly
    const hHit = resolveTarget(dom, { at: "h.intro" });
    expect(hHit.tapeIndex).toBe(1);

    // Target by scopedId
    const node4ScopedId = nodes[3]?.scopedId!;
    const pHit = resolveTarget(dom, { at: node4ScopedId });
    expect(pHit.tapeIndex).toBe(4);

    const section = neighborhoodFrom(nodes, node4ScopedId);
    expect(section[0]?.tapeIndex).toBe(4);
  });

  test("provides informative error listing available headings if headingId missing", () => {
    const nodes = makeSampleDoc();
    const dom = new DocDom(nodes);

    expect(() => resolveTarget(dom, { at: "h.nonexistent.1234" })).toThrow(
      /Heading 'h\.nonexistent' does not exist in this document\.\nAvailable headings:/,
    );
  });

  test("provides informative error listing current nodes if checksum missing in section", () => {
    const nodes = makeSampleDoc();
    const dom = new DocDom(nodes);

    expect(() => resolveTarget(dom, { at: "h.arch.0000" })).toThrow(
      /Node 'h\.arch\.0000' not found under section 'h\.arch'\.\nCurrent nodes in this section:/,
    );
  });
});

describe("dangerousRemoveSection", () => {
  test("removes heading and all children until the next same-or-higher heading", () => {
    const nodes: DocNode[] = [
      {
        end: 10,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 1,
        tapeIndex: 1,
        text: "Preamble",
      },
      {
        end: 20,
        headingId: "h.target",
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 10,
        tapeIndex: 2,
        text: "Section to remove",
      },
      {
        end: 30,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        tapeIndex: 3,
        text: "Child paragraph 1",
      },
      {
        end: 40,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        tapeIndex: 4,
        text: "Child paragraph 2",
      },
      {
        end: 50,
        headingId: "h.next",
        kind: "paragraph",
        namedStyleType: "HEADING_2",
        start: 40,
        tapeIndex: 5,
        text: "Next Section",
      },
      {
        end: 60,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 50,
        tapeIndex: 6,
        text: "Next Section child",
      },
    ];
    assignScopedIds(nodes);

    const writer = new DomWriter(nodes);
    const plan = applyOps(writer, [{ at: "h.target", dangerousRemoveSection: true }]);

    expect(plan[0]?.action).toBe("dangerousRemoveSection");
    // Nodes 2, 3, 4 should be removed; 1, 5, 6 should remain
    expect(writer.nodes.map((n) => n.tapeIndex)).toEqual([1, 5, 6]);
  });
});

describe("executeDangerousClear", () => {
  test("clears all nodes except the last paragraph which is emptied", () => {
    const nodes: DocNode[] = [
      { end: 10, kind: "paragraph", namedStyleType: "HEADING_1", start: 1, tapeIndex: 1, text: "Title" },
      { end: 20, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 10, tapeIndex: 2, text: "Body 1" },
      { end: 30, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 20, tapeIndex: 3, text: "Body 2" },
    ];
    const writer = new DomWriter(nodes);
    executeDangerousClear(writer);

    expect(writer.nodes).toHaveLength(1);
    expect(writer.nodes[0]?.text).toBe("");
    expect(writer.nodes[0]?.namedStyleType).toBe("NORMAL_TEXT");
  });
});

describe("parseDomOps multi-tab support", () => {
  test("parses tabs array with dangerousClear and tab-level ops", () => {
    const rawYaml = {
      documentId: "doc-123",
      tabs: [
        {
          dangerousClear: true,
          ops: [{ at: "h.intro", innerText: "New Intro" }],
          tabId: "t.tab1",
        },
        {
          ops: [{ at: "h.appendix", innerText: "New Appendix" }],
          tabId: "t.tab2",
        },
      ],
    };

    const parsed = parseDomOps(rawYaml);
    expect(parsed.documentId).toBe("doc-123");
    expect(parsed.tabs).toHaveLength(2);
    expect(parsed.tabs?.[0]?.dangerousClear).toBe(true);
    expect(parsed.tabs?.[0]?.tabId).toBe("t.tab1");
    expect(parsed.tabs?.[0]?.ops).toHaveLength(1);
    expect(parsed.tabs?.[1]?.tabId).toBe("t.tab2");
  });
});
