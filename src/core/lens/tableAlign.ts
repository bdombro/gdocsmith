/* Aligns a table as read with the table as written: columns by position or header, rows by content (G3 M16). */

import { lcsPairs } from "../diff/myers.ts";
import { CoreError } from "../model/errors.ts";
import { dice2 } from "./blockDiff.ts";
import type { ParsedSpan } from "./parse.ts";

/** A table's cell content: rows × columns × spans. */
export type TableRows = ReadonlyArray<ReadonlyArray<readonly ParsedSpan[]>>;

/** One step of an alignment, in final order: kept/paired (`o` and `n`), deleted (`o` only), or inserted (`n` only). */
export interface AlignStep {
  /** Index in the table as written. */ n?: number;
  /** Index in the table as read. */ o?: number;
}

/** How a table's rows and columns line up. */
export interface TableAlignment {
  /** Columns, in final order (deleted ones where they were). */ columns: AlignStep[];
  /** Rows, in final order (deleted ones where they were). */ rows: AlignStep[];
}

/** Minimum similarity for pairing rows or columns that aren't identical. */
const PAIR_THRESHOLD = 0.5;

/**
 * Aligns two tables. Columns: by position when the counts match, else by header text (exact, then by
 * similarity of the column's text); an added or removed column whose header another column shares is ambiguous
 * (`ambiguousTableAlignment`). Rows: exact matches by content, then similarity pairing over the
 * shared columns.
 */
export function tableAlign(
  /** Table as read. */
  old: TableRows,
  /** Table as written. */
  next: TableRows,
): TableAlignment {
  const oCols = Math.max(0, ...old.map((r) => r.length));
  const nCols = Math.max(0, ...next.map((r) => r.length));
  const columns =
    oCols === nCols
      ? Array.from({ length: oCols }, (_, i): AlignStep => ({ n: i, o: i }))
      : columnsAlign(old, next, oCols, nCols);
  const shared = columns.filter((c) => c.o !== undefined && c.n !== undefined) as Array<{ n: number; o: number }>;
  const rowText = (rows: TableRows, r: number, side: "n" | "o") =>
    shared.map((c) => spansText(rows[r]?.[c[side]] ?? [])).join("\t");
  const oHashes = old.map((_, r) => rowText(old, r, "o"));
  const nHashes = next.map((_, r) => rowText(next, r, "n"));
  const rowSim = (o: number, n: number) => {
    if (!shared.length) return 0;
    return (
      shared.reduce((sum, c) => sum + dice2(spansText(old[o]?.[c.o] ?? []), spansText(next[n]?.[c.n] ?? [])), 0) /
      shared.length
    );
  };
  // The header row always pairs with the header row.
  const rows = align(oHashes.slice(1), nHashes.slice(1), (o, n) => rowSim(o + 1, n + 1)).map((s) => ({
    n: s.n === undefined ? undefined : s.n + 1,
    o: s.o === undefined ? undefined : s.o + 1,
  }));
  return { columns, rows: [...(old.length && next.length ? [{ n: 0, o: 0 }] : []), ...rows] };
}

/** Aligns columns of differently sized tables by header text, then column-text similarity. */
function columnsAlign(old: TableRows, next: TableRows, oCols: number, nCols: number): AlignStep[] {
  const header = (rows: TableRows, count: number) =>
    Array.from({ length: count }, (_, c) =>
      spansText(rows[0]?.[c] ?? [])
        .trim()
        .toLowerCase(),
    );
  const oHead = header(old, oCols);
  const nHead = header(next, nCols);
  const columnText = (rows: TableRows, c: number) => rows.map((r) => spansText(r[c] ?? [])).join("\n");
  const steps = align(oHead, nHead, (o, n) => dice2(columnText(old, o), columnText(next, n)));
  // A header shared with another column on the same side can't tell which one moved.
  for (const [heads, side] of [
    [oHead, "o"],
    [nHead, "n"],
  ] as const) {
    for (const step of steps) {
      const other = side === "o" ? "n" : "o";
      if (step[side] === undefined || step[other] !== undefined) continue;
      const h = heads[step[side] as number];
      if (h && heads.filter((x) => x === h).length > 1) {
        throw new CoreError(
          "ambiguousTableAlignment",
          `columns headed "${h}" can't be told apart; change one table operation at a time`,
        );
      }
    }
  }
  return steps;
}

/** Exact LCS alignment, then similarity pairing (≥ 0.5) inside each gap, in final order. */
function align(a: readonly string[], b: readonly string[], sim: (i: number, j: number) => number): AlignStep[] {
  const pairs = lcsPairs(a, b);
  const out: AlignStep[] = [];
  let ai = 0;
  let bi = 0;
  for (const [i, j] of [...pairs, [a.length, b.length] as [number, number]]) {
    out.push(...gapPair(ai, i, bi, j, sim));
    if (i < a.length) out.push({ n: j, o: i });
    ai = i + 1;
    bi = j + 1;
  }
  return out;
}

/** Pairs a gap by similarity (in order), deleting and inserting the rest. */
function gapPair(a0: number, a1: number, b0: number, b1: number, sim: (i: number, j: number) => number): AlignStep[] {
  const p = a1 - a0;
  const q = b1 - b0;
  const W = Array.from({ length: p + 1 }, () => new Float64Array(q + 1));
  const score = (i: number, j: number) => {
    const s = sim(a0 + i, b0 + j);
    return s >= PAIR_THRESHOLD ? s : -Infinity;
  };
  for (let i = 1; i <= p; i++)
    for (let j = 1; j <= q; j++) W[i][j] = Math.max(W[i - 1][j], W[i][j - 1], W[i - 1][j - 1] + score(i - 1, j - 1));
  const out: AlignStep[] = [];
  let i = p;
  let j = q;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && W[i][j] === W[i - 1][j - 1] + score(i - 1, j - 1)) {
      out.push({ n: b0 + j - 1, o: a0 + i - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || W[i][j - 1] >= W[i - 1][j])) {
      out.push({ n: b0 + j - 1 });
      j--;
    } else {
      out.push({ o: a0 + i - 1 });
      i--;
    }
  }
  return out.reverse();
}

/** Plain text of spans. */
function spansText(spans: readonly ParsedSpan[]): string {
  return spans.map((s) => (s.kind === "text" ? s.text : "￼")).join("");
}
