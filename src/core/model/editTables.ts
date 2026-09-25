/* Model editing primitives B (structure): tables, section breaks, and page-break paragraphs (G3 D10, D20, M7). */

import {
  MERGED_ROW_MIN_HEIGHT,
  SECTION_STYLE_DEFAULT,
  TABLE_CELL_PARAGRAPH_STYLE_DEFAULT,
  TABLE_CELL_STYLE_DEFAULT,
  TABLE_ROW_STYLE_DEFAULT,
  tableColumnPropertiesDefault,
} from "./apiFacts.ts";
import { blockFind, type EditTarget, type SymSpec, stylePatchApply, symbolsFromSpecs } from "./edit.ts";
import { CoreError } from "./errors.ts";
import { containerNormalize, paragraphEmptyCreate } from "./invariants.ts";
import type { JsonObject } from "./rawJson.ts";
import { paragraphSymbolsSet } from "./symbols.ts";
import type { Block, CellModel, ParagraphBlock, RowModel, SectionBreakBlock, TableBlock } from "./types.ts";

/** A rectangle of cells. */
export interface CellRange {
  /** Top-left column. */ column: number;
  /** Columns covered (default 1). */ columnSpan?: number;
  /** Top-left row. */ row: number;
  /** Rows covered (default 1). */ rowSpan?: number;
}

/** Content and column alignment for a new table. */
export interface TableSpec {
  /** Per-column paragraph alignment (e.g. from a GFM table). */ alignments?: Array<
    "CENTER" | "END" | "START" | undefined
  >;
  /** Rows × cells × the cell paragraph's symbols. */ rows: SymSpec[][][];
}

/**
 * Creates a table at body index `index` with the API's explicit defaults (F13), and returns its key.
 * A new table must follow a new paragraph without a page break (S1), so one is inserted before it
 * when needed; the body is then normalized (V1).
 */
export function tableCreate(
  /** Tab being edited. */
  target: EditTarget,
  /** Body index to insert at. */
  index: number,
  /** Content. */
  spec: TableSpec,
): string {
  const columnCount = Math.max(...spec.rows.map((r) => r.length));
  if (!spec.rows.length || columnCount < 1) throw new CoreError("internal", "a table needs at least one cell");
  const { keys } = target.ctx;
  const table: TableBlock = {
    columns: tableColumnPropertiesDefault(columnCount).map((props) => ({ key: keys.next("n"), props })),
    key: keys.next("n"),
    kind: "table",
    protected: false,
    rows: spec.rows.map((cells) => ({
      cells: Array.from({ length: columnCount }, (_, c) => {
        const style = spec.alignments?.[c] ? { alignment: spec.alignments[c] } : {};
        return cellCreate(target, { ...TABLE_CELL_STYLE_DEFAULT }, style, cells[c] ?? []);
      }),
      key: keys.next("n"),
      style: structuredClone(TABLE_ROW_STYLE_DEFAULT),
    })),
    stamp: target.ctx.stamp,
  };
  structureInsert(target, index, table);
  return table.key;
}

/** Inserts `count` rows at `at`, copying the row above's (or, at 0, the row below's) row, cell, and cell-paragraph styles (F20). */
export function rowsInsert(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Row index the first new row gets. */
  at: number,
  /** How many rows. */
  count: number,
): string[] {
  const table = tableRequire(target, tableKey);
  const ref = table.rows[at - 1] ?? table.rows[at];
  if (!ref || at < 0 || at > table.rows.length) throw new CoreError("internal", `row index ${at} is out of range`);
  const rows: RowModel[] = Array.from({ length: count }, () => ({
    cells: ref.cells.map((cell) => cellLike(target, cell)),
    key: target.ctx.keys.next("n"),
    style: structuredClone(ref.style),
  }));
  table.rows.splice(at, 0, ...rows);
  table.stamp = target.ctx.stamp;
  return rows.map((r) => r.key);
}

/** Deletes rows (tombstoning their atoms); deleting every row is refused (delete the table instead). */
export function rowsDelete(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Row indices. */
  rows: readonly number[],
): void {
  const table = tableRequire(target, tableKey);
  const doomed = new Set(rows);
  if (doomed.size >= table.rows.length)
    throw new CoreError("internal", "deleting every row deletes the table; use blocksDelete");
  for (const r of doomed) {
    if (!table.rows[r]) throw new CoreError("internal", `row ${r} does not exist`);
    for (const cell of table.rows[r].cells) cellTombstonesAdd(target, cell);
  }
  table.rows = table.rows.filter((_, r) => !doomed.has(r));
  table.stamp = target.ctx.stamp;
}

