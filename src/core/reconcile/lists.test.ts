/* Differential tests for the bullet pass: joins, new lists, rebuilds, removals, and refusals. */

import { describe, expect, test } from "bun:test";
import { paragraphsInsert } from "../model/edit.ts";
import { bulletsSet, listKindSet, nestingSet } from "../model/editLists.ts";
import { listPresetTable } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { ParagraphBlock } from "../model/types.ts";
import { differentialRun } from "./testHarness.ts";

const pt = (magnitude: number) => ({ magnitude, unit: "PT" });
const item = (text: string, nestingLevel = 0, listId = "kix.p"): BlockSpec => ({
  bullet: { listId, nestingLevel },
  content: [text],
  kind: "paragraph",
  style: { indentFirstLine: pt(36 * (nestingLevel + 1) - 18), indentStart: pt(36 * (nestingLevel + 1)) },
});
const para = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });
const lists = {
  "kix.c": { listProperties: { nestingLevels: Array.from({ length: 9 }, () => ({ glyphSymbol: "✱" })) } },
  "kix.p": { listProperties: { nestingLevels: listPresetTable().BULLET_DISC_CIRCLE_SQUARE } },
};
const doc = (blocks: BlockSpec[]) => docJsonBuild({ tabs: [{ blocks, lists }] });
const kinds = (requests: JsonObject[]) => requests.map((r) => Object.keys(r)[0]);

describe("bulletsReconcile", () => {
  test("a paragraph after a same-preset list item joins it with one create", () => {
    const r = differentialRun(doc([item("a"), para("b"), para("z")]), (t, k) =>
      bulletsSet(t, [k[1]], { kind: "bullet" }),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual(["createParagraphBullets"]);
    expect(r.ctx.listRebuilds).toEqual([]);
  });

  test("a nesting change keeps the text and rebuilds the run", () => {
    const r = differentialRun(doc([item("a"), item("b"), item("c"), para("z")]), (t, k) => nestingSet(t, k[1], 1));
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).not.toContain("deleteContentRange");
    expect(r.ctx.listRebuilds).toMatchObject([
      { keys: r.final.tabs[0].blocks.slice(0, 3).map((b) => b.key), lossy: false },
    ]);
  });

  test("a kind change splits the item into a new list; the item after stays in the old one", () => {
    const r = differentialRun(doc([item("a"), item("b"), item("c"), para("z")]), (t, k) =>
      listKindSet(t, [k[1]], "number"),
    );
    expect(r.compare.diffs).toEqual([]);
    const [a, b, c] = r.final.tabs[0].blocks as ParagraphBlock[];
    expect(b.bullet?.listId).not.toBe(a.bullet?.listId);
    expect(c.bullet?.listId).toBe("kix.p");
  });

  test("a numbered list after a bullet list stays separate", () => {
    const r = differentialRun(doc([item("a"), para("x"), para("y"), para("z")]), (t, k) =>
      bulletsSet(t, [k[1], k[2]], { kind: "number" }),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual(["createParagraphBullets"]);
  });

  test("removing bullets restores the final indents", () => {
    const r = differentialRun(doc([item("a"), item("b"), para("z")]), (t, k) => bulletsSet(t, [k[0], k[1]], null));
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)[0]).toBe("deleteParagraphBullets");
  });

  test("a new nested item after existing ones rebuilds the run including them", () => {
    const r = differentialRun(doc([item("a"), item("b"), para("z")]), (t) =>
      paragraphsInsert(t, { kind: "body" }, 2, [
        {
          bullet: { listId: "kix.p", nestingLevel: 1 },
          style: { indentFirstLine: pt(54), indentStart: pt(72) },
          syms: [{ ch: "c" }],
        },
      ]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(r.ctx.listRebuilds[0].keys).toHaveLength(3);
  });

  test("a new list right after a same-preset list is refused (the API would merge them)", () => {
    expect(() =>
      differentialRun(doc([item("a"), para("x"), para("z")]), (t, k) => {
        const x = t.tab.blocks[1] as ParagraphBlock;
        x.bullet = { listId: "new:list:x", nestingLevel: 0 };
        t.tab.lists["new:list:x"] = {
          isNew: true,
          nestingLevels: [...(listPresetTable().BULLET_DISC_CIRCLE_SQUARE ?? [])],
          preset: "BULLET_DISC_CIRCLE_SQUARE",
        };
        void k;
      }),
    ).toThrow(/merge/);
  });

  test("nesting an item of a custom list moves it to a new default list, flagged lossy", () => {
    let lossy = false;
    const r = differentialRun(doc([item("a", 0, "kix.c"), item("b", 0, "kix.c"), para("z")]), (t, k) => {
      lossy = nestingSet(t, k[1], 1).lossy;
    });
    expect(lossy).toBe(true);
    expect(r.compare.diffs).toEqual([]);
    const [a, b] = r.final.tabs[0].blocks as ParagraphBlock[];
    expect(b.bullet?.listId).not.toBe(a.bullet?.listId);
  });
});
