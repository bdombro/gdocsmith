/* Renders a projection as markdown: escaping, emphasis nesting with CommonMark flanking fallbacks, directives, tokens, lists, code fences, GFM tables, and frontmatter (G3 D26, D29–D32, M13). */

import { type InlineContext, inlineSignature, TAB_ENTITY } from "./markedLens.ts";
import type { DirectiveAttrs, LinkTarget, Marks, ProjBlock, Projection, ProjSpan, TokenRef } from "./project.ts";

/** Resolves link targets to their markdown form. */
export interface LinkRenderContext {
  /** The tab being rendered. */ currentTabId?: string;
  /** Text of a heading in this tab by id, and whether that text is unique among the tab's headings. */ headingText(
    headingId: string,
    tabId?: string,
  ): { tabTitle?: string; text: string; unique: boolean } | undefined;
  /** Text of a heading created this run (pending link), by key. */ pendingText(key: string): string | undefined;
  /** Title of a tab. */ tabTitle(tabId: string): string | undefined;
}

/** Document and tab identity written into frontmatter. */
export interface FrontmatterIdentity {
  /** Document id. */ doc: string;
  /** Revision the markdown was read at. */ revision?: string;
  /** Tab id. */ tab: string;
  /** Tab title. */ title: string;
}

/** Options for `markdownRender`. */
export interface RenderOptions {
  /** Frontmatter identity (frontmatter mode only). */ frontmatter?: FrontmatterIdentity;
  /** Link resolution (links fall back to ids without it). */ links?: LinkRenderContext;
}

/** The order marks nest in, outermost first (D26). */
const MARK_ORDER = ["link", "directive", "strike", "bold", "italic", "code"] as const;

/** Delimiters of the emphasis marks. */
const EMPHASIS: Record<"bold" | "italic" | "strike", string> = { bold: "**", italic: "*", strike: "~~" };

/** Renders a projection. */
export function markdownRender(
  /** What to render. */
  projection: Projection,
  /** Frontmatter identity and link resolution. */
  opts: RenderOptions = {},
): string {
  const out: string[] = [];
  if (projection.mode === "frontmatter" && opts.frontmatter)
    out.push(frontmatterRender(opts.frontmatter, projection.styles));
  const parts: string[] = [];
  let listState: ListState | undefined;
  let alternate = { bullet: false, number: false };
  let i = 0;
  while (i < projection.blocks.length) {
    const block = projection.blocks[i];
    if (block.kind === "codeLine") {
      const lines: string[] = [];
      while (projection.blocks[i]?.kind === "codeLine" && projection.blocks[i].codeGroup === block.codeGroup) {
        const span = projection.blocks[i].spans[0];
        lines.push(span?.kind === "text" ? span.text : "");
        i++;
      }
      parts.push(codeFenceRender(lines));
      listState = undefined;
      continue;
    }
    if (block.kind === "listItem" && block.list) {
      const items: string[] = [];
      const group = block.list.group;
      const kind = block.list.kind === "number" ? "number" : "bullet";
      // An adjacent separate list of the same family switches marker, so the two don't merge.
      alternate = { ...alternate, [kind]: listState?.adjacentKind === kind ? !alternate[kind] : false };
      const widths: number[] = [];
      while (projection.blocks[i]?.kind === "listItem" && projection.blocks[i].list?.group === group) {
        const item = projection.blocks[i];
        const list = item.list as NonNullable<ProjBlock["list"]>;
        // Markdown can only nest one level deeper than the item before (the first item at the top).
        const depth = Math.min(list.depth, widths.length);
        const indent = Array.from({ length: depth }, (_, k) => widths[k] ?? 2).reduce((a, b) => a + b, 0);
        widths[depth] = list.kind === "number" ? 3 : 2;
        widths.length = depth + 1;
        items.push(
          `${" ".repeat(indent)}${listMarker(list.kind, alternate)} ${inlineRender(item.spans, opts, { cell: false, listItem: true })}`,
        );
        i++;
      }
      parts.push(items.join("\n"));
      listState = { adjacentKind: kind };
      continue;
    }
    listState = undefined;
    parts.push(blockRender(block, opts));
    i++;
  }
  out.push(parts.join("\n\n"));
  return `${out.join("\n")}\n`;
}

