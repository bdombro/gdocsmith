/* Shared structural types for Google Docs API payloads. */

/**
 * Totals returned after applying one or more operations.
 */
export type ApplySummary = {
  /** Number of characters deleted. */
  deleteChars: number;
  /** Number of characters inserted. */
  insertChars: number;
  /** Number of API requests generated. */
  requestCount: number;
  /** Number of table operations applied. */
  tables: number;
};

/**
 * One structural element in a document body (paragraph, table, break, etc.).
 */
export type DocElement = {
  /** End index (exclusive) in the document segment. */
  endIndex: number;
  /** Paragraph content and styling if this element represents a paragraph. */
  paragraph?: {
    /** Bullet and list configuration for bulleted or numbered paragraphs. */
    bullet?: {
      /** Rendered glyph string. */
      glyph?: string;
      /** Unique list identifier. */
      listId?: string;
      /** Zero-based indentation nesting level. */
      nestingLevel?: number;
    };
    /** Array of inline content elements contained within this paragraph. */
    elements?: Array<{
      /** Date chip element properties. */
      dateElement?: {
        /** Associated date parameters. */
        dateElementProperties?: {
          /** ISO date string. */
          date?: string;
          /** Display text label. */
          displayText?: string;
        };
        /** Unique date identifier. */
        dateId?: string;
        /** Text styling applied to the chip. */
        textStyle?: Record<string, unknown>;
      };
      /** End index of this inline element. */
      endIndex?: number;
      /** Equation object if present. */
      equation?: unknown;
      /** Footnote reference anchor if present. */
      footnoteReference?: {
        /** Unique footnote identifier. */
        footnoteId?: string;
      };
      /** Horizontal rule element if present. */
      horizontalRule?: unknown;
      /** Inline image or embedded object element. */
      inlineObjectElement?: {
        /** Unique inline object identifier. */
        inlineObjectId?: string;
      };
      /** Hard page break element if present. */
      pageBreak?: unknown;
      /** People / user mention chip element. */
      person?: {
        /** Unique person identifier. */
        personId?: string;
        /** Metadata for the mentioned person. */
        personProperties?: {
          /** Email address. */
          email?: string;
          /** Display name. */
          name?: string;
        };
        /** Text styling applied to the person chip. */
        textStyle?: Record<string, unknown>;
      };
      /** Rich link chip element. */
      richLink?: {
        /** Unique rich link identifier. */
        richLinkId?: string;
        /** Metadata for the linked resource. */
        richLinkProperties?: {
          /** MIME type of the link target. */
          mimeType?: string;
          /** Title of the linked target. */
          title?: string;
          /** URI of the link target. */
          uri?: string;
        };
        /** Text styling applied to the rich link. */
        textStyle?: Record<string, unknown>;
      };
      /** Start index of this inline element. */
      startIndex?: number;
      /** Text run containing string content and style attributes. */
      textRun?: {
        /** Raw text content. */
        content?: string;
        /** Character styling attributes. */
        textStyle?: Record<string, unknown>;
      };
    }>;
    /** Paragraph-level styling properties. */
    paragraphStyle?: {
      /** Text alignment: START, CENTER, END, JUSTIFIED. */
      alignment?: string;
      /** Heading identifier anchor if heading style. */
      headingId?: string;
      /** End margin indentation. */
      indentEnd?: {
        /** Magnitude of indentation. */
        magnitude?: number;
        /** Unit of measurement (e.g. PT). */
        unit?: string;
      };
      /** First line indentation. */
      indentFirstLine?: {
        /** Magnitude of indentation. */
        magnitude?: number;
        /** Unit of measurement (e.g. PT). */
        unit?: string;
      };
      /** Start margin indentation. */
      indentStart?: {
        /** Magnitude of indentation. */
        magnitude?: number;
        /** Unit of measurement (e.g. PT). */
        unit?: string;
      };
      /** Line spacing percentage. */
      lineSpacing?: number;
      /** Named paragraph style identifier (e.g. NORMAL_TEXT, HEADING_1). */
      namedStyleType?: string;
      /** Background shading for callouts or highlighted blocks. */
      shading?: {
        /** Shading background color. */
        backgroundColor?: {
          /** RGB color coordinates. */
          color?: {
            /** Color components. */
            rgbColor?: {
              /** Blue channel value 0.0 - 1.0. */
              blue?: number;
              /** Green channel value 0.0 - 1.0. */
              green?: number;
              /** Red channel value 0.0 - 1.0. */
              red?: number;
            };
          };
        };
      };
      /** Space above paragraph. */
      spaceAbove?: {
        /** Magnitude in points. */
        magnitude?: number;
        /** Unit of measurement. */
        unit?: string;
      };
      /** Space below paragraph. */
      spaceBelow?: {
        /** Magnitude in points. */
        magnitude?: number;
        /** Unit of measurement. */
        unit?: string;
      };
    };
  };
  /** Positioned floating object reference if present. */
  positionedObject?: unknown;
  /** Section break structural element. */
  sectionBreak?: {
    /** Style attributes applied to this document section. */
    sectionStyle?: {
      /** Number of layout columns. */
      columnCount?: number;
    };
  };
  /** Start index (inclusive) in the document segment. */
  startIndex: number;
  /** Table structural element containing rows and cells. */
  table?: {
    /** Column count. */
    columns: number;
    /** Row count. */
    rows: number;
    /** Table-level style settings. */
    tableStyle?: {
      /** Column width specifications. */
      tableColumnProperties?: Array<{
        /** Column width magnitude and unit. */
        width?: {
          /** Width magnitude in points. */
          magnitude?: number;
          /** Unit of measurement. */
          unit?: string;
        };
        /** Column width sizing strategy. */
        widthType?: string;
      }>;
    };
    /** Array of table rows. */
    tableRows?: Array<{
      /** Array of cells within this table row. */
      tableCells?: Array<{
        /** Structural elements contained inside the cell. */
        content?: DocElement[];
        /** Cell visual styling properties. */
        tableCellStyle?: {
          /** Cell background color. */
          backgroundColor?: {
            /** Shading color wrapper. */
            color?: {
              /** RGB components. */
              rgbColor?: {
                /** Blue channel. */
                blue?: number;
                /** Green channel. */
                green?: number;
                /** Red channel. */
                red?: number;
              };
            };
          };
          /** Top border styling. */
          borderTop?: {
            /** Border color wrapper. */
            color?: {
              /** Color wrapper. */
              color?: {
                /** RGB color channels. */
                rgbColor?: {
                  /** Blue channel. */
                  blue?: number;
                  /** Green channel. */
                  green?: number;
                  /** Red channel. */
                  red?: number;
                };
              };
            };
          };
          /** Vertical alignment of cell content: TOP, MIDDLE, BOTTOM. */
          contentAlignment?: string;
          /** Top cell padding. */
          paddingTop?: {
            /** Padding magnitude. */
            magnitude?: number;
            /** Unit of measurement. */
            unit?: string;
          };
        };
      }>;
      /** Row styling options. */
      tableRowStyle?: {
        /** Minimum height for the row. */
        minRowHeight?: {
          /** Magnitude. */
          magnitude?: number;
          /** Unit. */
          unit?: string;
        };
        /** Prevent row from splitting across pages. */
        preventOverflow?: boolean;
        /** Indicates row is a repeating table header. */
        tableHeader?: boolean;
      };
    }>;
  };
  /** Table of contents structural element. */
  tableOfContents?: unknown;
};

