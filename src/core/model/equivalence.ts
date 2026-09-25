/* Compares two DocModels under the equality contract the emulator self-check and differential tests rely on (see G3 D14). */

import { styleEqual } from "./styleValues.ts";
import type {
  Block,
  CellModel,
  DocModel,
  IdentityTransfer,
  Inline,
  ParagraphBlock,
  RowModel,
  TableBlock,
  TabModel,
} from "./types.ts";

/** Options narrowing what `docModelsCompare` treats as equal despite a literal difference. */
export interface CompareOptions {
  /** Identity (`headingId`) moves the reconciler performed; a kept heading is expected at its transfer's `toKey`, not its original key. */
  identityTransfers?: readonly IdentityTransfer[];
  /** Maps an "expected" (pre-flush) tab id to the "actual" (post-flush) tab id it corresponds to, when a doc/tab was newly created. */
  tabIdMap?: ReadonlyMap<string, string>;
}

/** Result of comparing two `DocModel`s. */
export interface CompareResult {
  /** One human-readable message per difference found (empty when equal). */ diffs: string[];
  /** True when no differences were found. */ equal: boolean;
}

/**
 * Compares two `DocModel`s under G3's equivalence contract: structure and content must match, but
 * revision ids, named ranges, and the concrete id values of anything newly created are ignored
 * (see G3 D14). Order matters: `expected` is the reference, `actual` is what's being checked
 * against it.
 */
export function docModelsCompare(
  /** Reference model. */
  expected: DocModel,
  /** Model being checked. */
  actual: DocModel,
  /** Narrowing options (identity transfers, tab id remapping). */
  opts: CompareOptions = {},
): CompareResult {
  const diffs: string[] = [];
  if (expected.tabs.length !== actual.tabs.length) {
    diffs.push(`tab count: expected ${expected.tabs.length}, got ${actual.tabs.length}`);
    return { diffs, equal: false };
  }
  expected.tabs.forEach((tab, i) => {
    tabCompare(tab, actual.tabs[i], opts, diffs);
  });
  return { diffs, equal: diffs.length === 0 };
}

/** Compares one pair of corresponding tabs. */
function tabCompare(expected: TabModel, actual: TabModel, opts: CompareOptions, diffs: string[]): void {
  const path = `tab "${expected.title}"`;
  if (expected.title !== actual.title) diffs.push(`${path}: title expected "${expected.title}", got "${actual.title}"`);
  const expectedParent = expected.parentTabId
    ? (opts.tabIdMap?.get(expected.parentTabId) ?? expected.parentTabId)
    : undefined;
  if (expectedParent !== actual.parentTabId) {
    diffs.push(`${path}: parentTabId expected ${expectedParent}, got ${actual.parentTabId}`);
  }
  if (!styleEqual(expected.documentStyle, actual.documentStyle)) diffs.push(`${path}: documentStyle differs`);
  if (expected.blocks.length !== actual.blocks.length) {
    diffs.push(`${path}: block count expected ${expected.blocks.length}, got ${actual.blocks.length}`);
    return;
  }
  expected.blocks.forEach((block, i) => {
    blockCompare(`${path} block ${i}`, block, actual.blocks[i], opts, diffs);
  });
}

/** Compares one pair of corresponding blocks (must share the same `kind`). */
function blockCompare(path: string, expected: Block, actual: Block, opts: CompareOptions, diffs: string[]): void {
  if (expected.kind !== actual.kind) {
    diffs.push(`${path}: kind expected "${expected.kind}", got "${actual.kind}"`);
    return;
  }
  if (expected.kind === "paragraph" && actual.kind === "paragraph") {
    paragraphCompare(path, expected, actual, opts, diffs);
  } else if (expected.kind === "table" && actual.kind === "table") {
    tableCompare(path, expected, actual, opts, diffs);
  } else if (expected.kind === "toc" && actual.kind === "toc") {
    if (!styleEqual(expected.raw, actual.raw)) diffs.push(`${path}: TOC content differs`);
  } else if (expected.kind === "sectionBreak" && actual.kind === "sectionBreak") {
    if (!styleEqual(expected.sectionStyle, actual.sectionStyle)) diffs.push(`${path}: sectionStyle differs`);
  }
}

/** Compares one pair of corresponding paragraphs: style (minus `headingId`), `headingId`, bullet, newline, and inline content. */
function paragraphCompare(
  path: string,
  expected: ParagraphBlock,
  actual: ParagraphBlock,
  opts: CompareOptions,
  diffs: string[],
): void {
  if (!styleEqual(expected.style, actual.style)) diffs.push(`${path}: style differs`);
  headingIdCompare(path, expected, actual, opts, diffs);
  bulletCompare(path, expected.bullet, actual.bullet, diffs);
  if (!styleEqual(expected.newline.style, actual.newline.style)) {
    diffs.push(`${path}: newline style differs`);
  }
  if (expected.inlines.length !== actual.inlines.length) {
    diffs.push(`${path}: inline count expected ${expected.inlines.length}, got ${actual.inlines.length}`);
    return;
  }
  expected.inlines.forEach((inline, i) => {
    inlineCompare(`${path} inline ${i}`, inline, actual.inlines[i], diffs);
  });
}

