/* Tests for block alignment. */

import { describe, expect, test } from "bun:test";
import { blockDiff, dice2 } from "./blockDiff.ts";
import type { ParsedBlock } from "./parse.ts";

const p = (text: string): ParsedBlock => ({ kind: "paragraph", spans: [{ kind: "text", marks: {}, text }] });

describe("blockDiff", () => {
  test("an edited block pairs with its edit, not with a new block in its position (Bar → New, Bar2)", () => {
    const edits = blockDiff([p("Foo"), p("Bar baz qux")], [p("Foo"), p("New"), p("Bar baz quux")]);
    expect(edits).toEqual([
      { kind: "keep", n: 0, o: 0 },
      { kind: "insert", n: 1 },
      { kind: "pair", n: 2, o: 1 },
    ]);
  });

  test("of two identical blocks, the anchored one is kept", () => {
    const edits = blockDiff([p("dup"), p("dup")], [p("dup")], { anchorWeight: (o) => (o === 1 ? 3 : 0) });
    expect(edits).toEqual([
      { kind: "delete", o: 0 },
      { kind: "keep", n: 0, o: 1 },
    ]);
  });

  test("dissimilar blocks aren't paired", () => {
    expect(blockDiff([p("completely different")], [p("zzz")])).toEqual([
      { kind: "delete", o: 0 },
      { kind: "insert", n: 0 },
    ]);
  });

  test("dice2", () => {
    expect(dice2("night", "nacht")).toBeCloseTo(0.25);
    expect(dice2("", "")).toBe(1);
    expect(dice2("Same  Text", "same text")).toBe(1);
  });
});
