/* Tests for structural invariant validation and normalization. */

import { describe, expect, test } from "bun:test";
import { blockInvisibleIs, containerNormalize, containerValidate, paragraphEmptyCreate } from "./invariants.ts";
import { KeyAllocator } from "./keys.ts";
import type { Block, ParagraphBlock, SectionBreakBlock, TableBlock } from "./types.ts";

function paragraph(key: string, opts: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return { inlines: [], key, kind: "paragraph", newline: { style: {} }, protected: false, style: {}, ...opts };
}

function table(key: string): TableBlock {
  return { columns: [], key, kind: "table", protected: false, rows: [] };
}

function sectionBreak(key: string): SectionBreakBlock {
  return { key, kind: "sectionBreak", sectionStyle: {} };
}

describe("invariants", () => {
  test("V1 fails when the container ends with a table", () => {
    const blocks: Block[] = [paragraph("o1"), table("o2")];
    expect(containerValidate(blocks, { inCell: false })).toEqual(
      expect.arrayContaining([expect.stringContaining("V1")]),
    );
  });

  test("V2 fails when a table is directly followed by another table", () => {
    const blocks: Block[] = [paragraph("o1"), table("o2"), table("o3"), paragraph("o4")];
    const problems = containerValidate(blocks, { inCell: false });
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("block 2 (table)")]));
  });

  test("a valid sequence has no problems", () => {
    const blocks: Block[] = [paragraph("o1"), table("o2"), paragraph("o3"), sectionBreak("o4"), paragraph("o5")];
    expect(containerValidate(blocks, { inCell: false })).toEqual([]);
  });

  test("normalize inserts empty paragraphs to fix V1/V2", () => {
    const keys = new KeyAllocator();
    const stamp = { force: false, stepIndex: 0 };
    const blocks: Block[] = [table("o1"), table("o2")];
    const normalized = containerNormalize(blocks, keys, stamp);
    expect(normalized.map((b) => b.kind)).toEqual(["paragraph", "table", "paragraph", "table", "paragraph"]);
    expect(containerValidate(normalized, { inCell: false })).toEqual([]);
  });

  test("normalize leaves an already-valid sequence unchanged", () => {
    const keys = new KeyAllocator();
    const stamp = { force: false, stepIndex: 0 };
    const blocks: Block[] = [paragraph("o1"), table("o2"), paragraph("o3")];
    expect(containerNormalize(blocks, keys, stamp)).toEqual(blocks);
  });

  test("paragraphEmptyCreate makes an empty NORMAL_TEXT paragraph", () => {
    const keys = new KeyAllocator();
    const p = paragraphEmptyCreate(keys);
    expect(p.inlines).toEqual([]);
    expect(p.bullet).toBeUndefined();
    expect(p.key.startsWith("n")).toBe(true);
  });

  test("blockInvisibleIs", () => {
    expect(blockInvisibleIs(paragraph("o1"))).toBe(true);
    expect(blockInvisibleIs(paragraph("o1", { style: { namedStyleType: "HEADING_1" } }))).toBe(false);
    expect(blockInvisibleIs(paragraph("o1", { bullet: { listId: "l1", nestingLevel: 0 } }))).toBe(false);
    expect(blockInvisibleIs(paragraph("o1", { inlines: [{ kind: "text", style: {}, text: "x" }] }))).toBe(false);
    expect(blockInvisibleIs(table("o1"))).toBe(false);
  });
});
