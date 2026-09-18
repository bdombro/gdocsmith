/* Canonical tape IR: Google Docs body.content is an ordered sibling list. */

import type { BulletPreset } from "./element.ts";

/**
 * Vertical alignment inside a table cell (updateTableCellStyle.contentAlignment).
 */
export type CellContentAlignment = "TOP" | "MIDDLE" | "BOTTOM";

/**
 * One paragraph inside a table cell.
 */
export type CellParagraph = {
  /** Paragraph alignment. */
  alignment?: ParagraphAlignment;
  /** Smart chips in this cell paragraph. innerText / remove destroy them (apply warns). */
  chips?: InlineChip[];
  /** Column index inside the parent table. */
  col?: number;
  /** End UTF-16 character offset in document. */
  end: number;
  /** Foreground hex colors found across text runs in this cell paragraph. */
  fontColors?: string[];
  /** True if this cell paragraph contains a math equation. */
  hasEquation?: boolean;
  /** True if this cell paragraph contains a horizontal rule / divider. */
  hasHorizontalRule?: boolean;
  /** Inline images contained in this cell paragraph. */
  images?: InlineImage[];
  /** End indent in points. */
  indentEnd?: { magnitude: number; unit: "PT" };
  /** First line indent in points. */
  indentFirstLine?: { magnitude: number; unit: "PT" };
  /** Start indent in points. */
  indentStart?: { magnitude: number; unit: "PT" };
  /** Line spacing percentage. */
  lineSpacing?: number;
  /** Markup representation if present. */
  markup?: string;
  /** Row index inside the parent table. */
  row?: number;
  /** Heading-scoped node ID: "{headingId}.{checksum}" or "{headingId}.table.{r}.{c}.{checksum}". */
  scopedId?: string;
  /** Background shading color string. */
  shading?: string;
  /** Space above in points. */
  spaceAbove?: number;
  /** Space below in points. */
  spaceBelow?: number;
  /** Start UTF-16 character offset in document. */
  start: number;
  /** Uniform non-default italic / size / color on this cell paragraph. */
  style?: QueryTextStyle;
  /** Plain text content of cell paragraph. */
  text: string;
};

/**
 * One body sibling. `tapeIndex` is a 1-based session-local tape index; `start`/`end` are API UTF-16 offsets.
 */
export type DocNode = {
  /** Paragraph alignment. */
  alignment?: ParagraphAlignment;
  /** Bullet list formatting metadata. */
  bullet?: {
    /** List identifier. */
    listId?: string;
    /** Zero-based nesting level. */
    nestingLevel: number;
    /** Bullet glyph preset. */
    preset?: BulletPreset;
    /** Bullet type classification. */
    type?: "NUMBERED" | "BULLET" | "CHECKBOX";
  };
  /** Smart chips in this paragraph. innerText / remove destroy them (apply warns). */
  chips?: InlineChip[];
  /** Column index if inside a table. */
  col?: number;
  /** Format > Columns count, on sectionBreak. */
  columnCount?: number;
  /** End UTF-16 character offset. */
  end: number;
  /** Foreground hex colors found across text runs in this paragraph. */
  fontColors?: string[];
  /** Footnote IDs referenced in this paragraph. */
  footnoteIds?: string[];
  /** True if this paragraph contains a math equation. */
  hasEquation?: boolean;
  /** True if this paragraph contains a horizontal rule / divider. */
  hasHorizontalRule?: boolean;
  /** Google Docs internal heading ID (e.g. "h.8f4t1c8x4mh"), populated on headings. */
  headingId?: string;
  /** Inline images in this paragraph, or flattened from table cells. */
  images?: InlineImage[];
  /** End indent in points. */
  indentEnd?: { magnitude: number; unit: "PT" };
  /** First line indent in points. */
  indentFirstLine?: { magnitude: number; unit: "PT" };
  /** Start indent in points. */
  indentStart?: { magnitude: number; unit: "PT" };
  /** True if this paragraph is formatted as a code snippet. */
  isCode?: boolean;
  /** Structural kind of node. */
  kind: NodeKind;
  /** Line spacing percentage. */
  lineSpacing?: number;
  /** Write-path markup when it differs from `text` (links, bold, code). */
  markup?: string;
  /** Docs named style classification. */
  namedStyleType?: NamedStyle;
  /** Row index if inside a table. */
  row?: number;
  /** Heading-scoped node ID: "{headingId}.{checksum}" or "_preamble.{checksum}". */
  scopedId?: string;
  /** Background shading fill color. */
  shading?: string;
  /** Space above in points. */
  spaceAbove?: number;
  /** Space below in points. */
  spaceBelow?: number;
  /** Start UTF-16 character offset. */
  start: number;
  /** Uniform non-default italic / size / color (tip chrome). Compact query prints this. */
  style?: QueryTextStyle;
  /** Table structure if kind is "table". */
  table?: {
    /** Uniform #RRGGBB on all four cell borders when query can see it. */
    borderColor?: string;
    /** Two-dimensional matrix of table cells. */
    cells: TableCell[][];
    /** Cell padding in points. */
    cellPadding?: number;
    /** Default column width in points. */
    columnWidth?: number;
    /** Default cell content alignment. */
    contentAlignment?: CellContentAlignment;
    /** Minimum row height in points. */
    minRowHeight?: number;
    /** Pinned table header row count. */
    pinnedHeaderRows?: number;
    /** Prevent overflow across page breaks. */
    preventOverflow?: boolean;
  };
  /** 1-based index within the body tape. */
  tapeIndex: number;
  /** Plain visible text (links stripped to their labels). */
  text?: string;
};

