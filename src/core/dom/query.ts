/*

DOM-ish query over the sibling tape. No descendant combinator — headings
do not wrap following paragraphs.

Selector grammar:
  selector  := compound ( combinator compound )*
  combinator := '+' | '~'
  compound  := type? extra*
  type      := '*' | 'paragraph' | 'table' | 'tableOfContents' | 'sectionBreak'
             | 'pageBreak' | 'heading' | NamedStyle
  extra     := '[bullet]' | ':not([bullet])' | '[image]' | ':not([image])'
             | ':empty' | ':contains(' text ')'
             | ':first-of-type' | ':last-of-type' | ':last-child'
             | ':nth-of-type(' INTEGER ')' | ':nth-sibling(' INTEGER ')'
             | ':nth(' INTEGER ')'

`heading` matches TITLE, SUBTITLE, or HEADING_*. Adjacent `+` selects the
immediate right-hand sibling. Chained `+` walks further siblings
(`HEADING_2 + NORMAL_TEXT + NORMAL_TEXT` = second after that H2).

`~` is following-sibling, filtered: walk forward, keep matches, stop before
the next heading whose outline level is <= the left node's
(`HEADING_2 ~ NORMAL_TEXT[bullet]:nth(1)` = first bullet after that H2,
skipping a tip paragraph). Not unbounded rest-of-doc.

:nth-of-type(n) is 1-indexed among **all body siblings** of that type.
:nth-sibling(n) is 1-indexed following siblings from the previous `+` compound
(counts non-matches). n=1 ≡ adjacent `+`.
:nth(n) is 1-indexed among matches of this compound in a `~` step.

:contains() matches unique-or-not substring on node.text (not CSS; jQuery-like).
:empty matches whitespace-only / missing text **and no images or chips** (spacers, blank headings).

*/

import type { Gdoc } from "../gdoc.ts";
import type { GoogleDoc } from "../types.ts";
import { type ParsedTape, parseTape } from "./parse.ts";
import { type DocNode, isHeadingStyle, NAMED_STYLES, type NamedStyle, STYLE_TO_LEVEL } from "./types.ts";

const KIND_TYPES = new Set<string>(["paragraph", "table", "tableOfContents", "sectionBreak", "pageBreak"]);

const NAMED_TYPES = new Set<string>(NAMED_STYLES);

type Combinator = "+" | "~";

type Compound = {
  contains?: string;
  empty?: boolean;
  hasBullet?: boolean;
  hasImage?: boolean;
  lastChild?: boolean;
  lastOfType?: boolean;
  nth?: number;
  nthOfType?: number;
  nthSibling?: number;
  type?: string;
};

type SelectorStep = {
  combinator: Combinator | null;
  compound: Compound;
};

const SIBLING_DUMP_CAP = 20;
const RELATIVE_NTH_MSG =
  ":nth-sibling(n) and :nth(n) are relative to the previous combinator. Use HEADING_2 + NORMAL_TEXT:nth-sibling(3) or HEADING_2 ~ NORMAL_TEXT[bullet]:nth(1).";

/** Error when `at` does not match a heading-scoped id on this tape. */
export function missingNodeIdMsg(id: number | string, tapeLen: number, kind: "node" | "heading" = "node"): string {
  const what = kind === "heading" ? "heading" : "node";
  if (typeof id === "string" && (id.includes(".") || id.startsWith("h."))) {
    return `No ${what} with id "${id}". Copy id from query (heading-scoped, e.g. h.arch.9a1b).`;
  }
  const numeric = typeof id === "number" ? id : Number(id);
  const hint =
    Number.isFinite(numeric) && numeric > tapeLen
      ? ` Tape has ${tapeLen} nodes — ${id} looks like a leftover startIndex / raw character offset. Do NOT compute character offsets; copy the heading-scoped id from query (e.g. h.arch.9a1b).`
      : ` Tape has ${tapeLen} nodes. Copy the heading-scoped id from query (e.g. h.arch.9a1b).`;
  return `No ${what} with id ${id}.${hint}`;
}

/** Finds a tape node by heading-scoped id, headingId, or numeric snapshot id. */
export function findNodeAt(nodes: DocNode[], at: number | string): DocNode | undefined {
  return nodes.find(
    (n) => n.tapeIndex === at || n.scopedId === at || n.headingId === at || String(n.tapeIndex) === String(at),
  );
}

