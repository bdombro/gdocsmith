/* Parses lens markdown (frontmatter, CommonMark + GFM, position tokens, style directives) into lens blocks, rejecting what the lens can't represent (G3 D28–D32, M14). */

import type { Token, Tokens } from "marked";
import { parse as yamlParse } from "yaml";
import { headingStyleIs } from "../model/effectiveStyle.ts";
import { CoreError } from "../model/errors.ts";
import type { AtomCreate, DocModel, ParagraphBlock, TabModel } from "../model/types.ts";
import { paragraphText } from "./anchors.ts";
import { lensMarked, TAB_ENTITY } from "./markedLens.ts";
import type { DirectiveAttrs, LinkTarget, Marks, ProjBlockKind, TokenKind } from "./project.ts";

/** A reference to an existing atom or block by per-tab ordinal. */
export interface ParsedTokenRef {
  /** Kind. */ kind: TokenKind;
  /** Informational label (must match the current one when present). */ label?: string;
  /** 1-based position among the tab's tokens of this kind. */ ordinal: number;
}

/** Something a token creates. */
export type ParsedTokenCreate =
  | { create: AtomCreate }
  | { pageBreak: true }
  | { sectionBreak: "CONTINUOUS" | "NEXT_PAGE" };

/** A parsed token. */
export type ParsedToken = ParsedTokenCreate | ParsedTokenRef;

/** A parsed link: a lens target, or a heading that exists only in this markdown (resolved after it's created). */
export type ParsedLink = LinkTarget | { kind: "pendingText"; text: string };

/** Marks on a parsed span. */
export type ParsedMarks = Omit<Marks, "link"> & { link?: ParsedLink };

/** One inline piece of a parsed block. */
export type ParsedSpan =
  | { directive?: string; kind: "text"; marks: ParsedMarks; text: string }
  | { kind: "token"; marks: ParsedMarks; token: ParsedToken };

/** One parsed block (mirrors `ProjBlock`). */
export interface ParsedBlock {
  /** Code group. */ codeGroup?: number;
  /** Heading level (1–6). */ headingLevel?: number;
  /** Kind. */ kind: ProjBlockKind;
  /** List membership; `written` is the kind the markdown used when it differs (a nested item takes its list's kind). */ list?: {
    depth: number;
    group: number;
    kind: "bullet" | "check" | "number";
    written?: "bullet" | "check" | "number";
  };
  /** Inline content. */ spans: ParsedSpan[];
  /** Table content. */ table?: { alignments: Array<"CENTER" | "END" | undefined>; rows: ParsedSpan[][][] };
  /** Block token. */ token?: ParsedToken;
}

/** Frontmatter (D32). */
export interface Frontmatter {
  /** Document id the markdown was read from. */ doc?: string;
  /** Revision it was read at. */ revision?: string;
  /** Style directives. */ styles?: Record<string, DirectiveAttrs>;
  /** Tab id. */ tab?: string;
  /** Tab title. */ title?: string;
}

/** Parsed markdown. */
export interface ParsedMarkdown {
  /** Blocks, in order. */ blocks: ParsedBlock[];
  /** Frontmatter, when present. */ frontmatter?: Frontmatter;
}

/** What a parse resolves links and directives against. */
export interface ParseContext {
  /** Document (for same-document URLs and tab titles). */ doc: DocModel;
  /** Styles from elsewhere (e.g. the export the markdown came from) when it has no frontmatter. */ styles?: Record<
    string,
    DirectiveAttrs
  >;
  /** Tab the markdown targets. */ tab: TabModel;
}

/** Every token kind. */
const TOKEN_KINDS: ReadonlySet<string> = new Set([
  "autotext",
  "chart",
  "columnbreak",
  "date",
  "drawing",
  "equation",
  "footnote",
  "hr",
  "image",
  "pagebreak",
  "person",
  "richlink",
  "sectionbreak",
  "toc",
]);

