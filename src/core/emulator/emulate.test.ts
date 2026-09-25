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

  test("insertText with an embedded newline splits the paragraph, minting a fresh heading id for the first half", () => {
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
    expect(blocks[0].headingId).toBeDefined();
    expect(blocks[0].headingId).not.toBe("h.orig");
    expect(blocks[1].headingId).toBe("h.orig");
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

  test("deleteContentRange merges paragraphs; the later newline's properties survive (F7)", () => {
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

  test("deleteParagraphBullets removes membership and sets indent from the level", () => {
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
    expect(p.style.indentStart).toEqual({ magnitude: 36, unit: "PT" });
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

  test("RANGE_AT_SEGMENT_END: a style range ending at the segment's final newline", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    expect(() =>
      requestsEmulate(json, [
        { updateTextStyle: { fields: "bold", range: { endIndex: 3, startIndex: 1 }, textStyle: { bold: true } } },
      ]),
    ).toThrowError(expect.objectContaining({ code: "RANGE_AT_SEGMENT_END" }) as unknown as EmulatorError);
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
    expect(() => requestsEmulate(json, [{ insertInlineImage: {} }])).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_REQUEST" }) as unknown as EmulatorError,
    );
  });
});
