/* Tests for block copying (flattening, atoms, lists, links) and paragraph assignment. */

import { describe, expect, test } from "bun:test";
import { blocksCopy, paragraphAssign } from "./copy.ts";
import type { EditTarget } from "./edit.ts";
import { docModelParse } from "./fromJson.ts";
import { KeyAllocator } from "./keys.ts";
import { listPresetTable } from "./lists.ts";
import { paragraphSymbols } from "./symbols.ts";
import { type BlockSpec, docJsonBuild } from "./testDocs.ts";
import type { DocModel, ParagraphBlock } from "./types.ts";

const keys = new KeyAllocator();

function docBuild(docId: string, blocks: BlockSpec[], namedStyles?: object[]): DocModel {
  const json = docJsonBuild({ tabs: [{ blocks }] }) as unknown as {
    tabs: Array<{ documentTab: Record<string, unknown> }>;
  };
  if (namedStyles) json.tabs[0].documentTab.namedStyles = { styles: namedStyles };
  return docModelParse(json as never, { docId, keys });
}

function targetOf(doc: DocModel): EditTarget {
  return { ctx: { keys, stamp: { force: false, stepIndex: 3 }, tombstones: [] }, tab: doc.tabs[0] };
}

describe("blocksCopy", () => {
  test("flattens styles against the target's named styles", () => {
    const source = docBuild(
      "src",
      [{ content: ["Heading"], kind: "paragraph", style: { namedStyleType: "HEADING_1" } }],
      [{ namedStyleType: "HEADING_1", textStyle: { bold: true } }],
    );
    const target = docBuild(
      "dst",
      [{ content: ["x"], kind: "paragraph" }],
      [{ namedStyleType: "HEADING_1", textStyle: {} }],
    );
    const t = targetOf(target);
    const { keys: created } = blocksCopy(
      { doc: source, keys: [source.tabs[0].blocks[0].key], tab: source.tabs[0] },
      t,
      { kind: "body" },
      1,
      {
        force: false,
        targetDocId: "dst",
      },
    );
    const copy = t.tab.blocks.find((b) => b.key === created[0]) as ParagraphBlock;
    expect(copy.style).toEqual({ namedStyleType: "HEADING_1" });
    expect(copy.inlines).toEqual([{ kind: "text", style: { bold: true }, text: "Heading" }]);
    expect(copy.headingId).toBeUndefined();
  });

  test("refuses what can't be recreated unless forced; recreates chips", () => {
    const source = docBuild("src", [{ content: ["a", { type: "person" }, { type: "equation" }], kind: "paragraph" }]);
    const src = { doc: source, keys: [source.tabs[0].blocks[0].key], tab: source.tabs[0] };
    const person = source.tabs[0].blocks[0] as ParagraphBlock;
    const personAtom = person.inlines[1];
    if (personAtom.kind === "atom") personAtom.raw = { person: { personProperties: { email: "p@x.test" } } };
    const target = docBuild("dst", [{ content: ["x"], kind: "paragraph" }]);
    expect(() => blocksCopy(src, targetOf(target), { kind: "body" }, 1, { force: false, targetDocId: "dst" })).toThrow(
      /equation/,
    );
    const t = targetOf(target);
    const result = blocksCopy(src, t, { kind: "body" }, 1, { force: true, targetDocId: "dst" });
    expect(result.notes).toEqual(["dropped an equation (the Docs API can't recreate it)"]);
    const copy = t.tab.blocks[1] as ParagraphBlock;
    expect(copy.inlines[1]).toMatchObject({ create: { email: "p@x.test", type: "person" }, kind: "atom" });
  });

  test("each contiguous list run becomes a new list; custom lists fall back to the default preset with a note", () => {
    const source = docBuild("src", [
      { bullet: { listId: "kix.p" }, content: ["a"], kind: "paragraph" },
      { bullet: { listId: "kix.p", nestingLevel: 1 }, content: ["b"], kind: "paragraph" },
      { content: ["gap"], kind: "paragraph" },
      { bullet: { listId: "kix.c" }, content: ["c"], kind: "paragraph" },
    ]);
    source.tabs[0].lists["kix.p"] = {
      isNew: false,
      nestingLevels: [...(listPresetTable().BULLET_STAR_CIRCLE_SQUARE ?? [])],
      preset: "BULLET_STAR_CIRCLE_SQUARE",
    };
    source.tabs[0].lists["kix.c"] = { isNew: false, nestingLevels: [{ glyphSymbol: "x" }] };
    const target = docBuild("dst", [{ content: ["x"], kind: "paragraph" }]);
    const t = targetOf(target);
    const result = blocksCopy(
      { doc: source, keys: source.tabs[0].blocks.map((b) => b.key), tab: source.tabs[0] },
      t,
      { kind: "body" },
      1,
      {
        force: false,
        targetDocId: "dst",
      },
    );
    const [a, b, , c] = result.keys.map((k) => t.tab.blocks.find((x) => x.key === k) as ParagraphBlock);
    expect(a.bullet?.listId).toBe(b.bullet?.listId as string);
    expect(b.bullet?.nestingLevel).toBe(1);
    expect(t.tab.lists[a.bullet?.listId as string]).toMatchObject({ isNew: true, preset: "BULLET_STAR_CIRCLE_SQUARE" });
    expect(t.tab.lists[c.bullet?.listId as string].preset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(result.notes).toEqual(["a custom list was copied as the default BULLET_DISC_CIRCLE_SQUARE list"]);
  });

  test("links to copied headings become pending; other cross-document links become Docs URLs", () => {
    const source = docBuild("src", [
      { content: ["Target"], headingId: "h.t", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
      {
        content: [
          { style: { link: { heading: { id: "h.t", tabId: "t.0" } } }, text: "in" },
          { style: { link: { heading: { id: "h.x", tabId: "t.0" } } }, text: "out" },
        ],
        kind: "paragraph",
      },
    ]);
    const target = docBuild("dst", [{ content: ["x"], kind: "paragraph" }]);
    const t = targetOf(target);
    const result = blocksCopy(
      { doc: source, keys: source.tabs[0].blocks.map((b) => b.key), tab: source.tabs[0] },
      t,
      { kind: "body" },
      1,
      {
        force: false,
        targetDocId: "dst",
      },
    );
    const linked = t.tab.blocks.find((b) => b.key === result.keys[1]) as ParagraphBlock;
    expect(linked.inlines[0].style?.link).toEqual({ heading: { key: result.keys[0], tabId: "t.0" } });
    expect(linked.inlines[1].style?.link).toEqual({
      url: "https://docs.google.com/document/d/src/edit?tab=t.0#heading=h.x",
    });
  });
});

describe("paragraphAssign", () => {
  test("keeps atoms already in the paragraph and takes the source's styles", () => {
    const doc = docBuild("d", [{ content: ["old ", { type: "image" }, " text"], kind: "paragraph" }]);
    const t = targetOf(doc);
    const p = t.tab.blocks[0] as ParagraphBlock;
    const image = p.inlines[1];
    const source = paragraphSymbols(p).map((sym) => (sym.kind === "char" ? { ...sym, style: { italic: true } } : sym));
    source.splice(0, 3, ...Array.from("new", (ch) => ({ ch, kind: "char" as const, style: { italic: true } })));
    paragraphAssign(t, p.key, source, { alignment: "CENTER" });
    expect(p.inlines[1]).toEqual(image);
    expect(p.inlines[0]).toEqual({ kind: "text", style: { italic: true }, text: "new " });
    expect(p.style).toEqual({ alignment: "CENTER" });
  });
});
