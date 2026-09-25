/* Tests for model editing primitives A (insert/delete blocks, splice, text and paragraph style). */

import { describe, expect, test } from "bun:test";
import {
  type BlockLocation,
  blockFind,
  blocksDelete,
  type EditTarget,
  paragraphSplice,
  paragraphStyleUpdate,
  paragraphsInsert,
  textStyleUpdate,
} from "./edit.ts";
import { CoreError } from "./errors.ts";
import { docModelParse } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { type BlockSpec, docJsonBuild } from "./testDocs.ts";
import type { ParagraphBlock, TableBlock } from "./types.ts";

/** A tab (parsed from `blocks`) ready to edit, plus its keys in body order. */
function targetBuild(blocks: BlockSpec[]): { keys: string[]; target: EditTarget } {
  const keys = new KeyAllocator();
  const doc = docModelParse(docJsonBuild({ tabs: [{ blocks }] }), { docId: "d", keys });
  const tab = doc.tabs[0];
  return {
    keys: tab.blocks.map((b) => b.key),
    target: { ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab },
  };
}

function paragraphAt(target: EditTarget, key: string): ParagraphBlock {
  return (blockFind(target.tab, key) as BlockLocation).block as ParagraphBlock;
}

describe("paragraphSplice", () => {
  test("inserted text inherits the previous character's style", () => {
    const { keys, target } = targetBuild([
      { content: [{ style: { bold: true }, text: "ab" }, "cd"], kind: "paragraph" },
    ]);
    paragraphSplice(target, keys[0], 2, 0, [{ ch: "X" }]);
    expect(paragraphAt(target, keys[0]).inlines).toEqual([
      { kind: "text", style: { bold: true }, text: "abX" },
      { kind: "text", style: {}, text: "cd" },
    ]);
  });

  test("at the paragraph start, inserted text inherits the next character's style", () => {
    const { keys, target } = targetBuild([{ content: [{ style: { italic: true }, text: "b" }], kind: "paragraph" }]);
    paragraphSplice(target, keys[0], 0, 0, [{ ch: "a" }]);
    expect(paragraphAt(target, keys[0]).inlines).toEqual([{ kind: "text", style: { italic: true }, text: "ab" }]);
  });

  test("replaces a word by code point (emoji stay whole) and stamps the paragraph", () => {
    const { keys, target } = targetBuild([{ content: ["a😀 cat"], kind: "paragraph" }]);
    paragraphSplice(target, keys[0], 3, 3, [{ ch: "dog" }]);
    const p = paragraphAt(target, keys[0]);
    expect(p.inlines).toEqual([{ kind: "text", style: {}, text: "a😀 dog" }]);
    expect(p.stamp).toEqual({ force: false, stepIndex: 0 });
  });

  test("re-inserting an existing atom is refused; deleting one leaves a tombstone", () => {
    const { keys, target } = targetBuild([{ content: ["a", { type: "person" }], kind: "paragraph" }]);
    const atom = paragraphAt(target, keys[0]).inlines[1];
    expect(() => paragraphSplice(target, keys[0], 0, 0, [{ atomKey: atom.kind === "atom" ? atom.key : "" }])).toThrow(
      CoreError,
    );
    paragraphSplice(target, keys[0], 1, 1, []);
    expect(target.ctx.tombstones).toMatchObject([{ kind: "atom" }]);
  });

  test("new chips are validated; page breaks and newlines are refused", () => {
    const { keys, target } = targetBuild([{ content: ["a"], kind: "paragraph" }]);
    const splice = (spec: Parameters<typeof paragraphSplice>[4][number]) => () =>
      paragraphSplice(target, keys[0], 1, 0, [spec]);
    expect(splice({ create: { email: "nope", type: "person" } })).toThrow(/email/);
    expect(splice({ create: { timestamp: "tomorrow", type: "date" } })).toThrow(/ISO/);
    expect(splice({ create: { type: "richLink", uri: "http://x.test" } })).toThrow(/https/);
    expect(splice({ create: { type: "pageBreak" } })).toThrow(/page break/);
    expect(splice({ ch: "a\nb" })).toThrow(/paragraphsInsert/);
    splice({ create: { email: "a@b.test", type: "person" } })();
    expect(paragraphAt(target, keys[0]).inlines[1]).toMatchObject({
      create: { email: "a@b.test" },
      key: "n1",
      length: 1,
      type: "person",
    });
  });
});

