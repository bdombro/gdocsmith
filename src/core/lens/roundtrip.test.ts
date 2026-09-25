/* Seeded round-trip property: parsing rendered markdown keeps every block's visible text, never invents styling, and re-renders identically (G3 M14). */

import { describe, expect, test } from "bun:test";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild, rngCreate } from "../model/testDocs.ts";
import { markdownParse, type ParsedBlock, type ParsedSpan } from "./parse.ts";
import type { DirectiveAttrs, Marks, ProjBlock, Projection, ProjSpan } from "./project.ts";
import { markdownRender } from "./render.ts";

const SEEDS = 2000;
const ALPHABET = [
  "a",
  "b",
  "z",
  " ",
  "  ",
  "*",
  "_",
  "~",
  "`",
  "[",
  "]",
  "<",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ":",
  "&",
  "!",
  "\\",
  "\t",
  "1.",
  "😀",
  "é",
  "(",
  ")",
];
const STYLES: Record<string, DirectiveAttrs> = {
  "color-E11D48": { foregroundColor: "#E11D48" },
  "size-9": { fontSize: 9 },
};
const doc = docModelParse(docJsonBuild({ tabs: [{ blocks: [{ content: ["x"], kind: "paragraph" }], title: "T" }] }), {
  docId: "d",
  keys: new KeyAllocator(),
});

/** A random projection with adversarial text. */
function projectionRandom(rng: () => number): Projection {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const text = (breaks: boolean) => {
    let out = "";
    for (let i = 1 + Math.floor(rng() * 6); i > 0; i--) out += breaks && rng() < 0.05 ? "\u000b" : pick(ALPHABET);
    return /\S/.test(out.replace(/\v/g, "")) ? out : `${out}w`;
  };
  const spans = (breaks: boolean): ProjSpan[] =>
    Array.from({ length: 1 + Math.floor(rng() * 4) }, () => {
      const marks: Marks = {};
      if (rng() < 0.25) marks.bold = true;
      if (rng() < 0.2) marks.italic = true;
      if (rng() < 0.1) marks.strike = true;
      if (rng() < 0.1) marks.code = true;
      if (rng() < 0.1)
        marks.link = { kind: "url", url: pick(["https://x.test/a", "https://x.test/(b)", "mailto:a@b.test"]) };
      return {
        directive: rng() < 0.1 ? pick(Object.keys(STYLES)) : undefined,
        kind: "text",
        marks,
        text: text(breaks),
      } as ProjSpan;
    });
  const blocks: ProjBlock[] = [];
  let group = 0;
  let codeGroup = 0;
  for (let i = 1 + Math.floor(rng() * 6); i > 0; i--) {
    const roll = rng();
    const base = { anchor: "a", key: `k${blocks.length}`, owned: [], sourceSyms: [], styled: false };
    if (roll < 0.35) blocks.push({ ...base, kind: "paragraph", spans: spans(true) });
    else if (roll < 0.5)
      blocks.push({ ...base, headingLevel: 1 + Math.floor(rng() * 6), kind: "heading", spans: spans(false) });
    else if (roll < 0.75) {
      group++;
      const kind = pick(["bullet", "number", "check"] as const);
      let depth = 0;
      for (let n = 1 + Math.floor(rng() * 3); n > 0; n--) {
        blocks.push({
          ...base,
          key: `k${blocks.length}`,
          kind: "listItem",
          list: { depth, group, kind, listId: `l${group}` },
          spans: spans(false),
        });
        depth = Math.max(0, Math.min(depth + (rng() < 0.4 ? 1 : rng() < 0.3 ? -1 : 0), 2));
      }
    } else if (roll < 0.87) {
      codeGroup++;
      for (let n = 1 + Math.floor(rng() * 3); n > 0; n--) {
        blocks.push({
          ...base,
          codeGroup,
          key: `k${blocks.length}`,
          kind: "codeLine",
          spans: [{ kind: "text", marks: {}, text: text(false).replace(/\s+$/, "") }],
        });
      }
    } else {
      blocks.push({
        ...base,
        kind: "table",
        spans: [],
        table: {
          alignments: [undefined, pick([undefined, "CENTER", "END"] as const)],
          cellKeys: [],
          readOnly: false,
          rows: [
            [spans(false), spans(false)],
            [spans(false), spans(false)],
          ],
        },
      });
    }
  }
  return { base: {}, blocks, leadingOwned: [], mode: "frontmatter", styles: STYLES };
}

