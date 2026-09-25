/* v2's own raw Docs API JSON typings; kept separate from the v1 `GoogleDoc` transport type so parsing can rely on the full document shape (tabs, namedRanges, suggestions) without widening v1's narrower types. */

import type { GoogleDoc } from "~/core/types.ts";

/** Loosely typed JSON object; used for style/property bags whose exact shape is handled by canonicalization, not by these raw types. */
export type JsonObject = Record<string, unknown>;

/** Docs API rgbColor 0-1 channels. */
export type RawColor = { blue?: number; green?: number; red?: number };

/** Docs API OptionalColor wrapper. */
export type RawOptionalColor = { color?: { rgbColor?: RawColor } };

/** Docs API Dimension (PT unless stated otherwise). */
export type RawDimension = { magnitude?: number; unit?: string };

/** One named range instance (Docs API `NamedRange`). */
export type RawNamedRange = {
  /** Human-assigned name (not unique; the same name can label several disjoint ranges). */ name?: string;
  /** Unique named range identifier. */ namedRangeId?: string;
  /** Disjoint index ranges this instance covers. */ ranges?: Array<{
    endIndex?: number;
    startIndex?: number;
    tabId?: string;
  }>;
};

/** One entry in a document's `namedRanges` map (Docs API `NamedRanges`, keyed by name). */
export type RawNamedRanges = { name?: string; namedRanges?: RawNamedRange[] };

/** One `nestingLevels` entry inside a list definition. */
export type RawListNestingLevel = JsonObject;

/** One entry in a document's `lists` map. */
export type RawList = {
  /** List-wide properties. */ listProperties?: { nestingLevels?: RawListNestingLevel[] };
};

/** A structural element holding suggested-insertion/-deletion id arrays. */
export type RawSuggested = { suggestedDeletionIds?: string[]; suggestedInsertionIds?: string[] };

/** Docs API TextRun. */
export type RawTextRun = RawSuggested & {
  content?: string;
  suggestedTextStyleChanges?: JsonObject;
  textStyle?: JsonObject;
};

/** Docs API Person chip. */
export type RawPerson = RawSuggested & { personId?: string; personProperties?: JsonObject; textStyle?: JsonObject };

/** Docs API RichLink chip. */
export type RawRichLink = RawSuggested & {
  richLinkId?: string;
  richLinkProperties?: JsonObject;
  textStyle?: JsonObject;
};

/** Docs API date chip (read back as `dateElement`; the server fills locale/format/displayText). */
export type RawDate = RawSuggested & { dateElementProperties?: JsonObject; dateId?: string; textStyle?: JsonObject };

/** Docs API inline image/drawing reference. */
export type RawInlineObjectElement = RawSuggested & { inlineObjectId?: string; textStyle?: JsonObject };

/** Docs API footnote reference marker. */
export type RawFootnoteReference = RawSuggested & {
  footnoteId?: string;
  footnoteNumber?: string;
  textStyle?: JsonObject;
};

/** Docs API standalone horizontal rule. */
export type RawHorizontalRule = RawSuggested & { textStyle?: JsonObject };

/** Docs API page break marker. */
export type RawPageBreak = RawSuggested & { textStyle?: JsonObject };

/** Docs API column break marker. */
export type RawColumnBreak = RawSuggested & { textStyle?: JsonObject };

/** Docs API inline equation. */
export type RawEquation = JsonObject;

/** Docs API auto-generated text (e.g. page number field). */
export type RawAutoText = RawSuggested & { textStyle?: JsonObject; type?: string };

/** One element inside a paragraph's `elements` array; exactly one variant key is set. */
export type RawParagraphElement = {
  autoText?: RawAutoText;
  columnBreak?: RawColumnBreak;
  dateElement?: RawDate;
  endIndex?: number;
  equation?: RawEquation;
  footnoteReference?: RawFootnoteReference;
  horizontalRule?: RawHorizontalRule;
  inlineObjectElement?: RawInlineObjectElement;
  pageBreak?: RawPageBreak;
  person?: RawPerson;
  richLink?: RawRichLink;
  startIndex?: number;
  textRun?: RawTextRun;
};

/** Docs API bullet reference on a paragraph. */
export type RawBullet = { listId?: string; nestingLevel?: number; textStyle?: JsonObject };

