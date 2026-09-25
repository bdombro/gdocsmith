/* Compares two DocModels under the equality contract the emulator self-check and differential tests rely on (see G3 D14). */

import { styleEqual, styleFieldsChanged } from "./styleValues.ts";
import type {
  Atom,
  AtomCreate,
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
  /** Identity (`headingId`) moves the reconciler performed; the paragraph at a transfer's `toKey` is expected to carry its id. */
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
  styleCompare(path, "documentStyle", expected.documentStyle, actual.documentStyle, diffs);
  styleCompare(path, "leadingSectionStyle", expected.leadingSectionStyle, actual.leadingSectionStyle, diffs);
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
    styleCompare(path, "sectionStyle", expected.sectionStyle, actual.sectionStyle, diffs);
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
  styleCompare(path, "style", paragraphStyleDefaulted(expected.style), paragraphStyleDefaulted(actual.style), diffs);
  headingIdCompare(path, expected, actual, opts, diffs);
  bulletCompare(path, expected.bullet, actual.bullet, diffs);
  styleCompare(path, "newline style", expected.newline.style, actual.newline.style, diffs);
  if (expected.inlines.length !== actual.inlines.length) {
    diffs.push(`${path}: inline count expected ${expected.inlines.length}, got ${actual.inlines.length}`);
    return;
  }
  expected.inlines.forEach((inline, i) => {
    inlineCompare(`${path} inline ${i}`, inline, actual.inlines[i], diffs);
  });
}

/** Compares `headingId`: a paragraph an identity transfer lands on must carry the transferred id; a kept heading must keep its own; a brand-new heading needs *some* id; a non-heading needs none. */
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
  // A reported transfer says which id this paragraph ends up with (e.g. a reused newline's).
  const transfer = opts.identityTransfers?.find((t) => t.toKey === expected.key && t.headingId);
  if (transfer) {
    if (actual.headingId !== transfer.headingId) {
      diffs.push(`${path}: headingId expected "${transfer.headingId}" (transferred), got "${actual.headingId}"`);
    }
    return;
  }
  // A new heading, or one the model just made a heading, gets whatever id the API mints.
  if (expected.key.startsWith("n") || !expected.headingId) {
    if (!actual.headingId) diffs.push(`${path}: new heading paragraph has no headingId`);
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
    styleCompare(path, "style", expected.style, actual.style, diffs);
    return;
  }
  if (expected.kind !== "atom" || actual.kind !== "atom") return;
  if (expected.type !== actual.type) diffs.push(`${path}: atom type expected "${expected.type}", got "${actual.type}"`);
  if (expected.create) {
    if (!atomCreateMatches(expected.create, actual)) diffs.push(`${path}: atom create fields differ`);
    return;
  }
  styleCompare(path, "atom payload", expected.raw ?? {}, actual.raw ?? {}, diffs);
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
  } else {
    expected.columns.forEach((column, i) => {
      styleCompare(`${path} column ${i}`, "props", column.props, actual.columns[i].props, diffs);
    });
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
  styleCompare(path, "style", expected.style, actual.style, diffs);
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
  styleCompare(path, "style", expected.style, actual.style, diffs);
  if (expected.blocks.length !== actual.blocks.length) {
    diffs.push(`${path}: paragraph count expected ${expected.blocks.length}, got ${actual.blocks.length}`);
    return;
  }
  expected.blocks.forEach((p, i) => {
    paragraphCompare(`${path} paragraph ${i}`, p, actual.blocks[i], opts, diffs);
  });
}

/** Pushes `<path>: <label> differs (<fields>)` when two style objects aren't equal, naming the top-level fields that differ. */
function styleCompare(path: string, label: string, expected: object, actual: object, diffs: string[]): void {
  if (styleEqual(expected, actual)) return;
  const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const changed = styleFieldsChanged(expected as Record<string, unknown>, actual as Record<string, unknown>, fields);
  diffs.push(`${path}: ${label} differs (${changed.join(", ")})`);
}

/** A paragraph style with the fields the API always reads back filled in (`namedStyleType` NORMAL_TEXT, `direction` LEFT_TO_RIGHT), so a sparse model compares equal. */
function paragraphStyleDefaulted(style: Record<string, unknown>): Record<string, unknown> {
  return { direction: "LEFT_TO_RIGHT", namedStyleType: "NORMAL_TEXT", ...style };
}

/** True when an atom read back from the API is what `create` asked for (ids and server-filled fields ignored; images match by type, since their source lives in `inlineObjects`). */
function atomCreateMatches(create: AtomCreate, actual: Atom): boolean {
  if (actual.create) return styleEqual(create, actual.create);
  const raw = (actual.raw ?? {}) as Record<string, Record<string, Record<string, unknown> | undefined> | undefined>;
  switch (create.type) {
    case "person":
      return raw.person?.personProperties?.email === create.email;
    case "date":
      return raw.dateElement?.dateElementProperties?.timestamp === create.timestamp;
    case "richLink":
      return raw.richLink?.richLinkProperties?.uri === create.uri;
    default:
      return actual.type === create.type;
  }
}