/** Formats a rich error message for missing heading-scoped targets with available headings or section nodes. */
export function formatMissingScopedTargetMsg(nodes: DocNode[], rawAt: string | number): string {
  const atStr = String(rawAt);
  const parts = atStr.split(".");
  const headingPart = atStr.startsWith("h.") && parts.length > 1 ? `${parts[0]}.${parts[1]}` : parts[0]!;

  const headings = nodes.filter((n) => n.kind === "paragraph" && isHeading(n));
  const targetHeading = headings.find(
    (h) => h.headingId === headingPart || h.scopedId?.startsWith(`${headingPart}.`) || h.scopedId === headingPart,
  );

  if (!targetHeading && headingPart !== "_preamble") {
    const available = headings
      .map((h) => `  - ${h.headingId || h.tapeIndex}: "${(h.text ?? "").trim()}" (${h.namedStyleType})`)
      .slice(0, 15)
      .join("\n");
    return `Heading '${headingPart}' does not exist in this document.\nAvailable headings:\n${available || "  (none)"}`;
  }

  const checksum = parts[parts.length - 1];
  const nodeWithChecksum = nodes.find((n) => n.scopedId?.includes(`.${checksum}`) && n.scopedId !== atStr);
  if (nodeWithChecksum?.scopedId) {
    return `Node '${checksum}' not found under section '${headingPart}', but found at '${nodeWithChecksum.scopedId}'. Did this section move?`;
  }

  const sectionNodes = targetHeading ? neighborhoodFrom(nodes, targetHeading.tapeIndex) : nodes.slice(0, 10);
  const current = sectionNodes
    .map((n) => `  - ${n.scopedId ?? n.tapeIndex} (${n.namedStyleType ?? n.kind}): "${previewText(n.text ?? "")}"`)
    .slice(0, 15)
    .join("\n");

  return `Node '${atStr}' not found under section '${headingPart}'.\nCurrent nodes in this section:\n${current || "  (none)"}`;
}

/**
 * Contiguous tape slice from `startId` through following siblings, stopping
 * before the next heading whose outline level is <= the start node's.
 * Includes sectionBreak / table / everything in between — not a filtered selector.
 */
export function neighborhoodFrom(nodes: DocNode[], startId: number | string): DocNode[] {
  const start = findNodeAt(nodes, startId);
  if (!start) throw new Error(missingNodeIdMsg(startId, nodes.length));
  const i = nodes.indexOf(start);
  const startLevel = headingLevel(start);
  const out: DocNode[] = [start];
  for (let j = i + 1; j < nodes.length; j++) {
    const n = nodes[j]!;
    if (isHeading(n) && headingLevel(n) <= startLevel) break;
    out.push(n);
  }
  return out;
}

/** Options for findHeadingsByText / findNodesByText. `at` is the snapshot id. */
export type FindHeadingTextOptions = {
  at?: number;
  match?: "exact" | "substr";
};

/** Options for findNodesByText. Same shape as heading lookup. */
export type FindNodeTextOptions = FindHeadingTextOptions;

/** Tape wrapper with querySelector / sibling navigation. */
export class DocDom {
  readonly documentId: string;
  readonly nodes: DocNode[];
  readonly revisionId?: string;
  readonly title: string;

  constructor(tape: ParsedTape | DocNode[]) {
    if (Array.isArray(tape)) {
      this.documentId = "";
      this.nodes = tape;
      this.title = "";
    } else {
      this.documentId = tape.documentId;
      this.nodes = tape.nodes;
      this.revisionId = tape.revisionId;
      this.title = tape.title;
    }
  }

  /** Parses a Google Doc or Gdoc into a queryable tape. */
  static from(source: GoogleDoc | Gdoc): DocDom {
    return new DocDom(parseTape(source));
  }

  /** First node matching `sel`, or null. */
  querySelector(sel: string): DocNode | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  /** All nodes matching `sel`, in tape order. */
  querySelectorAll(sel: string): DocNode[] {
    return querySelectorAll(this.nodes, sel);
  }

  /**
   * Apply `select` starting at `start` (first compound must match `start`).
   * Used by title + select so the chain is heading-relative.
   */
  queryFrom(start: DocNode, select: string): DocNode[] {
    return queryFrom(this.nodes, start, select);
  }

  /** Next body sibling, or null. */
  nextElementSibling(node: DocNode): DocNode | null {
    return nextElementSibling(this.nodes, node);
  }

