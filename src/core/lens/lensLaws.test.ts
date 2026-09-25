/* The lens laws on synthetic documents: GetPut (unchanged markdown changes nothing), PutGet (what you write is what you read), and the plan self-check after every write (G3 M15). */

import { describe, expect, test } from "bun:test";
import blankTab from "../model/blankTab.json";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { listPresetTable } from "../model/lists.ts";
import { type BlockSpec, docJsonBuild, rngCreate } from "../model/testDocs.ts";
import type { DocModel } from "../model/types.ts";
import { docPlanSelfCheck, docReconcile } from "../reconcile/reconcile.ts";
import { parsedCanonical } from "./canonical.ts";
import { tabMarkdownExport } from "./export.ts";
import { markdownParse } from "./parse.ts";
import { markdownPut } from "./put.ts";

const mono = { weightedFontFamily: { fontFamily: "Courier New", weight: 400 } };
const red = { foregroundColor: { color: { rgbColor: { red: 0.88, green: 0.11, blue: 0.28 } } } };
const item = (text: string, level = 0, listId = "kix.p"): BlockSpec => ({
  bullet: { listId, nestingLevel: level },
  content: [text],
  kind: "paragraph",
  style: {
    indentFirstLine: { magnitude: 36 * (level + 1) - 18, unit: "PT" },
    indentStart: { magnitude: 36 * (level + 1), unit: "PT" },
  },
});
const h = (text: string, level: number, id: string): BlockSpec => ({
  content: [text],
  headingId: id,
  kind: "paragraph",
  style: { namedStyleType: `HEADING_${level}` },
});
const p = (
  ...content: BlockSpec extends infer _
    ? Array<string | { style?: object; text: string } | { type: "equation" | "person" | "image" }>
    : never
): BlockSpec => ({ content: content as never, kind: "paragraph" });
const empty: BlockSpec = { content: [], kind: "paragraph" };

/** Fifteen documents covering every projected construct. */
const DOCS: BlockSpec[][] = [
  [p("hello")],
  [h("Title", 1, "h.1"), p("body text"), empty, p("after an empty paragraph")],
  [p("a ", { style: { bold: true }, text: "bold" }, " and ", { style: { italic: true }, text: "italic" }, " words")],
  [item("one"), item("two"), item("nested", 1), item("three"), p("after")],
  [
    p("intro"),
    { content: [{ style: mono, text: "let a = *1*;" }], kind: "paragraph" },
    { content: [{ style: mono, text: "b" }], kind: "paragraph" },
    p("outro"),
  ],
  [
    p("intro"),
    {
      cells: [
        [[{ content: ["h1"] }], [{ content: ["h2"] }]],
        [[{ content: ["a|b"] }], [{ content: [] }]],
      ],
      kind: "table",
    },
    p("z"),
  ],
  [p("intro"), { cells: [[[{ content: ["x"] }, { content: ["x2"] }], [{ content: ["y"] }]]], kind: "table" }, p("z")],
  [p("math ", { type: "equation" }, " here"), p("chip ", { type: "person" })],
  [p("before"), { content: [{ type: "pageBreak" } as never], kind: "paragraph" }, p("after")],
  [p("colored ", { style: red, text: "red" }, " text")],
  [p("specials * _ ~ ` [ ] < > # + - = | { } : & ! \\")],
  [p("# not a heading"), p("1. not a list"), p("- nor this")],
  [p("line one\u000bline two\u000bline three"), p("tab\tseparated")],
  [p("emoji 😀 and é"), h("Sub", 2, "h.2"), item("x", 0, "kix.q"), item("y", 0, "kix.q")],
  [h("A", 1, "h.a"), h("B", 2, "h.b"), p("   "), p("text"), empty, empty],
];

const lists = {
  "kix.p": { listProperties: { nestingLevels: listPresetTable().BULLET_DISC_CIRCLE_SQUARE } },
  "kix.q": { listProperties: { nestingLevels: listPresetTable().NUMBERED_DECIMAL_ALPHA_ROMAN } },
};

/** A parsed document and its JSON. */
function docOf(blocks: BlockSpec[]) {
  const json = docJsonBuild({ tabs: [{ blocks, lists, title: "Main" }] }) as unknown as {
    tabs: Array<{ documentTab: Record<string, unknown> }>;
  };
  json.tabs[0].documentTab.namedStyles = structuredClone(blankTab.namedStyles);
  const keys = new KeyAllocator();
  return { json: json as never, keys, original: docModelParse(json as never, { docId: "d", keys }) };
}