/** Inserts `count` columns at `at`, copying the column to the left's (or, at 0, the right's) properties and each row's cell styles (F20). */
export function columnsInsert(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Column index the first new column gets. */
  at: number,
  /** How many columns. */
  count: number,
): void {
  const table = tableRequire(target, tableKey);
  const refIndex = at > 0 ? at - 1 : 0;
  if (at < 0 || at > table.columns.length) throw new CoreError("internal", `column index ${at} is out of range`);
  const columns = Array.from({ length: count }, () => ({
    key: target.ctx.keys.next("n"),
    props: structuredClone(table.columns[refIndex]?.props ?? {}),
  }));
  table.columns.splice(at, 0, ...columns);
  for (const row of table.rows) {
    const ref = row.cells[refIndex];
    row.cells.splice(at, 0, ...Array.from({ length: count }, () => cellLike(target, ref)));
  }
  table.stamp = target.ctx.stamp;
}

/** Deletes columns (tombstoning their atoms); deleting every column is refused (delete the table instead). */
export function columnsDelete(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Column indices. */
  columns: readonly number[],
): void {
  const table = tableRequire(target, tableKey);
  const doomed = new Set(columns);
  if (doomed.size >= table.columns.length) {
    throw new CoreError("internal", "deleting every column deletes the table; use blocksDelete");
  }
  for (const row of table.rows) {
    for (const c of doomed) if (row.cells[c]) cellTombstonesAdd(target, row.cells[c]);
    row.cells = row.cells.filter((_, c) => !doomed.has(c));
  }
  table.columns = table.columns.filter((_, c) => !doomed.has(c));
  table.stamp = target.ctx.stamp;
}

