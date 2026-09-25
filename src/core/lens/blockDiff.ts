/* Aligns the blocks of the markdown as read (P0) with the markdown as written (P1): exact matches by LCS, then similarity pairing inside the gaps (G3 D33, M15). */

import { lcsPairs } from "../diff/myers.ts";
import { parsedCanonical } from "./canonical.ts";
import type { ParsedBlock } from "./parse.ts";
import type { DirectiveAttrs } from "./project.ts";

/** One step of the alignment, in document order. */
export type BlockEdit =
  | { kind: "delete"; o: number }
  | { kind: "insert"; n: number }
  | { kind: "keep"; n: number; o: number }
  | { kind: "pair"; n: number; o: number };

/** Largest gap (old × new blocks) that gets similarity pairing. */
const PAIR_CELLS_MAX = 40_000;

/** Minimum similarity for pairing. */
const PAIR_THRESHOLD = 0.5;

/** Similarity factor when the block kind changes. */
const KIND_CHANGE_FACTOR = 0.9;

/** Bonus per anchor weight, so anchored blocks win ties. */
const ANCHOR_BONUS = 1e-3;

/**
 * Aligns old and new blocks: an LCS over canonical block hashes (ties to heavier, e.g. commented,
 * blocks), then inside each gap a similarity pairing (bigram Dice ≥ 0.5, ×0.9 when the kind changes;
 * text-bearing kinds pair with each other, code with code, tables with tables; skipped above 40,000
 * cells), so an edited block pairs with its edit rather than with whatever sits in the same position.
 */
export function blockDiff(
  /** Blocks as read (P0). */
  olds: readonly ParsedBlock[],
  /** Blocks as written (P1). */
  news: readonly ParsedBlock[],
  /** Anchor weight of an old block, and each side's directive definitions (hashes compare directive attributes, not names). */
  opts: {
    anchorWeight?: (o: number) => number;
    stylesNew?: Record<string, DirectiveAttrs>;
    stylesOld?: Record<string, DirectiveAttrs>;
  } = {},
): BlockEdit[] {
  const hash = (styles?: Record<string, DirectiveAttrs>) => (b: ParsedBlock) =>
    JSON.stringify(parsedCanonical([b], styles)[0]);
  const pairs = lcsPairs(olds.map(hash(opts.stylesOld)), news.map(hash(opts.stylesNew)), opts.anchorWeight);
  const edits: BlockEdit[] = [];
  let oi = 0;
  let ni = 0;
  for (const [o, n] of [...pairs, [olds.length, news.length] as [number, number]]) {
    edits.push(...gapPair(olds, news, oi, o, ni, n, opts.anchorWeight));
    if (o < olds.length) edits.push({ kind: "keep", n, o });
    oi = o + 1;
    ni = n + 1;
  }
  return edits;
}

/** Bigram Dice similarity of two strings (lower-cased, whitespace collapsed; single characters compared as unigrams; two empties are identical). */
export function dice2(
  /** First string. */
  a: string,
  /** Second string. */
  b: string,
): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x && !y) return 1;
  const grams = (s: string) => {
    const chars = Array.from(s);
    if (chars.length < 2) return chars;
    return chars.slice(0, -1).map((c, i) => c + chars[i + 1]);
  };
  const gx = grams(x);
  const gy = grams(y);
  if (!gx.length || !gy.length) return 0;
  const counts = new Map<string, number>();
  for (const g of gx) counts.set(g, (counts.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of gy) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      common++;
      counts.set(g, n - 1);
    }
  }
  return (2 * common) / (gx.length + gy.length);
}

/** Pairs similar blocks inside one gap (old `[o0, o1)` × new `[n0, n1)`), deleting and inserting the rest, in order. */
function gapPair(
  olds: readonly ParsedBlock[],
  news: readonly ParsedBlock[],
  o0: number,
  o1: number,
  n0: number,
  n1: number,
  weight: ((o: number) => number) | undefined,
): BlockEdit[] {
  const p = o1 - o0;
  const q = n1 - n0;
  const plain = (): BlockEdit[] => [
    ...Array.from({ length: p }, (_, i): BlockEdit => ({ kind: "delete", o: o0 + i })),
    ...Array.from({ length: q }, (_, j): BlockEdit => ({ kind: "insert", n: n0 + j })),
  ];
  if (!p || !q || p * q > PAIR_CELLS_MAX) return plain();
  const sim = (i: number, j: number) => {
    const a = olds[o0 + i];
    const b = news[n0 + j];
    if (!compatible(a, b)) return 0;
    return dice2(blockText(a), blockText(b)) * (a.kind === b.kind ? 1 : KIND_CHANGE_FACTOR);
  };
  // W[i][j]: best total score pairing olds[0..i) with news[0..j) in order.
  const W = Array.from({ length: p + 1 }, () => new Float64Array(q + 1));
  for (let i = 1; i <= p; i++) {
    for (let j = 1; j <= q; j++) {
      const s = sim(i - 1, j - 1);
      const take = s >= PAIR_THRESHOLD ? W[i - 1][j - 1] + s + ANCHOR_BONUS * (weight?.(o0 + i - 1) ?? 0) : -Infinity;
      W[i][j] = Math.max(W[i - 1][j], W[i][j - 1], take);
    }
  }
  const out: BlockEdit[] = [];
  let i = p;
  let j = q;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const s = sim(i - 1, j - 1);
      const take = s >= PAIR_THRESHOLD ? W[i - 1][j - 1] + s + ANCHOR_BONUS * (weight?.(o0 + i - 1) ?? 0) : -Infinity;
      if (take === W[i][j]) {
        out.push({ kind: "pair", n: n0 + j - 1, o: o0 + i - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && (i === 0 || W[i][j - 1] >= W[i - 1][j])) {
      out.push({ kind: "insert", n: n0 + j - 1 });
      j--;
    } else {
      out.push({ kind: "delete", o: o0 + i - 1 });
      i--;
    }
  }
  return out.reverse();
}

/** Kinds that may pair: text-bearing blocks with each other, code with code, tables with tables; tokens only by exact match. */
function compatible(a: ParsedBlock, b: ParsedBlock): boolean {
  const text = (k: string) => k === "heading" || k === "paragraph" || k === "listItem";
  if (text(a.kind) && text(b.kind)) return true;
  return (a.kind === "codeLine" && b.kind === "codeLine") || (a.kind === "table" && b.kind === "table");
}

/** A block's plain text for similarity. */
function blockText(b: ParsedBlock): string {
  const spans = (xs: ParsedBlock["spans"]) => xs.map((s) => (s.kind === "text" ? s.text : "￼")).join("");
  if (b.table) return b.table.rows.map((r) => r.map(spans).join(" ")).join("\n");
  return spans(b.spans);
}
