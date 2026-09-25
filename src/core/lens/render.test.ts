/* Golden-string tests for the markdown renderer. */

import { describe, expect, test } from "bun:test";
import blankTab from "../model/blankTab.json";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import { tabMarkdownExport } from "./export.ts";
import type { Marks, ProjBlock, Projection, ProjSpan, TokenRef } from "./project.ts";
import { emphasisSafe, type LinkRenderContext, markdownRender } from "./render.ts";

const t = (text: string, marks: Marks = {}, directive?: string): ProjSpan => ({ directive, kind: "text", marks, text });
const tok = (token: Omit<TokenRef, "key">): ProjSpan => ({ kind: "token", marks: {}, token: { key: "k", ...token } });
const block = (kind: ProjBlock["kind"], spans: ProjSpan[], extra: Partial<ProjBlock> = {}): ProjBlock => ({
  anchor: "a",
  key: "k",
  kind,
  owned: [],
  sourceSyms: [],
  spans,
  styled: false,
  ...extra,
});
const para = (...spans: ProjSpan[]) => block("paragraph", spans);
const item = (kind: "bullet" | "check" | "number", depth: number, group: number, text: string) =>
  block("listItem", [t(text)], { list: { depth, group, kind, listId: `l${group}` } });
const code = (group: number, text: string) => block("codeLine", [t(text)], { codeGroup: group });
const projection = (blocks: ProjBlock[], styles: Projection["styles"] = {}): Projection => ({
  base: {},
  blocks,
  leadingOwned: [],
  mode: "frontmatter",
  styles,
});
const md = (blocks: ProjBlock[], links?: LinkRenderContext) => markdownRender(projection(blocks), { links }).trimEnd();

const links: LinkRenderContext = {
  headingText: (id) =>
    id === "h.1"
      ? { text: "Goals", unique: true }
      : id === "h.2"
        ? { text: "Plan", unique: false }
        : id === "h.3"
          ? { tabTitle: "Other", text: "Far", unique: true }
          : undefined,
  pendingText: (key) => (key === "n9" ? "New Heading" : undefined),
  tabTitle: (id) => (id === "t.1" ? "Other" : undefined),
};

describe("markdownRender: escaping", () => {
  test("inline specials", () =>
    expect(md([para(t("a*b_c`d[e]f<g>h~i\\j"))])).toBe("a\\*b\\_c\\`d\\[e\\]f\\<g\\>h\\~i\\\\j"));
  test("line-start block syntax", () => expect(md([para(t("# not a heading"))])).toBe("\\# not a heading"));
  test("line-start list-like text", () => {
    expect(md([para(t("- dash"))])).toBe("\\- dash");
    expect(md([para(t("1. one"))])).toBe("1\\. one");
    expect(md([para(t("+ plus"))])).toBe("\\+ plus");
    expect(md([para(t("> quote"))])).toBe("\\> quote");
  });
  test("mid-line specials that are only special at line start stay", () =>
    expect(md([para(t("a # b - c 1. d"))])).toBe("a # b - c 1. d"));
  test("! before [ and every { (so neither an image nor a token can form); ::name[ is safe since [ is escaped", () =>
    expect(md([para(t("![x] {{y ::n[z]"))])).toBe("\\!\\[x\\] \\{\\{y ::n\\[z\\]"));
  test("table cells escape pipes", () =>
    expect(
      md([
        block("table", [], {
          table: { alignments: [undefined], cellKeys: [["c"]], readOnly: false, rows: [[[t("a|b")]]] },
        }),
      ]),
    ).toBe("| a\\|b |\n| --- |"));
  test("leading and trailing whitespace is trimmed", () => expect(md([para(t("  padded  "))])).toBe("padded"));
  test("a line break is a hard break, and the next line still escapes", () =>
    expect(md([para(t("one\u000b# two"))])).toBe("one\\\n\\# two"));
});

describe("markdownRender: emphasis", () => {
  test("a bold run keeps its trailing space outside", () =>
    expect(md([para(t("bold ", { bold: true }), t("next"))])).toBe("**bold** next"));
  test("**(a)**b falls back to plain when the closer can't be right-flanking", () =>
    expect(md([para(t("(a)", { bold: true }), t("b"))])).toBe("(a)b"));
  test("nested bold and italic", () =>
    expect(md([para(t("x", { bold: true }), t("y", { bold: true, italic: true }), t("z", { bold: true }))])).toBe(
      "**x*y*z**",
    ));
  test("strike outside bold", () => expect(md([para(t("s", { bold: true, strike: true }))])).toBe("~~**s**~~"));
  test("a code span with backticks", () => expect(md([para(t("a`b", { code: true }))])).toBe("``a`b``"));
  test("a code span starting with a backtick is padded", () =>
    expect(md([para(t("`x", { code: true }))])).toBe("`` `x ``"));
  test("code content isn't escaped", () => expect(md([para(t("*raw*", { code: true }))])).toBe("`*raw*`"));
  test("emphasisSafe", () => {
    expect(emphasisSafe("x", " ", " ")).toBe(true);
    expect(emphasisSafe(" x", "", "")).toBe(false);
    expect(emphasisSafe("(a)", "", "b")).toBe(false);
  });
});

