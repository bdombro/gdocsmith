/* Tests for the lens markdown parser: every construct and every refusal. */

import { describe, expect, test } from "bun:test";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import { listIndentationNormalize, markdownParse, type ParsedBlock } from "./parse.ts";

const doc = docModelParse(
  docJsonBuild({
    tabs: [
      {
        blocks: [
          { content: ["Goals"], headingId: "h.1", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
          { content: ["x"], kind: "paragraph" },
        ],
        tabId: "t.0",
        title: "Main",
      },
      {
        blocks: [{ content: ["Far"], headingId: "h.9", kind: "paragraph", style: { namedStyleType: "HEADING_2" } }],
        tabId: "t.1",
        title: "Other",
      },
    ],
  }),
  { docId: "doc1", keys: new KeyAllocator() },
);
const ctx = { doc, tab: doc.tabs[0] };
const parse = (md: string) => markdownParse(md, ctx);
const one = (md: string): ParsedBlock => parse(md).blocks[0];
const code = (md: string) => {
  try {
    parse(md);
    return "ok";
  } catch (err) {
    return (err as { code: string }).code;
  }
};

describe("markdownParse: blocks", () => {
  test("headings and paragraphs; soft breaks are spaces, hard breaks are line breaks", () => {
    const { blocks } = parse("## Title\n\none\ntwo\\\nthree");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"]);
    expect(blocks[0].headingLevel).toBe(2);
    expect(blocks[1].spans.map((s) => (s.kind === "text" ? s.text : "")).join("")).toBe("one two\u000bthree");
  });

  test("lists: kinds, depth, groups; badly indented children still nest", () => {
    const { blocks } = parse("- a\n - b\n\n1. c\n\n- [ ] d");
    expect(blocks.map((b) => [b.list?.kind, b.list?.depth, b.list?.group])).toEqual([
      ["bullet", 0, 1],
      ["bullet", 1, 1],
      ["number", 0, 2],
      ["check", 0, 3],
    ]);
    expect(listIndentationNormalize("1. a\n  - b")).toBe("1. a\n   - b");
  });

  test("nested items retain the kind their markdown marker wrote", () => {
    const { blocks } = parse("1. step\n   - detail");
    expect(blocks[1].list).toMatchObject({ depth: 1, kind: "number", written: "bullet" });
  });

  test("code fences become code lines (fence info dropped)", () => {
    const { blocks } = parse("```ts\nlet a = *x*;\n\nb\n```");
    expect(blocks.map((b) => [b.kind, b.codeGroup, b.spans[0].kind === "text" ? b.spans[0].text : ""])).toEqual([
      ["codeLine", 1, "let a = *x*;"],
      ["codeLine", 1, ""],
      ["codeLine", 1, "b"],
    ]);
  });

  test("GFM tables with alignment and escaped pipes", () => {
    const table = one("| h | i |\n| :-: | --: |\n| a\\|b | c |").table;
    expect(table?.alignments).toEqual(["CENTER", "END"]);
    expect(table?.rows[1][0]).toMatchObject([{ text: "a|b" }]);
  });

  test("block tokens stand alone; inline ones can't be block tokens", () => {
    expect(one("{{pagebreak}}")).toMatchObject({ kind: "token", token: { pageBreak: true } });
    expect(one("{{sectionbreak:next-page}}").token).toEqual({ sectionBreak: "NEXT_PAGE" });
    expect(one("{{toc:1}}").token).toEqual({ kind: "toc", label: undefined, ordinal: 1 });
    expect(code("text {{pagebreak}}")).toBe("unsupportedSyntax");
  });
});

describe("markdownParse: inline", () => {
  test("emphasis, strike, code, escapes, entities kept", () => {
    const spans = one("**b** *i* ~~s~~ `c*` \\*lit &amp;").spans;
    expect(
      spans
        .filter((s) => s.kind === "text" && s.text.trim())
        .map((s) => (s.kind === "text" ? [s.text, Object.keys(s.marks).sort().join()] : [])),
    ).toEqual([
      ["b", "bold"],
      ["i", "italic"],
      ["s", "strike"],
      ["c*", "code"],
      [" *lit &amp;", ""],
    ]);
  });

  test("tokens: existing refs with labels, and creation forms", () => {
    const tokens = one(
      "{{person:2|Ada}} {{person:a@b.test}} {{date:2026-01-15}} {{richlink:https://x.test}} ![alt](https://x.test/i.png)",
    ).spans.filter((s) => s.kind === "token");
    expect(tokens.map((s) => (s.kind === "token" ? s.token : undefined))).toEqual([
      { kind: "person", label: "Ada", ordinal: 2 },
      { create: { email: "a@b.test", type: "person" } },
      { create: { timestamp: "2026-01-15", type: "date" } },
      { create: { type: "richLink", uri: "https://x.test" } },
      { create: { alt: "alt", type: "image", uri: "https://x.test/i.png" } },
    ]);
  });

  test("links: heading by text or id, tabs, other-tab headings, bookmarks, same-doc URLs, URLs, same-markdown headings", () => {
    const link = (href: string, extra = "") => {
      const [p] = parse(`[x](<${href}>)${extra}`).blocks;
      const span = p.spans[0];
      return span.kind === "text" ? span.marks.link : undefined;
    };
    expect(link("#goals")).toEqual({ headingId: "h.1", kind: "heading", tabId: undefined });
    expect(link("#h.1")).toEqual({ headingId: "h.1", kind: "heading", tabId: undefined });
    expect(link("tab:Other")).toEqual({ kind: "tab", tabId: "t.1" });
    expect(link("tab:Other#Far")).toEqual({ headingId: "h.9", kind: "heading", tabId: "t.1" });
    expect(link("#bookmark=b1")).toEqual({ id: "b1", kind: "bookmark" });
    expect(link("https://docs.google.com/document/d/doc1/edit?tab=t.1#heading=h.9")).toEqual({
      headingId: "h.9",
      kind: "heading",
      tabId: "t.1",
    });
    expect(link("https://example.com/a")).toEqual({ kind: "url", url: "https://example.com/a" });
    expect(link("#New Section", "\n\n# New Section")).toEqual({ kind: "pendingText", text: "New Section" });
    expect(code("[x](<#Nowhere>)")).toBe("linkTargetNotFound");
    expect(code("[x](<tab:Nope>)")).toBe("linkTargetNotFound");
  });

  test("directives need frontmatter styles", () => {
    const md = '---\nstyles:\n  red:\n    foregroundColor: "#e11d48"\n---\n\n::red[**hot**]::';
    const parsed = parse(md);
    expect(parsed.frontmatter?.styles).toEqual({ red: { foregroundColor: "#E11D48" } });
    expect(parsed.blocks[0].spans[0]).toMatchObject({ directive: "red", marks: { bold: true }, text: "hot" });
    expect(code("::red[x]::")).toBe("unsupportedSyntax");
    expect(code("---\nstyles: {}\n---\n::blue[x]::")).toBe("unsupportedSyntax");
  });
});

describe("markdownParse: frontmatter and refusals", () => {
  test("frontmatter keys", () => {
    expect(parse('---\ndoc: "d"\nrevision: "r"\ntab: "t.0"\ntitle: "Main"\n---\nx').frontmatter).toEqual({
      doc: "d",
      revision: "r",
      tab: "t.0",
      title: "Main",
    });
    expect(code("---\nbogus: 1\n---\nx")).toBe("unsupportedSyntax");
    expect(code('---\nstyles:\n  x:\n    color: "#000000"\n---\nx')).toBe("unsupportedSyntax");
  });

  test("everything the lens can't represent is refused", () => {
    for (const md of [
      "> quote",
      "<div>x</div>",
      "a <b>c</b>",
      "---",
      "- a\n\n  second paragraph",
      "- a\n\n- b",
      "- [x] done",
      "- ```\n  code\n  ```",
      "![x](http://x.test/i.png)",
      "{{widget:1}}",
      "{{equation:x}}",
    ]) {
      expect([md, code(md)]).toEqual([md, "unsupportedSyntax"]);
    }
  });
});
