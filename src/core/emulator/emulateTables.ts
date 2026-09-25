/* Table structural operations for the emulator: insert/delete rows and columns, merge/unmerge, and cell/row/column style (see G3 M4). */

import {
  MERGE_MOVED_PARAGRAPH_FIELDS,
  MERGED_ROW_MIN_HEIGHT,
  TABLE_CELL_PARAGRAPH_STYLE_DEFAULT,
  TABLE_CELL_STYLE_DEFAULT,
  TABLE_ROW_STYLE_DEFAULT,
  tableColumnPropertiesDefault,
} from "../model/apiFacts.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { applyStyleFields } from "./fieldMask.ts";
import type { TabState, TapeCell } from "./tape.ts";

/** One table cell's tape span. */
interface CellPos {
  /** Exclusive end (the position right after its content, before the next marker). */ end: number;
  /** Position of its `cellStart` marker. */ start: number;
}

/** One table row's tape span and cells. */
interface RowPos {
  /** Cells, in column order. */ cells: CellPos[];
  /** Exclusive end (the position right after its last cell). */ end: number;
  /** Position of its `rowStart` marker. */ start: number;
}

/** A table's rows, resolved from its `tableStart` marker position. */
interface TablePos {
  /** Rows, in order. */ rows: RowPos[];
}

/** Walks a table's tape cells (from its `tableStart` marker) into row/cell spans. */
function tableStructureAt(tape: TapeCell[], tableStart: number): TablePos {
  let i = tableStart + 1;
  const rows: RowPos[] = [];
  while (tape[i]?.t === "rowStart") {
    const rowStart = i;
    i += 1;
    const cells: CellPos[] = [];
    while (tape[i]?.t === "cellStart") {
      const cellStart = i;
      i += 1;
      while (i < tape.length && tape[i].t !== "cellStart" && tape[i].t !== "rowStart" && tape[i].t !== "tableEnd")
        i += 1;
      cells.push({ end: i, start: cellStart });
    }
    rows.push({ cells, end: i, start: rowStart });
  }
  return { rows };
}

/** Inserts a `rows` x `columns` table at `index` (which must be inside a paragraph), splitting that paragraph in two around it; new rows, cells, and cell paragraphs carry the API's explicit defaults (G3 F13). */
export function insertTable(
  tab: TabState,
  index: number,
  rows: number,
  columns: number,
  /** Text style of each new cell's newline. */
  cellTextStyle: JsonObject,
  splitNl: (idx: number) => void,
): void {
  splitNl(index);
  const tableStyle = { tableColumnProperties: tableColumnPropertiesDefault(columns) };
  const cells: TapeCell[] = [{ raw: { columns, rows, tableStyle } as JsonObject, t: "tableStart" }];
  for (let r = 0; r < rows; r++) {
    cells.push({ style: structuredClone(TABLE_ROW_STYLE_DEFAULT), t: "rowStart" });
    for (let c = 0; c < columns; c++) {
      cells.push(
        { style: structuredClone(TABLE_CELL_STYLE_DEFAULT), t: "cellStart" },
        { para: { style: structuredClone(TABLE_CELL_PARAGRAPH_STYLE_DEFAULT) }, style: cellTextStyle, t: "nl" },
      );
    }
  }
  cells.push({ t: "tableEnd" });
  tab.tape.splice(index + 1, 0, ...cells);
}

/** Inserts a new row adjacent to `rowIndex` (below when `insertBelow`), copying the reference row's and each reference cell's style (G3 F20). */
export function insertTableRow(tab: TabState, tableStart: number, rowIndex: number, insertBelow: boolean): void {
  const table = tableStructureAt(tab.tape, tableStart);
  const refRow = table.rows[rowIndex] ?? table.rows.at(-1);
  if (!refRow) throw new Error("table has no rows to insert next to");
  const insertAt = insertBelow ? refRow.end : refRow.start;
  const refRowCell = tab.tape[refRow.start] as Extract<TapeCell, { t: "rowStart" }>;
  const cells: TapeCell[] = [{ style: structuredClone(refRowCell.style), t: "rowStart" }];
  for (const cellPos of refRow.cells) {
    const refCellCell = tab.tape[cellPos.start] as Extract<TapeCell, { t: "cellStart" }>;
    cells.push(
      { style: { ...structuredClone(refCellCell.style), columnSpan: 1, rowSpan: 1 }, t: "cellStart" },
      cellParagraphLike(tab.tape, cellPos),
    );
  }
  tab.tape.splice(insertAt, 0, ...cells);
}

