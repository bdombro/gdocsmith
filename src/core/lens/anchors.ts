/* Stable anchors for blocks and cells, and resolution of anchors and ranges back to model locations (G3 D36, M12). */

import { createHash } from "node:crypto";
import type { ContainerRef } from "../model/edit.ts";
import { headingLevel, headingStyleIs } from "../model/effectiveStyle.ts";
import { CoreError } from "../model/errors.ts";
import type { ParagraphBlock, TableBlock, TabModel } from "../model/types.ts";

/** What part of a tab an operation addresses (G3 core API `RangeRef`). */
export type RangeRef =
  | { anchor: string; kind: "cell" }
  | { anchor: string; kind: "node" }
  | { from: string; kind: "nodes"; to: string }
  | { heading: string; includeHeading: boolean; kind: "section" }
  | { kind: "tab" };

/** A resolved range: consecutive blocks `[from, to)` of one container. */
export interface ResolvedRange {
  /** The container. */ containerRef: ContainerRef;
  /** First block index. */ from: number;
  /** Key of the section's heading (section ranges only). */ heading?: string;
  /** Exclusive end block index. */ to: number;
}

/** Every anchor in a tab, both ways. */
export interface AnchorIndex {
  /** Anchor → where it points. */ byAnchor: Map<string, AnchorTarget>;
  /** Block or cell key → its anchor. */ byKey: Map<string, string>;
}

/** Where an anchor points. */
export interface AnchorTarget {
  /** Block or cell key. */ key: string;
  /** A block, or a table cell. */ kind: "block" | "cell";
}

/** How many candidates an anchor error lists. */
const CANDIDATES_MAX = 5;

/** Builds every anchor of a tab: headings by id, other body blocks by scope and content hash, cells by table and position, created items by key. */
export function anchorsIndex(
  /** Tab to index. */
  tab: TabModel,
): AnchorIndex {
  const index: AnchorIndex = { byAnchor: new Map(), byKey: new Map() };
  const add = (anchor: string, target: AnchorTarget) => {
    index.byAnchor.set(anchor, target);
    index.byKey.set(target.key, anchor);
  };
  let scope = "_";
  const seen = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const block of tab.blocks) {
    let anchor: string;
    if (block.kind === "paragraph" && headingStyleIs(block.style.namedStyleType as string | undefined)) {
      anchor = block.headingId ?? `new:${block.key}`;
      scope = anchor;
    } else if (block.key.startsWith("n")) {
      anchor = `new:${block.key}`;
    } else {
      let hashInput: string;
      if (block.kind === "paragraph") hashInput = paragraphHashText(block);
      else if (block.kind === "table") hashInput = `table\0${tableHeaderText(block)}`;
      else {
        const n = (ordinals.get(block.kind) ?? 0) + 1;
        ordinals.set(block.kind, n);
        hashInput = `${block.kind}\0${n}`;
      }
      const base = `${scope}:${hash6(hashInput)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      anchor = n === 1 ? base : `${base}~${n}`;
    }
    add(anchor, { key: block.key, kind: "block" });
    if (block.kind === "table") {
      block.rows.forEach((row, r) => {
        row.cells.forEach((cell, c) => {
          add(`${anchor}/${r}.${c}`, { key: cell.key, kind: "cell" });
        });
      });
    }
  }
  return index;
}

/** The anchor of a block or cell. */
export function anchorOf(
  /** Tab holding it. */
  tab: TabModel,
  /** Block or cell key. */
  key: string,
): string {
  const anchor = anchorsIndex(tab).byKey.get(key);
  if (!anchor) throw new CoreError("anchorNotFound", `no block or cell with key ${key}`);
  return anchor;
}

/**
 * Resolves an anchor, or a heading's title (trimmed, case-insensitive, whitespace-collapsed, unique),
 * to what it names. Unknown anchors raise `anchorNotFound` with up to 5 nearby candidates; a title
 * shared by several headings raises `anchorAmbiguous`.
 */
export function anchorResolve(
  /** Tab to resolve in. */
  tab: TabModel,
  /** Anchor or heading title. */
  ref: string,
): AnchorTarget {
  const index = anchorsIndex(tab);
  const direct = index.byAnchor.get(ref);
  if (direct) return direct;
  const wanted = titleNormalize(ref);
  const headings = tab.blocks.filter(
    (b): b is ParagraphBlock => b.kind === "paragraph" && headingStyleIs(b.style.namedStyleType as string | undefined),
  );
  const matches = headings.filter((h) => titleNormalize(paragraphText(h)) === wanted);
  if (matches.length === 1) return { key: matches[0].key, kind: "block" };
  if (matches.length > 1) {
    throw new CoreError("anchorAmbiguous", `${matches.length} headings are titled "${ref.trim()}"; use a heading id`, {
      candidates: matches
        .slice(0, CANDIDATES_MAX)
        .map((h) => ({ anchor: index.byKey.get(h.key), text: paragraphText(h) })),
    });
  }
  throw new CoreError("anchorNotFound", `nothing matches "${ref}" (it may have changed since it was read)`, {
    candidates: candidatesNear(tab, index, ref),
  });
}

/**
 * Resolves a range to consecutive blocks of one container. A section runs from its heading to just
 * before the next heading of the same or a higher level (TITLE 0, SUBTITLE 1, HEADING_n n).
 */
export function rangeResolve(
  /** Tab to resolve in. */
  tab: TabModel,
  /** Range to resolve. */
  ref: RangeRef,
): ResolvedRange {
  const body: ContainerRef = { kind: "body" };
  if (ref.kind === "tab") return { containerRef: body, from: 0, to: tab.blocks.length };
  if (ref.kind === "cell" || ref.kind === "node") {
    const target = anchorResolve(tab, ref.anchor);
    if (target.kind === "cell" || ref.kind === "cell") {
      const cell = cellFind(tab, target.key);
      if (target.kind !== "cell" || !cell) throw new CoreError("anchorNotFound", `"${ref.anchor}" isn't a table cell`);
      return { containerRef: { cellKey: target.key }, from: 0, to: cell.blocks.length };
    }
    const i = bodyIndexOf(tab, target);
    return { containerRef: body, from: i, to: i + 1 };
  }
  if (ref.kind === "nodes") {
    const from = bodyIndexOf(tab, anchorResolve(tab, ref.from));
    const to = bodyIndexOf(tab, anchorResolve(tab, ref.to));
    if (to < from) throw new CoreError("invalidPlacement", `"${ref.to}" comes before "${ref.from}"`);
    return { containerRef: body, from, to: to + 1 };
  }
  const start = bodyIndexOf(tab, anchorResolve(tab, ref.heading));
  const heading = tab.blocks[start] as ParagraphBlock;
  const level = headingLevel(heading.style.namedStyleType as string | undefined);
  if (level === undefined) throw new CoreError("anchorNotFound", `"${ref.heading}" isn't a heading`);
  let end = start + 1;
  while (end < tab.blocks.length) {
    const b = tab.blocks[end];
    const l = b.kind === "paragraph" ? headingLevel(b.style.namedStyleType as string | undefined) : undefined;
    if (l !== undefined && l <= level) break;
    end++;
  }
  return { containerRef: body, from: ref.includeHeading ? start : start + 1, heading: heading.key, to: end };
}

