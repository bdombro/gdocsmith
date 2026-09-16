/*

Shared structural types for Google Docs API payloads.

*/

/** Totals returned after applying one or more operations. */
export type ApplySummary = {
  deleteChars: number;
  insertChars: number;
  requestCount: number;
  tables: number;
};

/** One structural element in a document body (paragraph, table, break, etc.). */
export type DocElement = {
  endIndex: number;
  paragraph?: {
    bullet?: { glyph?: string; listId?: string; nestingLevel?: number };
    elements?: Array<{
      dateElement?: {
        dateElementProperties?: {
          date?: string;
          displayText?: string;
        };
        dateId?: string;
        textStyle?: Record<string, unknown>;
      };
      endIndex?: number;
      equation?: unknown;
      footnoteReference?: { footnoteId?: string };
      horizontalRule?: unknown;
      inlineObjectElement?: { inlineObjectId?: string };
      pageBreak?: unknown;
      person?: {
        personId?: string;
        personProperties?: {
          email?: string;
          name?: string;
        };
        textStyle?: Record<string, unknown>;
      };
      richLink?: {
        richLinkId?: string;
        richLinkProperties?: {
          mimeType?: string;
          title?: string;
          uri?: string;
        };
        textStyle?: Record<string, unknown>;
      };
      startIndex?: number;
      textRun?: { content?: string; textStyle?: Record<string, unknown> };
    }>;
    paragraphStyle?: {
      alignment?: string;
      headingId?: string;
      indentEnd?: { magnitude?: number; unit?: string };
      indentFirstLine?: { magnitude?: number; unit?: string };
      indentStart?: { magnitude?: number; unit?: string };
      lineSpacing?: number;
      namedStyleType?: string;
      shading?: {
        backgroundColor?: {
          color?: { rgbColor?: { blue?: number; green?: number; red?: number } };
        };
      };
      spaceAbove?: { magnitude?: number; unit?: string };
      spaceBelow?: { magnitude?: number; unit?: string };
    };
  };
  positionedObject?: unknown;
  sectionBreak?: { sectionStyle?: { columnCount?: number } };
  startIndex: number;
  table?: {
    columns: number;
    rows: number;
    tableStyle?: {
      tableColumnProperties?: Array<{
        width?: { magnitude?: number; unit?: string };
        widthType?: string;
      }>;
    };
    tableRows?: Array<{
      tableRowStyle?: {
        minRowHeight?: { magnitude?: number; unit?: string };
        preventOverflow?: boolean;
        tableHeader?: boolean;
      };
      tableCells?: Array<{
        content?: DocElement[];
        tableCellStyle?: {
          backgroundColor?: {
            color?: { rgbColor?: { blue?: number; green?: number; red?: number } };
          };
          borderTop?: {
            color?: { color?: { rgbColor?: { blue?: number; green?: number; red?: number } } };
          };
          contentAlignment?: string;
          paddingTop?: { magnitude?: number; unit?: string };
        };
      }>;
    }>;
  };
  tableOfContents?: unknown;
};

/** One Docs tab, including nested child tabs. */
export type DocTab = {
  childTabs?: DocTab[];
  documentTab?: DocumentTab;
  tabProperties?: { tabId?: string; title?: string };
};

/** Minimal document snapshot from documents.get. */
export type GoogleDoc = {
  body?: { content: DocElement[] };
  documentId?: string;
  revisionId?: string;
  tabs?: DocTab[];
  documentStyle?: {
    defaultFooterId?: string;
    defaultHeaderId?: string;
    documentFormat?: { documentMode?: "PAGES" | "PAGELESS" };
    evenPageFooterId?: string;
    evenPageHeaderId?: string;
    firstPageFooterId?: string;
    firstPageHeaderId?: string;
    flipPageOrientation?: boolean;
    marginBottom?: { magnitude?: number; unit?: string };
    marginLeft?: { magnitude?: number; unit?: string };
    marginRight?: { magnitude?: number; unit?: string };
    marginTop?: { magnitude?: number; unit?: string };
    pageSize?: {
      height?: { magnitude?: number; unit?: string };
      width?: { magnitude?: number; unit?: string };
    };
    useEvenPageHeaderFooter?: boolean;
    useFirstPageHeaderFooter?: boolean;
  };
  footnotes?: Record<string, { content?: DocElement[]; footnoteId?: string }>;
  footers?: Record<string, { content?: DocElement[]; footerId?: string }>;
  headers?: Record<string, { content?: DocElement[]; headerId?: string }>;
  inlineObjects?: Record<
    string,
    {
      inlineObjectProperties?: {
        embeddedObject?: {
          imageProperties?: { sourceUri?: string };
          size?: {
            height?: { magnitude?: number; unit?: string };
            width?: { magnitude?: number; unit?: string };
          };
        };
      };
    }
  >;
  lists?: Record<
    string,
    {
      listProperties?: {
        nestingLevels?: Array<Record<string, unknown>>;
      };
    }
  >;
  title?: string;
};

/** Per-tab content (documents.get includeTabsContent). */
export type DocumentTab = Pick<
  GoogleDoc,
  "body" | "documentStyle" | "footnotes" | "footers" | "headers" | "inlineObjects" | "lists"
>;
