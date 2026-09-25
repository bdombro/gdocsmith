/* Reconciles tables: new tables (insert, fill, merge, style) and kept ones in the D20 order (G3 D20, F13, F20, F21, F27, M10). */

import {
  MERGED_ROW_MIN_HEIGHT,
  TABLE_CELL_PARAGRAPH_STYLE_DEFAULT,
  TABLE_CELL_STYLE_DEFAULT,
  TABLE_ROW_STYLE_DEFAULT,
  tableColumnPropertiesDefault,
} from "../model/apiFacts.ts";
import { CoreError } from "../model/errors.ts";
import { containerLength } from "../model/layout.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { styleEqual, styleFieldsChanged } from "../model/styleValues.ts";
import type { CellModel, ParagraphBlock, TableBlock } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import { type ReconcileContext, type RequestOrigin, requestPush } from "./context.ts";

/** Cell-style fields merges own (sent as merge requests, never as style). */
const SPAN_FIELDS = ["columnSpan", "rowSpan"];

/** Spans of a new (never merged) cell. */
const UNMERGED = { columnSpan: 1, rowSpan: 1 };

/** Row-style fields `pinTableHeaderRows` owns. */
const HEADER_FIELDS = ["tableHeader"];

/** Fills one new cell: its paragraphs go into the cell's single empty paragraph (reused), with full styles. */
export type CellFill = (cell: CellModel, contentStart: number) => void;

/** What the API holds for a table between structure edits and styling. */
interface TableState {
  /** Column properties. */ columns: JsonObject[];
  /** Row styles, then each row's cell styles. */ rows: Array<{ cells: JsonObject[]; style: JsonObject }>;
}

/**
 * Inserts a new table at `pos` (a paragraph start: the API splits off an empty paragraph first, so the
 * table starts at `pos + 1`), fills its cells from the end, then merges and styles it against the
 * API's defaults (F13).
 */
export function tableNewEmit(
  /** The new table (final). */
  t: TableBlock,
  /** Paragraph-start index to insert at. */
  pos: number,
  /** Reconciliation state. */
  ctx: ReconcileContext,
  /** Fills one new cell. */
  fill: CellFill,
): void {
  const origin: RequestOrigin = { key: t.key, stepIndex: t.stamp?.stepIndex };
  const columns = t.columns.length;
  requestPush(ctx, RequestBuilder.tableInsert(pos, t.rows.length, columns, ctx.tabId), origin);
  const tableStart = pos + 1;
  for (let r = t.rows.length - 1; r >= 0; r--) {
    for (let c = columns - 1; c >= 0; c--) {
      fill(t.rows[r].cells[c], tableStart + 1 + r * (1 + 2 * columns) + 1 + 2 * c + 1);
    }
  }
  const state: TableState = {
    columns: tableColumnPropertiesDefault(columns),
    rows: t.rows.map(() => ({
      cells: Array.from({ length: columns }, () => ({ ...TABLE_CELL_STYLE_DEFAULT })),
      style: { ...TABLE_ROW_STYLE_DEFAULT },
    })),
  };
  mergesEmit(undefined, t, state, tableStart, ctx, origin);
  stylesEmit(state, t, 0, tableStart, ctx, origin);
}

/**
 * Reconciles a kept table in the D20 order: (1) kept cells' content, last first; (2)+(3) rows, then
 * columns: deletes from the end, then inserts from the start (appending first when none survive);
 * (4) new cells filled, last first;
 * (5) merges and unmerges; (6) styles, against a simulation of what the API copied into new rows and
 * columns (F20).
 */
