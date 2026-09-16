/*

Canonical tape IR: Google Docs body.content is an ordered sibling list.
Headings do not wrap following paragraphs. Session-local key is `tapeIndex` (1…n).
Agent-facing identity is `scopedId` (`{headingId}.{checksum}`).

*/

import type { BulletPreset } from "./element.ts";

/** Docs named paragraph styles, including TITLE and SUBTITLE. */
export type NamedStyle =
  | "NORMAL_TEXT"
  | "TITLE"
  | "SUBTITLE"
  | "HEADING_1"
  | "HEADING_2"
  | "HEADING_3"
  | "HEADING_4"
  | "HEADING_5"
  | "HEADING_6";

/** Structural element kinds on the body tape. */
export type NodeKind = "paragraph" | "table" | "tableOfContents" | "sectionBreak" | "pageBreak";

/** One Docs smart chip (richLink, person, or date) inside a paragraph or table cell. */
export type InlineChip = {
  dateId?: string;
  end: number;
  kind?: "richLink" | "person" | "date";
  mimeType?: string;
  personId?: string;
  richLinkId?: string;
  start: number;
  title: string;
  uri: string;
};

/** One inline image inside a paragraph or table cell. */
export type InlineImage = {
  col?: number;
  end: number;
  heightPt?: number;
  objectId: string;
  row?: number;
  start: number;
  widthPt?: number;
};

/** Uniform run chrome dumped on query when it is not Docs defaults. */
export type QueryTextStyle = {
  fontSize?: number;
  foregroundColor?: string;
  italic?: boolean;
};

/** Docs paragraph alignment (updateParagraphStyle.alignment). */
export type ParagraphAlignment = "START" | "CENTER" | "END" | "JUSTIFIED";

/** Vertical alignment inside a table cell (updateTableCellStyle.contentAlignment). */
export type CellContentAlignment = "TOP" | "MIDDLE" | "BOTTOM";

const ALIGN_SET: ReadonlySet<string> = new Set(["CENTER", "END", "JUSTIFIED", "START"]);

const CONTENT_ALIGN_SET: ReadonlySet<string> = new Set(["BOTTOM", "MIDDLE", "TOP"]);

/** Narrows an API alignment string. */
export function asAlignment(raw: string | undefined): ParagraphAlignment | undefined {
  if (!raw) return undefined;
  return ALIGN_SET.has(raw) ? (raw as ParagraphAlignment) : undefined;
}

/** Narrows an API table-cell contentAlignment string. */
export function asContentAlignment(raw: string | undefined): CellContentAlignment | undefined {
  if (!raw) return undefined;
  return CONTENT_ALIGN_SET.has(raw) ? (raw as CellContentAlignment) : undefined;
}

/** One paragraph inside a table cell. */
export type CellParagraph = {
  alignment?: ParagraphAlignment;
  /** Smart chips in this cell paragraph. innerText / remove destroy them (apply warns). */
  chips?: InlineChip[];
  end: number;
  /** True if this cell paragraph contains a math equation. */
  hasEquation?: boolean;
  /** True if this cell paragraph contains a horizontal rule / divider. */
  hasHorizontalRule?: boolean;
  images?: InlineImage[];
  indentEnd?: { magnitude: number; unit: "PT" };
  indentFirstLine?: { magnitude: number; unit: "PT" };
  indentStart?: { magnitude: number; unit: "PT" };
  lineSpacing?: number;
  markup?: string;
  shading?: string;
  spaceAbove?: number;
  spaceBelow?: number;
  /** Heading-scoped node ID: "{headingId}.{checksum}" or "{headingId}.table.{r}.{c}.{checksum}" */
  scopedId?: string;
  start: number;
  /** Uniform non-default italic / size / color on this cell paragraph. */
  style?: QueryTextStyle;
  text: string;
};

/** One table cell. First paragraph is also flattened onto the cell for targeting `[row, col]`. */
export type TableCell = CellParagraph & {
  backgroundColor?: string;
  /** All paragraphs in the cell (index 0 is the same as this cell's text/start/end). Parser always sets this. */
  paragraphs?: CellParagraph[];
};

