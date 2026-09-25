/* Pure builders for Google Docs batchUpdate request objects (no API calls). */

/** Constructs batchUpdate payloads for Google Docs. */
export class RequestBuilder {
  /** One createParagraphBullets covering a sibling range so items share a listId. */
  static createParagraphBullets(
    startIndex: number,
    endIndex: number,
    bulletPreset: string,
    segmentId?: string,
    tabId?: string,
  ): object {
    return {
      createParagraphBullets: {
        bulletPreset,
        range: rng(startIndex, endIndex, segmentId, tabId),
      },
    };
  }

  /** Strips list glyphs. No-op when the range is not a list. */
  static deleteParagraphBullets(startIndex: number, endIndex: number, segmentId?: string, tabId?: string): object {
    return {
      deleteParagraphBullets: {
        range: rng(startIndex, endIndex, segmentId, tabId),
      },
    };
  }

  static insertPageBreak(index: number, segmentId?: string, tabId?: string): object {
    return { insertPageBreak: { location: loc(index, segmentId, tabId) } };
  }

  /** Deletes a document tab. */
  static deleteTab(tabId: string): object {
    return {
      deleteTab: {
        tabId,
      },
    };
  }

  /** Inserts a row into a table. Defaults to inserting below the reference cell. */
  static insertTableRow(opts: {
    columnIndex?: number;
    insertBelow?: boolean;
    rowIndex: number;
    segmentId?: string;
    tabId?: string;
    tableStart: number;
  }): object {
    return {
      insertTableRow: {
        insertBelow: opts.insertBelow !== false,
        tableCellLocation: {
          columnIndex: opts.columnIndex ?? 0,
          rowIndex: opts.rowIndex,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId),
        },
      },
    };
  }

  /** Deletes a row from a table at the given cell coordinates. */
  static deleteTableRow(opts: {
    columnIndex?: number;
    rowIndex: number;
    segmentId?: string;
    tabId?: string;
    tableStart: number;
  }): object {
    return {
      deleteTableRow: {
        tableCellLocation: {
          columnIndex: opts.columnIndex ?? 0,
          rowIndex: opts.rowIndex,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId),
        },
      },
    };
  }

  /** Inserts a column into a table. Defaults to inserting to the right. */
  static insertTableColumn(opts: {
    columnIndex: number;
    insertRight?: boolean;
    rowIndex?: number;
    segmentId?: string;
    tabId?: string;
    tableStart: number;
  }): object {
    return {
      insertTableColumn: {
        insertRight: opts.insertRight !== false,
        tableCellLocation: {
          columnIndex: opts.columnIndex,
          rowIndex: opts.rowIndex ?? 0,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId),
        },
      },
    };
  }

  /** Deletes a column from a table at the given cell coordinates. */
  static deleteTableColumn(opts: {
    columnIndex: number;
    rowIndex?: number;
    segmentId?: string;
    tabId?: string;
    tableStart: number;
  }): object {
    return {
      deleteTableColumn: {
        tableCellLocation: {
          columnIndex: opts.columnIndex,
          rowIndex: opts.rowIndex ?? 0,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId),
        },
      },
    };
  }

  /** Pins N top header rows in a table so they repeat across page breaks. */
  static pinTableHeaderRows(opts: {
    pinnedHeaderRowsCount: number;
    segmentId?: string;
    tabId?: string;
    tableStart: number;
  }): object {
    return {
      pinTableHeaderRows: {
        pinnedHeaderRowsCount: opts.pinnedHeaderRowsCount,
        tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId),
      },
    };
  }

  /** Updates TableRowStyle properties (e.g. preventOverflow, minRowHeight). */
  static updateTableRowStyle(opts: {
    fields: string;
    minRowHeight?: number;
    preventOverflow?: boolean;
    rowIndices?: number[];
    segmentId?: string;
    tabId?: string;
    tableHeader?: boolean;
    tableStart: number;
  }): object {
    const tableRowStyle: Record<string, unknown> = {};
    if (opts.minRowHeight != null) {
      tableRowStyle.minRowHeight = pt(opts.minRowHeight);
    }
    if (opts.preventOverflow != null) {
      tableRowStyle.preventOverflow = opts.preventOverflow;
    }
    if (opts.tableHeader != null) {
      tableRowStyle.tableHeader = opts.tableHeader;
    }
    return {
      updateTableRowStyle: {
        fields: opts.fields,
        ...(opts.rowIndices ? { rowIndices: opts.rowIndices } : {}),
        tableRowStyle,
        tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId),
      },
    };
  }

  /** Updates document-wide styles, margins, and page setup. */
  static updateDocumentStyle(opts: { documentStyle: Record<string, unknown>; fields: string; tabId?: string }): object {
    return {
      updateDocumentStyle: {
        documentStyle: opts.documentStyle,
        fields: opts.fields,
        ...(opts.tabId ? { tabId: opts.tabId } : {}),
      },
    };
  }

  /** Inserts a section break (NEXT_PAGE or CONTINUOUS) at a location. */
  static insertSectionBreak(opts: {
    endOfSegment?: boolean;
    index: number;
    sectionType?: "CONTINUOUS" | "NEXT_PAGE";
    segmentId?: string;
    tabId?: string;
  }): object {
    const sectionType = opts.sectionType ?? "NEXT_PAGE";
    if (opts.endOfSegment) {
      return {
        insertSectionBreak: {
          endOfSegmentLocation: loc(opts.index, opts.segmentId, opts.tabId),
          sectionType,
        },
      };
    }
    return {
      insertSectionBreak: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        sectionType,
      },
    };
  }

  /** Inserts a smart chip person mention. */
  static insertPerson(opts: { email: string; index: number; segmentId?: string; tabId?: string }): object {
    return {
      insertPerson: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        personProperties: {
          email: opts.email,
        },
      },
    };
  }

  /** Inserts a smart chip rich link (Drive file, YouTube, Calendar, etc.). */
  static insertRichLink(opts: { index: number; segmentId?: string; tabId?: string; uri: string }): object {
    return {
      insertRichLink: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        richLinkProperties: {
          uri: opts.uri,
        },
      },
    };
  }

  /** Inserts a smart chip date. */
  static insertDate(opts: {
    dateFormat?: string;
    displayText?: string;
    index: number;
    segmentId?: string;
    tabId?: string;
    timestamp?: string;
  }): object {
    return {
      insertDate: {
        dateElementProperties: {
          ...(opts.dateFormat ? { dateFormat: opts.dateFormat } : {}),
          ...(opts.displayText ? { displayText: opts.displayText } : {}),
          ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
        },
        location: loc(opts.index, opts.segmentId, opts.tabId),
      },
    };
  }

  /** Inserts an inline image from a public URI. */
  static insertInlineImage(opts: {
    heightPt?: number;
    index: number;
    segmentId?: string;
    tabId?: string;
    uri: string;
    widthPt?: number;
  }): object {
    const objectSize: Record<string, unknown> = {};
    if (opts.widthPt != null) objectSize.width = pt(opts.widthPt);
    if (opts.heightPt != null) objectSize.height = pt(opts.heightPt);
    return {
      insertInlineImage: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        ...(Object.keys(objectSize).length ? { objectSize } : {}),
        uri: opts.uri,
      },
    };
  }

  // --- v2 builders (G3 D2): body-only, every location/range carries tabId ---

  /** Inserts text at a body index. */
  static insertTextAt(index: number, text: string, tabId: string): object {
    return { insertText: { location: loc(index, undefined, tabId), text } };
  }

  /** Deletes a body index range. */
  static contentRangeDelete(startIndex: number, endIndex: number, tabId: string): object {
    return { deleteContentRange: { range: rng(startIndex, endIndex, undefined, tabId) } };
  }

  /** Sets (or, for masked fields without a value, resets) text style over a range. */
  static textStyleUpdate(
    startIndex: number,
    endIndex: number,
    textStyle: Record<string, unknown>,
    fields: readonly string[],
    tabId: string,
  ): object {
    return {
      updateTextStyle: { fields: fields.join(","), range: rng(startIndex, endIndex, undefined, tabId), textStyle },
    };
  }

  /** Sets (or resets) paragraph style for every paragraph a range overlaps. */
  static paragraphStyleUpdate(
    startIndex: number,
    endIndex: number,
    paragraphStyle: Record<string, unknown>,
    fields: readonly string[],
    tabId: string,
  ): object {
    return {
      updateParagraphStyle: {
        fields: fields.join(","),
        paragraphStyle,
        range: rng(startIndex, endIndex, undefined, tabId),
      },
    };
  }

  /** Inserts an empty rows x columns table at a body index. */
  static tableInsert(index: number, rows: number, columns: number, tabId: string): object {
    return { insertTable: { columns, location: loc(index, undefined, tabId), rows } };
  }

  /** Merges a rectangle of table cells. */
  static tableCellsMerge(opts: TableRangeOpts): object {
    return { mergeTableCells: { tableRange: tableRange(opts) } };
  }

  /** Unmerges the merged cell at a table range's top-left. */
  static tableCellsUnmerge(opts: TableRangeOpts): object {
    return { unmergeTableCells: { tableRange: tableRange(opts) } };
  }

  /** Sets (or resets) cell style over a rectangle of cells. */
  static tableCellStyleUpdate(
    opts: TableRangeOpts & { fields: readonly string[]; tableCellStyle: Record<string, unknown> },
  ): object {
    return {
      updateTableCellStyle: {
        fields: opts.fields.join(","),
        tableCellStyle: opts.tableCellStyle,
        tableRange: tableRange(opts),
      },
    };
  }

  /** Sets (or resets) properties of table columns. */
  static tableColumnPropertiesUpdate(opts: {
    columnIndices: readonly number[];
    fields: readonly string[];
    tabId: string;
    tableColumnProperties: Record<string, unknown>;
    tableStart: number;
  }): object {
    return {
      updateTableColumnProperties: {
        columnIndices: opts.columnIndices,
        fields: opts.fields.join(","),
        tableColumnProperties: opts.tableColumnProperties,
        tableStartLocation: loc(opts.tableStart, undefined, opts.tabId),
      },
    };
  }

  /** Sets (or resets) the style of table rows. */
  static tableRowStyleUpdate(opts: {
    fields: readonly string[];
    rowIndices: readonly number[];
    tabId: string;
    tableRowStyle: Record<string, unknown>;
    tableStart: number;
  }): object {
    return {
      updateTableRowStyle: {
        fields: opts.fields.join(","),
        rowIndices: opts.rowIndices,
        tableRowStyle: opts.tableRowStyle,
        tableStartLocation: loc(opts.tableStart, undefined, opts.tabId),
      },
    };
  }

  /** Sets (or resets) the style of every section break a range covers (a range starting at 0 is the first section). */
  static sectionStyleUpdate(
    startIndex: number,
    endIndex: number,
    sectionStyle: Record<string, unknown>,
    fields: readonly string[],
    tabId: string,
  ): object {
    return {
      updateSectionStyle: {
        fields: fields.join(","),
        range: rng(startIndex, endIndex, undefined, tabId),
        sectionStyle,
      },
    };
  }

  /** Updates a tab's title and/or index (the tab is named inside `tabProperties`, F19). */
  static documentTabPropertiesUpdate(
    tabId: string,
    properties: { index?: number; title?: string },
    fields: readonly ("index" | "title")[],
  ): object {
    return { updateDocumentTabProperties: { fields: fields.join(","), tabProperties: { ...properties, tabId } } };
  }

  /** Adds a tab, optionally under a parent and at an index among its siblings. */
  static documentTabAdd(title: string, opts: { index?: number; parentTabId?: string } = {}): object {
    return {
      addDocumentTab: {
        tabProperties: {
          ...(opts.index != null ? { index: opts.index } : {}),
          ...(opts.parentTabId ? { parentTabId: opts.parentTabId } : {}),
          title,
        },
      },
    };
  }
}

