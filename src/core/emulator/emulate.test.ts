/* Tests for requestsEmulate: one per handled rule, plus a negative test per error code. */

import { describe, expect, test } from "bun:test";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import type { ParagraphBlock } from "../model/types.ts";
import { type EmulatorError, requestsEmulate } from "./emulate.ts";

function parse(json: ReturnType<typeof docJsonBuild>) {
  return docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
}

describe("requestsEmulate", () => {
  test("insertText inherits style from the previous character in the same paragraph", () => {
    const json = docJsonBuild({
      tabs: [{ blocks: [{ content: [{ style: { bold: true }, text: "ab" }], kind: "paragraph" }] }],
    });
    const { json: out } = requestsEmulate(json, [{ insertText: { location: { index: 2 }, text: "X" } }]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toEqual([{ kind: "text", style: { bold: true }, text: "aXb" }]);
  });

  test("insertText inherits style from the next character at paragraph start", () => {
    const json = docJsonBuild({
      tabs: [{ blocks: [{ content: [{ style: { italic: true }, text: "b" }], kind: "paragraph" }] }],
    });
    const { json: out } = requestsEmulate(json, [{ insertText: { location: { index: 1 }, text: "a" } }]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toMatchObject([{ kind: "text", style: { italic: true }, text: "ab" }]);
  });

  test("insertText into an empty paragraph inherits the newline's style", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: [], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [{ insertText: { location: { index: 1 }, text: "x" } }]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toMatchObject([{ kind: "text", style: {}, text: "x" }]);
  });

  test("insertText with an embedded newline splits the paragraph, keeping the original heading id on the half containing the original text's start", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            {
              content: ["Hello World"],
              headingId: "h.orig",
              kind: "paragraph",
              style: { namedStyleType: "HEADING_1" },
            },
          ],
        },
      ],
    });
    const { json: out } = requestsEmulate(json, [{ insertText: { location: { index: 7 }, text: "\n" } }]);
    const doc = parse(out);
    const blocks = doc.tabs[0].blocks as ParagraphBlock[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].inlines).toMatchObject([{ kind: "text", style: {}, text: "Hello " }]);
    expect(blocks[1].inlines).toMatchObject([{ kind: "text", style: {}, text: "World" }]);
    expect(blocks[0].headingId).toBe("h.orig");
    expect(blocks[1].headingId).toBeDefined();
    expect(blocks[1].headingId).not.toBe("h.orig");
    expect(blocks[0].style.namedStyleType).toBe("HEADING_1");
    expect(blocks[1].style.namedStyleType).toBe("HEADING_1");
  });

  test("insertText split copies the bullet onto both halves", () => {
    const json = docJsonBuild({
      tabs: [{ blocks: [{ bullet: { listId: "kix.l1", nestingLevel: 1 }, content: ["ab"], kind: "paragraph" }] }],
    });
    const { json: out } = requestsEmulate(json, [{ insertText: { location: { index: 1 }, text: "\n" } }]);
    const blocks = parse(out).tabs[0].blocks as ParagraphBlock[];
    expect(blocks[0].bullet).toEqual({ listId: "kix.l1", nestingLevel: 1, textStyle: undefined });
    expect(blocks[1].bullet).toEqual({ listId: "kix.l1", nestingLevel: 1, textStyle: undefined });
  });

  test("deleteContentRange starting inside A merges into one paragraph carrying A's state (F7)", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["AAA"], kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
            { content: ["BBB"], kind: "paragraph", style: { namedStyleType: "HEADING_2" } },
          ],
        },
      ],
    });
    // "AAA\n" is indices 1-5, "BBB\n" is 5-9 (index 0 is the leading section break); delete across the boundary.
    const { json: out } = requestsEmulate(json, [{ deleteContentRange: { range: { endIndex: 6, startIndex: 3 } } }]);
    const doc = parse(out);
    expect(doc.tabs[0].blocks).toHaveLength(1);
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toEqual([{ kind: "text", style: {}, text: "AABB" }]);
    expect(p.style.namedStyleType).toBe("HEADING_1");
  });

  test("deleteContentRange starting at A's start removes A cleanly (F7)", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["AAA"], kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
            { content: ["BBB"], kind: "paragraph", style: { namedStyleType: "HEADING_2" } },
          ],
        },
      ],
    });
    const { json: out } = requestsEmulate(json, [{ deleteContentRange: { range: { endIndex: 6, startIndex: 1 } } }]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toEqual([{ kind: "text", style: {}, text: "BB" }]);
    expect(p.style.namedStyleType).toBe("HEADING_2");
  });

  test("updateTextStyle applies changed fields and resets omitted ones to inherited (F10)", () => {
    const json = docJsonBuild({
      tabs: [{ blocks: [{ content: [{ style: { bold: true, italic: true }, text: "ab" }], kind: "paragraph" }] }],
    });
    const { json: out } = requestsEmulate(json, [
      {
        updateTextStyle: {
          fields: "bold,underline",
          range: { endIndex: 3, startIndex: 1 },
          textStyle: { underline: true },
        },
      },
    ]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toMatchObject([{ kind: "text", style: { italic: true, underline: true }, text: "ab" }]);
  });

  test("updateParagraphStyle to a heading mints an id; back to NORMAL_TEXT removes it; heading-to-heading keeps it", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["a"], kind: "paragraph" },
            { content: ["b"], kind: "paragraph" },
          ],
        },
      ],
    });
    const { json: out } = requestsEmulate(json, [
      {
        updateParagraphStyle: {
          fields: "namedStyleType",
          paragraphStyle: { namedStyleType: "HEADING_1" },
          range: { endIndex: 3, startIndex: 1 },
        },
      },
    ]);
    const p0 = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p0.headingId).toBeDefined();

    const { json: out2 } = requestsEmulate(out, [
      {
        updateParagraphStyle: {
          fields: "namedStyleType",
          paragraphStyle: { namedStyleType: "HEADING_2" },
          range: { endIndex: 3, startIndex: 1 },
        },
      },
    ]);
    const p0b = parse(out2).tabs[0].blocks[0] as ParagraphBlock;
    expect(p0b.headingId).toBe(p0.headingId);

    const { json: out3 } = requestsEmulate(out2, [
      {
        updateParagraphStyle: {
          fields: "namedStyleType",
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          range: { endIndex: 3, startIndex: 1 },
        },
      },
    ]);
    const p0c = parse(out3).tabs[0].blocks[0] as ParagraphBlock;
    expect(p0c.headingId).toBeUndefined();
  });

  test("createParagraphBullets counts and removes leading tabs, and mints a new list", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["\t\titem"], kind: "paragraph" },
            { content: ["z"], kind: "paragraph" },
          ],
        },
      ],
    });
    const { json: out } = requestsEmulate(json, [
      { createParagraphBullets: { bulletPreset: "BULLET_DISC_CIRCLE_SQUARE", range: { endIndex: 8, startIndex: 1 } } },
    ]);
    const doc = parse(out);
    const p = doc.tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines).toMatchObject([{ kind: "text", style: {}, text: "item" }]);
    expect(p.bullet?.nestingLevel).toBe(2);
    expect(p.bullet?.listId).toMatch(/^emu\.list\./);
  });

  test("createParagraphBullets joins the previous paragraph's list when its preset matches", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["a"], kind: "paragraph" },
            { content: ["b"], kind: "paragraph" },
            { content: ["c"], kind: "paragraph" },
          ],
        },
      ],
    });
    const first = requestsEmulate(json, [
      { createParagraphBullets: { bulletPreset: "BULLET_DISC_CIRCLE_SQUARE", range: { endIndex: 3, startIndex: 1 } } },
    ]);
    const second = requestsEmulate(first.json, [
      { createParagraphBullets: { bulletPreset: "BULLET_DISC_CIRCLE_SQUARE", range: { endIndex: 5, startIndex: 3 } } },
    ]);
    const blocks = parse(second.json).tabs[0].blocks as ParagraphBlock[];
    expect(blocks[0].bullet?.listId).toBe(blocks[1].bullet?.listId);
  });

  test("createParagraphBullets (F11): joined items drop their tabs at nesting 0; bulleted items are untouched; the following list is never joined", () => {
    const bullet = (startIndex: number, endIndex: number) => ({
      createParagraphBullets: { bulletPreset: "BULLET_DISC_CIRCLE_SQUARE", range: { endIndex, startIndex } },
    });
    // "a" [1,3) "\tb" [3,6) "\tc" [6,9) "d" [9,11)
    const json = docJsonBuild({
      tabs: [{ blocks: ["a", "\tb", "\tc", "d"].map((t) => ({ content: [t], kind: "paragraph" as const })) }],
    });
    const listed = requestsEmulate(json, [bullet(1, 3), bullet(9, 11)]).json;
    const [a, b, c, d] = parse(listed).tabs[0].blocks as ParagraphBlock[];
    expect(a.bullet?.listId).not.toBe(d.bullet?.listId);
    const joined = parse(requestsEmulate(listed, [bullet(3, 6)]).json).tabs[0].blocks as ParagraphBlock[];
    expect(joined[1].bullet).toMatchObject({
      listId: a.bullet?.listId,
      nestingLevel: 0,
      textStyle: { underline: false },
    });
    expect(joined[1].inlines).toMatchObject([{ text: "b" }]);
    expect(joined[1].style).toMatchObject({ indentFirstLine: { magnitude: 18 }, indentStart: { magnitude: 36 } });
    // c follows the plain paragraph b in `listed`, so it starts a new list with tab-based nesting, never joining d's list.
    const fresh = parse(requestsEmulate(listed, [bullet(6, 9)]).json).tabs[0].blocks as ParagraphBlock[];
    expect(fresh[2].bullet?.nestingLevel).toBe(1);
    expect(fresh[2].bullet?.listId).not.toBe(d.bullet?.listId);
    expect(fresh[2].style).toMatchObject({ indentFirstLine: { magnitude: 54 }, indentStart: { magnitude: 72 } });
    const again = parse(requestsEmulate(listed, [bullet(1, 3)]).json).tabs[0].blocks as ParagraphBlock[];
    expect(again[0].bullet).toEqual(a.bullet);
    expect(b.bullet).toBeUndefined();
    expect(c.bullet).toBeUndefined();
  });

  test("updateTextStyle restyles the newline only when the range covers all of the paragraph's text (F10)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["ab"], kind: "paragraph" }] }] });
    const bold = (endIndex: number) => ({
      updateTextStyle: { fields: "bold", range: { endIndex, startIndex: 1 }, textStyle: { bold: true } },
    });
    const whole = parse(requestsEmulate(json, [bold(3)]).json).tabs[0].blocks[0] as ParagraphBlock;
    expect(whole.newline.style).toEqual({ bold: true });
    const partial = parse(requestsEmulate(json, [bold(2)]).json).tabs[0].blocks[0] as ParagraphBlock;
    expect(partial.newline.style).toEqual({});
    expect(partial.inlines).toMatchObject([
      { style: { bold: true }, text: "a" },
      { style: {}, text: "b" },
    ]);
  });

  test("updateTextStyle link chrome (F17): added unless masked, stripped on clear; {headingId} normalizes", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["ab"], kind: "paragraph" }] }] });
    (json.tabs as Array<{ documentTab: { namedStyles: unknown } }>)[0].documentTab.namedStyles = {
      styles: [
        {
          namedStyleType: "NORMAL_TEXT",
          textStyle: { foregroundColor: { color: { rgbColor: {} } }, underline: false },
        },
      ],
    };
    const link = (textStyle: object, fields: string) => ({
      updateTextStyle: { fields, range: { endIndex: 3, startIndex: 1 }, textStyle },
    });
    const chrome = { color: { rgbColor: { blue: 0.8, green: 0.33333334, red: 0.06666667 } } };
    const linked = requestsEmulate(json, [link({ link: { url: "https://x.test" } }, "link")]).json;
    const p = parse(linked).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.inlines[0].style).toEqual({ foregroundColor: chrome, link: { url: "https://x.test" }, underline: true });
    expect(p.newline.style).toEqual({});
    const cleared = parse(requestsEmulate(linked, [link({}, "link")]).json).tabs[0].blocks[0] as ParagraphBlock;
    expect(cleared.inlines[0].style).toEqual({});
    const masked = requestsEmulate(json, [
      link({ link: { headingId: "h.1" }, underline: false }, "link,underline,foregroundColor"),
    ]).json;
    const m = parse(masked).tabs[0].blocks[0] as ParagraphBlock;
    expect(m.inlines[0].style).toEqual({ link: { heading: { id: "h.1", tabId: "t.0" } } });
  });

  test("updateParagraphStyle refuses to clear namedStyleType and keeps an explicit direction (F10)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    const update = (paragraphStyle: object) => ({
      updateParagraphStyle: {
        fields: "direction,namedStyleType",
        paragraphStyle,
        range: { endIndex: 3, startIndex: 1 },
      },
    });
    expect(() => requestsEmulate(json, [update({})])).toThrow(/Named style property is not inherited/);
    const p = parse(requestsEmulate(json, [update({ namedStyleType: "NORMAL_TEXT" })]).json).tabs[0]
      .blocks[0] as ParagraphBlock;
    expect(p.style).toEqual({ direction: "LEFT_TO_RIGHT", namedStyleType: "NORMAL_TEXT" });
  });

  test("deleteParagraphBullets removes membership and resets indent flat (indentFirstLine dropped, indentStart explicit-empty)", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { bullet: { listId: "kix.l1", nestingLevel: 1 }, content: ["a"], kind: "paragraph" },
            { content: ["z"], kind: "paragraph" },
          ],
        },
      ],
    });
    const { json: out } = requestsEmulate(json, [
      { deleteParagraphBullets: { range: { endIndex: 3, startIndex: 1 } } },
    ]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.bullet).toBeUndefined();
    expect(p.style.indentStart).toEqual({ magnitude: 0, unit: "PT" });
    expect(p.style.indentFirstLine).toBeUndefined();
  });

  test("minted ids stay unique across batches applied to the same document", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["a"], kind: "paragraph" },
            { content: ["b"], kind: "paragraph" },
          ],
        },
      ],
    });
    const heading = (startIndex: number) => ({
      updateParagraphStyle: {
        fields: "namedStyleType",
        paragraphStyle: { namedStyleType: "HEADING_1" },
        range: { endIndex: startIndex + 1, startIndex },
      },
    });
    const once = requestsEmulate(json, [heading(1)]).json;
    const twice = requestsEmulate(once, [heading(3)]).json;
    const [a, b] = parse(twice).tabs[0].blocks as ParagraphBlock[];
    expect(a.headingId).toBeDefined();
    expect(b.headingId).toBeDefined();
    expect(a.headingId).not.toBe(b.headingId);
  });

  // --- one negative test per error code ---

  test("INSERT_OUTSIDE_PARAGRAPH: inserting at a table start", () => {
    const json = docJsonBuild({
      tabs: [{ blocks: [{ cells: [[[{ content: ["a"] }]]], kind: "table" }] }],
    });
    expect(() => requestsEmulate(json, [{ insertText: { location: { index: 1 }, text: "x" } }])).toThrowError(
      expect.objectContaining({ code: "INSERT_OUTSIDE_PARAGRAPH" }) as unknown as EmulatorError,
    );
  });

  test("DELETE_LAST_NEWLINE: deleting the tab's only (final) newline", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    expect(() =>
      requestsEmulate(json, [{ deleteContentRange: { range: { endIndex: 3, startIndex: 2 } } }]),
    ).toThrowError(expect.objectContaining({ code: "DELETE_LAST_NEWLINE" }) as unknown as EmulatorError);
  });

  test("DELETE_NEWLINE_BEFORE_STRUCTURE: deleting a paragraph's newline right before a table", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["a"], kind: "paragraph" },
            { cells: [[[{ content: ["b"] }]]], kind: "table" },
            { content: ["c"], kind: "paragraph" },
          ],
        },
      ],
    });
    expect(() =>
      requestsEmulate(json, [{ deleteContentRange: { range: { endIndex: 3, startIndex: 1 } } }]),
    ).toThrowError(expect.objectContaining({ code: "DELETE_NEWLINE_BEFORE_STRUCTURE" }) as unknown as EmulatorError);
  });

  test("DELETE_PARTIAL_STRUCTURE: deleting only part of a table", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { cells: [[[{ content: ["a"] }]]], kind: "table" },
            { content: ["z"], kind: "paragraph" },
          ],
        },
      ],
    });
    expect(() =>
      requestsEmulate(json, [{ deleteContentRange: { range: { endIndex: 3, startIndex: 2 } } }]),
    ).toThrowError(expect.objectContaining({ code: "DELETE_PARTIAL_STRUCTURE" }) as unknown as EmulatorError);
  });

  test("SURROGATE_SPLIT: deleting half of a surrogate pair", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a\u{1F600}b"], kind: "paragraph" }] }] });
    expect(() =>
      requestsEmulate(json, [{ deleteContentRange: { range: { endIndex: 3, startIndex: 2 } } }]),
    ).toThrowError(expect.objectContaining({ code: "SURROGATE_SPLIT" }) as unknown as EmulatorError);
  });

  test("a style/bullet range may freely reach the segment's true end (F9 corrected)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [
      { updateTextStyle: { fields: "bold", range: { endIndex: 3, startIndex: 1 }, textStyle: { bold: true } } },
    ]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    expect(p.newline.style).toEqual({ bold: true });

    const empty = docJsonBuild({ tabs: [{ blocks: [{ content: [], kind: "paragraph" }] }] });
    const { json: emptyOut } = requestsEmulate(empty, [
      {
        updateParagraphStyle: {
          fields: "alignment",
          paragraphStyle: { alignment: "CENTER" },
          range: { endIndex: 2, startIndex: 1 },
        },
      },
    ]);
    expect((parse(emptyOut).tabs[0].blocks[0] as ParagraphBlock).style.alignment).toBe("CENTER");
  });

  test("RANGE_AT_SEGMENT_END: insertText at index === segment length (the one real segment-end restriction)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    expect(() => requestsEmulate(json, [{ insertText: { location: { index: 3 }, text: "x" } }])).toThrowError(
      expect.objectContaining({ code: "RANGE_AT_SEGMENT_END" }) as unknown as EmulatorError,
    );
  });

  test("TAB_REQUIRED: a request on a multi-tab document with no tabId", () => {
    const json = docJsonBuild({
      tabs: [
        { blocks: [{ content: ["a"], kind: "paragraph" }], tabId: "t.0" },
        { blocks: [{ content: ["b"], kind: "paragraph" }], tabId: "t.1" },
      ],
    });
    expect(() => requestsEmulate(json, [{ insertText: { location: { index: 0 }, text: "x" } }])).toThrowError(
      expect.objectContaining({ code: "TAB_REQUIRED" }) as unknown as EmulatorError,
    );
  });

  test("UNKNOWN_REQUEST: an unrecognized request kind", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    expect(() => requestsEmulate(json, [{ replaceAllText: {} }])).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_REQUEST" }) as unknown as EmulatorError,
    );
  });
});
