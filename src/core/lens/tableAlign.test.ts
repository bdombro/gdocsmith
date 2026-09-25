/* Tests for table alignment. */

import { describe, expect, test } from "bun:test";
import type { ParsedSpan } from "./parse.ts";
import { tableAlign } from "./tableAlign.ts";

const t = (...rows: string[][]): ParsedSpan[][][] =>
  rows.map((r) => r.map((text) => [{ kind: "text", marks: {}, text }]));

describe("tableAlign", () => {
  test("an added row", () => {
    const a = tableAlign(t(["h1", "h2"], ["a", "b"]), t(["h1", "h2"], ["a", "b"], ["c", "d"]));
    expect(a.rows).toEqual([{ n: 0, o: 0 }, { n: 1, o: 1 }, { n: 2 }]);
    expect(a.columns).toEqual([
      { n: 0, o: 0 },
      { n: 1, o: 1 },
    ]);
  });

  test("a deleted row", () => {
    expect(tableAlign(t(["h"], ["a"], ["b"]), t(["h"], ["b"])).rows).toEqual([
      { n: 0, o: 0 },
      { o: 1 },
      { n: 1, o: 2 },
    ]);
  });

  test("edited cells pair their rows", () => {
    expect(tableAlign(t(["h", "i"], ["alpha", "beta"]), t(["h", "i"], ["alpha", "betas"])).rows).toEqual([
      { n: 0, o: 0 },
      { n: 1, o: 1 },
    ]);
  });

  test("an added column is found by header", () => {
    expect(
      tableAlign(t(["Name", "Age"], ["Ada", "36"]), t(["Name", "Role", "Age"], ["Ada", "Eng", "36"])).columns,
    ).toEqual([{ n: 0, o: 0 }, { n: 1 }, { n: 2, o: 1 }]);
  });

  test("repeated unmatched headers are ambiguous", () => {
    expect(() => tableAlign(t(["X", "Dup"], ["1", "2"]), t(["X", "Dup", "Dup"], ["1", "2", "3"]))).toThrow(
      /can't be told apart/,
    );
  });

  test("a reordered row is a delete plus an insert", () => {
    const a = tableAlign(t(["h"], ["first row"], ["second row"]), t(["h"], ["second row"], ["first row"]));
    expect(a.rows.filter((r) => r.o === undefined || r.n === undefined)).toHaveLength(2);
  });
});