/** Inserts a new column adjacent to `columnIndex` in every row (right when `insertRight`), copying each row's reference cell style (G3 F20). */
export function insertTableColumn(tab: TabState, tableStart: number, columnIndex: number, insertRight: boolean): void {
  const table = tableStructureAt(tab.tape, tableStart);
  for (let r = table.rows.length - 1; r >= 0; r--) {
    const row = table.rows[r];
    const refCellPos = row.cells[columnIndex] ?? row.cells.at(-1);
    if (!refCellPos) continue;
    const insertAt = insertRight ? refCellPos.end : refCellPos.start;
    const refCellCell = tab.tape[refCellPos.start] as Extract<TapeCell, { t: "cellStart" }>;
    tab.tape.splice(
      insertAt,
      0,
      { style: { ...structuredClone(refCellCell.style), columnSpan: 1, rowSpan: 1 }, t: "cellStart" },
      cellParagraphLike(tab.tape, refCellPos),
    );
  }
  tableColumnCountBump(tab, tableStart, 1);
  const raw = (tab.tape[tableStart] as Extract<TapeCell, { t: "tableStart" }>).raw;
  const tableStyle = { ...((raw.tableStyle as JsonObject | undefined) ?? {}) };
  const props = [...((tableStyle.tableColumnProperties as JsonObject[] | undefined) ?? [])];
  if (props.length) {
    const refIndex = Math.min(columnIndex, props.length - 1);
    props.splice(insertRight ? refIndex + 1 : refIndex, 0, structuredClone(props[refIndex]));
    tableStyle.tableColumnProperties = props;
    raw.tableStyle = tableStyle;
  }
}

/** Deletes an entire row. */
export function deleteTableRow(tab: TabState, tableStart: number, rowIndex: number): void {
  const row = tableStructureAt(tab.tape, tableStart).rows[rowIndex];
  if (!row) throw new Error(`row ${rowIndex} does not exist`);
  tab.tape.splice(row.start, row.end - row.start);
}

/** Deletes a column from every row. */
export function deleteTableColumn(tab: TabState, tableStart: number, columnIndex: number): void {
  const table = tableStructureAt(tab.tape, tableStart);
  for (let r = table.rows.length - 1; r >= 0; r--) {
    const cell = table.rows[r].cells[columnIndex];
    if (!cell) continue;
    tab.tape.splice(cell.start, cell.end - cell.start);
  }
  tableColumnCountBump(tab, tableStart, -1);
}

/**
 * Merges a `rowSpan` x `columnSpan` rectangle of cells starting at `(rowIndex, columnIndex)` (G3 F21):
 * the head (top-left) cell gets the spans and absorbs every non-empty covered cell's paragraphs in
 * reading order, each keeping only `MERGE_MOVED_PARAGRAPH_FIELDS`; empty covered cells contribute
 * nothing. Covered cells stay in the tape with one empty paragraph styled like their last one, and
 * every merged row gets `MERGED_ROW_MIN_HEIGHT`.
 */
export function mergeTableCells(
  tab: TabState,
  tableStart: number,
  rowIndex: number,
  columnIndex: number,
  rowSpan: number,
  columnSpan: number,
): void {
  const table = tableStructureAt(tab.tape, tableStart);
  const headPos = table.rows[rowIndex]?.cells[columnIndex];
  if (!headPos) throw new Error("merge head cell does not exist");
  const covered: CellPos[] = [];
  for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
    for (let c = columnIndex; c < columnIndex + columnSpan; c++) {
      if (r === rowIndex && c === columnIndex) continue;
      const pos = table.rows[r]?.cells[c];
      if (pos) covered.push(pos);
    }
  }
  covered.sort((a, b) => b.start - a.start);
  const absorbed: TapeCell[] = [];
  for (const pos of covered) {
    const content = tab.tape.slice(pos.start + 1, pos.end);
    const isEmpty = content.length === 1;
    const last = content.at(-1) as Extract<TapeCell, { t: "nl" }>;
    if (!isEmpty) absorbed.unshift(...content.map(movedParagraphCell));
    tab.tape.splice(pos.start + 1, pos.end - pos.start - 1, {
      para: { style: structuredClone(last.para.style) },
      style: last.style,
      t: "nl",
    });
  }
  if (absorbed.length > 0) tab.tape.splice(headPos.end, 0, ...absorbed);
  const headCell = tab.tape[headPos.start] as Extract<TapeCell, { t: "cellStart" }>;
  headCell.style = { ...headCell.style, columnSpan, rowSpan };
  for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
    const row = table.rows[r];
    if (!row) continue;
    const rowCell = tab.tape[row.start] as Extract<TapeCell, { t: "rowStart" }>;
    rowCell.style = { ...rowCell.style, minRowHeight: structuredClone(MERGED_ROW_MIN_HEIGHT) };
  }
}

/** Reduces a newline cell moved into a merge head to the paragraph fields the API keeps (F21); other cells pass through. */
function movedParagraphCell(cell: TapeCell): TapeCell {
  if (cell.t !== "nl") return cell;
  const style: JsonObject = {};
  for (const field of MERGE_MOVED_PARAGRAPH_FIELDS) {
    if (cell.para.style[field] !== undefined) style[field] = cell.para.style[field];
  }
  return { ...cell, para: { ...cell.para, style } };
}