/** Token kinds that stand alone as a block. */
const BLOCK_TOKEN_KINDS: ReadonlySet<string> = new Set(["pagebreak", "sectionbreak", "toc"]);

/** Frontmatter keys (D32). */
const FRONTMATTER_KEYS: ReadonlySet<string> = new Set(["doc", "revision", "styles", "tab", "title"]);

/** Directive attributes a `styles:` entry may set, with their value types (D30). */
const STYLE_ATTRS: Record<string, "boolean" | "color" | "number" | "string"> = {
  backgroundColor: "color",
  baselineOffset: "string",
  bold: "boolean",
  fontFamily: "string",
  fontSize: "number",
  fontWeight: "number",
  foregroundColor: "color",
  italic: "boolean",
  smallCaps: "boolean",
  strikethrough: "boolean",
  underline: "boolean",
};

/** A Docs heading id (`h.` + base-36). */
const HEADING_ID = /^h\.[0-9a-z]+$/;

/** A directive name (D30). */
const DIRECTIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9_+.-]*$/;

/** Parses lens markdown. */
export function markdownParse(
  /** Markdown source. */
  md: string,
  /** Resolution context. */
  ctx: ParseContext,
): ParsedMarkdown {
  const { body, frontmatter } = frontmatterSplit(md);
  const styles = frontmatter?.styles ?? ctx.styles;
  const tokens = lensMarked(frontmatter !== undefined || ctx.styles !== undefined).lexer(
    listIndentationNormalize(body),
  );
  const state: WalkState = { blocks: [], codeGroup: 0, ctx, listGroup: 0, pendingTexts: [], styles };
  for (const token of tokens) blockWalk(token, state);
  const headingTexts = new Set(
    state.blocks.filter((b) => b.kind === "heading").map((b) => titleNormalize(spansText(b.spans))),
  );
  for (const pending of state.pendingTexts) {
    if (!headingTexts.has(titleNormalize(pending.text))) {
      throw new CoreError("linkTargetNotFound", `no heading "${pending.text}" in this tab or in the markdown`);
    }
  }
  return { blocks: state.blocks, frontmatter };
}

/**
 * Re-indents list items so each nested list sits at least as deep as CommonMark needs under its
 * parent's marker (ported from v1 `dom/markdownParser.ts`), leaving code blocks untouched.
 */
export function listIndentationNormalize(
  /** Markdown source. */
  md: string,
): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let inCode = false;
  let stack: Array<{ indent: number; minChildIndent: number; shift: number }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCode = !inCode;
      result.push(line);
      stack = [];
      continue;
    }
    if (inCode || trimmed === "") {
      result.push(line);
      continue;
    }
    const match = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/.exec(line);
    if (!match) {
      const leading = (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
      if (stack.length && leading > stack[0].indent) {
        result.push(" ".repeat(stack[stack.length - 1].shift) + line);
        continue;
      }
      stack = [];
      result.push(line);
      continue;
    }
    const [, indentStr, marker, space, text] = match;
    const rawIndent = indentStr.replace(/\t/g, "    ").length;
    const markerLen = marker.length + space.length;
    while (stack.length && stack[stack.length - 1].indent >= rawIndent) stack.pop();
    let shift = 0;
    if (stack.length) {
      const parent = stack[stack.length - 1];
      shift = parent.shift;
      const effective = rawIndent + shift;
      if (effective < parent.minChildIndent) shift += parent.minChildIndent - effective;
    }
    const indent = rawIndent + shift;
    stack.push({ indent: rawIndent, minChildIndent: indent + Math.max(markerLen, /^\d/.test(marker) ? 3 : 2), shift });
    result.push(" ".repeat(indent) + marker + space + text);
  }
  return result.join("\n");
}