/** Tracks the previous list so adjacent separate lists can alternate markers. */
interface ListState {
  /** Marker family of the list just rendered. */ adjacentKind: "bullet" | "number";
}

/** One list item's marker. */
function listMarker(kind: "bullet" | "check" | "number", alternate: { bullet: boolean; number: boolean }): string {
  if (kind === "number") return alternate.number ? "1)" : "1.";
  const bullet = alternate.bullet ? "*" : "-";
  return kind === "check" ? `${bullet} [ ]` : bullet;
}

/** Renders a non-list, non-code block. */
function blockRender(block: ProjBlock, opts: RenderOptions): string {
  if (block.kind === "token" && block.token) return tokenRender(block.token);
  if (block.kind === "heading") {
    // Headings can't hold line breaks; a trailing " #" run would read as a closing sequence.
    const spans = block.spans.map((sp) =>
      sp.kind === "text" ? { ...sp, text: sp.text.replaceAll("\u000b", " ") } : sp,
    );
    const text = inlineRender(spans, opts, { cell: false }).replace(
      /(^|\s)(#+)$/,
      (_, space: string, hashes: string) => `${space}\\${hashes}`,
    );
    return `${"#".repeat(Math.min(6, block.headingLevel ?? 1))} ${text}`;
  }
  if (block.kind === "table" && block.table) return tableRender(block, opts);
  return inlineRender(block.spans, opts, { cell: false });
}

/** A GFM table (read-only tables render the same way; writes to them are refused). */
function tableRender(block: ProjBlock, opts: RenderOptions): string {
  const table = block.table as NonNullable<ProjBlock["table"]>;
  const width = Math.max(1, ...table.rows.map((row) => row.length));
  const row = (cells: ProjSpan[][]) =>
    `| ${Array.from({ length: width }, (_, c) => inlineRender(cells[c] ?? [], opts, { cell: true }) || " ").join(" | ")} |`;
  const align = Array.from({ length: width }, (_, c) =>
    table.alignments[c] === "CENTER" ? ":-:" : table.alignments[c] === "END" ? "--:" : "---",
  );
  const [header, ...body] = table.rows;
  return [row(header ?? []), `| ${align.join(" | ")} |`, ...body.map(row)].join("\n");
}

/** A fenced code block, with a fence longer than any backtick run inside. */
function codeFenceRender(lines: readonly string[]): string {
  const longest = Math.max(0, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((m) => m.length))));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, ...lines, fence].join("\n");
}

