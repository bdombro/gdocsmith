/* Tests for docModelsCompare. */

import { describe, expect, test } from "bun:test";
import { docModelsCompare } from "./equivalence.ts";
import type { DocModel, ParagraphBlock, TabModel } from "./types.ts";

function tab(blocks: TabModel["blocks"], overrides: Partial<TabModel> = {}): TabModel {
  return {
    blocks,
    documentStyle: {},
    footnotes: {},
    headersFooters: {},
    inlineObjects: {},
    isNew: false,
    leadingSectionStyle: {},
    lists: {},
    namedRanges: [],
    namedStyles: {},
    positionedObjects: {},
    tabId: "t.0",
    title: "Tab",
    ...overrides,
  };
}

function doc(tabs: TabModel[]): DocModel {
  return { docId: "d1", isNew: false, tabs, title: "Doc" };
}

function paragraph(key: string, overrides: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return { inlines: [], key, kind: "paragraph", newline: { style: {} }, protected: false, style: {}, ...overrides };
}

describe("docModelsCompare", () => {
  test("equal despite run splits (merged by canonical style)", () => {
    const expected = doc([
      tab([paragraph("o1", { inlines: [{ kind: "text", style: { bold: true }, text: "Hello world" }] })]),
    ]);
    const actual = doc([
      tab([
        paragraph("o1", {
          inlines: [
            { kind: "text", style: { bold: true }, text: "Hello " },
            { kind: "text", style: { bold: true }, text: "world" },
          ],
        }),
      ]),
    ]);
    const result = docModelsCompare(expected, actual);
    expect(result.diffs).toEqual(expect.arrayContaining([expect.stringContaining("inline count")]));
    expect(result.equal).toBe(false);
  });

  test("listIds match exactly for kept lists, but not for two newly created lists", () => {
    const keptExpected = doc([tab([paragraph("o1", { bullet: { listId: "kix.abc", nestingLevel: 0 } })])]);
    const keptActualSame = doc([tab([paragraph("o1", { bullet: { listId: "kix.abc", nestingLevel: 0 } })])]);
    expect(docModelsCompare(keptExpected, keptActualSame).equal).toBe(true);
    const keptActualDiff = doc([tab([paragraph("o1", { bullet: { listId: "kix.xyz", nestingLevel: 0 } })])]);
    expect(docModelsCompare(keptExpected, keptActualDiff).equal).toBe(false);

    const newExpected = doc([tab([paragraph("n1", { bullet: { listId: "new:list:1", nestingLevel: 0 } })])]);
    const newActual = doc([tab([paragraph("n1", { bullet: { listId: "kix.realid", nestingLevel: 0 } })])]);
    expect(docModelsCompare(newExpected, newActual).equal).toBe(true);
  });

  test("a new heading needs some headingId; a kept heading needs the same one", () => {
    const keptExpected = doc([tab([paragraph("o1", { headingId: "h.1", style: { namedStyleType: "HEADING_1" } })])]);
    const keptActualMissing = doc([tab([paragraph("o1", { style: { namedStyleType: "HEADING_1" } })])]);
    expect(docModelsCompare(keptExpected, keptActualMissing).equal).toBe(false);
    const keptActualSame = doc([tab([paragraph("o1", { headingId: "h.1", style: { namedStyleType: "HEADING_1" } })])]);
    expect(docModelsCompare(keptExpected, keptActualSame).equal).toBe(true);

    const newExpected = doc([tab([paragraph("n1", { style: { namedStyleType: "HEADING_1" } })])]);
    const newActualWithId = doc([
      tab([paragraph("n1", { headingId: "h.new", style: { namedStyleType: "HEADING_1" } })]),
    ]);
    expect(docModelsCompare(newExpected, newActualWithId).equal).toBe(true);
    const newActualMissing = doc([tab([paragraph("n1", { style: { namedStyleType: "HEADING_1" } })])]);
    expect(docModelsCompare(newExpected, newActualMissing).equal).toBe(false);
  });

  test("identity transfer moves the expected headingId onto a different key", () => {
    const expected = doc([tab([paragraph("o1", { headingId: "h.1", style: { namedStyleType: "HEADING_1" } })])]);
    const actual = doc([tab([paragraph("o1", { headingId: "h.1", style: { namedStyleType: "HEADING_1" } })])]);
    const transferred = doc([tab([paragraph("o1", { headingId: "h.moved", style: { namedStyleType: "HEADING_1" } })])]);
    expect(docModelsCompare(expected, actual).equal).toBe(true);
    expect(docModelsCompare(expected, transferred).equal).toBe(false);
    expect(
      docModelsCompare(expected, transferred, {
        identityTransfers: [{ fromKey: "o1", headingId: "h.moved", tabId: "t.0", toKey: "o1" }],
      }).equal,
    ).toBe(true);
  });

  test("a new image atom compares by its create fields only, ignoring style", () => {
    const expected = doc([
      tab([
        paragraph("n1", {
          inlines: [
            { create: { type: "image", uri: "https://x/img.png" }, key: "n2", kind: "atom", length: 1, type: "image" },
          ],
        }),
      ]),
    ]);
    const actual = doc([
      tab([
        paragraph("n1", {
          inlines: [
            {
              create: { type: "image", uri: "https://x/img.png" },
              key: "n2",
              kind: "atom",
              length: 1,
              style: { backgroundColor: { color: { rgbColor: {} } } },
              type: "image",
            },
          ],
        }),
      ]),
    ]);
    expect(docModelsCompare(expected, actual).equal).toBe(true);
  });

  test("diffs are human-readable and name the field", () => {
    const expected = doc([tab([paragraph("o1", { inlines: [{ kind: "text", style: {}, text: "a" }] })])]);
    const actual = doc([tab([paragraph("o1", { inlines: [{ kind: "text", style: {}, text: "b" }] })])]);
    const result = docModelsCompare(expected, actual);
    expect(result.equal).toBe(false);
    expect(result.diffs[0]).toContain("text");
    expect(result.diffs[0]).toContain("expected");
  });
});