describe("paragraphsInsert / blocksDelete", () => {
  test("inserts paragraphs with explicit properties and returns their keys", () => {
    const { keys, target } = targetBuild([{ content: ["a"], kind: "paragraph" }]);
    const created = paragraphsInsert(target, { kind: "body" }, 1, [
      { style: { namedStyleType: "HEADING_1" }, syms: [{ ch: "Title" }] },
    ]);
    expect(target.tab.blocks.map((b) => b.key)).toEqual([keys[0], ...created]);
    const p = paragraphAt(target, created[0]);
    expect(p).toMatchObject({ inlines: [{ text: "Title" }], style: { namedStyleType: "HEADING_1" } });
    expect(p.headingId).toBeUndefined();
  });

  test("deleting the paragraph between two tables normalizes one back in (V2)", () => {
    const table: BlockSpec = { cells: [[[{ content: ["x"] }]]], kind: "table" };
    const { keys, target } = targetBuild([
      { content: ["a"], kind: "paragraph" },
      table,
      { content: ["mid"], kind: "paragraph" },
      table,
      { content: ["z"], kind: "paragraph" },
    ]);
    blocksDelete(target, [keys[2]]);
    expect(target.tab.blocks.map((b) => b.kind)).toEqual(["paragraph", "table", "paragraph", "table", "paragraph"]);
    expect(target.tab.blocks[2].key).toMatch(/^n/);
  });

  test("deleting a table tombstones it and the atoms in its cells", () => {
    const { keys, target } = targetBuild([
      { content: ["a"], kind: "paragraph" },
      { cells: [[[{ content: [{ type: "person" }] }]]], kind: "table" },
      { content: ["z"], kind: "paragraph" },
    ]);
    const table = target.tab.blocks[1] as TableBlock;
    const atom = table.rows[0].cells[0].blocks[0].inlines[0];
    blocksDelete(target, [keys[1]]);
    expect(target.ctx.tombstones.map((t) => [t.kind, t.key])).toEqual([
      ["block", keys[1]],
      ["atom", atom.kind === "atom" ? atom.key : ""],
    ]);
  });

  test("a cell emptied of paragraphs gets an empty one back (V1)", () => {
    const { target } = targetBuild([
      { content: ["a"], kind: "paragraph" },
      { cells: [[[{ content: ["x"] }]]], kind: "table" },
      { content: ["z"], kind: "paragraph" },
    ]);
    const cell = (target.tab.blocks[1] as TableBlock).rows[0].cells[0];
    blocksDelete(target, [cell.blocks[0].key]);
    expect(cell.blocks).toHaveLength(1);
    expect(cell.blocks[0].inlines).toEqual([]);
  });
});

describe("textStyleUpdate", () => {
  test("null resets; a whole-paragraph range restyles the newline too, except link", () => {
    const { keys, target } = targetBuild([{ content: [{ style: { italic: true }, text: "ab" }], kind: "paragraph" }]);
    textStyleUpdate(target, keys[0], 0, 2, { bold: true, italic: null, link: { url: "https://x.test" } });
    const p = paragraphAt(target, keys[0]);
    expect(p.inlines).toEqual([{ kind: "text", style: { bold: true, link: { url: "https://x.test" } }, text: "ab" }]);
    expect(p.newline.style).toEqual({ bold: true });
    textStyleUpdate(target, keys[0], 0, 1, { bold: null });
    expect(paragraphAt(target, keys[0]).newline.style).toEqual({ bold: true });
  });

  test("where restyles only runs whose explicit values match", () => {
    const gray = { color: { rgbColor: { blue: 0.2, green: 0.2, red: 0.2 } } };
    const { keys, target } = targetBuild([
      {
        content: [
          { style: { foregroundColor: gray }, text: "ab" },
          "cd",
          { style: { foregroundColor: gray }, text: "ef" },
        ],
        kind: "paragraph",
      },
    ]);
    textStyleUpdate(target, keys[0], 0, 6, { foregroundColor: null }, { where: { foregroundColor: gray } });
    const p = paragraphAt(target, keys[0]);
    expect(p.inlines).toEqual([{ kind: "text", style: {}, text: "abcdef" }]);
    expect(p.newline.style).toEqual({});
  });
});

describe("paragraphStyleUpdate", () => {
  test("becoming a heading removes the bullet; leaving it clears headingId; heading-to-heading keeps it", () => {
    const { keys, target } = targetBuild([
      { bullet: { listId: "kix.l" }, content: ["item"], kind: "paragraph" },
      { content: ["h"], headingId: "h.1", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
    ]);
    paragraphStyleUpdate(target, keys[0], { namedStyleType: "HEADING_2" });
    expect(paragraphAt(target, keys[0]).bullet).toBeUndefined();
    paragraphStyleUpdate(target, keys[1], { namedStyleType: "HEADING_3" });
    expect(paragraphAt(target, keys[1]).headingId).toBe("h.1");
    paragraphStyleUpdate(target, keys[1], { alignment: "CENTER", namedStyleType: "NORMAL_TEXT" });
    expect(paragraphAt(target, keys[1])).toMatchObject({
      style: { alignment: "CENTER", namedStyleType: "NORMAL_TEXT" },
    });
    expect(paragraphAt(target, keys[1]).headingId).toBeUndefined();
    paragraphStyleUpdate(target, keys[1], { alignment: null });
    expect(paragraphAt(target, keys[1]).style.alignment).toBeUndefined();
  });
});
