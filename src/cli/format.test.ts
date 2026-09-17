/* Tests for CLI JSON output formatting and input parsing. */

import { describe, expect, test } from "bun:test";
import { formatOutput, parseInput } from "./format.ts";

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

  test("formats as JSON", () => {
    const formatted = formatOutput(undefined, sample);
    expect(formatted.startsWith("{")).toBe(true);
    expect(JSON.parse(formatted)).toEqual(sample);
  });
});

describe("parseInput", () => {
  test("parses valid JSON string", () => {
    const json = JSON.stringify({ ops: [{ at: 7, innerText: "Hello" }] });
    expect(parseInput(json)).toEqual({ ops: [{ at: 7, innerText: "Hello" }] });
  });

  test("rejects non-JSON input", () => {
    expect(() =>
      parseInput(`
documentId: doc-abc
ops: []
`),
    ).toThrow();
  });
});
