/* Tests for list editing primitives (L1–L3 membership, nesting, kind, presets). */

import { describe, expect, test } from "bun:test";
import { blockFind, type EditTarget } from "./edit.ts";
import { bulletsSet, listKindSet, listPresetSet, nestingSet } from "./editLists.ts";
import { docModelParse } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { listPresetTable } from "./lists.ts";
import { type BlockSpec, docJsonBuild } from "./testDocs.ts";
import type { ParagraphBlock } from "./types.ts";

/** Parses `blocks` into an editable tab with a preset bullet list `kix.p` and a custom (preset-less) bullet list `kix.c`. */
function targetBuild(blocks: BlockSpec[]): { keys: string[]; target: EditTarget } {
  const keys = new KeyAllocator();
  const tab = docModelParse(docJsonBuild({ tabs: [{ blocks }] }), { docId: "d", keys }).tabs[0];
  tab.lists["kix.p"] = {
    isNew: false,
    nestingLevels: structuredClone([...(listPresetTable().BULLET_DISC_CIRCLE_SQUARE ?? [])]),
    preset: "BULLET_DISC_CIRCLE_SQUARE",
  };
  tab.lists["kix.c"] = { isNew: false, nestingLevels: Array.from({ length: 9 }, () => ({ glyphSymbol: "x" })) };
  return {
    keys: tab.blocks.map((b) => b.key),
    target: { ctx: { keys, stamp: { force: false, stepIndex: 1 }, tombstones: [] }, tab },
  };
}

function p(target: EditTarget, key: string): ParagraphBlock {
  return blockFind(target.tab, key)?.block as ParagraphBlock;
}

const item = (text: string, listId: string, nestingLevel = 0): BlockSpec => ({
  bullet: { listId, nestingLevel },
  content: [text],
  kind: "paragraph",
});
const para = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });

describe("bulletsSet", () => {
  test("joins the previous list at the same nesting (L1) with that level's indents", () => {
    const { keys, target } = targetBuild([item("a", "kix.p"), para("b")]);
    bulletsSet(target, [keys[1]], { kind: "bullet" });
    expect(p(target, keys[1]).bullet).toMatchObject({
      listId: "kix.p",
      nestingLevel: 0,
      textStyle: { underline: false },
    });
    expect(p(target, keys[1]).style).toMatchObject({
      indentFirstLine: { magnitude: 18 },
      indentStart: { magnitude: 36 },
    });
  });

  test("joins the next list at the same nesting (L2)", () => {
    const { keys, target } = targetBuild([para("a"), item("b", "kix.c")]);
    bulletsSet(target, [keys[0]], { kind: "bullet" });
    expect(p(target, keys[0]).bullet?.listId).toBe("kix.c");
  });

  test("otherwise starts a new list with the kind's default preset (L3)", () => {
    const { keys, target } = targetBuild([para("a"), para("b")]);
    bulletsSet(target, keys, { kind: "number" });
    const listId = p(target, keys[0]).bullet?.listId as string;
    expect(listId).toMatch(/^new:list:/);
    expect(p(target, keys[1]).bullet?.listId).toBe(listId);
    expect(target.tab.lists[listId]).toMatchObject({ isNew: true, preset: "NUMBERED_DECIMAL_ALPHA_ROMAN" });
  });

  test("refuses headings, empty paragraphs, typed glyph prefixes, and leading tabs", () => {
    const { keys, target } = targetBuild([
      { content: ["h"], kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
      { content: [], kind: "paragraph" },
      para("- typed"),
      para("1. typed"),
      para("\tindented"),
    ]);
    const codes = keys.map((key) => {
      try {
        bulletsSet(target, [key], { kind: "bullet" });
        return "ok";
      } catch (err) {
        return (err as { code: string }).code;
      }
    });
    expect(codes).toEqual([
      "headingBullet",
      "listItemEmpty",
      "fakeBulletPrefix",
      "fakeBulletPrefix",
      "fakeBulletPrefix",
    ]);
  });

  test("null unbullets like the API (indentFirstLine dropped, indentStart 0)", () => {
    const { keys, target } = targetBuild([item("a", "kix.p")]);
    bulletsSet(target, keys, null);
    expect(p(target, keys[0]).bullet).toBeUndefined();
    expect(p(target, keys[0]).style.indentStart).toEqual({ magnitude: 0, unit: "PT" });
    expect(p(target, keys[0]).style.indentFirstLine).toBeUndefined();
  });
});

describe("nestingSet / listKindSet / listPresetSet", () => {
  test("nesting deeper joins the previous list only when it has an exact preset", () => {
    const exact = targetBuild([item("a", "kix.p"), item("b", "kix.p")]);
    expect(nestingSet(exact.target, exact.keys[1], 1)).toEqual({ lossy: false });
    expect(p(exact.target, exact.keys[1]).bullet).toMatchObject({ listId: "kix.p", nestingLevel: 1 });
    expect(p(exact.target, exact.keys[1]).style.indentStart).toEqual({ magnitude: 72, unit: "PT" });

    const custom = targetBuild([item("a", "kix.c"), item("b", "kix.c")]);
    expect(nestingSet(custom.target, custom.keys[1], 1)).toEqual({ lossy: true });
    expect(p(custom.target, custom.keys[1]).bullet?.listId).toMatch(/^new:list:/);
  });

  test("a kind change splits the item into its own list", () => {
    const { keys, target } = targetBuild([item("a", "kix.p"), item("b", "kix.p"), item("c", "kix.p")]);
    expect(listKindSet(target, [keys[1]], "number")).toEqual({ lossy: false });
    const listId = p(target, keys[1]).bullet?.listId as string;
    expect(listId).toMatch(/^new:list:/);
    expect(target.tab.lists[listId].preset).toBe("NUMBERED_DECIMAL_ALPHA_ROMAN");
    expect(p(target, keys[2]).bullet?.listId).toBe("kix.p");
  });

  test("presets change only on lists created this run", () => {
    const { keys, target } = targetBuild([para("a")]);
    bulletsSet(target, keys, { kind: "bullet" });
    const listId = p(target, keys[0]).bullet?.listId as string;
    listPresetSet(target, listId, "BULLET_STAR_CIRCLE_SQUARE");
    expect(target.tab.lists[listId].preset).toBe("BULLET_STAR_CIRCLE_SQUARE");
    expect(() => listPresetSet(target, "kix.p", "BULLET_STAR_CIRCLE_SQUARE")).toThrow(/in place/);
  });
});
