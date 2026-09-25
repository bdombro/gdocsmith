/* Renders a projection as markdown: escaping, emphasis nesting with CommonMark flanking fallbacks, directives, tokens, lists, code fences, GFM tables, and frontmatter (G3 D26, D29–D32, M13). */

import type { DirectiveAttrs, LinkTarget, Marks, ProjBlock, Projection, ProjSpan, TokenRef } from "./project.ts";

/** Resolves link targets to their markdown form. */
export interface LinkRenderContext {
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
        const indent = Array.from({ length: list.depth }, (_, k) => widths[k] ?? 2).reduce((a, b) => a + b, 0);
        widths[list.depth] = list.kind === "number" ? 3 : 2;
        widths.length = list.depth + 1;
        items.push(
          `${" ".repeat(indent)}${listMarker(list.kind, alternate)} ${inlineRender(item.spans, opts, { cell: false })}`,
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
  if (block.kind === "heading")
    return `${"#".repeat(Math.min(6, block.headingLevel ?? 1))} ${inlineRender(block.spans, opts, { cell: false })}`;
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

/** Renders inline content: whitespace-trimmed, with line breaks as hard breaks. */
function inlineRender(spans: readonly ProjSpan[], opts: RenderOptions, ctx: { cell: boolean }): string {
  const trimmed = trimSpans(spans);
  const text = spansRender(trimmed, 0, opts, ctx);
  return lineStartsEscape(text);
}

/** Drops whitespace at the start and end of a span list (D26: lossy trim). */
function trimSpans(spans: readonly ProjSpan[]): ProjSpan[] {
  const out = spans.map((s) => ({ ...s })) as ProjSpan[];
  while (out.length && out[0].kind === "text" && !(out[0] as { text: string }).text.replace(/^\s+/, "")) out.shift();
  while (out.length && out.at(-1)?.kind === "text" && !(out.at(-1) as { text: string }).text.replace(/\s+$/, ""))
    out.pop();
  if (out[0]?.kind === "text") out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, "") };
  const last = out.at(-1);
  if (last?.kind === "text") out[out.length - 1] = { ...last, text: last.text.replace(/\s+$/, "") };
  return out;
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
  if (mark === "link") {
    const target = linkRender(group[0].marks.link as LinkTarget, opts.links);
    return `${escapeText(lead, ctx)}[${content}](<${target}>)${escapeText(trail, ctx)}`;
  }
  if (mark === "directive") {
    const name = group[0].kind === "text" ? group[0].directive : "";
    return `${escapeText(lead, ctx)}::${name}[${content}]::${escapeText(trail, ctx)}`;
  }
  const delimiter = EMPHASIS[mark];
  const prev = before.at(-1) ?? (lead ? " " : "");
  const nextSpan = after[0];
  const next = trail ? " " : nextSpan?.kind === "text" ? (nextSpan.text[0] ?? "") : nextSpan ? "a" : "";
  if (!emphasisSafe(content, lead ? " " : prev, next)) return spansRender(group, level + 1, opts, ctx);
  return `${escapeText(lead, ctx)}${delimiter}${content}${delimiter}${escapeText(trail, ctx)}`;
}

/** Splits leading/trailing whitespace off a span group. */
function whitespaceSplit(group: readonly ProjSpan[]): { inner: ProjSpan[]; lead: string; trail: string } {
  const inner = group.map((s) => ({ ...s })) as ProjSpan[];
  let lead = "";
  let trail = "";
  const first = inner[0];
  if (first?.kind === "text") {
    lead = first.text.match(/^\s*/)?.[0] ?? "";
    inner[0] = { ...first, text: first.text.slice(lead.length) };
  }
  const last = inner.at(-1);
  if (last?.kind === "text") {
    trail = last.text.match(/\s*$/)?.[0] ?? "";
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
  const first = content[0] ?? "";
  const last = content.at(-1) ?? "";
  const space = (c: string) => c === "" || /\s/u.test(c);
  const punct = (c: string) => /[\p{P}\p{S}]/u.test(c);
  const leftFlanking = !space(first) && (!punct(first) || space(prev) || punct(prev));
  const rightFlanking = !space(last) && (!punct(last) || space(next) || punct(next));
  return leftFlanking && rightFlanking;
}

/** A leaf span: escaped text, or a token. */
function leafRender(span: ProjSpan, ctx: { cell: boolean }): string {
  if (span.kind === "token") return tokenRender(span.token);
  return escapeText(span.text, ctx).replaceAll("\u000b", "\\\n");
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

/** Escapes markdown syntax characters in text (D26). */
function escapeText(text: string, ctx: { cell: boolean }): string {
  let out = text.replace(/[\\`*_[\]<>~]/g, (c) => `\\${c}`);
  if (ctx.cell) out = out.replace(/\|/g, "\\|");
  out = out.replace(/!(?=\\\[)/g, "\\!");
  out = out.replace(/\{\{/g, "\\{\\{");
  out = out.replace(/::(?=[A-Za-z0-9][A-Za-z0-9_+.-]*\\\[)/g, "\\:\\:");
  return out;
}

/** Escapes characters that would start block syntax at the start of each line. */
function lineStartsEscape(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>+=-])/, "$1\\$2").replace(/^(\s*)(\d+)([.)])/, "$1$2\\$3"))
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
