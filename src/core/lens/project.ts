/* Projects a tab (or a range of it) into the markdown lens's block view: visible blocks, marks and directives relative to the tab's base styles, and position tokens (G3 D24, D25, D29, D30, M12). */

import type { ContainerRef } from "../model/edit.ts";
import { headingStyleIs, textStyleEffective } from "../model/effectiveStyle.ts";
import { blockInvisibleIs } from "../model/invariants.ts";
import { listKind } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { colorHexFromOptional, dimensionPt, LINK_CHROME, monospaceFontIs } from "../model/styleValues.ts";
import { paragraphSymbols, type Sym } from "../model/symbols.ts";
import type { Atom, Block, ParagraphBlock, TableBlock, TabModel } from "../model/types.ts";
import { anchorsIndex, type ResolvedRange } from "./anchors.ts";

/** Position-token kinds (D29). */
export type TokenKind =
  | "autotext"
  | "chart"
  | "columnbreak"
  | "date"
  | "drawing"
  | "equation"
  | "footnote"
  | "hr"
  | "image"
  | "pagebreak"
  | "person"
  | "richlink"
  | "sectionbreak"
  | "toc";

/** A reference to an atom or block rendered as `{{kind:ordinal|label}}`. */
export interface TokenRef {
  /** Model key of the atom or block. */ key: string;
  /** Token kind. */ kind: TokenKind;
  /** Informational label (a person's name, a date's display text, …). */ label?: string;
  /** 1-based position among the tab's tokens of this kind. */ ordinal: number;
}

/** Where a link points. */
export type LinkTarget =
  | { headingId: string; kind: "heading"; tabId?: string }
  | { id: string; kind: "bookmark"; tabId?: string }
  | { key: string; kind: "pending"; tabId: string }
  | { kind: "tab"; tabId: string }
  | { kind: "url"; url: string };

/** Markdown-expressible emphasis on a span, relative to the base style. */
export interface Marks {
  /** `**bold**`. */ bold?: true;
  /** `` `code` `` (monospace). */ code?: true;
  /** `*italic*`. */ italic?: true;
  /** `[text](target)`. */ link?: LinkTarget;
  /** `~~strike~~`. */ strike?: true;
}

/** One inline piece of a projected block. */
export type ProjSpan =
  | { directive?: string; kind: "text"; marks: Marks; text: string }
  | { kind: "token"; marks: Marks; token: TokenRef };

/** A projected table. */
export interface ProjTable {
  /** Per-column alignment when uniform down the column. */ alignments: Array<"CENTER" | "END" | undefined>;
  /** Cell keys, rows × columns. */ cellKeys: string[][];
  /** True when markdown can't express it (several paragraphs in a cell, merges, headings or lists in cells, line breaks). */ readOnly: boolean;
  /** Cell content, rows × columns × spans. */ rows: ProjSpan[][][];
}

/** Kinds of projected blocks (D24). */
export type ProjBlockKind = "codeLine" | "heading" | "listItem" | "paragraph" | "table" | "token";

/** One visible block. */
export interface ProjBlock {
  /** Its anchor. */ anchor: string;
  /** Code group (consecutive code lines share one). */ codeGroup?: number;
  /** Heading level to render: TITLE 1, SUBTITLE 2, HEADING_n n. */ headingLevel?: number;
  /** Model key. */ key: string;
  /** Kind. */ kind: ProjBlockKind;
  /** List membership. */ list?: { depth: number; group: number; kind: "bullet" | "check" | "number"; listId: string };
  /** The paragraph's named style type. */ namedStyleType?: string;
  /** Keys of the invisible paragraphs that belong to this block (deleted with it). */ owned: string[];
  /** The model symbols this block's text came from. */ sourceSyms: Sym[];
  /** Inline content (paragraph-like blocks). */ spans: ProjSpan[];
  /** True when some run carries style markdown can't show (a directive in frontmatter mode, lost in plain mode). */ styled: boolean;
  /** The table (table blocks). */ table?: ProjTable;
  /** The token (token blocks). */ token?: TokenRef;
}

