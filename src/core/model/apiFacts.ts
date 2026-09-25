/* Docs API behaviors recorded by the live conformance suite (G3 D12, M5); shared by the model and the emulator. */

import type { JsonObject } from "./rawJson.ts";

/** Foreground color the API adds to newly linked text unless the request's mask lists `foregroundColor` (#1155CC, F17). */
export const LINK_CHROME_COLOR: JsonObject = {
  color: { rgbColor: { blue: 0.8, green: 0.33333334, red: 0.06666667 } },
};

/** Text-style fields whose explicitly set value is dropped when it equals the inherited one (F17; only these two are verified). */
export const TEXT_STYLE_INHERIT_DROP_FIELDS: readonly string[] = ["foregroundColor", "underline"];

/** Style every row of a newly inserted table gets (F13). */
export const TABLE_ROW_STYLE_DEFAULT: JsonObject = { minRowHeight: { unit: "PT" } };

/** Style every cell of a newly inserted table gets (F13). */
export const TABLE_CELL_STYLE_DEFAULT: JsonObject = {
  backgroundColor: {},
  columnSpan: 1,
  contentAlignment: "TOP",
  paddingBottom: { magnitude: 5, unit: "PT" },
  paddingLeft: { magnitude: 5, unit: "PT" },
  paddingRight: { magnitude: 5, unit: "PT" },
  paddingTop: { magnitude: 5, unit: "PT" },
  rowSpan: 1,
};

/** Border every side of a new table cell's paragraph gets. */
const CELL_PARAGRAPH_BORDER: JsonObject = {
  color: {},
  dashStyle: "SOLID",
  padding: { unit: "PT" },
  width: { unit: "PT" },
};

/** Paragraph style of every paragraph in a newly created table cell (F13, F20). */
export const TABLE_CELL_PARAGRAPH_STYLE_DEFAULT: JsonObject = {
  alignment: "START",
  avoidWidowAndOrphan: false,
  borderBetween: CELL_PARAGRAPH_BORDER,
  borderBottom: CELL_PARAGRAPH_BORDER,
  borderLeft: CELL_PARAGRAPH_BORDER,
  borderRight: CELL_PARAGRAPH_BORDER,
  borderTop: CELL_PARAGRAPH_BORDER,
  direction: "LEFT_TO_RIGHT",
  indentEnd: { unit: "PT" },
  indentFirstLine: { unit: "PT" },
  indentStart: { unit: "PT" },
  keepLinesTogether: false,
  keepWithNext: false,
  lineSpacing: 100,
  namedStyleType: "NORMAL_TEXT",
  pageBreakBefore: false,
  shading: { backgroundColor: {} },
  spaceAbove: { unit: "PT" },
  spaceBelow: { unit: "PT" },
  spacingMode: "COLLAPSE_LISTS",
};

/** Column width (PT) of a new table in the default pageless doc, by column count; recorded for 1–3 columns (F13). */
const TABLE_COLUMN_WIDTHS_PT: Readonly<Record<number, number>> = { 1: 500, 2: 250, 3: 175 };

/** `tableStyle.tableColumnProperties` of a new `columns`-wide table (unrecorded counts fall back to an even 500pt split). */
export function tableColumnPropertiesDefault(
  /** Column count. */
  columns: number,
): JsonObject[] {
  const width = TABLE_COLUMN_WIDTHS_PT[columns] ?? 500 / columns;
  return Array.from({ length: columns }, () => ({
    width: { magnitude: width, unit: "PT" },
    widthType: "FIXED_WIDTH",
  }));
}

/** Paragraph-style fields a paragraph keeps when `mergeTableCells` moves it into the head cell (F21). */
export const MERGE_MOVED_PARAGRAPH_FIELDS: readonly string[] = [
  "avoidWidowAndOrphan",
  "direction",
  "indentStart",
  "lineSpacing",
  "namedStyleType",
  "spaceBelow",
];

/** `minRowHeight` every row touched by `mergeTableCells` gets (F21). */
export const MERGED_ROW_MIN_HEIGHT: JsonObject = { magnitude: 21, unit: "PT" };

/** Section style every new section break gets besides its `sectionType` (F15). */
export const SECTION_STYLE_DEFAULT: JsonObject = { columnSeparatorStyle: "NONE", contentDirection: "LEFT_TO_RIGHT" };

/** Date-chip properties the server fills in when the request omits them (F25). */
export const DATE_ELEMENT_DEFAULTS: JsonObject = {
  dateFormat: "DATE_FORMAT_MONTH_DAY_YEAR_ABBREVIATED",
  locale: "en",
  timeFormat: "TIME_FORMAT_DISABLED",
};