/** State of one parse. */
interface WalkState {
  /** Blocks so far. */ blocks: ParsedBlock[];
  /** Last code group number. */ codeGroup: number;
  /** Context. */ ctx: ParseContext;
  /** Last list group number. */ listGroup: number;
  /** Links to headings that must appear in this markdown. */ pendingTexts: Array<{ text: string }>;
  /** Directive definitions in scope. */ styles?: Record<string, DirectiveAttrs>;
}

/** Splits off and validates frontmatter. */
function frontmatterSplit(md: string): { body: string; frontmatter?: Frontmatter } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  if (!match) return { body: md };
  let raw: unknown;
  try {
    raw = yamlParse(match[1]) ?? {};
  } catch (err) {
    throw new CoreError("unsupportedSyntax", `frontmatter isn't valid YAML: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CoreError("unsupportedSyntax", "frontmatter must be a YAML mapping");
  const fm = raw as Record<string, unknown>;
  for (const key of Object.keys(fm)) {
    if (!FRONTMATTER_KEYS.has(key))
      throw new CoreError(
        "unsupportedSyntax",
        `unknown frontmatter key "${key}" (allowed: doc, revision, styles, tab, title)`,
      );
  }
  for (const key of ["doc", "revision", "tab", "title"]) {
    if (fm[key] !== undefined && typeof fm[key] !== "string")
      throw new CoreError("unsupportedSyntax", `frontmatter "${key}" must be a string`);
  }
  const out: Frontmatter = {
    doc: fm.doc as string | undefined,
    revision: fm.revision as string | undefined,
    tab: fm.tab as string | undefined,
    title: fm.title as string | undefined,
  };
  if (fm.styles !== undefined) out.styles = stylesValidate(fm.styles);
  return { body: md.slice(match[0].length), frontmatter: out };
}

/** Validates the frontmatter `styles:` map. */
function stylesValidate(raw: unknown): Record<string, DirectiveAttrs> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CoreError("unsupportedSyntax", "frontmatter styles must be a mapping of name → attributes");
  const out: Record<string, DirectiveAttrs> = {};
  for (const [name, attrs] of Object.entries(raw)) {
    if (!DIRECTIVE_NAME.test(name))
      throw new CoreError("unsupportedSyntax", `style name "${name}" must match ${DIRECTIVE_NAME}`);
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs))
      throw new CoreError("unsupportedSyntax", `style "${name}" must be a mapping of attributes`);
    const entry: DirectiveAttrs = {};
    for (const [attr, value] of Object.entries(attrs)) {
      const type = STYLE_ATTRS[attr];
      if (!type)
        throw new CoreError(
          "unsupportedSyntax",
          `style "${name}" has unknown attribute "${attr}" (allowed: ${Object.keys(STYLE_ATTRS).join(", ")})`,
        );
      const ok =
        type === "color"
          ? typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)
          : type === "boolean"
            ? typeof value === "boolean"
            : type === "number"
              ? typeof value === "number" && value > 0
              : typeof value === "string" && value.length > 0;
      if (!ok)
        throw new CoreError(
          "unsupportedSyntax",
          `style "${name}" attribute "${attr}" must be ${type === "color" ? "#RRGGBB" : `a ${type}`}`,
        );
      entry[attr] = type === "color" ? String(value).toUpperCase() : (value as boolean | number | string);
    }
    out[name] = entry;
  }
  return out;
}

/** Turns one top-level marked token into blocks. */
function blockWalk(token: Token, state: WalkState): void {
  switch (token.type) {
    case "space":
      return;
    case "heading": {
      const t = token as Tokens.Heading;
      state.blocks.push({ headingLevel: t.depth, kind: "heading", spans: inlineWalk(t.tokens, state, {}) });
      return;
    }
    case "paragraph": {
      const spans = inlineWalk((token as Tokens.Paragraph).tokens, state, {});
      const meaningful = spans.filter((s) => !(s.kind === "text" && !s.text.trim()));
      const only = meaningful.length === 1 ? meaningful[0] : undefined;
      if (only?.kind === "token" && blockTokenIs(only.token)) {
        state.blocks.push({ kind: "token", spans: [], token: only.token });
        return;
      }
      for (const span of spans) {
        if (span.kind === "token" && blockTokenIs(span.token)) {
          throw new CoreError(
            "unsupportedSyntax",
            "page breaks, section breaks, and tables of contents must be on a line of their own",
          );
        }
      }
      state.blocks.push({ kind: "paragraph", spans });
      return;
    }
    case "list":
      state.listGroup++;
      listWalk(token as Tokens.List, 0, state.listGroup, state);
      return;
    case "code": {
      state.codeGroup++;
      for (const line of (token as Tokens.Code).text.split("\n")) {
        state.blocks.push({
          codeGroup: state.codeGroup,
          kind: "codeLine",
          spans: [{ kind: "text", marks: {}, text: line.replace(/[ \t]+$/, "") }],
        });
      }
      return;
    }
    case "table": {
      const t = token as Tokens.Table;
      const cell = (c: Tokens.TableCell) => inlineWalk(c.tokens, state, {});
      state.blocks.push({
        kind: "table",
        spans: [],
        table: {
          alignments: t.align.map((a) => (a === "center" ? "CENTER" : a === "right" ? "END" : undefined)),
          rows: [t.header.map(cell), ...t.rows.map((row) => row.map(cell))],
        },
      });
      return;
    }
    case "blockquote":
      throw new CoreError("unsupportedSyntax", "block quotes aren't supported");
    case "hr":
      throw new CoreError(
        "unsupportedSyntax",
        'a "---" rule isn\'t supported (keep an existing one with its {{hr:N}} token)',
      );
    case "html":
      throw new CoreError("unsupportedSyntax", "HTML isn't supported; escape < as \\<");
    default:
      throw new CoreError("unsupportedSyntax", `unsupported markdown (${token.type})`);
  }
}

/**
 * Turns a list (and nested lists) into list-item blocks. Nested items take the kind of the list's
 * top-level items: Google Docs can't nest a different kind of list inside another (live N7–N9).
 */
function listWalk(
  list: Tokens.List,
  depth: number,
  group: number,
  state: WalkState,
  rootKind?: "bullet" | "check" | "number",
): void {
  if (list.loose)
    throw new CoreError(
      "unsupportedSyntax",
      "list items must be single paragraphs (remove blank lines inside the list)",
    );
  for (const item of list.items) {
    if (item.task && item.checked)
      throw new CoreError("unsupportedSyntax", "checked items ([x]) aren't supported; use [ ]");
    const written = item.task ? "check" : list.ordered ? "number" : "bullet";
    const kind = rootKind ?? written;
    const nested: Tokens.List[] = [];
    const inline: Token[] = [];
    for (const child of item.tokens) {
      if (child.type === "checkbox") continue;
      if (child.type === "list") nested.push(child as Tokens.List);
      else if (child.type === "text") inline.push(...((child as Tokens.Text).tokens ?? [child]));
      else if (child.type === "space") continue;
      else
        throw new CoreError(
          "unsupportedSyntax",
          `list items can only hold text and nested lists (found ${child.type})`,
        );
    }
    state.blocks.push({
      kind: "listItem",
      list: { depth, group, kind, ...(written !== kind ? { written } : {}) },
      spans: inlineWalk(inline, state, {}),
    });
    for (const sub of nested) listWalk(sub, depth + 1, group, state, kind);
  }
}

/** Merges adjacent text spans with the same marks and directive. */
function spansMerge(spans: readonly ParsedSpan[]): ParsedSpan[] {
  const out: ParsedSpan[] = [];
  for (const span of spans) {
    const last = out.at(-1);
    if (
      span.kind === "text" &&
      last?.kind === "text" &&
      last.directive === span.directive &&
      JSON.stringify(last.marks) === JSON.stringify(span.marks)
    ) {
      out[out.length - 1] = { ...last, text: last.text + span.text };
    } else out.push(span);
  }
  return out;
}

/** Turns inline marked tokens into spans (adjacent equal spans merged). */
function inlineWalk(tokens: readonly Token[], state: WalkState, marks: ParsedMarks, directive?: string): ParsedSpan[] {
  return spansMerge(inlineTokensWalk(tokens, state, marks, directive));
}

/** Turns inline marked tokens into spans. */
function inlineTokensWalk(
  tokens: readonly Token[],
  state: WalkState,
  marks: ParsedMarks,
  directive?: string,
): ParsedSpan[] {
  const out: ParsedSpan[] = [];
  const text = (t: string) => out.push({ directive, kind: "text", marks, text: t });
  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "escape": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) out.push(...inlineWalk(t.tokens, state, marks, directive));
        else text(token.type === "text" ? t.text.replaceAll(TAB_ENTITY, "\t").replace(/\n/g, " ") : t.text);
        break;
      }
      case "br":
        text("\u000b");
        break;
      case "codespan":
        out.push({ directive, kind: "text", marks: { ...marks, code: true }, text: (token as Tokens.Codespan).text });
        break;
      case "strong":
        out.push(...inlineWalk((token as Tokens.Strong).tokens, state, { ...marks, bold: true }, directive));
        break;
      case "em":
        out.push(...inlineWalk((token as Tokens.Em).tokens, state, { ...marks, italic: true }, directive));
        break;
      case "del":
        out.push(...inlineWalk((token as Tokens.Del).tokens, state, { ...marks, strike: true }, directive));
        break;
      case "link": {
        const t = token as Tokens.Link;
        out.push(...inlineWalk(t.tokens, state, { ...marks, link: linkParse(t.href, state) }, directive));
        break;
      }
      case "image": {
        const t = token as Tokens.Image;
        if (!/^https:\/\//.test(t.href))
          throw new CoreError("unsupportedSyntax", `images must be public https URLs (got "${t.href}")`);
        out.push({ kind: "token", marks, token: { create: { alt: t.text || undefined, type: "image", uri: t.href } } });
        break;
      }
      case "gdocToken": {
        const t = token as unknown as { kind: string; label?: string; ref?: string };
        out.push({ kind: "token", marks, token: tokenParse(t.kind, t.ref, t.label) });
        break;
      }
      case "gdocDirective": {
        const t = token as unknown as { name: string; tokens: Token[] };
        if (!state.styles?.[t.name])
          throw new CoreError(
            "unsupportedSyntax",
            `style directive "${t.name}" isn't defined in the frontmatter styles`,
          );
        out.push(...inlineWalk(t.tokens, state, marks, t.name));
        break;
      }
      case "html":
        throw new CoreError("unsupportedSyntax", "HTML isn't supported; escape < as \\<");
      default:
        throw new CoreError("unsupportedSyntax", `unsupported inline markdown (${token.type})`);
    }
  }
  return out;
}