describe("markdownRender: links, directives, tokens", () => {
  test("a URL with parentheses in angle brackets", () =>
    expect(md([para(t("site", { link: { kind: "url", url: "https://x.test/a_(b)" } }))])).toBe(
      "[site](<https://x.test/a_(b)>)",
    ));
  test("heading links by unique text, else by id; other tabs and pending headings", () => {
    expect(md([para(t("g", { link: { headingId: "h.1", kind: "heading" } }))], links)).toBe("[g](<#Goals>)");
    expect(md([para(t("p", { link: { headingId: "h.2", kind: "heading" } }))], links)).toBe("[p](<#h.2>)");
    expect(md([para(t("f", { link: { headingId: "h.3", kind: "heading", tabId: "t.1" } }))], links)).toBe(
      "[f](<tab:Other#Far>)",
    );
    expect(md([para(t("tab", { link: { kind: "tab", tabId: "t.1" } }))], links)).toBe("[tab](<tab:Other>)");
    expect(md([para(t("n", { link: { key: "n9", kind: "pending", tabId: "t.0" } }))], links)).toBe(
      "[n](<#New Heading>)",
    );
    expect(md([para(t("b", { link: { id: "bm.1", kind: "bookmark" } }))], links)).toBe("[b](<#bookmark=bm.1>)");
  });
  test("a directive wraps its text", () =>
    expect(md([para(t("red", {}, "color-E01C47"))])).toBe("::color-E01C47[red]::"));
  test("token labels are sanitized", () =>
    expect(md([para(t("hi "), tok({ kind: "person", label: "Ada {x} | L.", ordinal: 1 }))])).toBe(
      "hi {{person:1|Ada x L.}}",
    ));
  test("a block token on its own line", () =>
    expect(md([block("token", [], { token: { key: "k", kind: "pagebreak", ordinal: 2 } })])).toBe("{{pagebreak:2}}"));
});

describe("markdownRender: blocks", () => {
  test("headings, paragraphs, blank lines between", () =>
    expect(md([block("heading", [t("Title")], { headingLevel: 2 }), para(t("body"))])).toBe("## Title\n\nbody"));
  test("a list nested under a numbered item indents by the marker's width", () =>
    expect(md([item("number", 0, 1, "one"), item("bullet", 1, 1, "sub"), item("number", 0, 1, "two")])).toBe(
      "1. one\n   - sub\n1. two",
    ));
  test("adjacent separate lists alternate markers", () =>
    expect(md([item("bullet", 0, 1, "a"), item("bullet", 0, 2, "b")])).toBe("- a\n\n* b"));
  test("check items", () => expect(md([item("check", 0, 1, "todo")])).toBe("- [ ] todo"));
  test("a fence longer than any backtick run inside", () =>
    expect(md([code(1, "a ``` b"), code(1, "c")])).toBe("````\na ``` b\nc\n````"));
  test("a GFM table with alignment", () =>
    expect(
      md([
        block("table", [], {
          table: {
            alignments: [undefined, "CENTER", "END"],
            cellKeys: [],
            readOnly: false,
            rows: [
              [[t("h1")], [t("h2")], [t("h3")]],
              [[t("a")], [], [t("c")]],
            ],
          },
        }),
      ]),
    ).toBe("| h1 | h2 | h3 |\n| --- | :-: | --: |\n| a |   | c |"));
  test("deterministic frontmatter with sorted keys and styles", () =>
    expect(
      markdownRender(projection([para(t("x", {}, "size-9"))], { "size-9": { fontSize: 9 } }), {
        frontmatter: { doc: "d1", revision: "r1", tab: "t.0", title: "Tab" },
      }),
    ).toBe(
      '---\ndoc: "d1"\nrevision: "r1"\nstyles:\n  "size-9":\n    fontSize: 9\ntab: "t.0"\ntitle: "Tab"\n---\n\n::size-9[x]::\n',
    ));
});

describe("tabMarkdownExport", () => {
  test("a read-only table is reported; plain mode notes dropped styles", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: [{ style: { underline: true }, text: "u" }], kind: "paragraph" },
            { cells: [[[{ content: ["x"] }, { content: ["x2"] }]]], kind: "table" },
            { content: ["z"], kind: "paragraph" },
          ],
          title: "Tab",
        },
      ],
    }) as unknown as { tabs: Array<{ documentTab: Record<string, unknown> }> };
    json.tabs[0].documentTab.namedStyles = structuredClone(blankTab.namedStyles);
    const doc = docModelParse(json as never, { docId: "d", keys: new KeyAllocator() });
    const tab = doc.tabs[0];
    const range = { containerRef: { kind: "body" as const }, from: 0, to: tab.blocks.length };
    const plain = tabMarkdownExport(doc, tab, range, { skipFrontmatter: true });
    expect(plain.readOnly).toHaveLength(1);
    expect(plain.notes).toEqual([
      "styles markdown can't show were left out (plain mode)",
      "1 table(s) are read-only: markdown can't express their layout",
    ]);
    expect(plain.markdown).toBe("u\n\n| x x2 |\n| --- |\n\nz\n");
    expect(tabMarkdownExport(doc, tab, range).markdown).toContain("::underline[u]::");
  });
});