  /** Previous body sibling, or null. */
  previousElementSibling(node: DocNode): DocNode | null {
    return previousElementSibling(this.nodes, node);
  }

  /**
   * Finds one heading by title. Default: exact match preferred, then unique
   * substring. Same-level duplicate titles throw unless `at` is passed.
   */
  findHeadingsByText(needle: string, opts?: FindHeadingTextOptions): DocNode {
    return findHeadingsByText(this.nodes, needle, opts);
  }

  /**
   * Finds one paragraph by visible text (any named style). Default: exact
   * match preferred, then unique substring. Duplicates throw unless `at`.
   */
  findNodesByText(needle: string, opts?: FindNodeTextOptions): DocNode {
    return findNodesByText(this.nodes, needle, opts);
  }
}

/** First match of `sel` on a node list. */
export function querySelector(nodes: DocNode[], sel: string): DocNode | null {
  return querySelectorAll(nodes, sel)[0] ?? null;
}

/** All matches of `sel` on a node list, in tape order. */
export function querySelectorAll(nodes: DocNode[], sel: string): DocNode[] {
  const steps = parseSelector(sel);
  const first = steps[0];
  if (!first) return [];
  assertRelativeNthOnRest(first.compound);
  const candidates = nodes.filter((n) => matchesCompound(nodes, n, first.compound));
  return walkCompounds(nodes, candidates, steps.slice(1));
}

/**
 * Matches `select` with the first compound pinned to `start`.
 * `HEADING_2 + NORMAL_TEXT:nth-sibling(3)` from a titled H2 is the 3rd sibling after it.
 * `HEADING_2 ~ NORMAL_TEXT[bullet]:nth(1)` is the first matching sibling, skipping others.
 */
export function queryFrom(nodes: DocNode[], start: DocNode, select: string): DocNode[] {
  const steps = parseSelector(select);
  const first = steps[0];
  if (!first) return [];
  assertRelativeNthOnRest(first.compound);
  if (!matchesCompound(nodes, start, first.compound)) {
    throw new Error(
      `No match for "${select}" starting at node ${start.tapeIndex}:${previewText(start.text ?? "")}. Use a sibling selector from that node (e.g. HEADING_2 + NORMAL_TEXT or + *).`,
    );
  }
  return walkCompounds(nodes, [start], steps.slice(1));
}

/**
 * Compact dump of following siblings until the next same-or-higher heading
 * (capped). Used when a heading-relative select misses.
 */
export function formatFollowingSiblings(nodes: DocNode[], from: DocNode): string {
  const lines: string[] = [];
  const stopLevel = headingLevel(from);
  let sib = nextElementSibling(nodes, from);
  let i = 0;
  while (sib && lines.length < SIBLING_DUMP_CAP) {
    i++;
    const style = sib.namedStyleType ?? sib.kind;
    const bullet = sib.bullet ? "[bullet]" : "";
    const image = sib.images?.length ? "[image]" : "";
    const text = sib.kind === "paragraph" ? ` ${JSON.stringify(previewText(sib.text ?? ""))}` : "";
    lines.push(`  ${i} ${style}${bullet}${image}${text}`);
    if (isHeading(sib) && headingLevel(sib) <= stopLevel) {
      sib = null;
      break;
    }
    sib = nextElementSibling(nodes, sib);
  }
  if (!lines.length) return "  (none)";
  if (sib) lines.push("  …");
  return lines.join("\n");
}

function walkCompounds(nodes: DocNode[], start: DocNode[], rest: SelectorStep[]): DocNode[] {
  let candidates = start;
  for (const step of rest) {
    const combinator = step.combinator ?? "+";
    const compound = step.compound;
    if (combinator === "~" && compound.nthSibling != null) {
      throw new Error(":nth-sibling(n) counts every following sibling (for +). With ~, use :nth(n) among matches.");
    }
    if (combinator === "+" && compound.nth != null) {
      throw new Error(":nth(n) is for ~ (among matching following siblings). With +, use :nth-sibling(n).");
    }
    const next: DocNode[] = [];
    const seen = new Set<number>();
    for (const a of candidates) {
      const hits = combinator === "~" ? followingMatches(nodes, a, compound) : adjacentMatch(nodes, a, compound);
      for (const sib of hits) {
        if (seen.has(sib.tapeIndex)) continue;
        seen.add(sib.tapeIndex);
        next.push(sib);
      }
    }
    candidates = next;
  }
  return candidates;
}