/** Parses `{{kind:ref|label}}` into a reference or a create (D29). */
function tokenParse(kind: string, ref: string | undefined, label: string | undefined): ParsedToken {
  if (!TOKEN_KINDS.has(kind)) throw new CoreError("unsupportedSyntax", `unknown token kind "${kind}"`);
  if (ref && /^\d+$/.test(ref)) return { kind: kind as TokenKind, label, ordinal: Number(ref) };
  if (kind === "pagebreak" && !ref) return { pageBreak: true };
  if (kind === "sectionbreak" && (ref === "next-page" || ref === "continuous"))
    return { sectionBreak: ref === "next-page" ? "NEXT_PAGE" : "CONTINUOUS" };
  if (kind === "person" && ref) return { create: { email: ref, type: "person" } };
  if (kind === "date" && ref) return { create: { timestamp: ref, type: "date" } };
  if (kind === "richlink" && ref) return { create: { type: "richLink", uri: ref } };
  throw new CoreError(
    "unsupportedSyntax",
    `"{{${kind}${ref ? `:${ref}` : ""}}}" is neither an existing ${kind} (a number) nor a way to create one`,
  );
}

/** True for tokens that stand alone as blocks. */
function blockTokenIs(token: ParsedToken): boolean {
  if ("ordinal" in token) return BLOCK_TOKEN_KINDS.has(token.kind);
  return "pageBreak" in token || "sectionBreak" in token;
}

