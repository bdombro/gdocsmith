/* Tests for paragraph symbol sequences. */

import { describe, expect, test } from "bun:test";
import { paragraphSymbols, paragraphSymbolsSet, symbolId, symbolsUtf16Length } from "./symbols.ts";
import type { ParagraphBlock } from "./types.ts";

function paragraph(inlines: ParagraphBlock["inlines"]): ParagraphBlock {
  return { inlines, key: "o1", kind: "paragraph", newline: { style: {} }, protected: false, style: {} };
}

describe("symbols", () => {
  test("emoji stays one symbol and keeps its UTF-16 length", () => {
    const p = paragraph([{ kind: "text", style: {}, text: "a😀b" }]);
    const syms = paragraphSymbols(p);
    expect(syms.map(symbolId)).toEqual(["a", "😀", "b"]);
    expect(symbolsUtf16Length(syms)).toBe(4);
  });

  test("atoms are one symbol keyed by their key; lengths come from the atom", () => {
    const p = paragraph([
      { kind: "text", style: {}, text: "x" },
      { key: "o9", kind: "atom", length: 3, type: "equation" },
    ]);
    const syms = paragraphSymbols(p);
    expect(syms.map(symbolId)).toEqual(["x", "\0o9"]);
    expect(symbolsUtf16Length(syms)).toBe(4);
  });

  test("set merges equal-style characters into canonical runs", () => {
    const p = paragraph([
      { kind: "text", style: { bold: true }, text: "a" },
      { kind: "text", style: { bold: true }, text: "b" },
      { kind: "text", style: {}, text: "c" },
    ]);
    paragraphSymbolsSet(p, paragraphSymbols(p));
    expect(p.inlines).toEqual([
      { kind: "text", style: { bold: true }, text: "ab" },
      { kind: "text", style: {}, text: "c" },
    ]);
  });

  test("suggestion metadata splits runs", () => {
    const p = paragraph([
      { kind: "text", style: {}, suggestedInsertionIds: ["s1"], text: "a" },
      { kind: "text", style: {}, text: "b" },
    ]);
    paragraphSymbolsSet(p, paragraphSymbols(p));
    expect(p.inlines).toHaveLength(2);
  });
});
