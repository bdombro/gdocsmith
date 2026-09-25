/* Tests for lens put: minimal edits, kind changes, refusals, tokens, and links. */

import { describe, expect, test } from "bun:test";
import blankTab from "../model/blankTab.json";
import type { EditTarget } from "../model/edit.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { listPresetTable } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { DocModel, ParagraphBlock } from "../model/types.ts";
import { docPlanSelfCheck, docReconcile } from "../reconcile/reconcile.ts";
import { tabMarkdownExport } from "./export.ts";
import { markdownPut, type Placement } from "./put.ts";

/** A document, a mutable copy, and helpers to export, write, and plan. */
function setup(blocks: BlockSpec[], listLevels?: readonly unknown[]) {
  const nestingLevels = structuredClone([
    ...(listLevels ?? listPresetTable().BULLET_DISC_CIRCLE_SQUARE ?? []),
  ]) as JsonObject[];
  const json = docJsonBuild({
    tabs: [
      {
        blocks,
        lists: { "kix.p": { listProperties: { nestingLevels } } },
        title: "Main",
      },
    ],
  }) as unknown as { tabs: Array<{ documentTab: Record<string, unknown> }> };
  json.tabs[0].documentTab.namedStyles = structuredClone(blankTab.namedStyles);
  const keys = new KeyAllocator();
  const original = docModelParse(json as never, { docId: "d", keys });
  const final: DocModel = structuredClone(original);
  const target: EditTarget = {
    ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] },
    tab: final.tabs[0],
  };
  const whole = () => ({ containerRef: { kind: "body" as const }, from: 0, to: final.tabs[0].blocks.length });
  return {
    exportMd: (plain = false) => tabMarkdownExport(final, final.tabs[0], whole(), { skipFrontmatter: plain }).markdown,
    final,
    plan: () => {
      const input = { final, original, originalJson: json as never };
      const plan = docReconcile(input);
      return { check: docPlanSelfCheck(plan, input), plan };
    },
    target,
    write: (md: string, placement: Placement = { kind: "replace", range: { kind: "tab" } }) =>
      markdownPut(target, final, placement, md),
  };
}

const para = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });
const kinds = (requests: JsonObject[]) => requests.map((r) => Object.keys(r)[0]);
const mixedListLevels: JsonObject[] = [
  { glyphFormat: "%0.", glyphType: "DECIMAL", startNumber: 1 },
  { glyphSymbol: "•", glyphType: "GLYPH_TYPE_UNSPECIFIED" },
];
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (err) {
    return (err as { code: string }).code;
  }
};

function mixedListSetup() {
  return setup(
    [
      { bullet: { listId: "kix.p" }, content: ["step"], kind: "paragraph" },
      { bullet: { listId: "kix.p", nestingLevel: 1 }, content: ["detail"], kind: "paragraph" },
      para("unrelated"),
    ],
    mixedListLevels,
  );
}

