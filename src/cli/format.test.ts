/* Tests for CLI output formatting and structured input parsing. */

import { describe, expect, test } from "bun:test";
import { formatOutput, formatYaml, parseInput } from "./format.ts";

describe("formatOutput", () => {
  const sample = {
    documentId: "doc-123",
    nodes: [
      { id: 1, namedStyleType: "HEADING_1", text: "Title" },
      { id: 2, namedStyleType: "NORMAL_TEXT", text: "Line 1\nLine 2" },
    ],
    ops: [],
    revisionId: "rev-456",
    tabId: "t.0",
  };

  test("defaults to YAML formatting", () => {
    const formatted = formatOutput(undefined, sample);
    expect(formatted).toContain("documentId: doc-123");
    expect(formatted).toContain("revisionId: rev-456");
    expect(formatted).toContain("tabId: t.0");
    expect(formatted).toContain("ops: []");
    expect(formatted).toContain("Line 1\n      Line 2");
    // Ensure it parses back accurately
    expect(parseInput(formatted)).toEqual(sample);
  });

  test("uses JSON when ctx has --json flag", () => {
    const ctx = {
      hasFlag: (name: string) => name === "json",
    };
    const formatted = formatOutput(ctx, sample);
    expect(formatted.startsWith("{")).toBe(true);
    expect(JSON.parse(formatted)).toEqual(sample);
  });

  test("uses YAML when ctx does not have --json flag", () => {
    const ctx = {
      hasFlag: (_name: string) => false,
    };
    const formatted = formatOutput(ctx, sample);
    expect(formatted.startsWith("documentId:")).toBe(true);
    expect(parseInput(formatted)).toEqual(sample);
  });

  test("does not wrap long lines in YAML", () => {
    const longText = "A".repeat(300);
    const formatted = formatYaml({ longText });
    expect(formatted).toContain(`longText: ${longText}`);
    expect(formatted.split("\n").length).toBe(1);
  });
});

describe("parseInput", () => {
  test("parses valid JSON string", () => {
    const json = JSON.stringify({ ops: [{ at: 7, innerText: "Hello" }] });
    expect(parseInput(json)).toEqual({ ops: [{ at: 7, innerText: "Hello" }] });
  });

  test("parses valid YAML string", () => {
    const yaml = `
documentId: doc-abc
revisionId: rev-1
ops:
  - at: 7
    innerText: |-
      Line 1
      Line 2
`;
    expect(parseInput(yaml)).toEqual({
      documentId: "doc-abc",
      ops: [{ at: 7, innerText: "Line 1\nLine 2" }],
      revisionId: "rev-1",
    });
  });

  test("parses bare array in YAML", () => {
    const yaml = `
- at: 10
  innerText: New item
- at: 11
  remove: true
`;
    expect(parseInput(yaml)).toEqual([
      { at: 10, innerText: "New item" },
      { at: 11, remove: true },
    ]);
  });
});