/** Compares `headingId`: a kept heading must keep its id (after identity transfers); a brand-new heading needs *some* id; a non-heading needs none. */
function headingIdCompare(
  path: string,
  expected: ParagraphBlock,
  actual: ParagraphBlock,
  opts: CompareOptions,
  diffs: string[],
): void {
  const isHeading =
    typeof expected.style.namedStyleType === "string" && expected.style.namedStyleType !== "NORMAL_TEXT";
  if (!isHeading) {
    if (actual.headingId) diffs.push(`${path}: expected no headingId, got "${actual.headingId}"`);
    return;
  }
  if (expected.key.startsWith("n")) {
    if (!actual.headingId) diffs.push(`${path}: new heading paragraph has no headingId`);
    return;
  }
  const transfer = opts.identityTransfers?.find((t) => t.fromKey === expected.key);
  if (transfer) {
    if (actual.headingId !== transfer.headingId) {
      diffs.push(`${path}: headingId expected "${transfer.headingId}" (transferred), got "${actual.headingId}"`);
    }
    return;
  }
  if (expected.headingId !== actual.headingId) {
    diffs.push(`${path}: headingId expected "${expected.headingId}", got "${actual.headingId}"`);
  }
}

/** Compares bullet membership: nesting must match exactly; `listId` must match exactly unless both lists are newly created ("up to renaming", see G3 D14). */
function bulletCompare(
  path: string,
  expected: ParagraphBlock["bullet"],
  actual: ParagraphBlock["bullet"],
  diffs: string[],
): void {
  if (!expected && !actual) return;
  if (!expected || !actual) {
    diffs.push(`${path}: bullet expected ${expected ? "present" : "absent"}, got ${actual ? "present" : "absent"}`);
    return;
  }
  if (expected.nestingLevel !== actual.nestingLevel) {
    diffs.push(`${path}: bullet nestingLevel expected ${expected.nestingLevel}, got ${actual.nestingLevel}`);
  }
  const listsRenamed = expected.listId.startsWith("new:") || actual.listId.startsWith("new:");
  if (!listsRenamed && expected.listId !== actual.listId) {
    diffs.push(`${path}: bullet listId expected "${expected.listId}", got "${actual.listId}"`);
  }
}

/** Compares one pair of corresponding inlines (text run or atom). */
function inlineCompare(path: string, expected: Inline, actual: Inline, diffs: string[]): void {
  if (expected.kind !== actual.kind) {
    diffs.push(`${path}: kind expected "${expected.kind}", got "${actual.kind}"`);
    return;
  }
  if (expected.kind === "text" && actual.kind === "text") {
    if (expected.text !== actual.text) diffs.push(`${path}: text expected "${expected.text}", got "${actual.text}"`);
    if (!styleEqual(expected.style, actual.style)) diffs.push(`${path}: style differs`);
    return;
  }
  if (expected.kind !== "atom" || actual.kind !== "atom") return;
  if (expected.type !== actual.type) diffs.push(`${path}: atom type expected "${expected.type}", got "${actual.type}"`);
  if (expected.create) {
    if (!styleEqual(expected.create, actual.create)) diffs.push(`${path}: atom create fields differ`);
    return;
  }
  if (!styleEqual(expected.raw, actual.raw)) diffs.push(`${path}: atom payload differs`);
}

/** Compares one pair of corresponding tables: row/column count, row/cell style, and cell content. */
function tableCompare(
  path: string,
  expected: TableBlock,
  actual: TableBlock,
  opts: CompareOptions,
  diffs: string[],
): void {
  if (expected.columns.length !== actual.columns.length) {
    diffs.push(`${path}: column count expected ${expected.columns.length}, got ${actual.columns.length}`);
  }
  if (expected.rows.length !== actual.rows.length) {
    diffs.push(`${path}: row count expected ${expected.rows.length}, got ${actual.rows.length}`);
    return;
  }
  expected.rows.forEach((row, i) => {
    rowCompare(`${path} row ${i}`, row, actual.rows[i], opts, diffs);
  });
}

/** Compares one pair of corresponding rows: style and cell contents. */
function rowCompare(path: string, expected: RowModel, actual: RowModel, opts: CompareOptions, diffs: string[]): void {
  if (!styleEqual(expected.style, actual.style)) diffs.push(`${path}: style differs`);
  if (expected.cells.length !== actual.cells.length) {
    diffs.push(`${path}: cell count expected ${expected.cells.length}, got ${actual.cells.length}`);
    return;
  }
  expected.cells.forEach((cell, i) => {
    cellCompare(`${path} cell ${i}`, cell, actual.cells[i], opts, diffs);
  });
}

/** Compares one pair of corresponding cells: style and paragraph content. */
function cellCompare(
  path: string,
  expected: CellModel,
  actual: CellModel,
  opts: CompareOptions,
  diffs: string[],
): void {
  if (!styleEqual(expected.style, actual.style)) diffs.push(`${path}: style differs`);
  if (expected.blocks.length !== actual.blocks.length) {
    diffs.push(`${path}: paragraph count expected ${expected.blocks.length}, got ${actual.blocks.length}`);
    return;
  }
  expected.blocks.forEach((p, i) => {
    paragraphCompare(`${path} paragraph ${i}`, p, actual.blocks[i], opts, diffs);
  });
}