/** Exports, writes, and plans on a fresh copy. */
function session(blocks: BlockSpec[]) {
  const { json, keys, original } = docOf(blocks);
  const final: DocModel = structuredClone(original);
  const tab = final.tabs[0];
  const target = { ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab };
  const range = () => ({ containerRef: { kind: "body" as const }, from: 0, to: tab.blocks.length });
  return {
    exportMd: (plain: boolean) => tabMarkdownExport(final, tab, range(), { skipFrontmatter: plain }).markdown,
    final,
    original,
    selfCheck: () => {
      const input = { final, original, originalJson: json };
      return docPlanSelfCheck(docReconcile(input), input).diffs;
    },
    write: (md: string) => markdownPut(target, final, { kind: "replace", range: { kind: "tab" } }, md),
  };
}

/** A random edit to markdown lines outside code fences and tables. */
function markdownEdit(md: string, rng: () => number): string {
  const lines = md.split("\n");
  let fm = 0;
  if (lines[0] === "---") fm = lines.indexOf("---", 1) + 1;
  let inCode = false;
  const editable: number[] = [];
  lines.forEach((line, i) => {
    if (i < fm) return;
    if (line.startsWith("```")) inCode = !inCode;
    else if (!inCode && line.trim() && !line.startsWith("|") && !line.startsWith("{{")) editable.push(i);
  });
  if (!editable.length) return md;
  const i = editable[Math.floor(rng() * editable.length)];
  const words = ["new", "edited", "zeta", "more words"];
  const word = words[Math.floor(rng() * words.length)];
  switch (Math.floor(rng() * 6)) {
    case 0:
      lines[i] = `${lines[i]} ${word}`;
      break;
    case 1:
      lines.splice(i, 1);
      break;
    case 2:
      lines.splice(i + 1, 0, "", `a ${word} paragraph`);
      break;
    case 3:
      lines[i] = lines[i].replace(/^#+ /, (m) => (m.length > 3 ? "# " : `#${m}`));
      break;
    case 4:
      lines[i] = lines[i].replace(/(\w+)/, "**$1**");
      break;
    default:
      lines[i] = lines[i].replace(/^(\s*)- /, "$11. ");
  }
  return lines.join("\n");
}

describe("lens laws", () => {
  test("GetPut: writing back unchanged markdown changes nothing, in both modes", () => {
    for (const [i, blocks] of DOCS.entries()) {
      for (const plain of [false, true]) {
        const s = session(blocks);
        const before = JSON.stringify(s.final);
        const report = s.write(s.exportMd(plain));
        expect([i, plain, report.changed]).toEqual([i, plain, false]);
        expect(JSON.stringify(s.final)).toBe(before);
      }
    }
  });

  test("PutGet over 500 seeded edits: what you write is what you read back, and every plan self-checks", () => {
    const failures: string[] = [];
    let refused = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const rng = rngCreate(seed);
      const s = session(DOCS[seed % DOCS.length]);
      const plain = rng() < 0.3;
      const md = markdownEdit(s.exportMd(plain), rng);
      try {
        s.write(md);
      } catch (err) {
        if (err instanceof CoreError && err.code !== "internal") {
          refused++;
          continue;
        }
        failures.push(`seed ${seed}: put threw ${(err as Error).message}\n${md}`);
        continue;
      }
      const ctx = { doc: s.final, tab: s.final.tabs[0] };
      const written = markdownParse(md, ctx);
      const readBack = markdownParse(s.exportMd(plain), ctx);
      const a = JSON.stringify(parsedCanonical(written.blocks, written.frontmatter?.styles));
      const b = JSON.stringify(parsedCanonical(readBack.blocks, readBack.frontmatter?.styles));
      if (a !== b) failures.push(`seed ${seed}: read back differs\n--- written\n${md}\n--- read\n${s.exportMd(plain)}`);
      const diffs = s.selfCheck();
      if (diffs.length) failures.push(`seed ${seed}: self-check ${diffs.slice(0, 3).join("; ")}\n${md}`);
    }
    if (failures.length)
      console.log(`${failures.length} failures (${refused} refused):\n${failures.slice(0, 5).join("\n\n")}`);
    expect(failures).toEqual([]);
  });
});
