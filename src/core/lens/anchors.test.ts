/* Tests for anchors and range resolution. */

import { describe, expect, test } from "bun:test";
import { textStyleUpdate } from "../model/edit.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { TabModel } from "../model/types.ts";
import { anchorResolve, anchorsIndex, rangeResolve } from "./anchors.ts";

function tabOf(blocks: BlockSpec[]): TabModel {
  return docModelParse(docJsonBuild({ tabs: [{ blocks }] }), { docId: "d", keys: new KeyAllocator() }).tabs[0];
}

const h = (text: string, id: string, type = "HEADING_1"): BlockSpec => ({
  content: [text],
  headingId: id,
  kind: "paragraph",
  style: { namedStyleType: type },
});
const p = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });

describe("anchors", () => {
  test("a heading's anchor is its heading id; other blocks are scope:hash6", () => {
    const tab = tabOf([p("intro"), h("One", "h.1"), p("body")]);
    const anchors = tab.blocks.map((b) => anchorsIndex(tab).byKey.get(b.key));
    expect(anchors[0]).toMatch(/^_:[0-9a-f]{6}$/);
    expect(anchors[1]).toBe("h.1");
    expect(anchors[2]).toMatch(/^h\.1:[0-9a-f]{6}$/);
  });

  test("a block anchor is stable under restyling and whitespace; duplicates get ~2", () => {
    const tab = tabOf([h("One", "h.1"), p("same  text"), p("same text")]);
    const [, a, b] = tab.blocks.map((x) => anchorsIndex(tab).byKey.get(x.key) as string);
    expect(b).toBe(`${a}~2`);
    textStyleUpdate(
      { ctx: { keys: new KeyAllocator(), stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab },
      tab.blocks[1].key,
      0,
      4,
      { bold: true },
    );
    expect(anchorsIndex(tab).byKey.get(tab.blocks[1].key)).toBe(a);
  });

  test("heading titles resolve (trimmed, case-insensitive); duplicates are ambiguous", () => {
    const tab = tabOf([h("Goals", "h.1"), h("  Plan ", "h.2"), h("Plan", "h.3")]);
    expect(anchorResolve(tab, " goals ")).toEqual({ key: tab.blocks[0].key, kind: "block" });
    expect(() => anchorResolve(tab, "plan")).toThrow(/2 headings/);
  });

  test("an anchor whose text changed fails with same-scope candidates", () => {
    const tab = tabOf([h("One", "h.1"), p("body")]);
    try {
      anchorResolve(tab, "h.1:000000");
      throw new Error("expected a failure");
    } catch (err) {
      expect((err as { code: string }).code).toBe("anchorNotFound");
      expect(
        (err as { details: { candidates: Array<{ text: string }> } }).details.candidates.map((c) => c.text),
      ).toEqual(["body"]);
    }
  });

  test("cells are <table>/<row>.<col>; a cell range is its paragraphs", () => {
    const tab = tabOf([p("a"), { cells: [[[{ content: ["x"] }], [{ content: ["y"] }]]], kind: "table" }, p("z")]);
    const tableAnchor = anchorsIndex(tab).byKey.get(tab.blocks[1].key) as string;
    expect(anchorResolve(tab, `${tableAnchor}/0.1`).kind).toBe("cell");
    expect(rangeResolve(tab, { anchor: `${tableAnchor}/0.1`, kind: "cell" })).toMatchObject({ from: 0, to: 1 });
  });

  test("a section runs to the next heading of the same or higher level", () => {
    const tab = tabOf([h("A", "h.a"), p("a1"), h("A.1", "h.a1", "HEADING_2"), p("a11"), h("B", "h.b"), p("b1")]);
    expect(rangeResolve(tab, { heading: "h.a", includeHeading: true, kind: "section" })).toMatchObject({
      from: 0,
      to: 4,
    });
    expect(rangeResolve(tab, { heading: "A.1", includeHeading: false, kind: "section" })).toMatchObject({
      from: 3,
      to: 4,
    });
  });
});