/** Writes explicit `rowSpan: 1, columnSpan: 1` on a merged head cell (content stays where it is, F21). */
export function unmergeTableCells(tab: TabState, tableStart: number, rowIndex: number, columnIndex: number): void {
  const table = tableStructureAt(tab.tape, tableStart);
  const headPos = table.rows[rowIndex]?.cells[columnIndex];
  if (!headPos) throw new Error("unmerge head cell does not exist");
  const headCell = tab.tape[headPos.start] as Extract<TapeCell, { t: "cellStart" }>;
  headCell.style = { ...headCell.style, columnSpan: 1, rowSpan: 1 };
}

/** Applies a field-masked style patch to every cell in a rectangular range (defaults to the whole table when `rowIndex`/`columnIndex` are omitted). */
export function updateTableCellStyle(
  tab: TabState,
  tableStart: number,
  rowIndex: number | undefined,
  columnIndex: number | undefined,
  rowSpan: number | undefined,
  columnSpan: number | undefined,
  patch: JsonObject,
  fields: readonly string[],
): void {
  const table = tableStructureAt(tab.tape, tableStart);
  const rStart = rowIndex ?? 0;
  const rEnd = rowIndex === undefined ? table.rows.length : rowIndex + (rowSpan ?? 1);
  for (let r = rStart; r < rEnd; r++) {
    const row = table.rows[r];
    if (!row) continue;
    const cStart = columnIndex ?? 0;
    const cEnd = columnIndex === undefined ? row.cells.length : columnIndex + (columnSpan ?? 1);
    for (let c = cStart; c < cEnd; c++) {
      const cellPos = row.cells[c];
      if (!cellPos) continue;
      const cell = tab.tape[cellPos.start] as Extract<TapeCell, { t: "cellStart" }>;
      cell.style = applyStyleFields(cell.style, patch, fields);
    }
  }
}

/** Applies a field-masked style patch to each named column's stored properties (`tableStyle.tableColumnProperties`). */
export function updateTableColumnProperties(
  tab: TabState,
  tableStart: number,
  columnIndices: readonly number[],
  patch: JsonObject,
  fields: readonly string[],
): void {
  const tableStartCell = tab.tape[tableStart] as Extract<TapeCell, { t: "tableStart" }>;
  const raw = tableStartCell.raw;
  const tableStyle = { ...((raw.tableStyle as JsonObject | undefined) ?? {}) };
  const props = [...((tableStyle.tableColumnProperties as JsonObject[] | undefined) ?? [])];
  for (const idx of columnIndices) {
    props[idx] = applyStyleFields(props[idx] ?? {}, patch, fields);
  }
  tableStyle.tableColumnProperties = props;
  raw.tableStyle = tableStyle;
}

/** Applies a field-masked style patch to each named row's style. */
export function updateTableRowStyle(
  tab: TabState,
  tableStart: number,
  rowIndices: readonly number[],
  patch: JsonObject,
  fields: readonly string[],
): void {
  const table = tableStructureAt(tab.tape, tableStart);
  for (const idx of rowIndices) {
    const row = table.rows[idx];
    if (!row) continue;
    const rowCell = tab.tape[row.start] as Extract<TapeCell, { t: "rowStart" }>;
    rowCell.style = applyStyleFields(rowCell.style, patch, fields);
  }
}

/** Marks the first `count` rows `tableHeader: true` (repeated on every page) and unmarks the rest (F27). */
export function pinTableHeaderRows(tab: TabState, tableStart: number, count: number): void {
  tableStructureAt(tab.tape, tableStart).rows.forEach((row, r) => {
    const rowCell = tab.tape[row.start] as Extract<TapeCell, { t: "rowStart" }>;
    const style = { ...rowCell.style };
    if (r < count) style.tableHeader = true;
    else delete style.tableHeader;
    rowCell.style = style;
  });
}

/** Adjusts the table's recorded column count by `delta` (after a column insert/delete). */
function tableColumnCountBump(tab: TabState, tableStart: number, delta: number): void {
  const tableStartCell = tab.tape[tableStart] as Extract<TapeCell, { t: "tableStart" }>;
  const raw = tableStartCell.raw;
  if (typeof raw.columns === "number") raw.columns = Math.max(0, raw.columns + delta);
}

/** An empty paragraph for a new row/column cell, styled like the reference cell's last paragraph (F20). */
function cellParagraphLike(tape: TapeCell[], refCell: CellPos): TapeCell {
  const last = tape[refCell.end - 1];
  const style =
    last?.t === "nl" ? structuredClone(last.para.style) : structuredClone(TABLE_CELL_PARAGRAPH_STYLE_DEFAULT);
  return { para: { style }, style: {}, t: "nl" };
}
