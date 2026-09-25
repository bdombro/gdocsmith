/* Line-based unified diff text (the `diff -u` format) for showing what a run changed (see G3 M6). */

import { diffHunks, type Hunk } from "./myers.ts";

/** Options for `unifiedDiffFormat`. */
export interface UnifiedDiffOptions {
  /** Unchanged lines shown around each change (default 3). */ context?: number;
  /** Path shown on the `+++` line. */ newPath: string;
  /** Path shown on the `---` line. */ oldPath: string;
}

/** Formats a unified diff from `oldText` to `newText`; `""` when they're equal. */
export function unifiedDiffFormat(
  /** Original text. */
  oldText: string,
  /** Final text. */
  newText: string,
  /** Header paths and context size. */
  opts: UnifiedDiffOptions,
): string {
  if (oldText === newText) return "";
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  const context = opts.context ?? 3;
  const groups = hunksGroup(diffHunks(a, b), context);
  const out = [`--- ${opts.oldPath}`, `+++ ${opts.newPath}`];
  for (const group of groups) {
    const aStart = Math.max(0, group[0].aStart - context);
    const bStart = Math.max(0, group[0].bStart - context);
    const last = group[group.length - 1];
    const aEnd = Math.min(a.length, last.aEnd + context);
    const bEnd = Math.min(b.length, last.bEnd + context);
    out.push(`@@ -${rangeLabel(aStart, aEnd - aStart)} +${rangeLabel(bStart, bEnd - bStart)} @@`);
    let ai = aStart;
    for (const hunk of group) {
      while (ai < hunk.aStart) out.push(` ${a[ai++]}`);
      for (let i = hunk.aStart; i < hunk.aEnd; i++) out.push(`-${a[i]}`);
      for (let j = hunk.bStart; j < hunk.bEnd; j++) out.push(`+${b[j]}`);
      ai = hunk.aEnd;
    }
    while (ai < aEnd) out.push(` ${a[ai++]}`);
  }
  return out.join("\n");
}

/** Groups hunks whose context windows would touch (fewer than `2 · context` unchanged lines apart). */
function hunksGroup(hunks: Hunk[], context: number): Hunk[][] {
  const groups: Hunk[][] = [];
  for (const hunk of hunks) {
    const last = groups.at(-1)?.at(-1);
    if (last && hunk.aStart - last.aEnd <= 2 * context) groups[groups.length - 1].push(hunk);
    else groups.push([hunk]);
  }
  return groups;
}

/** `start,count` with 1-based start, per the unified format (an empty range names the line before it). */
function rangeLabel(start: number, count: number): string {
  return `${count === 0 ? start : start + 1},${count}`;
}