/** Visible text of spans, normalized the way markdown does (edges trimmed, spaces around hard breaks dropped, tabs as spaces at edges). */
function visible(spans: ReadonlyArray<ParsedSpan | ProjSpan>): string {
  return spans
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("")
    .replace(/[ \t]*\v[ \t]*/g, "\u000b")
    .trim();
}

/** A parsed block as a projection block (for re-rendering). */
function asProj(b: ParsedBlock, i: number): ProjBlock {
  const spans = (xs: ParsedSpan[]) => xs as unknown as ProjSpan[];
  return {
    anchor: "a",
    codeGroup: b.codeGroup,
    headingLevel: b.headingLevel,
    key: `k${i}`,
    kind: b.kind,
    list: b.list ? { ...b.list, listId: `g${b.list.group}` } : undefined,
    owned: [],
    sourceSyms: [],
    spans: spans(b.spans),
    styled: false,
    table: b.table
      ? { alignments: b.table.alignments, cellKeys: [], readOnly: false, rows: b.table.rows.map((r) => r.map(spans)) }
      : undefined,
  };
}

/** Per-character marks, as comparable strings. */
function charMarks(spans: ReadonlyArray<ParsedSpan | ProjSpan>): string[] {
  return spans.flatMap((s) => {
    if (s.kind !== "text") return [];
    const m = s.marks;
    const tag = [
      m.bold && "b",
      m.italic && "i",
      m.strike && "s",
      m.code && "c",
      m.link && `l${JSON.stringify(m.link)}`,
      s.directive && `d${s.directive}`,
    ]
      .filter(Boolean)
      .join(",");
    return Array.from(s.text, (ch) => (/\s/.test(ch) ? "" : tag));
  });
}

describe("lens round trip", () => {
  test(`${SEEDS} seeded projections: text kept, no invented styling, re-render identical`, () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const projection = projectionRandom(rngCreate(seed));
      const opts = { frontmatter: { doc: "d", tab: "t.0", title: "T" } };
      const md = markdownRender(projection, opts);
      let parsed: ParsedBlock[];
      try {
        parsed = markdownParse(md, { doc, tab: doc.tabs[0] }).blocks;
      } catch (err) {
        failures.push(`seed ${seed}: parse threw ${(err as Error).message}\n${md}`);
        continue;
      }
      const original = projection.blocks;
      if (parsed.length !== original.length) {
        failures.push(`seed ${seed}: ${original.length} blocks became ${parsed.length}\n${md}`);
        continue;
      }
      for (let i = 0; i < original.length; i++) {
        const o = original[i];
        const p = parsed[i];
        const oText = o.table ? o.table.rows.map((r) => r.map(visible).join("|")).join("/") : visible(o.spans);
        const pText = p.table ? p.table.rows.map((r) => r.map(visible).join("|")).join("/") : visible(p.spans);
        const kindOk =
          p.kind === o.kind &&
          p.headingLevel === o.headingLevel &&
          p.list?.depth === o.list?.depth &&
          p.list?.kind === o.list?.kind;
        if (!kindOk || oText !== pText)
          failures.push(
            `seed ${seed} block ${i}: ${o.kind} ${JSON.stringify(oText)} → ${p.kind} ${JSON.stringify(pText)}\n${md}`,
          );
        else if (!o.table) {
          const oMarks = charMarks(o.spans.map((s) => s)).filter((_, _k) => true);
          const pMarks = charMarks(p.spans);
          const invented = pMarks.some((tag, k) =>
            tag.split(",").some((t) => t && !(oMarks[k] ?? "").split(",").includes(t)),
          );
          if (invented && oMarks.length === pMarks.length)
            failures.push(`seed ${seed} block ${i}: invented styling\n${md}`);
        }
      }
      const again = markdownRender({ ...projection, blocks: parsed.map(asProj) }, opts);
      if (again !== md) failures.push(`seed ${seed}: re-render differs\n--- first\n${md}--- second\n${again}`);
    }
    if (failures.length) console.log(`${failures.length} failures:\n${failures.slice(0, 6).join("\n\n")}`);
    expect(failures).toEqual([]);
  });
});