export function tableReconcile(
  /** Original table (with origins). */
  o: TableBlock,
  /** Final table. */
  f: TableBlock,
  /** Reconciliation state. */
  ctx: ReconcileContext,
  /** Reconciles a kept cell's content. */
  cellReconcile: (o: CellModel, f: CellModel) => void,
  /** Fills a new cell. */
  fill: CellFill,
): void {
  if (!o.origin) throw new CoreError("internal", `table ${o.key} has no original range`);
  const origin: RequestOrigin = { key: f.key, stepIndex: f.stamp?.stepIndex };
  const tableStart = o.origin.start;
  const keptRows = keptOrder(o.rows, f.rows, "row");
  const keptColumns = keptOrder(o.columns, f.columns, "column");
  const oRow = new Map(o.rows.map((row, i) => [row.key, i]));
  const oColumn = new Map(o.columns.map((col, i) => [col.key, i]));
  // (1) kept cells, last first
  for (let r = f.rows.length - 1; r >= 0; r--) {
    const or = oRow.get(f.rows[r].key);
    if (or === undefined) continue;
    for (let c = f.columns.length - 1; c >= 0; c--) {
      const oc = oColumn.get(f.columns[c].key);
      if (oc !== undefined) cellReconcile(o.rows[or].cells[oc], f.rows[r].cells[c]);
    }
  }
  // (2)+(3) rows, then columns: deletes from the end, then inserts from the start, simulating what the API holds.
  // When nothing survives, new ones are appended first (the API can't delete every row or column).
  const state: TableState = {
    columns: o.columns.map((col) => col.props),
    rows: o.rows.map((row) => ({ cells: row.cells.map((cell) => cell.style), style: row.style })),
  };
  const rowInsert = (at: number, below: boolean) => {
    const refIndex = below ? at - 1 : at;
    requestPush(
      ctx,
      RequestBuilder.insertTableRow({ insertBelow: below, rowIndex: refIndex, tabId: ctx.tabId, tableStart }),
      origin,
    );
    const ref = state.rows[refIndex];
    state.rows.splice(at, 0, { cells: ref.cells.map((style) => ({ ...style, ...UNMERGED })), style: { ...ref.style } });
  };
  const rowDelete = (r: number) => {
    requestPush(ctx, RequestBuilder.deleteTableRow({ rowIndex: r, tabId: ctx.tabId, tableStart }), origin);
    state.rows.splice(r, 1);
  };
  if (keptRows.size) {
    for (let r = o.rows.length - 1; r >= 0; r--) if (!keptRows.has(o.rows[r].key)) rowDelete(r);
    f.rows.forEach((row, r) => {
      if (!keptRows.has(row.key)) rowInsert(r, r > 0);
    });
  } else {
    for (let r = 0; r < f.rows.length; r++) rowInsert(state.rows.length, true);
    for (let r = o.rows.length - 1; r >= 0; r--) rowDelete(r);
  }
  const columnInsert = (at: number, right: boolean) => {
    const refIndex = right ? at - 1 : at;
    requestPush(
      ctx,
      RequestBuilder.insertTableColumn({ columnIndex: refIndex, insertRight: right, tabId: ctx.tabId, tableStart }),
      origin,
    );
    state.columns.splice(at, 0, { ...(state.columns[refIndex] ?? {}) });
    for (const row of state.rows)
      row.cells.splice(at, 0, { ...(row.cells[refIndex] ?? TABLE_CELL_STYLE_DEFAULT), ...UNMERGED });
  };
  const columnDelete = (c: number) => {
    requestPush(ctx, RequestBuilder.deleteTableColumn({ columnIndex: c, tabId: ctx.tabId, tableStart }), origin);
    state.columns.splice(c, 1);
    for (const row of state.rows) row.cells.splice(c, 1);
  };
  if (keptColumns.size) {
    for (let c = o.columns.length - 1; c >= 0; c--) if (!keptColumns.has(o.columns[c].key)) columnDelete(c);
    f.columns.forEach((col, c) => {
      if (!keptColumns.has(col.key)) columnInsert(c, c > 0);
    });
  } else {
    for (let c = 0; c < f.columns.length; c++) columnInsert(state.columns.length, true);
    for (let c = o.columns.length - 1; c >= 0; c--) columnDelete(c);
  }
  // (4) new cells, last first, at their positions in the current (final-shaped) table
  const newCells: Array<{ cell: CellModel; start: number }> = [];
  let pos = tableStart + 1;
  f.rows.forEach((row) => {
    pos += 1;
    const rowIsNew = !keptRows.has(row.key);
    row.cells.forEach((cell, c) => {
      pos += 1;
      const isNew = rowIsNew || !keptColumns.has(f.columns[c].key);
      if (isNew) newCells.push({ cell, start: pos });
      pos += isNew ? 1 : containerLength(cell.blocks);
    });
  });
  for (const { cell, start } of newCells.reverse()) fill(cell, start);
  // (5) merges and unmerges, (6) styles
  mergesEmit(o, f, state, tableStart, ctx, origin);
  stylesEmit(state, f, o.rows.filter((row) => row.style.tableHeader === true).length, tableStart, ctx, origin);
}

/** The synthetic empty paragraph a new cell starts with, for `CellFill` implementations. */
export function cellEmptyParagraph(
  /** Key to give it. */
  key: string,
  /** Its index. */
  start: number,
): ParagraphBlock {
  return {
    inlines: [],
    key,
    kind: "paragraph",
    newline: { style: {} },
    origin: { end: start + 1, start },
    protected: false,
    style: { ...TABLE_CELL_PARAGRAPH_STYLE_DEFAULT },
  };
}

