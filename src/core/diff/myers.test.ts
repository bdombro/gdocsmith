/* Tests for Myers hunks and weighted LCS pairing. */

import { describe, expect, test } from "bun:test";
import { rngCreate } from "../model/testDocs.ts";
import { diffHunks, lcsPairs } from "./myers.ts";

/** Applies hunks to `a`, producing what should equal `b`. */
function hunksApply<T>(a: readonly T[], b: readonly T[], hunks: ReturnType<typeof diffHunks>): T[] {
  const out: T[] = [];
  let ai = 0;
  for (const h of hunks) {
    while (ai < h.aStart) out.push(a[ai++]);
    out.push(...b.slice(h.bStart, h.bEnd));
    ai = h.aEnd;
  }
  while (ai < a.length) out.push(a[ai++]);
  return out;
}

/** Plain LCS length, for checking minimality. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

describe("diffHunks", () => {
  test("known scripts", () => {
    expect(diffHunks([..."abc"], [..."abc"])).toEqual([]);
    expect(diffHunks([], [..."ab"])).toEqual([{ aEnd: 0, aStart: 0, bEnd: 2, bStart: 0 }]);
    expect(diffHunks([..."ab"], [])).toEqual([{ aEnd: 2, aStart: 0, bEnd: 0, bStart: 0 }]);
    expect(diffHunks([..."the cat"], [..."the bat"])).toEqual([{ aEnd: 5, aStart: 4, bEnd: 5, bStart: 4 }]);
  });

  test("random inputs: hunks reproduce b with a minimal number of edits, deterministically", () => {
    const rng = rngCreate(7);
    for (let t = 0; t < 500; t++) {
      const a = Array.from({ length: Math.floor(rng() * 14) }, () => "abc"[Math.floor(rng() * 3)]);
      const b = Array.from({ length: Math.floor(rng() * 14) }, () => "abc"[Math.floor(rng() * 3)]);
      const hunks = diffHunks(a, b);
      expect(hunksApply(a, b, hunks)).toEqual(b);
      const edits = hunks.reduce((n, h) => n + h.aEnd - h.aStart + h.bEnd - h.bStart, 0);
      expect(edits).toBe(a.length + b.length - 2 * lcsLength(a, b));
      expect(diffHunks(a, b)).toEqual(hunks);
    }
  });

  test("custom equality", () => {
    expect(diffHunks(["A"], ["a"], (x, y) => x.toLowerCase() === y.toLowerCase())).toEqual([]);
  });
});

describe("lcsPairs", () => {
  test("pairs form a longest common subsequence", () => {
    const rng = rngCreate(11);
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: Math.floor(rng() * 10) }, () => "xyz"[Math.floor(rng() * 3)]);
      const b = Array.from({ length: Math.floor(rng() * 10) }, () => "xyz"[Math.floor(rng() * 3)]);
      const pairs = lcsPairs(a, b);
      expect(pairs.length).toBe(lcsLength(a, b));
      pairs.forEach(([i, j], k) => {
        expect(a[i]).toBe(b[j]);
        if (k > 0) expect(i > pairs[k - 1][0] && j > pairs[k - 1][1]).toBe(true);
      });
    }
  });

  test("ties go to the heavier element", () => {
    // "X" could pair with either original X; the anchored second one wins.
    expect(lcsPairs(["X", "X"], ["X"], (i) => (i === 1 ? 5 : 0))).toEqual([[1, 0]]);
    expect(lcsPairs(["X", "X"], ["X"])).toHaveLength(1);
  });
});
