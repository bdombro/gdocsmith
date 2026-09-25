/* Deterministic sequence diffing: Myers edit hunks and a weighted longest-common-subsequence pairing (see G3 M6). */

/** One changed region: `a[aStart, aEnd)` is replaced by `b[bStart, bEnd)` (either side may be empty). */
export interface Hunk {
  /** Exclusive end in `a`. */ aEnd: number;
  /** Start in `a`. */ aStart: number;
  /** Exclusive end in `b`. */ bEnd: number;
  /** Start in `b`. */ bStart: number;
}

/** Above this many DP cells, `lcsPairs` falls back from the weighted DP to a Myers diff. */
const LCS_DP_CELLS_MAX = 4_000_000;

/** Per-unit bonus `lcsPairs` gives a pair for its weight (ties go to heavier elements). */
const LCS_WEIGHT_BONUS = 1e-3;

/**
 * Computes the minimal edit script turning `a` into `b` (Myers O(ND)) as changed regions in order.
 * Common prefixes and suffixes are trimmed first; the result is deterministic for equal inputs.
 */
export function diffHunks<T>(
  /** Original sequence. */
  a: readonly T[],
  /** Final sequence. */
  b: readonly T[],
  /** Element equality (default `Object.is`). */
  eq: (x: T, y: T) => boolean = Object.is,
): Hunk[] {
  return hunksFromMatches(matchesMyers(a, b, eq), a.length, b.length);
}

/**
 * Pairs equal strings of `a` and `b` as a longest common subsequence, preferring pairs whose `a`
 * element weighs more when several subsequences are equally long (each pair scores `1 + 1e-3 · weight`).
 * Uses a DP (over the middle after trimming common ends, when unweighted) while it has at most 4e6 cells, else Myers.
 */
export function lcsPairs(
  /** Original sequence. */
  a: readonly string[],
  /** Final sequence. */
  b: readonly string[],
  /** Weight of `a[i]` (e.g. how many anchors sit on it). */
  weightA?: (i: number) => number,
): Array<[number, number]> {
  // Trimming common ends would pair them before weights are consulted, so it's skipped when weights are given.
  let pre = 0;
  let suf = 0;
  if (!weightA) {
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);
  const middle =
    aMid.length * bMid.length <= LCS_DP_CELLS_MAX
      ? lcsWeighted(aMid, bMid, (i) => weightA?.(i + pre) ?? 0)
      : matchesMyers(aMid, bMid, (x, y) => x === y);
  for (const [i, j] of middle) pairs.push([i + pre, j + pre]);
  for (let k = suf; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return pairs;
}

/** Matched index pairs of a Myers shortest edit script, in order. */
function matchesMyers<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK];
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  return pairs.reverse();
}

/** Weighted LCS by dynamic programming (ties broken toward heavier `a` elements, then deterministically). */
function lcsWeighted(
  a: readonly string[],
  b: readonly string[],
  weight: (i: number) => number,
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const score = new Float64Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const skip = Math.max(score[at(i + 1, j)], score[at(i, j + 1)]);
      const take = a[i] === b[j] ? score[at(i + 1, j + 1)] + 1 + LCS_WEIGHT_BONUS * weight(i) : -1;
      score[at(i, j)] = Math.max(skip, take);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && score[at(i, j)] === score[at(i + 1, j + 1)] + 1 + LCS_WEIGHT_BONUS * weight(i)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (score[at(i + 1, j)] >= score[at(i, j + 1)]) i++;
    else j++;
  }
  return pairs;
}

/** Turns ordered matched pairs into the changed regions between them. */
function hunksFromMatches(pairs: ReadonlyArray<[number, number]>, n: number, m: number): Hunk[] {
  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  for (const [i, j] of [...pairs, [n, m] as [number, number]]) {
    if (i > ai || j > bi) hunks.push({ aEnd: i, aStart: ai, bEnd: j, bStart: bi });
    ai = i + 1;
    bi = j + 1;
  }
  return hunks;
}
