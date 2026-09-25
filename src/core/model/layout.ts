/* Computes Docs API JSON index spans from the content model (see G3 D11: paragraph/table/TOC/section-break length rules). */

import type { Block, CellModel, ParagraphBlock, Range, RowModel, TableBlock, TabModel } from "./types.ts";

/** Every computed index range for a tab: top-level and nested (cell) blocks, table rows, table cells, and where each cell's content starts. */
export interface Layout {
  /** Block key -> JSON index range, including blocks nested inside table cells. */ blockRanges: Map<string, Range>;
  /** Table cell key -> the index its content (first child block) starts at. */ cellContentStart: Map<string, number>;
  /** Table cell key -> JSON index range (cell marker through its last child block). */ cellRanges: Map<string, Range>;
  /** Table row key -> JSON index range (row marker through its last cell). */ rowRanges: Map<string, Range>;
}

/** JSON index-span length of a single paragraph: its inline content plus one for the trailing newline. */
export function paragraphLength(
  /** Paragraph to measure. */
  p: ParagraphBlock,
): number {
  let len = 1;
  for (const inline of p.inlines) len += inline.kind === "text" ? inline.text.length : inline.length;
  return len;
}

/** JSON index-span length of a single content block (paragraph, table, TOC, or section break). */
export function blockLength(
  /** Block to measure. */
  block: Block,
): number {
  switch (block.kind) {
    case "paragraph":
      return paragraphLength(block);
    case "sectionBreak":
      return 1;
    case "table":
      return tableLength(block);
    case "toc":
      return block.length;
  }
}

/** Total JSON index-span length of a sequence of sibling blocks (a tab body or a table cell). */
export function containerLength(
  /** Blocks in document order. */
  blocks: readonly Block[],
): number {
  return blocks.reduce((sum, block) => sum + blockLength(block), 0);
}

/**
 * Computes the real JSON index range of every block (including ones nested inside table cells),
 * table row, and table cell in a tab, plus where each cell's content begins. The tab body starts
 * at index 1 (the leading section break always occupies `[0, 1)`, see G3 F1/D11).
 */
export function layoutCompute(
  /** Tab to lay out. */
  tab: TabModel,
): Layout {
  const layout: Layout = {
    blockRanges: new Map(),
    cellContentStart: new Map(),
    cellRanges: new Map(),
    rowRanges: new Map(),
  };
  let index = 1;
  for (const block of tab.blocks) index = layoutBlock(block, index, layout);
  return layout;
}

/** Lays out one block starting at `start`, recording its range (and any nested ranges), and returns the index right after it. */
function layoutBlock(
  /** Block to lay out. */
  block: Block,
  /** Index the block starts at. */
  start: number,
  /** Layout accumulator, mutated in place. */
  layout: Layout,
): number {
  if (block.kind !== "table") {
    const end = start + blockLength(block);
    layout.blockRanges.set(block.key, { end, start });
    return end;
  }
  let index = start + 1;
  for (const row of block.rows) index = layoutRow(row, index, layout);
  index += 1;
  layout.blockRanges.set(block.key, { end: index, start });
  return index;
}

/** Lays out one table row starting at `start`, recording its and its cells' ranges, and returns the index right after it. */
function layoutRow(
  /** Row to lay out. */
  row: RowModel,
  /** Index the row starts at (its row marker). */
  start: number,
  /** Layout accumulator, mutated in place. */
  layout: Layout,
): number {
  let index = start + 1;
  for (const cell of row.cells) index = layoutCell(cell, index, layout);
  layout.rowRanges.set(row.key, { end: index, start });
  return index;
}

/** Lays out one table cell starting at `start`, recording its content-start index and its and its blocks' ranges. */
function layoutCell(
  /** Cell to lay out. */
  cell: CellModel,
  /** Index the cell starts at (its cell marker). */
  start: number,
  /** Layout accumulator, mutated in place. */
  layout: Layout,
): number {
  let index = start + 1;
  layout.cellContentStart.set(cell.key, index);
  for (const block of cell.blocks) index = layoutBlock(block, index, layout);
  layout.cellRanges.set(cell.key, { end: index, start });
  return index;
}

/** JSON index-span length of a table: start/end markers, each row's marker, and each cell's marker plus content. */
function tableLength(table: TableBlock): number {
  let len = 2;
  for (const row of table.rows) {
    len += 1;
    for (const cell of row.cells) len += 1 + containerLength(cell.blocks);
  }
  return len;
}