/**
 * One Docs tab, including optional nested child tabs.
 */
export type DocTab = {
  /** Nested sub-tabs. */
  childTabs?: DocTab[];
  /** Content of the tab if loaded. */
  documentTab?: DocumentTab;
  /** Identifying properties of the tab. */
  tabProperties?: {
    /** Unique tab identifier. */
    tabId?: string;
    /** Human-readable tab title. */
    title?: string;
  };
};

/**
 * Per-tab content subset matching document body and definitions.
 */
export type DocumentTab = Pick<
  GoogleDoc,
  "body" | "documentStyle" | "footers" | "footnotes" | "headers" | "inlineObjects" | "lists"
>;

/**
 * Minimal document snapshot returned from documents.get API.
 */
export type GoogleDoc = {
  /** Document body containing structural elements. */
  body?: {
    /** Array of structural document elements in document order. */
    content: DocElement[];
  };
  /** Unique Google Doc document identifier. */
  documentId?: string;
  /** Page setup and document-level style configuration. */
  documentStyle?: {
    /** Default footer ID. */
    defaultFooterId?: string;
    /** Default header ID. */
    defaultHeaderId?: string;
    /** Document mode configuration. */
    documentFormat?: {
      /** Document layout mode: PAGES or PAGELESS. */
      documentMode?: "PAGES" | "PAGELESS";
    };
    /** Even page footer ID. */
    evenPageFooterId?: string;
    /** Even page header ID. */
    evenPageHeaderId?: string;
    /** First page footer ID. */
    firstPageFooterId?: string;
    /** First page header ID. */
    firstPageHeaderId?: string;
    /** Page orientation toggle. */
    flipPageOrientation?: boolean;
    /** Bottom margin dimension. */
    marginBottom?: {
      /** Dimension magnitude. */
      magnitude?: number;
      /** Unit of measurement. */
      unit?: string;
    };
    /** Left margin dimension. */
    marginLeft?: {
      /** Dimension magnitude. */
      magnitude?: number;
      /** Unit of measurement. */
      unit?: string;
    };
    /** Right margin dimension. */
    marginRight?: {
      /** Dimension magnitude. */
      magnitude?: number;
      /** Unit of measurement. */
      unit?: string;
    };
    /** Top margin dimension. */
    marginTop?: {
      /** Dimension magnitude. */
      magnitude?: number;
      /** Unit of measurement. */
      unit?: string;
    };
    /** Page dimensions. */
    pageSize?: {
      /** Page height dimension. */
      height?: {
        /** Magnitude. */
        magnitude?: number;
        /** Unit. */
        unit?: string;
      };
      /** Page width dimension. */
      width?: {
        /** Magnitude. */
        magnitude?: number;
        /** Unit. */
        unit?: string;
      };
    };
    /** Even page header/footer flag. */
    useEvenPageHeaderFooter?: boolean;
    /** First page header/footer flag. */
    useFirstPageHeaderFooter?: boolean;
  };
  /** Footers dictionary mapped by footer ID. */
  footers?: Record<
    string,
    {
      /** Footer structural elements. */
      content?: DocElement[];
      /** Footer ID. */
      footerId?: string;
    }
  >;
  /** Footnotes dictionary mapped by footnote ID. */
  footnotes?: Record<
    string,
    {
      /** Footnote structural elements. */
      content?: DocElement[];
      /** Footnote ID. */
      footnoteId?: string;
    }
  >;
  /** Headers dictionary mapped by header ID. */
  headers?: Record<
    string,
    {
      /** Header structural elements. */
      content?: DocElement[];
      /** Header ID. */
      headerId?: string;
    }
  >;
  /** Embedded inline images and objects mapped by object ID. */
  inlineObjects?: Record<
    string,
    {
      /** Inline object metadata. */
      inlineObjectProperties?: {
        /** Embedded object properties. */
        embeddedObject?: {
          /** Image details. */
          imageProperties?: {
            /** Source URI for the image. */
            sourceUri?: string;
          };
          /** Image dimensions. */
          size?: {
            /** Image height. */
            height?: {
              /** Height magnitude. */
              magnitude?: number;
              /** Unit. */
              unit?: string;
            };
            /** Image width. */
            width?: {
              /** Width magnitude. */
              magnitude?: number;
              /** Unit. */
              unit?: string;
            };
          };
        };
      };
    }
  >;
  /** List definitions mapped by list ID. */
  lists?: Record<
    string,
    {
      /** List properties. */
      listProperties?: {
        /** Hierarchy configuration for nesting levels. */
        nestingLevels?: Array<Record<string, unknown>>;
      };
    }
  >;
  /** Head revision ID of the document. */
  revisionId?: string;
  /** Tab definitions when includeTabsContent=true is used. */
  tabs?: DocTab[];
  /** Document title string. */
  title?: string;
};
