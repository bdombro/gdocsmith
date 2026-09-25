/* Differential tests for container reconcile: every edit is reconciled, emulated, and compared with the edited model. */

import { describe, expect, test } from "bun:test";
import { blocksDelete, paragraphSplice, paragraphStyleUpdate, paragraphsInsert } from "../model/edit.ts";
import { pageBreakParagraphInsert } from "../model/editTables.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { ParagraphBlock, TableBlock } from "../model/types.ts";
import { differentialRun } from "./testHarness.ts";

const heading = (text: string, id: string, type = "HEADING_1"): BlockSpec => ({
  content: [text],
  headingId: id,
  kind: "paragraph",
  style: { namedStyleType: type },
});
const para = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });
const item = (text: string, listId = "kix.l"): BlockSpec => ({
  bullet: { listId },
  content: [text],
  kind: "paragraph",
});
const table: BlockSpec = { cells: [[[{ content: ["cell"] }]]], kind: "table" };
const doc = (blocks: BlockSpec[]) => docJsonBuild({ tabs: [{ blocks }] });
const kinds = (requests: JsonObject[]) => requests.map((r) => Object.keys(r)[0]);
const headingIds = (json: ReturnType<typeof doc>) =>
  (
    json as unknown as {
      tabs: Array<{
        documentTab: { body: { content: Array<{ paragraph?: { paragraphStyle?: { headingId?: string } } }> } };
      }>;
    }
  ).tabs[0].documentTab.body.content
    .map((e) => e.paragraph?.paragraphStyle?.headingId)
    .filter(Boolean);

describe("containerReconcile", () => {
  test("inserting before a kept heading (LOC_B) keeps both heading ids and sends no delete", () => {
    const r = differentialRun(doc([heading("One", "h.1"), heading("Two", "h.2")]), (t) =>
      paragraphsInsert(t, { kind: "body" }, 1, [{ syms: [{ ch: "new text" }] }]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).not.toContain("deleteContentRange");
    expect(headingIds(r.json)).toEqual(["h.1", "h.2"]);
  });

  test("appending after the last heading (LOC_A) keeps its id; nothing transfers", () => {
    const r = differentialRun(doc([heading("One", "h.1")]), (t) =>
      paragraphsInsert(t, { kind: "body" }, 1, [{ syms: [{ ch: "after" }] }, { syms: [{ ch: "more" }] }]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(r.ctx.identityTransfers).toEqual([]);
    expect(headingIds(r.json)).toEqual(["h.1"]);
  });

  test("deleting a middle paragraph is one clean delete", () => {
    const r = differentialRun(doc([para("a"), para("b"), para("c")]), (t, k) => blocksDelete(t, [k[1]]));
    expect(r.compare.diffs).toEqual([]);
    expect(r.requests).toEqual([{ deleteContentRange: { range: { endIndex: 5, startIndex: 3, tabId: "t.0" } } }]);
  });

  test("deleting the last paragraph merges into the one before, which keeps its state", () => {
    const r = differentialRun(
      doc([heading("Keep", "h.1"), { content: ["gone"], kind: "paragraph", style: { alignment: "CENTER" } }]),
      (t, k) => blocksDelete(t, [k[1]]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(headingIds(r.json)).toEqual(["h.1"]);
  });

  test("deleting the last paragraph after an empty one: the deleted paragraph's state survives, so it's rewritten and its id transfers", () => {
    const r = differentialRun(doc([para("x"), { content: [], kind: "paragraph" }, heading("Last", "h.9")]), (t, k) =>
      blocksDelete(t, [k[2]]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(r.ctx.identityTransfers).toMatchObject([{ headingId: "h.9" }]);
  });

  test("deleting the paragraph before a table merges it into the one before", () => {
    const r = differentialRun(doc([para("a"), para("b"), table, para("z")]), (t, k) => blocksDelete(t, [k[1]]));
    expect(r.compare.diffs).toEqual([]);
  });

  test("replacing the paragraph before a table reuses its newline", () => {
    const r = differentialRun(doc([para("a"), heading("Old", "h.1"), table, para("z")]), (t, k) => {
      blocksDelete(t, [k[1]]);
      paragraphsInsert(t, { kind: "body" }, 1, [{ syms: [{ ch: "new one" }] }, { syms: [{ ch: "new two" }] }]);
    });
    expect(r.compare.diffs).toEqual([]);
    expect(r.ctx.identityTransfers).toMatchObject([{ headingId: "h.1" }]);
  });

  test("replacing content in the middle deletes and inserts in one gap", () => {
    const r = differentialRun(doc([para("a"), para("b"), para("c"), para("d")]), (t, k) => {
      blocksDelete(t, [k[1], k[2]]);
      paragraphsInsert(t, { kind: "body" }, 1, [{ syms: [{ ch: "X" }] }]);
    });
    expect(r.compare.diffs).toEqual([]);
  });

  test("page-break paragraphs go in before a kept paragraph and between new ones after the last", () => {
    const before = differentialRun(doc([para("a"), para("b")]), (t) => pageBreakParagraphInsert(t, 1));
    expect(before.compare.diffs).toEqual([]);
    expect(kinds(before.requests)).toContain("insertPageBreak");
    const after = differentialRun(doc([para("a")]), (t) => {
      paragraphsInsert(t, { kind: "body" }, 1, [{ syms: [{ ch: "tail" }] }]);
      pageBreakParagraphInsert(t, 1);
    });
    expect(after.compare.diffs).toEqual([]);
  });

  test("editing inside an existing cell", () => {
    const r = differentialRun(doc([para("a"), table, para("z")]), (t) => {
      const cell = (t.tab.blocks[1] as TableBlock).rows[0].cells[0];
      paragraphSplice(t, cell.blocks[0].key, 4, 0, [{ ch: "!" }]);
      paragraphsInsert(t, { cellKey: cell.key }, 1, [{ syms: [{ ch: "second line" }] }]);
    });
    expect(r.compare.diffs).toEqual([]);
  });

  test("a heading level change is one style request, not a delete", () => {
    const r = differentialRun(doc([heading("Title", "h.1"), para("body")]), (t, k) =>
      paragraphStyleUpdate(t, k[0], { namedStyleType: "HEADING_2" }),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toEqual(["updateParagraphStyle"]);
    expect(headingIds(r.json)).toEqual(["h.1"]);
  });

  test("a new item continuing the next list goes in before it and inherits the bullet", () => {
    const r = differentialRun(doc([para("intro"), item("b"), item("c")]), (t) =>
      paragraphsInsert(t, { kind: "body" }, 1, [{ bullet: { listId: "kix.l", nestingLevel: 0 }, syms: [{ ch: "a" }] }]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).not.toContain("createParagraphBullets");
    expect(kinds(r.requests)).not.toContain("deleteParagraphBullets");
  });

  test("a plain paragraph after the last list item inherits its bullet, then drops it", () => {
    const r = differentialRun(doc([item("a"), item("b")]), (t) =>
      paragraphsInsert(t, { kind: "body" }, 2, [{ syms: [{ ch: "after the list" }] }]),
    );
    expect(r.compare.diffs).toEqual([]);
    expect(kinds(r.requests)).toContain("deleteParagraphBullets");
    const last = r.final.tabs[0].blocks.at(-1) as ParagraphBlock;
    expect(last.bullet).toBeUndefined();
  });

  test("moving a block is refused", () => {
    expect(() =>
      differentialRun(doc([para("a"), para("b")]), (t) => {
        t.tab.blocks.reverse();
      }),
    ).toThrow(/moved/);
  });
});
