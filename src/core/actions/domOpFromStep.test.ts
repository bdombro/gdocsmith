/* Unit tests for workflow step to TapeMutation forwarding. */

import { describe, expect, test } from "bun:test";
import { TAPE_MUTATION_KEYS, type TapeMutationKey } from "~/core/dom/ops.ts";
import type { GdocsmithStepInput } from "~/core/workflowTypes.ts";
import { domOpFromStep } from "./domOpFromStep.ts";
import { QUERY_STEP_FIELDS } from "./query.ts";

describe("domOpFromStep", () => {
  test("forwards every TapeMutation key present on the step", () => {
    const identity = (val?: string) => val;
    const workflowAnchor: Partial<Record<TapeMutationKey, string>> = {
      after: "nodeAfter",
      at: "nodeAt",
      before: "nodeBefore",
    };
    for (const key of TAPE_MUTATION_KEYS) {
      const stepKey = workflowAnchor[key] ?? key;
      const step = {
        doc: "doc1",
        kind: "surgical",
        [stepKey]: sampleMutationValue(key),
      } as GdocsmithStepInput;
      const mutation = domOpFromStep(step, identity);
      expect(mutation[key], `missing TapeMutation key ${key}`).toBeDefined();
    }
  });

  test("resolves alias strings on nodeAfter and cloneNode", () => {
    const aliases = (val?: string) => (val === "heading" ? "h.arch.9a1b" : val);
    const mutation = domOpFromStep(
      {
        cloneNode: "heading",
        doc: "doc1",
        kind: "surgical",
        nodeAfter: "heading",
      },
      aliases,
    );
    expect(mutation.after).toBe("h.arch.9a1b");
    expect(mutation.cloneNode).toBe("h.arch.9a1b");
  });

  test("maps markdown: onto insertMarkdown when insertMarkdown is omitted", () => {
    const mutation = domOpFromStep({ doc: "doc1", kind: "markdownInsert", markdown: "# Hi" }, (v) => v);
    expect(mutation.insertMarkdown).toBe("# Hi");
  });

  test("maps markdown: onto replaceMarkdown when kind is replaceMarkdown", () => {
    const mutation = domOpFromStep(
      { doc: "doc1", kind: "replaceMarkdown", markdown: "# New Title", nodeAt: "h.title" },
      (v) => v,
    );
    expect(mutation.replaceMarkdown).toBe("# New Title");
    expect(mutation.insertMarkdown).toBeUndefined();
  });

  test("maps markdown: onto replaceSection when kind is replaceSection", () => {
    const mutation = domOpFromStep(
      { doc: "doc1", kind: "replaceSection", markdown: "## Motivation\n\nContent", nodeAt: "h.sec" },
      (v) => v,
    );
    expect(mutation.replaceSection).toBe("## Motivation\n\nContent");
    expect(mutation.insertMarkdown).toBeUndefined();
  });

  test("resolves at, after, and before shorthand anchor fields", () => {
    const mutation = domOpFromStep(
      {
        after: "h.after",
        at: "h.at",
        before: "h.before",
        doc: "doc1",
        kind: "surgical",
      } as GdocsmithStepInput,
      (v) => v,
    );
    expect(mutation.at).toBe("h.at");
    expect(mutation.after).toBe("h.after");
    expect(mutation.before).toBe("h.before");
  });

  test("resolves nodeAt, nodeAfter, nodeBefore, and nodeUnder aliases", () => {
    const aliases = (val?: string) => (val === "heading" ? "h.arch.9a1b" : val);
    const mutation = domOpFromStep(
      {
        doc: "doc1",
        kind: "surgical",
        nodeAfter: "heading",
        nodeAt: "heading",
        nodeBefore: "heading",
      },
      aliases,
    );
    expect(mutation.at).toBe("h.arch.9a1b");
    expect(mutation.after).toBe("h.arch.9a1b");
    expect(mutation.before).toBe("h.arch.9a1b");

    const underMutation = domOpFromStep(
      {
        doc: "doc1",
        find: "foo",
        kind: "textReplace",
        nodeUnder: "heading",
        replace: "bar",
      },
      aliases,
    );
    expect(underMutation.at).toBe("h.arch.9a1b");
  });
});

describe("query adapter completeness", () => {
  test("query.ts reads every QUERY_STEP_FIELDS name from the step", async () => {
    const src = await Bun.file(new URL("./query.ts", import.meta.url)).text();
    for (const field of QUERY_STEP_FIELDS) {
      expect(src.includes(`step.${field}`) || src.includes(`step[`), `query.ts must read step.${field}`).toBe(true);
      expect(src).toContain(`"${field}"`);
    }
    for (const field of ["contains", "stylesOnly", "nodeUnder", "unsafeOnly", "output", "full", "tab", "as", "doc"]) {
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