/** Merges a rectangle into its top-left cell; every other cell must be blank (one empty, unbulleted NORMAL_TEXT paragraph; `mergeNonEmpty`, D20). Merged rows get the API's 21pt minimum height (F21). */
export function cellsMerge(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Rectangle to merge. */
  range: CellRange,
): void {
  const table = tableRequire(target, tableKey);
  const cells = rangeCells(table, range);
  if (cells.length < 2) throw new CoreError("internal", "a merge needs at least two cells");
  for (const { cell } of cells.slice(1)) {
    const [only] = cell.blocks;
    const namedStyleType = (only?.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
    const blank =
      cell.blocks.length === 1 && only.inlines.length === 0 && !only.bullet && namedStyleType === "NORMAL_TEXT";
    if (!blank) {
      throw new CoreError(
        "mergeNonEmpty",
        "only the top-left cell of a merge may have content; empty the others first",
      );
    }
  }
  const head = cells[0].cell;
  head.style = { ...head.style, columnSpan: range.columnSpan ?? 1, rowSpan: range.rowSpan ?? 1 };
  for (let r = range.row; r < range.row + (range.rowSpan ?? 1); r++) {
    table.rows[r].style = { ...table.rows[r].style, minRowHeight: structuredClone(MERGED_ROW_MIN_HEIGHT) };
  }
  table.stamp = target.ctx.stamp;
}

/** Unmerges a merged cell (explicit 1×1 spans, F21; content stays in the head cell). */
export function cellsUnmerge(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** The merged head cell. */
  range: CellRange,
): void {
  const table = tableRequire(target, tableKey);
  const head = rangeCells(table, { column: range.column, row: range.row })[0].cell;
  head.style = { ...head.style, columnSpan: 1, rowSpan: 1 };
  table.stamp = target.ctx.stamp;
}

/** Patches one column's properties (`null` resets a field). */
export function columnPropsSet(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Column index. */
  column: number,
  /** Fields to set. */
  patch: JsonObject,
): void {
  const table = tableRequire(target, tableKey);
  const col = table.columns[column];
  if (!col) throw new CoreError("internal", `column ${column} does not exist`);
  col.props = stylePatchApply(col.props, patch);
  table.stamp = target.ctx.stamp;
}

/** Patches the style of every cell in a rectangle (`null` resets a field). */
export function cellStyleSet(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Cells to style. */
  range: CellRange,
  /** Fields to set. */
  patch: JsonObject,
): void {
  const table = tableRequire(target, tableKey);
  for (const { cell } of rangeCells(table, range)) cell.style = stylePatchApply(cell.style, patch);
  table.stamp = target.ctx.stamp;
}

/** Patches rows' styles (`null` resets a field). */
export function rowStyleSet(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Row indices. */
  rows: readonly number[],
  /** Fields to set. */
  patch: JsonObject,
): void {
  const table = tableRequire(target, tableKey);
  for (const r of rows) {
    if (!table.rows[r]) throw new CoreError("internal", `row ${r} does not exist`);
    table.rows[r].style = stylePatchApply(table.rows[r].style, patch);
  }
  table.stamp = target.ctx.stamp;
}

/** Makes the first `count` rows repeat as a header on every page (`tableHeader`, F27). */
export function headerRowsPin(
  /** Tab being edited. */
  target: EditTarget,
  /** Table key. */
  tableKey: string,
  /** Header row count. */
  count: number,
): void {
  const table = tableRequire(target, tableKey);
  table.rows.forEach((row, r) => {
    row.style = stylePatchApply(row.style, { tableHeader: r < count ? true : null });
  });
  table.stamp = target.ctx.stamp;
}

/** Inserts a new section break at body index `index` with the API's default style (F15), after a new paragraph (S1); returns its key. */
export function sectionBreakInsert(
  /** Tab being edited. */
  target: EditTarget,
  /** Body index to insert at. */
  index: number,
  /** Section type. */
  sectionType: "CONTINUOUS" | "NEXT_PAGE",
): string {
  const block: SectionBreakBlock = {
    create: { sectionType },
    key: target.ctx.keys.next("n"),
    kind: "sectionBreak",
    sectionStyle: { ...SECTION_STYLE_DEFAULT, sectionType },
  };
  structureInsert(target, index, block);
  return block.key;
}

/** Inserts a paragraph holding only a page break at body index `index` (P1: page breaks exist only as their own paragraphs); returns its key. */
export function pageBreakParagraphInsert(
  /** Tab being edited. */
  target: EditTarget,
  /** Body index to insert at. */
  index: number,
): string {
  if (index < 0 || index > target.tab.blocks.length)
    throw new CoreError("internal", `insert index ${index} is out of range`);
  const paragraph = paragraphEmptyCreate(target.ctx.keys, {}, target.ctx.stamp);
  paragraph.inlines = [
    { create: { type: "pageBreak" }, key: target.ctx.keys.next("n"), kind: "atom", length: 1, type: "pageBreak" },
  ];
  target.tab.blocks.splice(index, 0, paragraph);
  target.tab.blocks = containerNormalize(target.tab.blocks, target.ctx.keys, target.ctx.stamp);
  return paragraph.key;
}

/** Inserts a table or section break into the body, first adding a new empty paragraph when the block before isn't a new paragraph without a page break (S1). */
function structureInsert(target: EditTarget, index: number, block: Block): void {
  const blocks = target.tab.blocks;
  if (index < 0 || index > blocks.length) throw new CoreError("internal", `insert index ${index} is out of range`);
  const prev = blocks[index - 1];
  const prevOk =
    prev?.kind === "paragraph" &&
    prev.key.startsWith("n") &&
    !prev.inlines.some((i) => i.kind === "atom" && i.type === "pageBreak");
  const inserted: Block[] = prevOk ? [block] : [paragraphEmptyCreate(target.ctx.keys, {}, target.ctx.stamp), block];
  blocks.splice(index, 0, ...inserted);
  target.tab.blocks = containerNormalize(blocks, target.ctx.keys, target.ctx.stamp);
}

/** A new cell with one paragraph. */
function cellCreate(
  target: EditTarget,
  cellStyle: JsonObject,
  paragraphStyle: JsonObject,
  syms: readonly SymSpec[],
): CellModel {
  const paragraph = paragraphEmptyCreate(
    target.ctx.keys,
    { ...structuredClone(TABLE_CELL_PARAGRAPH_STYLE_DEFAULT), ...paragraphStyle },
    target.ctx.stamp,
  );
  paragraphSymbolsSet(paragraph, symbolsFromSpecs(target.ctx, syms, {}));
  return { blocks: [paragraph], key: target.ctx.keys.next("n"), style: cellStyle };
}

/** A new empty cell styled like `ref` (cell style and its last paragraph's style, F20). */
function cellLike(target: EditTarget, ref: CellModel | undefined): CellModel {
  const paragraphStyle = ref?.blocks.at(-1)?.style ?? TABLE_CELL_PARAGRAPH_STYLE_DEFAULT;
  return cellCreate(
    target,
    // A new cell is never merged, whatever its reference is (F20 copies the rest of the style).
    { ...structuredClone(ref?.style ?? TABLE_CELL_STYLE_DEFAULT), columnSpan: 1, rowSpan: 1 },
    structuredClone(paragraphStyle),
    [],
  );
}

/** The table with `key` (body level), or a `CoreError`. */
function tableRequire(target: EditTarget, key: string): TableBlock {
  const found = blockFind(target.tab, key);
  if (found?.block.kind !== "table") throw new CoreError("internal", `no table with key ${key}`);
  return found.block;
}

/** Cells of a rectangle in reading order, or a `CoreError` when it leaves the table. */
function rangeCells(table: TableBlock, range: CellRange): Array<{ cell: CellModel; column: number; row: number }> {
  const out: Array<{ cell: CellModel; column: number; row: number }> = [];
  for (let r = range.row; r < range.row + (range.rowSpan ?? 1); r++) {
    for (let c = range.column; c < range.column + (range.columnSpan ?? 1); c++) {
      const cell = table.rows[r]?.cells[c];
      if (!cell) throw new CoreError("internal", `cell ${r},${c} does not exist`);
      out.push({ cell, column: c, row: r });
    }
  }
  return out;
}

/** Tombstones every atom in a deleted cell. */
function cellTombstonesAdd(target: EditTarget, cell: CellModel): void {
  for (const p of cell.blocks as ParagraphBlock[]) {
    for (const inline of p.inlines) {
      if (inline.kind === "atom") {
        target.ctx.tombstones.push({ key: inline.key, kind: "atom", stamp: target.ctx.stamp, tabId: target.tab.tabId });
      }
    }
  }
}