/** `{{kind:ordinal|label}}`, with a sanitized label. */
function tokenRender(token: TokenRef): string {
  const label = token.label
    ?.replace(/[{}|\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return `{{${token.kind}:${token.ordinal}${label ? `|${label}` : ""}}}`;
}

/** The value a mark has on a span (links compared by target, directives by name). */
function markValue(span: ProjSpan, mark: (typeof MARK_ORDER)[number]): string | undefined {
  if (mark === "directive") return span.kind === "text" ? span.directive : undefined;
  if (mark === "link") return span.marks.link ? JSON.stringify(span.marks.link) : undefined;
  if (mark === "code") return span.kind === "text" && span.marks.code ? "code" : undefined;
  return (span.marks as Marks)[mark] ? mark : undefined;
}

/**
 * Renders inline content (edges trimmed, spaces next to line breaks dropped, D26), then lexes the
 * result back: when the styled markdown wouldn't parse to the same text and formatting, the block is
 * rendered plain instead (D27), which always round-trips.
 */
function inlineRender(
  spans: readonly ProjSpan[],
  opts: RenderOptions,
  ctx: { cell: boolean; listItem?: boolean },
): string {
  const normalized = spansNormalize(spans);
  const context = ctx.cell ? "cell" : ctx.listItem ? "listItem" : "paragraph";
  const styled = lineStartsEscape(spansRender(normalized, 0, opts, ctx));
  if (signatureMatches(styled, normalized, opts, context)) return styled;
  return lineStartsEscape(normalized.map((s) => leafRender(s, ctx)).join(""));
}

/** Trims whitespace at the edges and around line breaks (both lossy in markdown), dropping emptied spans. */
function spansNormalize(spans: readonly ProjSpan[]): ProjSpan[] {
  const within = (text: string) => text.replace(/[ \t]+\v/g, "\u000b").replace(/\v[ \t]+/g, "\u000b");
  let out = spans
    .map((s) => (s.kind === "text" ? { ...s, text: within(s.text) } : { ...s }))
    .filter((s) => s.kind !== "text" || s.text !== "") as ProjSpan[];
  // Across spans: spaces before a line break that starts the next span, or after one that ends the previous.
  for (let changed = true; changed; ) {
    changed = false;
    out = out.map((span, i) => {
      if (span.kind !== "text") return span;
      const prev = out[i - 1];
      const next = out[i + 1];
      let text = span.text;
      if (next?.kind === "text" && next.text.startsWith("\u000b")) text = text.replace(/[ \t]+$/, "");
      if (prev?.kind === "text" && prev.text.endsWith("\u000b")) text = text.replace(/^[ \t]+/, "");
      if (text !== span.text) changed = true;
      return { ...span, text };
    });
    const before = out.length;
    out = out.filter((s) => s.kind !== "text" || s.text !== "");
    if (out.length !== before) changed = true;
  }
  // Trim the edges until they're stable (several whitespace-only spans can sit at an edge).
  let kept = out.filter((s) => s.kind !== "text" || s.text !== "");
  for (let changed = true; changed; ) {
    changed = false;
    const first = kept[0];
    if (first?.kind === "text" && /^[ \t\v]/.test(first.text)) {
      kept[0] = { ...first, text: first.text.replace(/^[ \t\v]+/, "") };
      changed = true;
    }
    const last = kept.at(-1);
    if (last?.kind === "text" && /[ \t\v]$/.test(last.text)) {
      kept[kept.length - 1] = { ...last, text: last.text.replace(/[ \t\v]+$/, "") };
      changed = true;
    }
    kept = kept.filter((s) => s.kind !== "text" || s.text !== "");
  }
  return kept;
}

/** True when `markdown` lexes back to exactly the characters of `spans` with their formatting (whitespace formatting ignored). */
function signatureMatches(
  markdown: string,
  spans: readonly ProjSpan[],
  opts: RenderOptions,
  context: InlineContext,
): boolean {
  const parsed = inlineSignature(markdown, context);
  if (!parsed) return false;
  const expected: Array<{ ch: string; tag: string }> = [];
  for (const span of spans) {
    const m = span.marks;
    const tags = [
      m.bold && "b",
      m.italic && "i",
      m.strike && "s",
      span.kind === "text" && m.code && "c",
      m.link && `l:${linkRender(m.link, opts.links).replace(/\\([<>])/g, "$1")}`,
      span.kind === "text" && span.directive && `d:${span.directive}`,
    ].filter((t): t is string => !!t);
    const tag = tags.sort().join(",");
    if (span.kind === "token") expected.push({ ch: "\uFFFC", tag });
    else for (const ch of Array.from(span.text)) expected.push({ ch, tag });
  }
  return (
    parsed.length === expected.length &&
    parsed.every((c, i) => c.ch === expected[i].ch && (/\s/.test(c.ch) || c.tag === expected[i].tag))
  );
}

/** Renders spans at mark level `level` of `MARK_ORDER`, nesting deeper marks inside. */
function spansRender(spans: readonly ProjSpan[], level: number, opts: RenderOptions, ctx: { cell: boolean }): string {
  if (level >= MARK_ORDER.length) return spans.map((s) => leafRender(s, ctx)).join("");
  const mark = MARK_ORDER[level];
  let out = "";
  let i = 0;
  while (i < spans.length) {
    const value = markValue(spans[i], mark);
    let j = i + 1;
    while (j < spans.length && markValue(spans[j], mark) === value) j++;
    const group = spans.slice(i, j);
    if (value === undefined) out += spansRender(group, level + 1, opts, ctx);
    else out += markWrap(mark, group, level, opts, ctx, out, spans.slice(j));
    i = j;
  }
  return out;
}

/** Wraps a group of spans sharing a mark, keeping boundary whitespace outside and falling back to no mark when CommonMark wouldn't parse it. */
function markWrap(
  mark: (typeof MARK_ORDER)[number],
  group: readonly ProjSpan[],
  level: number,
  opts: RenderOptions,
  ctx: { cell: boolean },
  before: string,
  after: readonly ProjSpan[],
): string {
  if (mark === "code") return codeSpanRender(group.map((s) => (s.kind === "text" ? s.text : "")).join(""));
  const { lead, inner, trail } = whitespaceSplit(group);
  const content = spansRender(inner, level + 1, opts, ctx);
  if (!content) return spansRender(group, level + 1, opts, ctx);
  const leadText = textRender(lead, ctx);
  const trailText = textRender(trail, ctx);
  if (mark === "link") {
    const target = linkRender(group[0].marks.link as LinkTarget, opts.links);
    return `${leadText}[${content}](<${target}>)${trailText}`;
  }
  if (mark === "directive") {
    const name = group[0].kind === "text" ? group[0].directive : "";
    return `${leadText}::${name}[${content}]::${trailText}`;
  }
  const delimiter = EMPHASIS[mark];
  const prev = lead ? " " : (Array.from(before).at(-1) ?? "");
  const nextSpan = after[0];
  const next = trail ? " " : nextSpan?.kind === "text" ? (Array.from(nextSpan.text)[0] ?? "") : nextSpan ? "a" : "";
  // A delimiter right after the same delimiter character would merge into one run.
  if (!emphasisSafe(content, prev, next) || prev === delimiter[0]) return spansRender(group, level + 1, opts, ctx);
  return `${leadText}${delimiter}${content}${delimiter}${trailText}`;
}

/** Splits leading/trailing whitespace (line breaks included) off a span group. */
function whitespaceSplit(group: readonly ProjSpan[]): { inner: ProjSpan[]; lead: string; trail: string } {
  const inner = group.map((s) => ({ ...s })) as ProjSpan[];
  let lead = "";
  let trail = "";
  const first = inner[0];
  if (first?.kind === "text") {
    lead = first.text.match(/^[ \t\v]*/)?.[0] ?? "";
    inner[0] = { ...first, text: first.text.slice(lead.length) };
  }
  const last = inner.at(-1);
  if (last?.kind === "text") {
    trail = last.text.match(/[ \t\v]*$/)?.[0] ?? "";
    inner[inner.length - 1] = { ...last, text: last.text.slice(0, last.text.length - trail.length) };
  }
  return { inner: inner.filter((s) => s.kind !== "text" || s.text), lead, trail };
}

/**
 * True when `**x**`-style delimiters around `content` would parse as emphasis in CommonMark: the
 * opener is left-flanking and the closer right-flanking, given the characters around them.
 */
export function emphasisSafe(
  /** Rendered content between the delimiters. */
  content: string,
  /** Character before the opener ("" at the start). */
  prev: string,
  /** Character after the closer ("" at the end). */
  next: string,
): boolean {
  const chars = Array.from(content);
  const first = chars[0] ?? "";
  const last = chars.at(-1) ?? "";
  const space = (c: string) => c === "" || /\s/u.test(c);
  const punct = (c: string) => /[\p{P}\p{S}]/u.test(c);
  const leftFlanking = !space(first) && (!punct(first) || space(prev) || punct(prev));
  const rightFlanking = !space(last) && (!punct(last) || space(next) || punct(next));
  return leftFlanking && rightFlanking;
}

/** A leaf span: escaped text, or a token. */
function leafRender(span: ProjSpan, ctx: { cell: boolean }): string {
  if (span.kind === "token") return tokenRender(span.token);
  return textRender(span.text, ctx);
}

/** Escaped text with line breaks as hard breaks. */
function textRender(text: string, ctx: { cell: boolean }): string {
  return escapeText(text, ctx).replaceAll("\u000b", "\\\n");
}

/** An inline code span with a fence longer than any backtick run, padded when needed. */
function codeSpanRender(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad =
    text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim())
      ? " "
      : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Escapes markdown syntax characters in text (D26); tabs become the tab entity. */
function escapeText(text: string, ctx: { cell: boolean }): string {
  let out = text.replace(/[\\`*_[\]<>~]/g, (c) => `\\${c}`);
  if (ctx.cell) out = out.replace(/\|/g, "\\|");
  // Every "{" (not just "{{"), so a token can't form across two spans.
  out = out.replace(/\{/g, "\\{");
  out = out.replace(/&(?=#9;)/g, "\\&").replaceAll("\t", TAB_ENTITY);
  return out;
}

/** Escapes what would start block syntax at the start of each line, and `!` before an escaped `[` (an image) anywhere. */
function lineStartsEscape(text: string): string {
  return text
    .replace(/(^|[^\\])!(?=\\\[)/g, "$1\\!")
    .split("\n")
    .map((line, i) => {
      const escaped = line.replace(/^(\s*)([#>+=|-])/, "$1\\$2").replace(/^(\s*)(\d+)([.)])/, "$1$2\\$3");
      // A later line of only pipes, colons, and dashes would read as a table delimiter row.
      return i > 0 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-*:?\s*)*\|?\s*$/.test(escaped)
        ? escaped.replace(/^(\s*)([|:])/, "$1\\$2")
        : escaped;
    })
    .join("\n");
}

/** A link target in markdown form (D31). */
function linkRender(target: LinkTarget, links: LinkRenderContext | undefined): string {
  const angle = (s: string) => s.replace(/[<>]/g, (c) => `\\${c}`);
  switch (target.kind) {
    case "url":
      return angle(target.url);
    case "tab":
      return angle(`tab:${links?.tabTitle(target.tabId) ?? target.tabId}`);
    case "bookmark":
      return angle(`#bookmark=${target.id}`);
    case "pending":
      return angle(`#${links?.pendingText(target.key) ?? target.key}`);
    case "heading": {
      const heading = links?.headingText(target.headingId, target.tabId);
      if (heading?.tabTitle)
        return angle(`tab:${heading.tabTitle}#${heading.unique ? heading.text : target.headingId}`);
      // A dangling link (its heading is gone) keeps its id, and its tab when that's another one.
      const otherTab = !heading && target.tabId ? links?.tabTitle(target.tabId) : undefined;
      if (otherTab && links?.currentTabId !== target.tabId) return angle(`tab:${otherTab}#${target.headingId}`);
      return angle(`#${heading?.unique ? heading.text : target.headingId}`);
    }
  }
}

/** YAML frontmatter, written by hand: keys sorted, strings JSON-quoted (D32). */
function frontmatterRender(identity: FrontmatterIdentity, styles: Record<string, DirectiveAttrs>): string {
  const q = (value: unknown) => JSON.stringify(value);
  const lines = ["---", `doc: ${q(identity.doc)}`];
  if (identity.revision) lines.push(`revision: ${q(identity.revision)}`);
  const names = Object.keys(styles).sort();
  if (names.length) {
    lines.push("styles:");
    for (const name of names) {
      lines.push(`  ${q(name)}:`);
      for (const [attr, value] of Object.entries(styles[name]).sort(([a], [b]) => (a < b ? -1 : 1)))
        lines.push(`    ${attr}: ${q(value)}`);
    }
  }
  lines.push(`tab: ${q(identity.tab)}`, `title: ${q(identity.title)}`, "---", "");
  return lines.join("\n");
}
