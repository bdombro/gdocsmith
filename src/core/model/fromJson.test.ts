/* Tests for the JSON -> model parser (docModelParse). */

import { describe, expect, test } from "bun:test";
import type { GoogleDoc } from "~/core/types.ts";
import { docModelParse, ParseError } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { docJsonBuild } from "./testDocs.ts";
import type { ParagraphBlock, TableBlock } from "./types.ts";

function parse(json: GoogleDoc) {
  return docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
}

describe("docModelParse", () => {
  test("merges equal-style runs", () => {
    const style = { bold: true };
    const doc = parse(
      docJsonBuild({
        tabs: [
          {
            blocks: [
              {
                content: [
                  { style, text: "Hello, " },
                  { style, text: "world" },
                ],
                kind: "paragraph",
              },
            ],
          },
        ],
      }),
    );
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toHaveLength(1);
    expect(p.inlines[0]).toMatchObject({ kind: "text", text: "Hello, world" });
  });

  test("atoms keep JSON lengths (equation len 3)", () => {
    const doc = parse(
      docJsonBuild({ tabs: [{ blocks: [{ content: [{ atomLen: 3, type: "equation" }], kind: "paragraph" }] }] }),
    );
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines[0]).toMatchObject({ kind: "atom", length: 3, type: "equation" });
  });

  test("richLink title adds no text", () => {
    const doc = parse(docJsonBuild({ tabs: [{ blocks: [{ content: [{ type: "richLink" }], kind: "paragraph" }] }] }));
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toEqual([
      { key: expect.any(String), kind: "atom", length: 1, raw: expect.any(Object), style: undefined, type: "richLink" },
    ]);
  });

  test("nestingLevel defaults 0", () => {
    const doc = parse(
      docJsonBuild({ tabs: [{ blocks: [{ bullet: { listId: "kix.list1" }, content: ["item"], kind: "paragraph" }] }] }),
    );
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.bullet).toEqual({ listId: "kix.list1", nestingLevel: 0, textStyle: undefined });
  });

  test("headingId lifted out of style", () => {
    const doc = parse(
      docJsonBuild({
        tabs: [
          {
            blocks: [
              { content: ["Title"], headingId: "h.abc", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
            ],
          },
        ],
      }),
    );
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.headingId).toBe("h.abc");
    expect(p.style).not.toHaveProperty("headingId");
    expect(p.style).toMatchObject({ namedStyleType: "HEADING_1" });
  });

  test("suggestions mark protected (paragraph, table)", () => {
    const doc = parse(
      docJsonBuild({
        tabs: [
          {
            blocks: [
              { content: [{ sugIns: ["s1"], text: "new text" }], kind: "paragraph" },
              {
                cells: [[[{ content: [{ sugDel: ["s2"], text: "old" }] }]]],
                kind: "table",
              },
            ],
          },
        ],
      }),
    );
    expect((doc.tabs[0].blocks[0] as ParagraphBlock).protected).toBe(true);
    expect((doc.tabs[0].blocks[1] as TableBlock).protected).toBe(true);
  });

  test("table keys and origins", () => {
    const doc = parse(
      docJsonBuild({
        tabs: [
          {
            blocks: [
              {
                cells: [[[{ content: ["a"] }], [{ content: ["b"] }]]],
                kind: "table",
              },
            ],
          },
        ],
      }),
    );
    const table = doc.tabs[0].blocks[0] as TableBlock;
    expect(table.origin).toBeDefined();
    const keys = new Set<string>([
      table.key,
      ...table.columns.map((c) => c.key),
      ...table.rows.flatMap((r) => [r.key, ...r.cells.map((c) => c.key)]),
    ]);
    expect(keys.size).toBe(1 + table.columns.length + table.rows.length + table.rows[0].cells.length);
    for (const row of table.rows) {
      expect(row.origin).toBeDefined();
      for (const cell of row.cells) expect(cell.origin).toBeDefined();
    }
  });

  test("TOC is opaque", () => {
    const doc = parse(docJsonBuild({ tabs: [{ blocks: [{ kind: "toc", length: 5 }] }] }));
    expect(doc.tabs[0].blocks[0]).toMatchObject({ kind: "toc", length: 5 });
  });

  test("leading section break is not a block; a mid-body one is", () => {
    const doc = parse(
      docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }, { kind: "sectionBreak" }] }] }),
    );
    expect(doc.tabs[0].blocks).toHaveLength(2);
    expect(doc.tabs[0].blocks[1].kind).toBe("sectionBreak");
    expect(doc.tabs[0].leadingSectionStyle).toEqual({});
  });

  test("tabs DFS with parentTabId", () => {
    const json = {
      documentId: "d1",
      revisionId: "rev-1",
      tabs: [
        {
          documentTab: { body: { content: [{ endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 }] } },
          tabProperties: { tabId: "t.0", title: "Root" },
        },
        {
          childTabs: [
            {
              documentTab: { body: { content: [{ endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 }] } },
              tabProperties: { parentTabId: "t.1", tabId: "t.2", title: "Child" },
            },
          ],
          documentTab: { body: { content: [{ endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 }] } },
          tabProperties: { tabId: "t.1", title: "Parent" },
        },
      ],
      title: "Doc",
    } as unknown as GoogleDoc;
    const doc = parse(json);
    expect(doc.tabs.map((t) => [t.tabId, t.parentTabId])).toEqual([
      ["t.0", undefined],
      ["t.1", undefined],
      ["t.2", "t.1"],
    ]);
  });

  test("legacy doc synthesizes t.0", () => {
    const json = {
      body: { content: [{ endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 }] },
      documentId: "d1",
      title: "Legacy",
    } as unknown as GoogleDoc;
    const doc = parse(json);
    expect(doc.tabs).toHaveLength(1);
    expect(doc.tabs[0].tabId).toBe("t.0");
  });

  test("input not mutated", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["hello"], kind: "paragraph" }] }] });
    const before = JSON.stringify(json);
    parse(json);
    expect(JSON.stringify(json)).toBe(before);
  });

  test("throws on non-newline tail", () => {
    const json = {
      body: {
        content: [
          { endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 },
          {
            endIndex: 6,
            paragraph: { elements: [{ endIndex: 6, startIndex: 1, textRun: { content: "hello", textStyle: {} } }] },
            startIndex: 1,
          },
        ],
      },
      documentId: "d1",
      title: "Bad",
    } as unknown as GoogleDoc;
    expect(() => parse(json)).toThrow(ParseError);
  });
});