describe("markdownPut", () => {
  test("unchanged markdown changes nothing (both modes)", () => {
    const s = setup([para("one"), { content: [{ style: { bold: true }, text: "two" }], kind: "paragraph" }]);
    expect(s.write(s.exportMd()).changed).toBe(false);
    expect(s.write(s.exportMd(true)).changed).toBe(false);
    expect(s.plan().plan.contentRequests).toEqual([]);
  });

  test("a word edit touches only the changed characters", () => {
    const s = setup([para("intro"), para("the quick brown fox"), para("outro")]);
    s.write(s.exportMd().replace("quick", "slow"));
    const { check, plan } = s.plan();
    expect(check.diffs).toEqual([]);
    expect(kinds(plan.contentRequests)).toEqual(["deleteContentRange", "insertText", "updateTextStyle"]);
  });

  test("a marker change converts the list kind in place, keeping the text", () => {
    const s = setup([para("intro"), { bullet: { listId: "kix.p" }, content: ["item"], kind: "paragraph" }, para("z")]);
    s.write(s.exportMd().replace("- item", "1. item"));
    const { check, plan } = s.plan();
    expect(check.diffs).toEqual([]);
    expect(kinds(plan.contentRequests)).not.toContain("deleteContentRange");
    expect(kinds(plan.contentRequests)).toContain("createParagraphBullets");
  });

  test("indenting an item nests it", () => {
    const s = setup([
      { bullet: { listId: "kix.p" }, content: ["a"], kind: "paragraph" },
      { bullet: { listId: "kix.p" }, content: ["b"], kind: "paragraph" },
      para("z"),
    ]);
    s.write(s.exportMd().replace("- b", "  - b"));
    expect((s.final.tabs[0].blocks[1] as ParagraphBlock).bullet?.nestingLevel).toBe(1);
    expect(s.plan().check.diffs).toEqual([]);
  });

  test("code is literal: asterisks inside a code block stay asterisks", () => {
    const mono = { weightedFontFamily: { fontFamily: "Courier New", weight: 400 } };
    const s = setup([para("intro"), { content: [{ style: mono, text: "a = *x*" }], kind: "paragraph" }, para("z")]);
    s.write(s.exportMd().replace("a = *x*", "a = *y*"));
    const p = s.final.tabs[0].blocks[1] as ParagraphBlock;
    expect(p.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe("a = *y*");
    expect(s.plan().check.diffs).toEqual([]);
  });

  test("a heading level change is one style change", () => {
    const s = setup([
      { content: ["Title"], headingId: "h.1", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
      para("body"),
    ]);
    s.write(s.exportMd().replace("# Title", "## Title"));
    expect(kinds(s.plan().plan.contentRequests)).toEqual(["updateParagraphStyle"]);
  });

  test("refusals: stale revision, undefined directive, changed token label, moved equation", () => {
    const s = setup([para("a"), { content: ["b", { type: "equation" }], kind: "paragraph" }]);
    const md = s.exportMd();
    expect(code(() => s.write(md.replace('revision: "rev-1"', 'revision: "old"')))).toBe("staleBase");
    expect(code(() => s.write(`${md}\n::nope[x]::\n`))).toBe("unsupportedSyntax");
    const moved = md.replace("b{{equation:1}}", "b").replace("\na\n", "\na{{equation:1}}\n");
    expect(code(() => s.write(moved))).toBe("unrecreatableMove");
  });

  test("a token's label can't be edited; a person chip moves by recreation", () => {
    const s = setup([para("a"), { content: ["b", { type: "person" }], kind: "paragraph" }]);
    const person = (s.final.tabs[0].blocks[1] as ParagraphBlock).inlines[1];
    if (person.kind === "atom") person.raw = { person: { personProperties: { email: "p@x.test", name: "Pat" } } };
    const md = s.exportMd();
    expect(md).toContain("{{person:1|Pat}}");
    expect(code(() => s.write(md.replace("{{person:1|Pat}}", "{{person:1|Sam}}")))).toBe("tokenLabelChanged");
    s.write(md.replace("b{{person:1|Pat}}", "b").replace("\na\n", "\na{{person:1|Pat}}\n"));
    const a = s.final.tabs[0].blocks[0] as ParagraphBlock;
    expect(a.inlines[1]).toMatchObject({ create: { email: "p@x.test", type: "person" } });
  });

  test("new mixed-kind nested lists are refused before mutation", () => {
    const s = setup([para("intro")]);
    expect(code(() => s.write("1. step one\n   - detail\n1. step two", { kind: "append" }))).toBe("unsupportedSyntax");
    expect((s.final.tabs[0].blocks[0] as ParagraphBlock).inlines[0]).toMatchObject({ text: "intro" });
    expect(s.final.tabs[0].blocks).toHaveLength(1);
  });

  test("same-kind nested list items remain supported", () => {
    const s = setup([para("intro")]);
    s.write("1. step\n   1. detail", { kind: "append" });
    const items = (s.final.tabs[0].blocks as ParagraphBlock[]).slice(1);
    expect(items.map((item) => item.bullet?.nestingLevel)).toEqual([0, 1]);
    expect(s.plan().check.diffs).toEqual([]);
  });

  test("an unchanged UI-created mixed-kind list round-trips; editing its mixed item is refused", () => {
    const s = mixedListSetup();
    const md = s.exportMd();
    expect(md).toContain("1. step\n   - detail");
    expect(s.write(md).changed).toBe(false);
    expect(code(() => s.write(md.replace("- detail", "- changed detail")))).toBe("unsupportedSyntax");
    expect((s.final.tabs[0].blocks[1] as ParagraphBlock).inlines[0]).toMatchObject({ text: "detail" });
  });

  test("removing an existing mixed-kind nested item remains supported", () => {
    const s = mixedListSetup();
    const md = s.exportMd();
    expect(s.write(md.replace("   - detail\n", "")).changed).toBe(true);
    expect(s.plan().check.diffs).toEqual([]);
    expect(s.exportMd()).not.toContain("detail");
  });

  test("unrelated edits preserve an existing UI-created mixed-kind list", () => {
    const s = mixedListSetup();
    const md = s.exportMd();
    expect(s.write(md.replace("unrelated", "changed outside list")).changed).toBe(true);
    expect(s.exportMd()).toContain("1. step\n   - detail");
    expect(s.plan().check.diffs).toEqual([]);
  });

  test("headings of every level (H1–H6) are created and read back", () => {
    const s = setup([para("intro")]);
    const md = [1, 2, 3, 4, 5, 6].map((n) => `${"#".repeat(n)} Level ${n}`).join("\n\n");
    s.write(md, { kind: "append" });
    const types = (s.final.tabs[0].blocks as ParagraphBlock[]).slice(1).map((p) => p.style.namedStyleType);
    expect(types).toEqual([1, 2, 3, 4, 5, 6].map((n) => `HEADING_${n}`));
    expect(s.plan().check.diffs).toEqual([]);
    expect(s.exportMd(true)).toBe(`intro\n\n${md}\n`);
  });

  test("markdown table edits: cells, rows, columns, alignment", () => {
    const table: BlockSpec = {
      cells: [
        [[{ content: ["Name"] }], [{ content: ["Age"] }]],
        [[{ content: ["Ada"] }], [{ content: ["36"] }]],
      ],
      kind: "table",
    };
    const s = setup([para("intro"), table, para("z")]);
    const md = s.exportMd();
    expect(md).toContain("| Name | Age |");
    s.write(
      md.replace(
        "| Name | Age |\n| --- | --- |\n| Ada | 36 |",
        "| Name | Role | Age |\n| --- | :-: | --- |\n| Ada | Eng | 37 |\n| Bob | Ops | 41 |",
      ),
    );
    const { check } = s.plan();
    expect(check.diffs).toEqual([]);
    expect(s.exportMd()).toContain(
      "| Name | Role | Age |\n| --- | :-: | --- |\n| Ada | Eng | 37 |\n| Bob | Ops | 41 |",
    );
  });

  test("a read-only table can't change or move", () => {
    const table: BlockSpec = {
      cells: [[[{ content: ["x"] }, { content: ["x2"] }], [{ content: ["y"] }]]],
      kind: "table",
    };
    const s = setup([para("intro"), table, para("z")]);
    const md = s.exportMd();
    expect(code(() => s.write(md.replace("| x x2 | y |", "| x x2 | changed |")))).toBe("readOnlyTable");
    const lines = md.split("\n");
    const start = lines.findIndex((l) => l.startsWith("| x x2"));
    const tableLines = lines.splice(start, 2);
    lines.push("", ...tableLines);
    expect(code(() => s.write(lines.join("\n")))).toBe("unrecreatableMove");
  });

  test("appending into an empty tab leaves no stray empty paragraph", () => {
    const s = setup([{ content: [], kind: "paragraph" }]);
    s.write("# Title\n\nbody", { kind: "append" });
    expect(
      s.final.tabs[0].blocks.map((b) =>
        b.kind === "paragraph" ? b.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("") : b.kind,
      ),
    ).toEqual(["Title", "body"]);
    expect(s.plan().check.diffs).toEqual([]);
  });

  test("a link to a heading created in the same markdown becomes a pending link to it", () => {
    const s = setup([para("a")]);
    const report = s.write("# New Part\n\n[see](<#New Part>)", { kind: "append" });
    const [heading, link] = report.createdKeys;
    const p = s.final.tabs[0].blocks.find((b) => b.key === link) as ParagraphBlock;
    expect(p.inlines[0].style?.link).toEqual({ heading: { key: heading, tabId: "t.0" } });
    expect(s.plan().plan.pendingLinks).toMatchObject([{ headingKey: heading, length: 3, offset: 0 }]);
  });
});