/** Docs API Paragraph structural element body. */
export type RawParagraph = {
  bullet?: RawBullet;
  elements?: RawParagraphElement[];
  paragraphStyle?: JsonObject;
  positionedObjectIds?: string[];
  suggestedBulletChanges?: JsonObject;
  suggestedParagraphStyleChanges?: JsonObject;
  suggestedPositionedObjectIds?: JsonObject;
};

/** Docs API TableCell (a container of block-level structural elements). */
export type RawTableCell = RawSuggested & {
  content?: RawStructuralElement[];
  endIndex?: number;
  startIndex?: number;
  suggestedTableCellStyleChanges?: JsonObject;
  tableCellStyle?: JsonObject;
};

/** Docs API TableRow. */
export type RawTableRow = RawSuggested & {
  endIndex?: number;
  startIndex?: number;
  suggestedTableRowStyleChanges?: JsonObject;
  tableCells?: RawTableCell[];
  tableRowStyle?: JsonObject;
};

/** Docs API Table structural element body. */
export type RawTable = {
  columns?: number;
  rows?: number;
  tableRows?: RawTableRow[];
  tableStyle?: JsonObject;
};

/** Docs API TableOfContents structural element body (opaque; not editable in v2). */
export type RawTableOfContents = { content?: RawStructuralElement[] };

/** Docs API SectionBreak structural element body. */
export type RawSectionBreak = { sectionStyle?: JsonObject };

/** One entry in a document body/cell/footer/footnote's `content` array; exactly one variant key is set. */
export type RawStructuralElement = {
  endIndex?: number;
  paragraph?: RawParagraph;
  sectionBreak?: RawSectionBreak;
  startIndex?: number;
  table?: RawTable;
  tableOfContents?: RawTableOfContents;
};

/** Docs API per-tab document content (body, styles, and every ancillary map that's tab-scoped). */
export type RawDocumentTab = {
  body?: { content?: RawStructuralElement[] };
  documentStyle?: JsonObject;
  footers?: Record<string, { content?: RawStructuralElement[] }>;
  footnotes?: Record<string, { content?: RawStructuralElement[] }>;
  headers?: Record<string, { content?: RawStructuralElement[] }>;
  inlineObjects?: Record<string, JsonObject>;
  lists?: Record<string, RawList>;
  namedRanges?: Record<string, RawNamedRanges>;
  namedStyles?: { styles?: Array<{ namedStyleType?: string; paragraphStyle?: JsonObject; textStyle?: JsonObject }> };
  positionedObjects?: Record<string, JsonObject>;
};

/** One entry in the top-level `tabs` array. */
export type RawTab = {
  childTabs?: RawTab[];
  documentTab?: RawDocumentTab;
  tabProperties?: { index?: number; parentTabId?: string; tabId?: string; title?: string };
};

/** Full raw `documents.get` response shape v2 parses from. */
export type RawDocument = {
  body?: { content?: RawStructuralElement[] };
  documentId?: string;
  documentStyle?: JsonObject;
  footers?: Record<string, { content?: RawStructuralElement[] }>;
  footnotes?: Record<string, { content?: RawStructuralElement[] }>;
  headers?: Record<string, { content?: RawStructuralElement[] }>;
  inlineObjects?: Record<string, JsonObject>;
  lists?: Record<string, RawList>;
  namedRanges?: Record<string, RawNamedRanges>;
  namedStyles?: { styles?: Array<{ namedStyleType?: string; paragraphStyle?: JsonObject; textStyle?: JsonObject }> };
  positionedObjects?: Record<string, JsonObject>;
  revisionId?: string;
  tabs?: RawTab[];
  title?: string;
};

/**
 * Casts a fetched `GoogleDoc` into v2's `RawDocument` shape after a minimal runtime check
 * (either `tabs` or a legacy `body` must be present, matching what `documents.get` always returns).
 */
export function rawDocumentOf(
  /** JSON returned by `documents.get`. */
  json: GoogleDoc,
): RawDocument {
  const raw = json as unknown as RawDocument;
  if (!raw.tabs && !raw.body) {
    throw new Error("rawDocumentOf: expected a document with `tabs` or a legacy `body`, got neither");
  }
  return raw;
}