/** A paragraph's visible text, atoms as U+FFFC. */
export function paragraphText(
  /** Paragraph. */
  p: ParagraphBlock,
): string {
  return p.inlines.map((i) => (i.kind === "text" ? i.text : "￼")).join("");
}

/** The text an anchor hashes: NFC, whitespace collapsed and trimmed, atoms as U+FFFC. */
function paragraphHashText(p: ParagraphBlock): string {
  return paragraphText(p).normalize("NFC").replace(/\s+/g, " ").trim();
}

/** A table's header row text, cells joined by tabs. */
function tableHeaderText(t: TableBlock): string {
  return (t.rows[0]?.cells ?? []).map((c) => c.blocks.map(paragraphHashText).join(" ")).join("\t");
}

/** First 6 hex characters of sha256. */
function hash6(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 6);
}

/** Title comparison form: NFC, trimmed, whitespace collapsed, lower case. */
function titleNormalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The body index of a block target, or a `CoreError` for cells and nested blocks. */
function bodyIndexOf(tab: TabModel, target: AnchorTarget): number {
  const i = tab.blocks.findIndex((b) => b.key === target.key);
  if (target.kind !== "block" || i < 0) throw new CoreError("anchorNotFound", "that anchor isn't a top-level block");
  return i;
}

/** Finds a cell by key. */
function cellFind(tab: TabModel, key: string) {
  for (const block of tab.blocks) {
    if (block.kind !== "table") continue;
    for (const row of block.rows) for (const cell of row.cells) if (cell.key === key) return cell;
  }
  return undefined;
}

/** Up to 5 anchors worth suggesting for an unknown one: same scope first, then headings whose title contains the text. */
function candidatesNear(tab: TabModel, index: AnchorIndex, ref: string): Array<{ anchor: string; text: string }> {
  const scope = ref.includes(":") ? ref.slice(0, ref.indexOf(":")) : undefined;
  const wanted = titleNormalize(ref);
  const out: Array<{ anchor: string; text: string }> = [];
  for (const block of tab.blocks) {
    const anchor = index.byKey.get(block.key) ?? "";
    const text = block.kind === "paragraph" ? paragraphText(block) : block.kind;
    const sameScope = scope !== undefined && anchor.startsWith(`${scope}:`);
    const titleHit =
      !!wanted &&
      block.kind === "paragraph" &&
      headingStyleIs(block.style.namedStyleType as string | undefined) &&
      titleNormalize(text).includes(wanted);
    if (sameScope || titleHit) out.push({ anchor, text: text.slice(0, 60) });
    if (out.length >= CANDIDATES_MAX) break;
  }
  return out;
}