/** Emits merges and unmerges (head cells whose spans changed) and mirrors their effects on the simulated state (F21). */
function mergesEmit(
  o: TableBlock | undefined,
  f: TableBlock,
  state: TableState,
  tableStart: number,
  ctx: ReconcileContext,
  origin: RequestOrigin,
): void {
  const oSpans = new Map<string, JsonObject>();
  for (const row of o?.rows ?? []) for (const cell of row.cells) oSpans.set(cell.key, cell.style);
  f.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      const rowSpan = (cell.style.rowSpan as number | undefined) ?? 1;
      const columnSpan = (cell.style.columnSpan as number | undefined) ?? 1;
      const before = oSpans.get(cell.key);
      const wasRow = (before?.rowSpan as number | undefined) ?? 1;
      const wasColumn = (before?.columnSpan as number | undefined) ?? 1;
      if (rowSpan === wasRow && columnSpan === wasColumn) return;
      const range = {
        columnIndex: c,
        columnSpan: Math.max(columnSpan, wasColumn),
        rowIndex: r,
        rowSpan: Math.max(rowSpan, wasRow),
        tabId: ctx.tabId,
        tableStart,
      };
      if (wasRow > 1 || wasColumn > 1) requestPush(ctx, RequestBuilder.tableCellsUnmerge(range), origin);
      if (rowSpan > 1 || columnSpan > 1) {
        requestPush(ctx, RequestBuilder.tableCellsMerge({ ...range, columnSpan, rowSpan }), origin);
        for (let rr = r; rr < r + rowSpan; rr++)
          state.rows[rr].style = { ...state.rows[rr].style, minRowHeight: MERGED_ROW_MIN_HEIGHT };
      }
    });
  });
}

/** Emits row, cell, column, and header-row style changes against the simulated API state. */
function stylesEmit(
  state: TableState,
  f: TableBlock,
  headerRowsBefore: number,
  tableStart: number,
  ctx: ReconcileContext,
  origin: RequestOrigin,
): void {
  f.rows.forEach((row, r) => {
    const fields = changedFields(state.rows[r].style, row.style, HEADER_FIELDS);
    if (fields.length) {
      requestPush(
        ctx,
        RequestBuilder.tableRowStyleUpdate({
          fields,
          rowIndices: [r],
          tabId: ctx.tabId,
          tableRowStyle: pick(row.style, fields),
          tableStart,
        }),
        origin,
      );
    }
    row.cells.forEach((cell, c) => {
      const cellFields = changedFields(state.rows[r].cells[c], cell.style, SPAN_FIELDS);
      if (!cellFields.length) return;
      requestPush(
        ctx,
        RequestBuilder.tableCellStyleUpdate({
          columnIndex: c,
          columnSpan: 1,
          fields: cellFields,
          rowIndex: r,
          rowSpan: 1,
          tabId: ctx.tabId,
          tableCellStyle: pick(cell.style, cellFields),
          tableStart,
        }),
        origin,
      );
    });
  });
  f.columns.forEach((col, c) => {
    const fields = changedFields(state.columns[c] ?? {}, col.props, []);
    if (!fields.length) return;
    requestPush(
      ctx,
      RequestBuilder.tableColumnPropertiesUpdate({
        columnIndices: [c],
        fields,
        tabId: ctx.tabId,
        tableColumnProperties: pick(col.props, fields),
        tableStart,
      }),
      origin,
    );
  });
  let header = 0;
  while (header < f.rows.length && f.rows[header].style.tableHeader === true) header++;
  if (f.rows.slice(header).some((row) => row.style.tableHeader === true)) {
    throw new CoreError("internal", "header rows must be the table's first rows");
  }
  if (header !== headerRowsBefore) {
    requestPush(
      ctx,
      RequestBuilder.pinTableHeaderRows({ pinnedHeaderRowsCount: header, tabId: ctx.tabId, tableStart }),
      origin,
    );
  }
}

/** Keys of `final` items also in `original`, which must keep their relative order. */
function keptOrder(
  original: ReadonlyArray<{ key: string }>,
  final: ReadonlyArray<{ key: string }>,
  what: string,
): Set<string> {
  const index = new Map(original.map((item, i) => [item.key, i]));
  let last = -1;
  const kept = new Set<string>();
  for (const item of final) {
    const i = index.get(item.key);
    if (i === undefined) continue;
    if (i <= last) throw new CoreError("internal", `a table ${what} moved; a move must be a delete plus an insert`);
    last = i;
    kept.add(item.key);
  }
  return kept;
}

/** Fields that differ between two styles, ignoring `skip`. */
function changedFields(before: JsonObject, after: JsonObject, skip: readonly string[]): string[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => !skip.includes(f)).sort();
  return styleFieldsChanged(before, after, fields).filter((field) => !styleEqual(before[field], after[field]));
}

/** The fields of `style` that are set, among `fields`. */
function pick(style: JsonObject, fields: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const field of fields) if (style[field] !== undefined) out[field] = style[field];
  return out;
}
