/* Tests for unified diff formatting. */

import { describe, expect, test } from "bun:test";
import { unifiedDiffFormat } from "./unified.ts";

const paths = { newPath: "b/doc", oldPath: "a/doc" };

describe("unifiedDiffFormat", () => {
  test("equal texts give an empty diff", () => {
    expect(unifiedDiffFormat("a\nb", "a\nb", paths)).toBe("");
  });

  test("one changed line with context", () => {
    const old = ["1", "2", "3", "4", "5", "6", "7"].join("\n");
    const next = ["1", "2", "3", "X", "5", "6", "7"].join("\n");
    expect(unifiedDiffFormat(old, next, { ...paths, context: 1 })).toBe(
      ["--- a/doc", "+++ b/doc", "@@ -3,3 +3,3 @@", " 3", "-4", "+X", " 5"].join("\n"),
    );
  });

  test("distant changes make separate hunks; near ones merge", () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const far = [...old];
    far[1] = "A";
    far[18] = "B";
    expect(unifiedDiffFormat(old.join("\n"), far.join("\n"), paths).match(/^@@/gm)).toHaveLength(2);
    const near = [...old];
    near[5] = "A";
    near[9] = "B";
    expect(unifiedDiffFormat(old.join("\n"), near.join("\n"), paths).match(/^@@/gm)).toHaveLength(1);
  });

  test("insertion into an empty text", () => {
    expect(unifiedDiffFormat("", "a", paths)).toBe(["--- a/doc", "+++ b/doc", "@@ -0,0 +1,1 @@", "+a"].join("\n"));
  });
});