/** Resolves a link target (D31). */
function linkParse(href: string, state: WalkState): ParsedLink {
  const { doc, tab } = state.ctx;
  if (href.startsWith("#bookmark=")) return { id: href.slice("#bookmark=".length), kind: "bookmark" };
  if (href.startsWith("tab:")) {
    const [title, heading] = splitOnce(href.slice(4), "#");
    const target = doc.tabs.find((t) => t.title.trim() === title.trim());
    if (!target) throw new CoreError("linkTargetNotFound", `no tab titled "${title}"`);
    if (heading === undefined) return { kind: "tab", tabId: target.tabId };
    return headingLink(target, heading, state, target.tabId);
  }
  if (href.startsWith("#")) return headingLink(tab, href.slice(1), state);
  const docsUrl = /^https:\/\/docs\.google\.com\/document\/d\/([^/?#]+)[^?#]*(?:\?([^#]*))?(?:#(.*))?$/.exec(href);
  if (docsUrl && docsUrl[1] === doc.docId) {
    const tabId = new URLSearchParams(docsUrl[2] ?? "").get("tab") ?? undefined;
    const fragment = docsUrl[3] ?? "";
    if (fragment.startsWith("heading="))
      return { headingId: fragment.slice("heading=".length), kind: "heading", tabId };
    if (tabId) return { kind: "tab", tabId };
  }
  return { kind: "url", url: href };
}

/** A link to a heading of `target` by id or unique title; unknown titles become pending (resolved after the markdown's own headings exist). */
function headingLink(target: TabModel, ref: string, state: WalkState, tabId?: string): ParsedLink {
  const headings = target.blocks.filter(
    (b): b is ParagraphBlock => b.kind === "paragraph" && headingStyleIs(b.style.namedStyleType as string | undefined),
  );
  const byId = headings.find((h) => h.headingId === ref);
  if (byId) return { headingId: ref, kind: "heading", tabId };
  const matches = headings.filter((h) => titleNormalize(paragraphText(h)) === titleNormalize(ref));
  if (matches.length > 1)
    throw new CoreError("anchorAmbiguous", `${matches.length} headings are titled "${ref}"; link by heading id`);
  if (matches.length === 1) {
    const heading = matches[0];
    return heading.headingId
      ? { headingId: heading.headingId, kind: "heading", tabId }
      : { key: heading.key, kind: "pending", tabId: target.tabId };
  }
  // A heading id nothing matches is a dangling link the document already has: keep it.
  if (HEADING_ID.test(ref)) return { headingId: ref, kind: "heading", tabId };
  if (tabId && tabId !== state.ctx.tab.tabId)
    throw new CoreError("linkTargetNotFound", `no heading "${ref}" in that tab`);
  state.pendingTexts.push({ text: ref });
  return { kind: "pendingText", text: ref };
}

/** Plain text of spans. */
function spansText(spans: readonly ParsedSpan[]): string {
  return spans.map((s) => (s.kind === "text" ? s.text : "")).join("");
}

/** Title comparison form. */
function titleNormalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Splits at the first `sep`. */
function splitOnce(text: string, sep: string): [string, string | undefined] {
  const i = text.indexOf(sep);
  return i < 0 ? [text, undefined] : [text.slice(0, i), text.slice(i + 1)];
}