function adjacentMatch(nodes: DocNode[], a: DocNode, compound: Compound): DocNode[] {
  const steps = compound.nthSibling ?? 1;
  let sib: DocNode | null = a;
  for (let s = 0; s < steps; s++) {
    sib = nextElementSibling(nodes, sib);
    if (!sib) return [];
  }
  if (!sib || !matchesCompound(nodes, sib, compound)) return [];
  return [sib];
}

function followingMatches(nodes: DocNode[], a: DocNode, compound: Compound): DocNode[] {
  const matches: DocNode[] = [];
  const stopLevel = headingLevel(a);
  let sib = nextElementSibling(nodes, a);
  while (sib) {
    if (isHeading(sib) && headingLevel(sib) <= stopLevel) break;
    if (matchesCompound(nodes, sib, compound)) matches.push(sib);
    sib = nextElementSibling(nodes, sib);
  }
  if (compound.nth != null) {
    const hit = matches[compound.nth - 1];
    return hit ? [hit] : [];
  }
  return matches;
}

function assertRelativeNthOnRest(compound: Compound): void {
  if (compound.nthSibling != null || compound.nth != null) {
    throw new Error(RELATIVE_NTH_MSG);
  }
}

function previewText(text: string): string {
  const one = text.split(/\s+/).join(" ").trim();
  return one.length <= 40 ? one : `${one.slice(0, 39)}…`;
}

/** Next tape sibling of `node`. */
export function nextElementSibling(nodes: DocNode[], node: DocNode): DocNode | null {
  const i = indexOfNode(nodes, node);
  if (i < 0) return null;
  return nodes[i + 1] ?? null;
}

/** Previous tape sibling of `node`. */
export function previousElementSibling(nodes: DocNode[], node: DocNode): DocNode | null {
  const i = indexOfNode(nodes, node);
  if (i <= 0) return null;
  return nodes[i - 1] ?? null;
}

/**
 * Resolves a heading by exact title or unique substring.
 * Throws on ambiguous different titles or same-level duplicate titles
 * unless `opts.at` is the heading snapshot id from query.
 */
export function findHeadingsByText(nodes: DocNode[], needle: string, opts: FindHeadingTextOptions = {}): DocNode {
  const headings = nodes.filter((n) => isHeading(n));
  if (opts.at !== undefined) {
    const hit = headings.find((h) => h.tapeIndex === opts.at);
    if (!hit) throw new Error(missingNodeIdMsg(opts.at, nodes.length, "heading"));
    return hit;
  }
  const n = normalize(needle);
  let hits = headings.filter((h) => {
    const t = normalize(h.text ?? "");
    if (opts.match === "exact") return t === n;
    return t.includes(n);
  });
  if (!hits.length) throw new Error(`Section not found: ${needle}`);

  if (opts.match !== "substr") {
    const exact = hits.filter((h) => normalize(h.text ?? "") === n);
    if (opts.match === "exact") hits = exact;
    else if (exact.length) hits = exact;
  }

  const sameTitle = new Set(hits.map((h) => normalize(h.text ?? ""))).size === 1;
  if (!sameTitle && hits.length > 1) {
    throw new Error(
      `Ambiguous heading "${needle}" matches ${hits.length} headings (${hits
        .map((h) => `${h.start}:${h.text || "(empty)"}`)
        .join("; ")}). Use the exact title or at:<id> from query.`,
    );
  }

  const ranked = [...hits].sort((a, b) => headingLevel(a) - headingLevel(b) || a.start - b.start);
  const shallow = headingLevel(ranked[0]!);
  const atShallow = ranked.filter((h) => headingLevel(h) === shallow);
  if (atShallow.length > 1) {
    throw new Error(
      `Duplicate heading "${needle}" (${atShallow.length} matches at level ${shallow}: ${atShallow
        .map((h) => String(h.tapeIndex))
        .join(", ")}). Pass at:<id> from query.`,
    );
  }
  return ranked[0]!;
}

/**
 * Resolves any paragraph by exact text or unique substring.
 * Throws on duplicates unless `opts.at` is the snapshot id from query.
 */