/** Where a v2 table-range request points: a table start, a top-left cell, and a span. */
type TableRangeOpts = {
  columnIndex: number;
  columnSpan: number;
  rowIndex: number;
  rowSpan: number;
  tabId: string;
  tableStart: number;
};

/** Builds a Docs API TableRange. */
function tableRange(opts: TableRangeOpts): object {
  return {
    columnSpan: opts.columnSpan,
    rowSpan: opts.rowSpan,
    tableCellLocation: {
      columnIndex: opts.columnIndex,
      rowIndex: opts.rowIndex,
      tableStartLocation: loc(opts.tableStart, undefined, opts.tabId),
    },
  };
}

/** Builds a Docs API Location object with optional segmentId and tabId. */
function loc(index: number, segmentId?: string, tabId?: string): { index: number; segmentId?: string; tabId?: string } {
  return {
    index,
    ...(segmentId ? { segmentId } : {}),
    ...(tabId ? { tabId } : {}),
  };
}

/** Builds a Docs API Range object with optional segmentId and tabId. */
function rng(
  startIndex: number,
  endIndex: number,
  segmentId?: string,
  tabId?: string,
): {
  endIndex: number;
  segmentId?: string;
  startIndex: number;
  tabId?: string;
} {
  return {
    endIndex,
    startIndex,
    ...(segmentId ? { segmentId } : {}),
    ...(tabId ? { tabId } : {}),
  };
}

/** Builds a Docs API Dimension object in points. */
function pt(magnitude: number): { magnitude: number; unit: "PT" } {
  return { magnitude, unit: "PT" };
}
