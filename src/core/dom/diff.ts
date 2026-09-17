/* Minimal LCS unified diff generator for text. */

/**
 * Configuration options for generating unified diffs.
 */
export type UnifiedDiffOptions = {
  /** Number of surrounding context lines to include in hunks. */
  contextLines?: number;
  /** Optional label for new file/target in header. */
  newLabel?: string;
  /** Display path for new file/target. */
  newPath: string;
  /** Optional label for old file/target in header. */
  oldLabel?: string;
  /** Display path for old file/target. */
  oldPath: string;
};

/**
 * Computes unified diff string between oldText and newText.
 */
export function diffUnifiedFormat(
  /** Baseline original text. */
  oldText: string,
  /** Modified target text. */
  newText: string,
  /** Formatting options including headers and paths. */
  opts: UnifiedDiffOptions,
): string {
  if (oldText === newText) return "";

  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];
  const context = opts.contextLines ?? 3;

  const edits = computeLineEdits(oldLines, newLines);
  const hunks = buildHunks(edits, context);

  if (!hunks.length) return "";

  const header = [
    `--- ${opts.oldPath}${opts.oldLabel ? `\t${opts.oldLabel}` : ""}`,
    `+++ ${opts.newPath}${opts.newLabel ? `\t${opts.newLabel}` : ""}`,
  ];

  const hunkStrs = hunks.map((hunk) => {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    const lines = hunk.lines.map((l) => `${l.type}${l.text}`);
    return [hunkHeader, ...lines].join("\n");
  });

  return [...header, ...hunkStrs].join("\n");
}

/**
 * Alias for diffUnifiedFormat.
 */
export const formatUnifiedDiff = diffUnifiedFormat;

type DiffHunk = {
  lines: Array<{ text: string; type: "+" | "-" | " " }>;
  newCount: number;
  newStart: number;
  oldCount: number;
  oldStart: number;
};

type Edit = { text: string; type: "+" | "-" | "=" };

function computeLineEdits(a: string[], b: string[]): Edit[] {
  const N = a.length;
  const M = b.length;

  const dp: number[][] = Array.from({ length: N + 1 }, () => Array(M + 1).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      if (a[i] === b[j]) {
        dp[i + 1]![j + 1] = dp[i]?.[j]! + 1;
      } else {
        dp[i + 1]![j + 1] = Math.max(dp[i + 1]?.[j]!, dp[i]?.[j + 1]!);
      }
    }
  }

  const edits: Edit[] = [];
  let i = N;
  let j = M;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.unshift({ text: a[i - 1]!, type: "=" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]?.[j - 1]! >= dp[i - 1]?.[j]!)) {
      edits.unshift({ text: b[j - 1]!, type: "+" });
      j--;
    } else if (i > 0 && (j === 0 || dp[i]?.[j - 1]! < dp[i - 1]?.[j]!)) {
      edits.unshift({ text: a[i - 1]!, type: "-" });
      i--;
    }
  }
  return edits;
}

function buildHunks(edits: Edit[], context: number): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 1;
  let newLineNum = 1;

  let pendingEquals: Array<{ text: string; type: " " }> = [];

  for (let e = 0; e < edits.length; e++) {
    const edit = edits[e]!;

    if (edit.type === "=") {
      if (!currentHunk) {
        pendingEquals.push({ text: edit.text, type: " " });
        if (pendingEquals.length > context) {
          pendingEquals.shift();
        }
      } else {
        let nextChangeDist = -1;
        for (let k = e; k < edits.length; k++) {
          if (edits[k]?.type !== "=") {
            nextChangeDist = k - e;
            break;
          }
        }

        if (nextChangeDist !== -1 && nextChangeDist <= 2 * context) {
          currentHunk.lines.push({ text: edit.text, type: " " });
          currentHunk.oldCount++;
          currentHunk.newCount++;
        } else {
          currentHunk.lines.push({ text: edit.text, type: " " });
          currentHunk.oldCount++;
          currentHunk.newCount++;
          if (currentHunk.lines.filter((l) => l.type === " ").length >= context) {
            hunks.push(currentHunk);
            currentHunk = null;
            pendingEquals = [{ text: edit.text, type: " " }];
          }
        }
      }
      oldLineNum++;
      newLineNum++;
    } else {
      if (!currentHunk) {
        const leadingContext = pendingEquals.slice(-context);
        const oldStart = oldLineNum - leadingContext.length;
        const newStart = newLineNum - leadingContext.length;
        currentHunk = {
          lines: [...leadingContext],
          newCount: leadingContext.length,
          newStart: Math.max(1, newStart),
          oldCount: leadingContext.length,
          oldStart: Math.max(1, oldStart),
        };
        pendingEquals = [];
      }

      if (edit.type === "-") {
        currentHunk.lines.push({ text: edit.text, type: "-" });
        currentHunk.oldCount++;
        oldLineNum++;
      } else if (edit.type === "+") {
        currentHunk.lines.push({ text: edit.text, type: "+" });
        currentHunk.newCount++;
        newLineNum++;
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}