export function findNodesByText(nodes: DocNode[], needle: string, opts: FindNodeTextOptions = {}): DocNode {
  const paras = nodes.filter((n) => n.kind === "paragraph");
  if (opts.at !== undefined) {
    const hit = paras.find((p) => p.tapeIndex === opts.at);
    if (!hit) throw new Error(missingNodeIdMsg(opts.at, nodes.length));
    return hit;
  }
  const n = normalize(needle);
  let hits = paras.filter((p) => {
    const t = normalize(p.text ?? "");
    if (opts.match === "exact") return t === n;
    return t.includes(n);
  });
  if (!hits.length) throw new Error(`Not found: ${needle}`);

  if (opts.match !== "substr") {
    const exact = hits.filter((h) => normalize(h.text ?? "") === n);
    if (opts.match === "exact") hits = exact;
    else if (exact.length) hits = exact;
  }

  if (hits.length > 1) {
    throw new Error(
      `Ambiguous text "${needle}" matches ${hits.length} nodes (${hits
        .map((h) => `${h.tapeIndex}:${previewText(h.text ?? "")}`)
        .join("; ")}). Use at from query.`,
    );
  }
  return hits[0]!;
}

/** Splits a selector on `+` / `~`; rejects descendant combinators. */
function parseSelector(input: string): SelectorStep[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty selector");
  return splitByCombinator(trimmed).map(({ combinator, raw }) => ({
    combinator,
    compound: parseCompound(raw),
  }));
}

/** Tokenizes compounds separated by `+` or `~`. Whitespace between tokens is descendant. */
function splitByCombinator(input: string): { combinator: Combinator | null; raw: string }[] {
  const parts: { combinator: Combinator | null; raw: string }[] = [];
  let buf = "";
  let depthSq = 0;
  let depthPar = 0;
  let pending: Combinator | null = null;

  const flush = (): void => {
    const part = buf.trim();
    if (!part) throw new Error(`Invalid selector: ${input}`);
    parts.push({ combinator: pending, raw: part });
    buf = "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "[") depthSq++;
    if (ch === "]") depthSq = Math.max(0, depthSq - 1);
    if (ch === "(") depthPar++;
    if (ch === ")") depthPar = Math.max(0, depthPar - 1);

    if ((ch === "+" || ch === "~") && depthSq === 0 && depthPar === 0) {
      flush();
      pending = ch;
      continue;
    }

    if (/\s/.test(ch) && depthSq === 0 && depthPar === 0) {
      let j = i;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      const next = input[j];
      if (next && next !== "+" && next !== "~" && buf.trim()) {
        throw new Error(`Descendant combinator is not supported (Google Docs body is a sibling tape): ${input}`);
      }
      i = j - 1;
      continue;
    }

    buf += ch;
  }
  flush();
  return parts;
}

/** Parses one compound: optional type plus extras. */
function parseCompound(raw: string): Compound {
  let type: string | undefined;
  let rest = raw;
  if (raw[0] === "*") {
    type = "*";
    rest = raw.slice(1);
  } else if (raw[0] !== "[" && raw[0] !== ":") {
    const typeMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw);
    if (!typeMatch) throw new Error(`Invalid selector: ${raw}`);
    type = typeMatch[0];
    rest = raw.slice(type.length);
    if (type !== "heading" && !KIND_TYPES.has(type) && !NAMED_TYPES.has(type)) {
      throw new Error(`Unknown selector type: ${type}`);
    }
  }

  const compound: Compound = { type };
  let pos = 0;
  while (pos < rest.length) {
    pos = consumeExtra(rest, pos, compound, raw);
  }
  return compound;
}

