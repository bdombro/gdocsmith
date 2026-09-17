/* Unit tests for workflow step to TapeMutation forwarding. */

import { describe, expect, test } from "bun:test";
import { TAPE_MUTATION_KEYS, type TapeMutationKey } from "~/core/dom/ops.ts";
import type { GdocsmithStepInput } from "~/core/workflowTypes.ts";
import { domOpFromStep } from "./domOpFromStep.ts";
import { QUERY_STEP_FIELDS } from "./query.ts";

describe("domOpFromStep", () => {
  test("forwards every TapeMutation key present on the step", () => {
    const identity = (val?: string) => val;
    for (const key of TAPE_MUTATION_KEYS) {
      const step: GdocsmithStepInput = {
        kind: "surgical",
        [key]: sampleMutationValue(key),
      };
      const mutation = domOpFromStep(step, identity);
      expect(mutation[key], `missing TapeMutation key ${key}`).toBeDefined();
    }
  });

  test("resolves alias strings on at/after/before and cloneNode", () => {
    const aliases = (val?: string) => (val === "heading" ? "h.arch.9a1b" : val);
    const mutation = domOpFromStep(
      {
        after: "heading",
        cloneNode: "heading",
        kind: "surgical",
      },
      aliases,
    );
    expect(mutation.after).toBe("h.arch.9a1b");
    expect(mutation.cloneNode).toBe("h.arch.9a1b");
  });

  test("maps markdown: onto insertMarkdown when insertMarkdown is omitted", () => {
    const mutation = domOpFromStep({ kind: "surgical", markdown: "# Hi" }, (v) => v);
    expect(mutation.insertMarkdown).toBe("# Hi");
  });
});

describe("query adapter completeness", () => {
  test("query.ts reads every QUERY_STEP_FIELDS name from the step", async () => {
    const src = await Bun.file(new URL("./query.ts", import.meta.url)).text();
    for (const field of QUERY_STEP_FIELDS) {
      expect(src.includes(`step.${field}`) || src.includes(`step[`), `query.ts must read step.${field}`).toBe(true);
      expect(src).toContain(`"${field}"`);
    }
    for (const field of ["contains", "stylesOnly", "under", "unsafeOnly", "output", "full", "tab", "as", "doc"]) {
      expect(src).toContain(`step.${field}`);
    }
  });
});

/** Sample value that survives TapeMutation assignment for a key. */
function sampleMutationValue(key: TapeMutationKey): unknown {
  switch (key) {
    case "after":
    case "as":
    case "at":
    case "before":
    case "file":
    case "innerText":
    case "replace":
      return "h.sample";
    case "alignment":
    case "tableAlignment":
      return "CENTER";
    case "bullet":
    case "dangerousRemoveSection":
    case "deleteTableColumn":
    case "deleteTableRow":
    case "force":
    case "h1IsTitle":
    case "insertSectionBreak":
    case "remove":
      return true;
    case "cloneNode":
      return "h.sample";
    case "cloneNodes":
      return ["h.sample"];
    case "duplicateTableRow":
      return { row: 0 };
    case "element":
      return { kind: "paragraph", text: "x" };
    case "elements":
      return [{ kind: "paragraph", text: "x" }];
    case "markdownStyles":
      return { alert: { color: "#ff0000" } };
    case "insertAdjacentElement":
      return { element: { kind: "paragraph", text: "x" }, position: "afterend" };
    case "insertDate":
      return { timestamp: "2026-09-15T00:00:00Z" };
    case "insertFootnote":
      return { text: "note" };
    case "insertImage":
      return { uri: "https://example.com/a.png" };
    case "insertMarkdown":
    case "replaceMarkdown":
    case "replaceSection":
    case "replaceSectionMarkdown":
      return "# x";
    case "insertPerson":
      return { email: "alice@example.com" };
    case "insertRichLink":
      return { uri: "https://example.com" };
    case "insertTableColumn":
      return { col: 0 };
    case "insertTableRow":
      return { row: 0 };
    case "namedStyleType":
      return "HEADING_2";
    case "position":
      return "afterend";
    case "runs":
      return [{ text: "x" }];
    case "style":
    case "tableStyle":
      return { fontSize: 11 };
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}