/**
 * Header / footer / footnote segment description.
 */
export type DocSegment = {
  /** Segment classification. */
  kind: DocSegmentKind;
  /** Ordered nodes within the segment tape. */
  nodes: DocNode[];
  /** Unique segment identifier. */
  segmentId: string;
  /** Segment page usage role. */
  use?: DocSegmentUse;
};

/**
 * Header / footer / footnote tape kind (own index space, own tapeIndex 1…n).
 */
export type DocSegmentKind = "footer" | "footnote" | "header";

/**
 * Page usage role for header and footer segments.
 */
export type DocSegmentUse = "default" | "even" | "first";

/**
 * One Docs smart chip (richLink, person, or date) inside a paragraph or table cell.
 */
export type InlineChip = {
  /** Date chip identifier. */
  dateId?: string;
  /** Date format pattern from the Docs API. */
  dateFormat?: string;
  /** Person email when this chip is a mention. */
  email?: string;
  /** End character offset. */
  end: number;
  /** Smart chip classification. */
  kind?: "richLink" | "person" | "date";
  /** Target MIME type for rich links. */
  mimeType?: string;
  /** Person identifier for user mentions. */
  personId?: string;
  /** Rich link identifier. */
  richLinkId?: string;
  /** Start character offset. */
  start: number;
  /** Offset in `Paragraph.text` (trailing newline excluded) where this chip sits. */
  textOffset?: number;
  /** ISO timestamp for date chips. */
  timestamp?: string;
  /** Label or title of the chip. */
  title: string;
  /** Resource URI for links or profiles. */
  uri: string;
};

/**
 * One inline image inside a paragraph or table cell.
 */
export type InlineImage = {
  /** Column index if inside a table cell. */
  col?: number;
  /** End character offset. */
  end: number;
  /** Display height in points. */
  heightPt?: number;
  /** Embedded object ID in Google Docs. */
  objectId: string;
  /** Row index if inside a table cell. */
  row?: number;
  /** Public HTTPS source URI when the image was inserted from a URL. */
  sourceUri?: string;
  /** Start character offset. */
  start: number;
  /** Offset in `Paragraph.text` where this image sits. */
  textOffset?: number;
  /** Display width in points. */
  widthPt?: number;
};

/**
 * Docs named paragraph styles, including TITLE and SUBTITLE.
 */
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

/**
 * Structural element kinds on the body tape.
 */
export type NodeKind = "paragraph" | "table" | "tableOfContents" | "sectionBreak" | "pageBreak";

/**
 * Docs paragraph alignment (updateParagraphStyle.alignment).
 */
export type ParagraphAlignment = "START" | "CENTER" | "END" | "JUSTIFIED";

/**
 * Uniform run chrome dumped on query when it is not Docs defaults.
 */
export type QueryTextStyle = {
  /** Font size in points. */
  fontSize?: number;
  /** Hex foreground color string. */
  foregroundColor?: string;
  /** Italic formatting flag. */
  italic?: boolean;
};

/**
 * One table cell. First paragraph is also flattened onto the cell for targeting `[row, col]`.
 */
export type TableCell = CellParagraph & {
  /** Background color hex string. */
  backgroundColor?: string;
  /** All paragraphs in the cell (index 0 is the same as this cell's text/start/end). Parser always sets this. */
  paragraphs?: CellParagraph[];
};

/**
 * Named styles treated as outline headings (TITLE, SUBTITLE, HEADING_*).
 */
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

/**
 * All Docs named paragraph styles.
 */
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

/**
 * Outline level for a named style. SUBTITLE is 1; TITLE is 0.
 */
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

/**
 * Narrows an API alignment string.
 */
export function alignmentAs(
  /** Raw alignment string from API. */
  raw: string | undefined,
): ParagraphAlignment | undefined {
  if (!raw) return undefined;
  return ALIGN_SET.has(raw) ? (raw as ParagraphAlignment) : undefined;
}

/**
 * Alias for alignmentAs.
 */
export const asAlignment = alignmentAs;

/**
 * Narrows an API table-cell contentAlignment string.
 */
export function contentAlignmentAs(
  /** Raw content alignment string from API. */
  raw: string | undefined,
): CellContentAlignment | undefined {
  if (!raw) return undefined;
  return CONTENT_ALIGN_SET.has(raw) ? (raw as CellContentAlignment) : undefined;
}

/**
 * Alias for contentAlignmentAs.
 */
export const asContentAlignment = contentAlignmentAs;

/**
 * True when a named style is TITLE, SUBTITLE, or HEADING_*.
 */
export function headingStyleIs(
  /** Named style to test. */
  style: NamedStyle | undefined,
): boolean {
  return style != null && HEADING_STYLES.has(style);
}

/**
 * Alias for headingStyleIs.
 */
export const isHeadingStyle = headingStyleIs;

/**
 * Narrows an API namedStyleType string to NamedStyle.
 */
export function namedStyleAs(
  /** Raw named style string from API. */
  raw: string | undefined,
): NamedStyle | undefined {
  if (!raw) return undefined;
  return NAMED_STYLE_SET.has(raw) ? (raw as NamedStyle) : undefined;
}

/**
 * Alias for namedStyleAs.
 */
export const asNamedStyle = namedStyleAs;

const ALIGN_SET: ReadonlySet<string> = new Set(["CENTER", "END", "JUSTIFIED", "START"]);
const CONTENT_ALIGN_SET: ReadonlySet<string> = new Set(["BOTTOM", "MIDDLE", "TOP"]);
const NAMED_STYLE_SET: ReadonlySet<string> = new Set(NAMED_STYLES);