/** One body sibling. `tapeIndex` is a 1-based session-local tape index; `start`/`end` are API UTF-16 offsets. */
export type DocNode = {
  alignment?: ParagraphAlignment;
  bullet?: {
    listId?: string;
    nestingLevel: number;
    preset?: BulletPreset;
    type?: "NUMBERED" | "BULLET" | "CHECKBOX";
  };
  /** Smart chips in this paragraph. innerText / remove destroy them (apply warns). */
  chips?: InlineChip[];
  /** Format > Columns count, on sectionBreak. */
  columnCount?: number;
  end: number;
  footnoteIds?: string[];
  /** True if this paragraph contains a math equation. */
  hasEquation?: boolean;
  /** True if this paragraph contains a horizontal rule / divider. */
  hasHorizontalRule?: boolean;
  tapeIndex: number;
  indentEnd?: { magnitude: number; unit: "PT" };
  indentFirstLine?: { magnitude: number; unit: "PT" };
  indentStart?: { magnitude: number; unit: "PT" };
  /** Inline images in this paragraph, or flattened from table cells. */
  images?: InlineImage[];
  /** Google Docs internal heading ID (e.g. "h.8f4t1c8x4mh"), populated on headings. */
  headingId?: string;
  /** True if this paragraph is formatted as a code snippet (entirely monospace text runs, NORMAL_TEXT, no bullets). */
  isCode?: boolean;
  kind: NodeKind;
  lineSpacing?: number;
  namedStyleType?: NamedStyle;
  /** Heading-scoped node ID: "{headingId}.{checksum}" or "_preamble.{checksum}" */
  scopedId?: string;
  shading?: string;
  spaceAbove?: number;
  spaceBelow?: number;
  start: number;
  /** Uniform non-default italic / size / color (tip chrome). Compact query prints this. */
  style?: QueryTextStyle;
  table?: {
    /** Uniform #RRGGBB on all four cell borders when query can see it. */
    borderColor?: string;
    cells: TableCell[][];
    cellPadding?: number;
    columnWidth?: number;
    contentAlignment?: CellContentAlignment;
    minRowHeight?: number;
    pinnedHeaderRows?: number;
    preventOverflow?: boolean;
  };
  /** Plain visible text (links stripped to their labels). */
  text?: string;
  /** Write-path markup when it differs from `text` (links, bold, code). */
  markup?: string;
};

/** Header / footer / footnote tape (own index space, own tapeIndex 1…n). */
export type DocSegmentKind = "footer" | "footnote" | "header";

export type DocSegmentUse = "default" | "even" | "first";

export type DocSegment = {
  kind: DocSegmentKind;
  nodes: DocNode[];
  segmentId: string;
  use?: DocSegmentUse;
};

/** Named styles treated as outline headings (TITLE, SUBTITLE, HEADING_*). */
export const HEADING_STYLES: ReadonlySet<NamedStyle> = new Set([
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
  "SUBTITLE",
  "TITLE",
]);

/** All Docs named paragraph styles. */
export const NAMED_STYLES: readonly NamedStyle[] = [
  "NORMAL_TEXT",
  "TITLE",
  "SUBTITLE",
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
];

/** Outline level for a named style. SUBTITLE is 1; TITLE is 0. */
export const STYLE_TO_LEVEL: Record<NamedStyle, number> = {
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
  NORMAL_TEXT: 99,
  SUBTITLE: 1,
  TITLE: 0,
};

const NAMED_STYLE_SET: ReadonlySet<string> = new Set(NAMED_STYLES);

/** True when a named style is TITLE, SUBTITLE, or HEADING_*. */
export function isHeadingStyle(style: NamedStyle | undefined): boolean {
  return style != null && HEADING_STYLES.has(style);
}

/** Narrows an API namedStyleType string to NamedStyle. */
export function asNamedStyle(raw: string | undefined): NamedStyle | undefined {
  if (!raw) return undefined;
  return NAMED_STYLE_SET.has(raw) ? (raw as NamedStyle) : undefined;
}
