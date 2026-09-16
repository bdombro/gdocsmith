import { describe, expect, test } from "bun:test";
import { formatUnifiedDiff } from "./diff.ts";

describe("formatUnifiedDiff", () => {
  test("returns empty string when inputs are identical", () => {
    const diff = formatUnifiedDiff("hello\nworld", "hello\nworld", {
      newPath: "b/file.txt",
      oldPath: "a/file.txt",
    });
    expect(diff).toBe("");
  });

  test("generates unified diff for insertions and replacements", () => {
    const oldText = "# Title\nOriginal line.\nFooter";
    const newText = "# Title\nUpdated line.\nNew line.\nFooter";
    const diff = formatUnifiedDiff(oldText, newText, {
      newPath: "b/doc.md",
      oldPath: "a/doc.md",
    });
    expect(diff).toContain("--- a/doc.md");
    expect(diff).toContain("+++ b/doc.md");
    expect(diff).toContain("-Original line.");
    expect(diff).toContain("+Updated line.");
    expect(diff).toContain("+New line.");
  });

  test("handles empty original text (creation)", () => {
    const diff = formatUnifiedDiff("", "# New Doc\nLine 1", {
      newPath: "b/doc.md",
      oldPath: "/dev/null",
    });
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/doc.md");
    expect(diff).toContain("+# New Doc");
    expect(diff).toContain("+Line 1");
  });
});