/** A projected tab or range. */
export interface Projection {
  /** Directive-attribute base style per named style type (D30). */ base: Record<string, DirectiveAttrs>;
  /** Visible blocks, in order. */ blocks: ProjBlock[];
  /** Invisible paragraphs before the first visible block. */ leadingOwned: string[];
  /** Frontmatter mode shows directives; plain mode drops them. */ mode: "frontmatter" | "plain";
  /** Directive name → attributes, for the frontmatter `styles:` map. */ styles: Record<string, DirectiveAttrs>;
}

/** Directive attribute values in frontmatter form (colors `#RRGGBB`, sizes in PT). */
export type DirectiveAttrs = Record<string, boolean | number | string>;

/** Builds the projection of `range` (a whole tab, or blocks of one container). */
export function projectionBuild(
  /** Tab to project. */
  tab: TabModel,
  /** Which blocks. */
  range: ResolvedRange,
  /** Frontmatter (directives) or plain. */
  opts: { mode: "frontmatter" | "plain" },
): Projection {
  const blocks = containerBlocks(tab, range.containerRef).slice(range.from, range.to);
  const anchors = anchorsIndex(tab).byKey;
  const tokens = tokenOrdinals(tab);
  const base = tabBaseStyles(tab);
  const styles: Record<string, DirectiveAttrs> = {};
  const projection: Projection = { base, blocks: [], leadingOwned: [], mode: opts.mode, styles };
  const code = blocks.map((b) => codeLineIs(tab, b));
  // An empty paragraph between two code lines is a code line too.
  for (let i = 1; i < blocks.length - 1; i++) {
    if (!code[i] && blockInvisibleIs(blocks[i])) {
      let j = i;
      while (j < blocks.length && !code[j] && blockInvisibleIs(blocks[j])) j++;
      if (code[i - 1] && code[j]) for (let k = i; k < j; k++) code[k] = true;
    }
  }
  let codeGroup = 0;
  let listGroup = 0;
  let prevVisible: ProjBlock | undefined;
  blocks.forEach((block, i) => {
    if (!code[i] && blockInvisibleIs(block)) {
      (prevVisible ? prevVisible.owned : projection.leadingOwned).push(block.key);
      return;
    }
    const anchor = anchors.get(block.key) ?? `new:${block.key}`;
    const proj = blockProject(tab, block, anchor, tokens, base, styles, opts.mode);
    if (code[i]) {
      proj.kind = "codeLine";
      proj.spans = [
        {
          kind: "text",
          marks: {},
          text: (block as ParagraphBlock).inlines.map((x) => (x.kind === "text" ? x.text : "")).join(""),
        },
      ];
      proj.styled = false;
      if (prevVisible?.kind !== "codeLine") codeGroup++;
      proj.codeGroup = codeGroup;
    }
    if (proj.list) {
      const prev = prevVisible?.list;
      if (!prev || prev.listId !== proj.list.listId) listGroup++;
      proj.list.group = listGroup;
    }
    projection.blocks.push(proj);
    prevVisible = proj;
  });
  if (opts.mode === "plain") for (const key of Object.keys(styles)) delete styles[key];
  return projection;
}

/**
 * Numbers every token-bearing atom and block of a tab, per kind, in document order (cells included),
 * with its label: a person's name or email, a date's display text, a rich link's title, an image's
 * title, the start of a footnote's text.
 */
export function tokenOrdinals(
  /** Tab to number. */
  tab: TabModel,
): Map<string, TokenRef> {
  const out = new Map<string, TokenRef>();
  const counts = new Map<TokenKind, number>();
  const add = (key: string, kind: TokenKind, label?: string) => {
    const ordinal = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, ordinal);
    out.set(key, { key, kind, label, ordinal });
  };
  const paragraph = (p: ParagraphBlock) => {
    for (const inline of p.inlines)
      if (inline.kind === "atom") add(inline.key, atomTokenKind(tab, inline), atomLabel(tab, inline));
  };
  for (const block of tab.blocks) {
    if (block.kind === "paragraph") paragraph(block);
    else if (block.kind === "table")
      for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(paragraph);
    else add(block.key, block.kind === "toc" ? "toc" : "sectionbreak");
  }
  return out;
}

