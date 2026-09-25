/* Tests for the markdown lens projection. */

import { describe, expect, test } from "bun:test";
import blankTab from "../model/blankTab.json";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { listPresetTable } from "../model/lists.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { TabModel } from "../model/types.ts";
import { projectionBuild } from "./project.ts";

const lists = {
  "kix.a": { listProperties: { nestingLevels: listPresetTable().BULLET_DISC_CIRCLE_SQUARE } },
  "kix.b": { listProperties: { nestingLevels: listPresetTable().BULLET_DISC_CIRCLE_SQUARE } },
};

/** A tab with the blank document's real named styles. */
function tabOf(blocks: BlockSpec[]): TabModel {
  const json = docJsonBuild({ tabs: [{ blocks, lists }] }) as unknown as {
    tabs: Array<{ documentTab: Record<string, unknown> }>;
  };
  json.tabs[0].documentTab.namedStyles = structuredClone(blankTab.namedStyles);
  return docModelParse(json as never, { docId: "d", keys: new KeyAllocator() }).tabs[0];
}

const project = (tab: TabModel, mode: "frontmatter" | "plain" = "frontmatter") =>
  projectionBuild(tab, { containerRef: { kind: "body" }, from: 0, to: tab.blocks.length }, { mode });
const p = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });
const empty: BlockSpec = { content: [], kind: "paragraph" };
const mono = (text: string): BlockSpec => ({
  content: [{ style: { weightedFontFamily: { fontFamily: "Courier New", weight: 400 } }, text }],
  kind: "paragraph",
});

describe("projectionBuild", () => {
  test("empty paragraphs are invisible and belong to the block before them", () => {
    const tab = tabOf([empty, p("a"), empty, empty, p("b")]);
    const proj = project(tab);
    expect(proj.leadingOwned).toEqual([tab.blocks[0].key]);
    expect(proj.blocks.map((b) => b.owned.length)).toEqual([2, 0]);
  });

  test("code lines group, and an empty paragraph between two code lines bridges them", () => {
    const tab = tabOf([mono("let a = 1;"), empty, mono("let b = 2;"), p("prose"), mono("x")]);
    const proj = project(tab);
    expect(proj.blocks.map((b) => [b.kind, b.codeGroup])).toEqual([
      ["codeLine", 1],
      ["codeLine", 1],
      ["codeLine", 1],
      ["paragraph", undefined],
      ["codeLine", 2],
    ]);
  });

  test("adjacent lists with different ids get different groups", () => {
    const tab = tabOf([
      { bullet: { listId: "kix.a" }, content: ["a1"], kind: "paragraph" },
      { bullet: { listId: "kix.a" }, content: ["a2"], kind: "paragraph" },
      { bullet: { listId: "kix.b" }, content: ["b1"], kind: "paragraph" },
    ]);
    expect(project(tab).blocks.map((b) => b.list?.group)).toEqual([1, 1, 2]);
  });

  test("a table with a multi-paragraph cell is read-only; a plain one isn't", () => {
    const plain = tabOf([p("a"), { cells: [[[{ content: ["x"] }], [{ content: ["y"] }]]], kind: "table" }, p("z")]);
    expect(project(plain).blocks[1].table?.readOnly).toBe(false);
    const complex = tabOf([
      p("a"),
      { cells: [[[{ content: ["x"] }, { content: ["x2"] }], [{ content: ["y"] }]]], kind: "table" },
      p("z"),
    ]);
    expect(project(complex).blocks[1].table?.readOnly).toBe(true);
  });

  test("tokens are numbered per kind across the tab", () => {
    const tab = tabOf([
      { content: ["a", { type: "person" }, { type: "equation" }], kind: "paragraph" },
      { content: [{ type: "person" }], kind: "paragraph" },
    ]);
    const spans = project(tab)
      .blocks.flatMap((b) => b.spans)
      .filter((s) => s.kind === "token");
    expect(spans.map((s) => (s.kind === "token" ? `${s.token.kind}:${s.token.ordinal}` : ""))).toEqual([
      "person:1",
      "equation:1",
      "person:2",
    ]);
  });

  test("directives only for deviations from the base; plain mode drops them", () => {
    const red = { color: { rgbColor: { red: 0.88, green: 0.11, blue: 0.28 } } };
    const tab = tabOf([
      {
        content: [
          "plain ",
          { style: { bold: true }, text: "bold" },
          " ",
          { style: { foregroundColor: red }, text: "red" },
        ],
        kind: "paragraph",
      },
    ]);
    const [block] = project(tab).blocks;
    expect(
      block.spans.map((s) => (s.kind === "text" ? [s.text, s.marks.bold ?? false, s.directive ?? ""] : [])),
    ).toEqual([
      ["plain ", false, ""],
      ["bold", true, ""],
      [" ", false, ""],
      ["red", false, "color-E01C47"],
    ]);
    expect(project(tab).styles).toEqual({ "color-E01C47": { foregroundColor: "#E01C47" } });
    expect(project(tab, "plain").styles).toEqual({});
    expect(project(tab, "plain").blocks[0].styled).toBe(true);
  });

  test("link chrome on a link isn't a directive", () => {
    const tab = tabOf([
      {
        content: [
          {
            style: {
              foregroundColor: { color: { rgbColor: { blue: 0.8, green: 0.33333334, red: 0.06666667 } } },
              link: { url: "https://x.test" },
              underline: true,
            },
            text: "link",
          },
        ],
        kind: "paragraph",
      },
    ]);
    const [span] = project(tab).blocks[0].spans;
    expect(span).toMatchObject({ marks: { link: { kind: "url", url: "https://x.test" } } });
    expect(span).not.toHaveProperty("directive");
  });

  test("a bold named style (heading) isn't flagged: the base for its type is bold", () => {
    const tab = tabOf([
      {
        content: [{ style: { bold: true }, text: "Heading" }],
        headingId: "h.1",
        kind: "paragraph",
        style: { namedStyleType: "HEADING_1" },
      },
      p("body"),
    ]);
    const [heading] = project(tab).blocks;
    expect(heading).toMatchObject({ headingLevel: 1, kind: "heading", styled: false });
    expect(heading.spans[0]).toMatchObject({ marks: {} });
    expect(heading.spans[0]).not.toHaveProperty("directive");
  });

  test("hard-break table projection flattens text without changing source or marks", () => {
    const table: BlockSpec = {
      cells: [
        [[{ content: ["Heading"] }], [{ content: ["H1\u000bH2"] }]],
        [[{ content: ["Label"] }], [{ content: [{ style: { bold: true }, text: "Body\u000bNext" }] }]],
      ],
      kind: "table",
    };
    const tab = tabOf([p("pre"), table, p("post")]);
    const original = structuredClone(tab);
    const projectedTable = project(tab).blocks[1].table;
    expect(projectedTable?.readOnly).toBe(true);
    expect(projectedTable?.rows[0][1]).toMatchObject([{ kind: "text", text: "H1 H2" }]);
    expect(projectedTable?.rows[1][1]).toMatchObject([{ kind: "text", marks: { bold: true }, text: "Body Next" }]);
    expect(tab).toEqual(original);
  });
});