function consumeExtra(rest: string, pos: number, compound: Compound, raw: string): number {
  const slice = rest.slice(pos);
  if (slice.startsWith("[bullet]")) {
    if (compound.hasBullet === false) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = true;
    return pos + 8;
  }
  const notBullet = /^:not\(\s*\[bullet\]\s*\)/.exec(slice);
  if (notBullet) {
    if (compound.hasBullet === true) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = false;
    return pos + notBullet[0].length;
  }
  if (slice.startsWith("[image]")) {
    if (compound.hasImage === false) {
      throw new Error(`Conflicting image filters: ${raw}`);
    }
    compound.hasImage = true;
    return pos + 7;
  }
  const notImage = /^:not\(\s*\[image\]\s*\)/.exec(slice);
  if (notImage) {
    if (compound.hasImage === true) {
      throw new Error(`Conflicting image filters: ${raw}`);
    }
    compound.hasImage = false;
    return pos + notImage[0].length;
  }
  if (slice.startsWith(":empty")) {
    compound.empty = true;
    return pos + 6;
  }
  if (slice.startsWith(":last-of-type")) {
    compound.lastOfType = true;
    return pos + 13;
  }
  if (slice.startsWith(":last-child")) {
    compound.lastChild = true;
    return pos + 11;
  }
  if (slice.startsWith(":first-of-type")) {
    compound.nthOfType = 1;
    return pos + 14;
  }
  const nthType = /^:nth-of-type\(\s*(\d+)\s*\)/.exec(slice);
  if (nthType) {
    const n = Number(nthType[1]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`:nth-of-type() requires a 1-based integer: ${raw}`);
    }
    compound.nthOfType = n;
    return pos + nthType[0].length;
  }
  const nthSib = /^:nth-sibling\(\s*(\d+)\s*\)/.exec(slice);
  if (nthSib) {
    const n = Number(nthSib[1]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`:nth-sibling() requires a 1-based integer: ${raw}`);
    }
    if (compound.nth != null) {
      throw new Error(`:nth(n) and :nth-sibling(n) cannot be combined: ${raw}`);
    }
    compound.nthSibling = n;
    return pos + nthSib[0].length;
  }
  const nthMatch = /^:nth\(\s*(\d+)\s*\)/.exec(slice);
  if (nthMatch) {
    const n = Number(nthMatch[1]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`:nth() requires a 1-based integer: ${raw}`);
    }
    if (compound.nthSibling != null) {
      throw new Error(`:nth(n) and :nth-sibling(n) cannot be combined: ${raw}`);
    }
    compound.nth = n;
    return pos + nthMatch[0].length;
  }
  const contains = /^:contains\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\)/.exec(slice);
  if (contains) {
    compound.contains = (contains[1] ?? contains[2] ?? contains[3]!).trim();
    return pos + contains[0].length;
  }
  throw new Error(`Invalid selector: ${raw}`);
}

function matchesCompound(nodes: DocNode[], node: DocNode, c: Compound): boolean {
  if (!matchesType(node, c.type)) return false;
  if (c.hasBullet === true && !node.bullet) return false;
  if (c.hasBullet === false && node.bullet) return false;
  if (c.hasImage === true && !node.images?.length) return false;
  if (c.hasImage === false && node.images?.length) return false;
  if (c.empty) {
    if (node.kind !== "paragraph") return false;
    if ((node.text ?? "").trim() !== "") return false;
    if (node.images?.length) return false;
    if (node.chips?.length) return false;
  }
  if (c.contains != null) {
    if (!normalize(node.text ?? "").includes(normalize(c.contains))) return false;
  }
  if (c.lastChild) {
    if (nodes.at(-1)?.tapeIndex !== node.tapeIndex) return false;
  }
  if (c.nthOfType != null && ofTypeIndex(nodes, node, c.type) !== c.nthOfType) {
    return false;
  }
  if (c.lastOfType) {
    const idx = ofTypeIndex(nodes, node, c.type);
    let count = 0;
    for (const cand of nodes) {
      if (c.type) {
        if (!matchesType(cand, c.type)) continue;
      } else if (cand.kind !== node.kind) {
        continue;
      }
      count++;
    }
    if (idx !== count) return false;
  }
  return true;
}

function matchesType(node: DocNode, type: string | undefined): boolean {
  if (!type || type === "*") return true;
  if (type === "heading") return isHeading(node);
  if (KIND_TYPES.has(type)) return node.kind === type;
  return node.namedStyleType === type;
}

/** 1-based index among body siblings of the selector's type (or node.kind). */
function ofTypeIndex(nodes: DocNode[], node: DocNode, type: string | undefined): number {
  let n = 0;
  for (const cand of nodes) {
    if (type) {
      if (!matchesType(cand, type)) continue;
    } else if (cand.kind !== node.kind) {
      continue;
    }
    n++;
    if (cand.tapeIndex === node.tapeIndex) return n;
  }
  return n;
}

function isHeading(node: DocNode): boolean {
  return node.kind === "paragraph" && isHeadingStyle(node.namedStyleType);
}

function headingLevel(node: DocNode): number {
  return STYLE_TO_LEVEL[(node.namedStyleType ?? "NORMAL_TEXT") as NamedStyle] ?? 99;
}

function indexOfNode(nodes: DocNode[], node: DocNode): number {
  return nodes.findIndex((n) => n.tapeIndex === node.tapeIndex);
}

function normalize(s: string): string {
  return s.split(/\s+/).join(" ").toLowerCase();
}