/**
 * The base directive style of each named style type: the most common effective style by character
 * count among the tab's runs of that type (link chrome and code fonts ignored), else the named style's own.
 */
export function tabBaseStyles(
  /** Tab to analyze. */
  tab: TabModel,
): Record<string, DirectiveAttrs> {
  const weights = new Map<string, Map<string, number>>();
  const visit = (p: ParagraphBlock) => {
    const type = (p.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
    for (const inline of p.inlines) {
      if (inline.kind !== "text" || !inline.text.trim()) continue;
      const attrs = directiveAttrsOf(textStyleEffective(tab, p, inline));
      const key = JSON.stringify(attrs);
      const byType = weights.get(type) ?? new Map<string, number>();
      byType.set(key, (byType.get(key) ?? 0) + inline.text.length);
      weights.set(type, byType);
    }
  };
  for (const block of tab.blocks) {
    if (block.kind === "paragraph") visit(block);
    else if (block.kind === "table")
      for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(visit);
  }
  const out: Record<string, DirectiveAttrs> = {};
  for (const [type, byType] of weights) {
    const best = [...byType.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    out[type] = JSON.parse(best);
  }
  return out;
}

/** The base style for a named style type (its own effective style when the tab has no runs of it). */
function baseFor(tab: TabModel, base: Record<string, DirectiveAttrs>, p: ParagraphBlock): DirectiveAttrs {
  const type = (p.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
  return base[type] ?? directiveAttrsOf(textStyleEffective(tab, p, {}));
}

/** Projects one visible block. */
function blockProject(
  tab: TabModel,
  block: Block,
  anchor: string,
  tokens: ReadonlyMap<string, TokenRef>,
  base: Record<string, DirectiveAttrs>,
  styles: Record<string, DirectiveAttrs>,
  mode: "frontmatter" | "plain",
): ProjBlock {
  const proj: ProjBlock = {
    anchor,
    key: block.key,
    kind: "paragraph",
    owned: [],
    sourceSyms: [],
    spans: [],
    styled: false,
  };
  if (block.kind === "toc" || block.kind === "sectionBreak") {
    proj.kind = "token";
    proj.token = tokens.get(block.key);
    return proj;
  }
  if (block.kind === "table") {
    proj.kind = "table";
    proj.table = tableProject(tab, block, tokens, base, styles, mode);
    proj.styled = proj.table.rows.some((row) =>
      row.some((cell) => cell.some((s) => s.kind === "text" && !!s.directive)),
    );
    return proj;
  }
  const namedStyleType = (block.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
  proj.namedStyleType = namedStyleType;
  proj.sourceSyms = paragraphSymbols(block);
  if (block.inlines.length === 1 && block.inlines[0].kind === "atom" && block.inlines[0].type === "pageBreak") {
    proj.kind = "token";
    proj.token = tokens.get(block.inlines[0].key);
    return proj;
  }
  if (headingStyleIs(namedStyleType)) {
    proj.kind = "heading";
    proj.headingLevel =
      namedStyleType === "TITLE"
        ? 1
        : namedStyleType === "SUBTITLE"
          ? 2
          : Number(namedStyleType.replace("HEADING_", ""));
  } else if (block.bullet) {
    const def = tab.lists[block.bullet.listId];
    proj.kind = "listItem";
    proj.list = {
      depth: block.bullet.nestingLevel,
      group: 0,
      kind: def ? listKind(def, block.bullet.nestingLevel) : "bullet",
      listId: block.bullet.listId,
    };
  }
  const result = spansProject(tab, block, tokens, base, styles, mode);
  proj.spans = result.spans;
  proj.styled = result.styled;
  return proj;
}

/** Projects a paragraph's inlines into spans with marks and (frontmatter mode) directives. */
function spansProject(
  tab: TabModel,
  p: ParagraphBlock,
  tokens: ReadonlyMap<string, TokenRef>,
  base: Record<string, DirectiveAttrs>,
  styles: Record<string, DirectiveAttrs>,
  mode: "frontmatter" | "plain",
): { spans: ProjSpan[]; styled: boolean } {
  const baseAttrs = baseFor(tab, base, p);
  const spans: ProjSpan[] = [];
  let styled = false;
  for (const inline of p.inlines) {
    const marks = marksOf(tab, p, inline.style ?? {}, baseAttrs);
    if (inline.kind === "atom") {
      const token = tokens.get(inline.key);
      if (token) spans.push({ kind: "token", marks: marks.marks, token });
      continue;
    }
    const span: ProjSpan = { kind: "text", marks: marks.marks, text: inline.text };
    if (Object.keys(marks.rest).length) {
      styled = true;
      if (mode === "frontmatter") {
        const name = directiveName(marks.rest);
        styles[name] = marks.rest;
        span.directive = name;
      }
    }
    spans.push(span);
  }
  return { spans, styled };
}

/**
 * Splits a run's effective style into markdown marks and the directive attributes that still differ
 * from the base: emphasis the base lacks becomes a mark, emphasis the base has but the run doesn't
 * becomes `false`; code fonts (a `code` mark) and link chrome on links are ignored.
 */
function marksOf(
  tab: TabModel,
  p: ParagraphBlock,
  style: JsonObject,
  base: DirectiveAttrs,
): { marks: Marks; rest: DirectiveAttrs } {
  const attrs = directiveAttrsOf(textStyleEffective(tab, p, { style }));
  const marks: Marks = {};
  const rest: DirectiveAttrs = {};
  const link = linkTargetOf(style.link as JsonObject | undefined);
  if (link) marks.link = link;
  const font = attrs.fontFamily === undefined ? "" : String(attrs.fontFamily);
  if (monospaceFontIs(font) && !monospaceFontIs(String(base.fontFamily ?? ""))) marks.code = true;
  const markFor: Record<string, keyof Marks> = { bold: "bold", italic: "italic", strikethrough: "strike" };
  for (const field of [...new Set([...Object.keys(attrs), ...Object.keys(base)])].sort()) {
    const value = attrs[field];
    if (value === base[field]) continue;
    const mark = markFor[field];
    if (mark && value === true) {
      (marks as Record<string, unknown>)[mark] = true;
      continue;
    }
    if (field === "fontFamily" && marks.code) continue;
    if (link && field === "underline" && value === LINK_CHROME.underline) continue;
    if (link && field === "foregroundColor" && value === LINK_CHROME.foregroundColor) continue;
    rest[field] = value ?? DIRECTIVE_DEFAULTS[field] ?? false;
  }
  return { marks, rest };
}

/** What an attribute absent from a run's effective style means, when the base sets it. */
const DIRECTIVE_DEFAULTS: DirectiveAttrs = { baselineOffset: "NONE", fontWeight: 400, foregroundColor: "#000000" };

/** The directive attributes (frontmatter form) of an effective style; false booleans, black text, normal weight, and no offset are left out. */
function directiveAttrsOf(effective: JsonObject): DirectiveAttrs {
  const out: DirectiveAttrs = {};
  const bool = (field: string) => {
    if (effective[field] === true) out[field] = true;
  };
  bool("bold");
  bool("italic");
  bool("smallCaps");
  bool("strikethrough");
  bool("underline");
  const bg = colorHexFromOptional(effective.backgroundColor as never);
  if (bg) out.backgroundColor = bg;
  const fg = colorHexFromOptional(effective.foregroundColor as never);
  if (fg && fg !== "#000000") out.foregroundColor = fg;
  if (
    typeof effective.baselineOffset === "string" &&
    effective.baselineOffset !== "NONE" &&
    effective.baselineOffset !== "BASELINE_OFFSET_UNSPECIFIED"
  ) {
    out.baselineOffset = effective.baselineOffset;
  }
  const size = effective.fontSize ? dimensionPt(effective.fontSize as never) : undefined;
  if (size) out.fontSize = size;
  const font = effective.weightedFontFamily as { fontFamily?: string; weight?: number } | undefined;
  if (font?.fontFamily) out.fontFamily = font.fontFamily;
  if (font?.weight && font.weight !== 400) out.fontWeight = font.weight;
  return out;
}

/** A directive name generated from its attributes, e.g. `color-E11D48+size-9`. */
function directiveName(attrs: DirectiveAttrs): string {
  const parts: string[] = [];
  const safe = (text: string) => text.replace(/[^A-Za-z0-9_.-]+/g, "_");
  for (const [field, value] of Object.entries(attrs).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (field === "backgroundColor") parts.push(`bg-${String(value).replace("#", "")}`);
    else if (field === "foregroundColor") parts.push(`color-${String(value).replace("#", "")}`);
    else if (field === "fontSize") parts.push(`size-${value}`);
    else if (field === "fontWeight") parts.push(`weight-${value}`);
    else if (field === "fontFamily") parts.push(`font-${safe(String(value))}`);
    else if (field === "baselineOffset") parts.push(String(value) === "SUPERSCRIPT" ? "super" : "sub");
    else parts.push(value === false ? `no${field.toLowerCase()}` : field.toLowerCase());
  }
  const name = parts.join("+");
  return /^[A-Za-z0-9]/.test(name) ? name : `s${name}`;
}

/** A model link in lens form. */
function linkTargetOf(link: JsonObject | undefined): LinkTarget | undefined {
  if (!link) return undefined;
  const heading = link.heading as { id?: string; key?: string; tabId?: string } | undefined;
  if (heading?.key) return { key: heading.key, kind: "pending", tabId: heading.tabId ?? "" };
  if (heading?.id) return { headingId: heading.id, kind: "heading", tabId: heading.tabId };
  const bookmark = link.bookmark as { id?: string; tabId?: string } | undefined;
  if (bookmark?.id) return { id: bookmark.id, kind: "bookmark", tabId: bookmark.tabId };
  if (typeof link.bookmarkId === "string") return { id: link.bookmarkId, kind: "bookmark" };
  if (typeof link.tabId === "string") return { kind: "tab", tabId: link.tabId };
  if (typeof link.url === "string") return { kind: "url", url: link.url };
  return undefined;
}

/** Projects a table; it's read-only unless every cell is one plain paragraph without merges or line breaks. */
function tableProject(
  tab: TabModel,
  t: TableBlock,
  tokens: ReadonlyMap<string, TokenRef>,
  base: Record<string, DirectiveAttrs>,
  styles: Record<string, DirectiveAttrs>,
  mode: "frontmatter" | "plain",
): ProjTable {
  let readOnly = false;
  const rows = t.rows.map((row) =>
    row.cells.map((cell) => {
      const spans = (cell.style.rowSpan as number | undefined) ?? 1;
      const cols = (cell.style.columnSpan as number | undefined) ?? 1;
      const only = cell.blocks.length === 1 ? cell.blocks[0] : undefined;
      const plain =
        !!only &&
        !only.bullet &&
        !headingStyleIs(only.style.namedStyleType as string | undefined) &&
        !only.inlines.some((i) => i.kind === "text" && i.text.includes("\u000b"));
      if (!plain || spans > 1 || cols > 1) readOnly = true;
      return cell.blocks.flatMap((p) => spansProject(tab, p, tokens, base, styles, mode).spans);
    }),
  );
  const columnCount = t.columns.length;
  const alignments = Array.from({ length: columnCount }, (_, c) => {
    const values = new Set(
      t.rows.map((row) => (row.cells[c]?.blocks[0]?.style.alignment as string | undefined) ?? "START"),
    );
    const [only] = values;
    return values.size === 1 && (only === "CENTER" || only === "END") ? only : undefined;
  });
  return { alignments, cellKeys: t.rows.map((row) => row.cells.map((cell) => cell.key)), readOnly, rows };
}

/** True for a code line: NORMAL_TEXT, no bullet, no atoms, and every non-empty run in a monospace font. */
function codeLineIs(tab: TabModel, block: Block): boolean {
  if (block.kind !== "paragraph" || block.bullet) return false;
  const type = (block.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
  if (type !== "NORMAL_TEXT" || !block.inlines.length) return false;
  return block.inlines.every((inline) => {
    if (inline.kind === "atom") return false;
    if (!inline.text.trim()) return true;
    const font = (textStyleEffective(tab, block, inline).weightedFontFamily as { fontFamily?: string } | undefined)
      ?.fontFamily;
    return !!font && monospaceFontIs(font);
  });
}

/** An atom's token kind (images are told apart from drawings and charts by their inline object). */
function atomTokenKind(tab: TabModel, atom: Atom): TokenKind {
  switch (atom.type) {
    case "autoText":
      return "autotext";
    case "columnBreak":
      return "columnbreak";
    case "date":
      return "date";
    case "equation":
      return "equation";
    case "footnoteRef":
      return "footnote";
    case "horizontalRule":
      return "hr";
    case "pageBreak":
      return "pagebreak";
    case "person":
      return "person";
    case "richLink":
      return "richlink";
    case "image": {
      const embedded = inlineObjectEmbedded(tab, atom);
      if (embedded?.embeddedDrawingProperties) return "drawing";
      if (embedded?.linkedContentReference) return "chart";
      return "image";
    }
  }
}

/** An atom's informational label. */
function atomLabel(tab: TabModel, atom: Atom): string | undefined {
  const raw = (atom.raw ?? {}) as Record<string, JsonObject | undefined>;
  if (atom.create) {
    const c = atom.create;
    return c.type === "person"
      ? c.email
      : c.type === "date"
        ? c.timestamp
        : c.type === "richLink"
          ? c.uri
          : c.type === "image"
            ? c.alt
            : undefined;
  }
  switch (atom.type) {
    case "person": {
      const props = raw.person?.personProperties as JsonObject | undefined;
      return (props?.name ?? props?.email) as string | undefined;
    }
    case "date":
      return (raw.dateElement?.dateElementProperties as JsonObject | undefined)?.displayText as string | undefined;
    case "richLink":
      return (raw.richLink?.richLinkProperties as JsonObject | undefined)?.title as string | undefined;
    case "image": {
      const embedded = inlineObjectEmbedded(tab, atom);
      return (embedded?.title ?? embedded?.description) as string | undefined;
    }
    case "footnoteRef": {
      const id = raw.footnoteReference?.footnoteId as string | undefined;
      const text = footnoteText(tab.footnotes[id ?? ""]);
      return text ? text.slice(0, 40) : undefined;
    }
    default:
      return undefined;
  }
}

/** The embedded object of an image atom's inline object. */
function inlineObjectEmbedded(tab: TabModel, atom: Atom): JsonObject | undefined {
  const id = ((atom.raw?.inlineObjectElement as JsonObject | undefined)?.inlineObjectId ?? "") as string;
  return (tab.inlineObjects[id]?.inlineObjectProperties as JsonObject | undefined)?.embeddedObject as
    | JsonObject
    | undefined;
}

/** A footnote's plain text. */
function footnoteText(footnote: JsonObject | undefined): string {
  const content = (footnote?.content ?? []) as Array<{
    paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
  }>;
  return content
    .flatMap((e) => e.paragraph?.elements ?? [])
    .map((e) => e.textRun?.content ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The block array of a container. */
function containerBlocks(tab: TabModel, ref: ContainerRef): readonly Block[] {
  if ("kind" in ref) return tab.blocks;
  for (const block of tab.blocks) {
    if (block.kind !== "table") continue;
    for (const row of block.rows) for (const cell of row.cells) if (cell.key === ref.cellKey) return cell.blocks;
  }
  return [];
}
