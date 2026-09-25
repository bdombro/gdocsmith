/* Pure builders for Google Docs batchUpdate request objects (no API calls). */

import type { ParagraphInlineSpecial } from "./dom/element.ts";
import { hangingFirstLine, optionalColor, pt, type StylePatch } from "./dom/style.ts";
import { InlineMarkup, type TextRun } from "./inline.ts";
import type { DocElement } from "./types.ts";

/** Constructs batchUpdate payloads for surgical writes. */
export class RequestBuilder {
  /** Fills table cells after insertTable; inserts run highest index first. */
  static buildTableFill(
    /** Whether the first row is a header (bold). */
    header: boolean,
    /** Matrix of cell text strings. */
    rows: string[][],
    /** Live table element from documents.get. */
    tableEl: DocElement,
    /** Header/footer segment id. */
    segmentId?: string,
    /** Target tab id. */
    tabId?: string,
    /** Per-cell inline specials aligned with `rows`. */
    cellSpecials?: Array<Array<ParagraphInlineSpecial[] | undefined>>,
  ): object[] {
    const inserts: Array<{
      boldRow: boolean;
      idx: number;
      line: string;
      runs: TextRun[];
      specials?: ParagraphInlineSpecial[];
    }> = [];

    const tableRows = tableEl.table?.tableRows ?? [];
    for (let r = 0; r < rows.length; r++) {
      const cells = tableRows[r]?.tableCells ?? [];
      for (let c = 0; c < rows[r]?.length; c++) {
        const cellText = rows[r]?.[c] ?? "";
        const specials = cellSpecials?.[r]?.[c];
        if (!cellText && !specials?.length) continue;
        const idx = RequestBuilder.#cellInsertIndex(cells[c] ?? {});
        if (!cellText) {
          inserts.push({ boldRow: false, idx, line: "", runs: [], specials });
          continue;
        }
        const { runs, text: plain } = InlineMarkup.parse(cellText);
        const line = plain.endsWith("\n") ? plain : `${plain}\n`;
        inserts.push({ boldRow: header && r === 0, idx, line, runs, specials });
      }
    }

    inserts.sort((a, b) => b.idx - a.idx);

    const requests: object[] = [];
    for (const { boldRow, idx, line, runs, specials } of inserts) {
      if (line) {
        requests.push({
          insertText: { location: loc(idx, segmentId, tabId), text: line },
        });
        const textEnd = idx + Math.max(0, line.length - (line.endsWith("\n") ? 1 : 0));
        if (textEnd > idx) {
          requests.push(RequestBuilder.clearInlineStyles(idx, textEnd, segmentId, tabId));
        }
        requests.push(...RequestBuilder.#textStyleRequests(idx, runs, segmentId, tabId));
        if (boldRow) {
          requests.push({
            updateTextStyle: {
              fields: "bold",
              range: rng(idx, idx + line.length - 1, segmentId, tabId),
              textStyle: { bold: true },
            },
          });
        }
      }
      requests.push(...RequestBuilder.insertInlineSpecials({ index: idx, segmentId, specials, tabId }));
    }
    return requests;
  }

  /**
   * Inserts `\n` at a paragraph's trailing newline so the next write lands in
   * a NEW sibling paragraph (Docs has no insert-sibling call).
   */
  static splitAfter(endIndex: number, segmentId?: string, tabId?: string): object {
    return {
      insertText: {
        location: loc(Math.max(1, endIndex - 1), segmentId, tabId),
        text: "\n",
      },
    };
  }

  /** Inserts `\n` at a paragraph start to create a sibling before it. */
  static splitBefore(startIndex: number, segmentId?: string, tabId?: string): object {
    return {
      insertText: { location: loc(startIndex, segmentId, tabId), text: "\n" },
    };
  }

  /**
   * Replaces paragraph body text, keeping the trailing newline.
   * Does not emit namedStyleType — callers must not restyle on innerText.
   */
  static replaceInnerText(
    startIndex: number,
    endIndex: number,
    text: string,
    segmentId?: string,
    tabId?: string,
  ): object[] {
    const textEnd = Math.max(startIndex, endIndex - 1);
    const requests: object[] = [];
    if (textEnd > startIndex) {
      requests.push({
        deleteContentRange: {
          range: rng(startIndex, textEnd, segmentId, tabId),
        },
      });
    }
    if (text.length) {
      requests.push({
        insertText: { location: loc(startIndex, segmentId, tabId), text },
      });
    }
    return requests;
  }

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

  /** indentStart + indentFirstLine for a list nesting level (18pt hanging). */
  static indentListLevel(
    startIndex: number,
    endIndex: number,
    indent: { indentFirstLine: number; indentStart: number },
    segmentId?: string,
    tabId?: string,
  ): object {
    return {
      updateParagraphStyle: {
        fields: "indentStart,indentFirstLine",
        paragraphStyle: {
          indentFirstLine: pt(indent.indentFirstLine),
          indentStart: pt(indent.indentStart),
        },
        range: rng(startIndex, endIndex, segmentId, tabId),
      },
    };
  }

  /** indentStart on a paragraph range, in PT. */
  static indentStart(
    startIndex: number,
    endIndex: number,
    magnitude: number,
    segmentId?: string,
    tabId?: string,
  ): object {
    return {
      updateParagraphStyle: {
        fields: "indentStart",
        paragraphStyle: {
          indentStart: pt(magnitude),
        },
        range: rng(startIndex, endIndex, segmentId, tabId),
      },
    };
  }

  /** namedStyleType on a paragraph range — for new siblings, never innerText. */
  static namedStyle(
    startIndex: number,
    endIndex: number,
    namedStyleType: string,
    segmentId?: string,
    tabId?: string,
  ): object {
    return {
      updateParagraphStyle: {
        fields: "namedStyleType",
        paragraphStyle: { namedStyleType },
        range: rng(startIndex, endIndex, segmentId, tabId),
      },
    };
  }

  /** Paragraph alignment (START / CENTER / END / JUSTIFIED). */
  static alignment(
    startIndex: number,
    endIndex: number,
    alignment: "START" | "CENTER" | "END" | "JUSTIFIED",
    segmentId?: string,
    tabId?: string,
  ): object {
    return {
      updateParagraphStyle: {
        fields: "alignment",
        paragraphStyle: { alignment },
        range: rng(startIndex, endIndex, segmentId, tabId),
      },
    };
  }

  static insertPageBreak(index: number, segmentId?: string, tabId?: string): object {
    return { insertPageBreak: { location: loc(index, segmentId, tabId) } };
  }

  /** Native paragraph / text / cell / section / table style fields. */
  static applyStyle(opts: {
    cell?: [number, number];
    /** Cell paragraph ranges for table-wide horizontal alignment. */
    cellRanges?: Array<{ end: number; start: number }>;
    end: number;
    /** List items get a hanging first-line when indentStart is set without indentFirstLine. */
    isBullet?: boolean;
    patch: StylePatch;
    segmentId?: string;
    start: number;
    tabId?: string;
    tableStart?: number;
    /** Style the whole table (not a paragraph range). */
    tableWide?: boolean;
  }): object[] {
    const { end, patch, segmentId, start, tabId } = opts;
    const requests: object[] = [];
    const para: Record<string, unknown> = {};
    const paraFields: string[] = [];
    if (patch.alignment) {
      paraFields.push("alignment");
      para.alignment = patch.alignment;
    }
    if (patch.spaceAbove != null) {
      paraFields.push("spaceAbove");
      para.spaceAbove = pt(patch.spaceAbove);
    }
    if (patch.spaceBelow != null) {
      paraFields.push("spaceBelow");
      para.spaceBelow = pt(patch.spaceBelow);
    }
    if (patch.lineSpacing != null) {
      paraFields.push("lineSpacing");
      para.lineSpacing = patch.lineSpacing;
    }
    if (patch.shading) {
      paraFields.push("shading");
      para.shading = { backgroundColor: optionalColor(patch.shading) };
    }
    RequestBuilder.#indentFields(para, paraFields, patch, Boolean(opts.isBullet));
    if (paraFields.length && !opts.tableWide) {
      requests.push({
        updateParagraphStyle: {
          fields: paraFields.join(","),
          paragraphStyle: para,
          range: rng(start, end, segmentId, tabId),
        },
      });
    }
    if (opts.tableWide && patch.alignment) {
      for (const cell of opts.cellRanges ?? []) {
        if (cell.start < 0 || cell.end <= cell.start) continue;
        requests.push({
          updateParagraphStyle: {
            fields: "alignment",
            paragraphStyle: { alignment: patch.alignment },
            range: rng(cell.start, cell.end, segmentId, tabId),
          },
        });
      }
    }

    const text: Record<string, unknown> = {};
    const textFields: string[] = [];
    if (patch.bold != null) {
      textFields.push("bold");
      text.bold = patch.bold;
    }
    if (patch.italic != null) {
      textFields.push("italic");
      text.italic = patch.italic;
    }
    if (patch.underline != null) {
      textFields.push("underline");
      text.underline = patch.underline;
    }
    if (patch.strikethrough != null) {
      textFields.push("strikethrough");
      text.strikethrough = patch.strikethrough;
    }
    if (patch.foregroundColor) {
      textFields.push("foregroundColor");
      text.foregroundColor = optionalColor(patch.foregroundColor);
    }
    if (patch.backgroundColor) {
      textFields.push("backgroundColor");
      text.backgroundColor = optionalColor(patch.backgroundColor);
    }
    if (patch.fontSize != null) {
      textFields.push("fontSize");
      text.fontSize = pt(patch.fontSize);
    }
    if (patch.fontFamily) {
      textFields.push("weightedFontFamily");
      text.weightedFontFamily = { fontFamily: patch.fontFamily };
    }
    if (textFields.length && end > start && !opts.tableWide) {
      requests.push({
        updateTextStyle: {
          fields: textFields.join(","),
          range: rng(start, Math.max(start, end - 1), segmentId, tabId),
          textStyle: text,
        },
      });
    }

    requests.push(...RequestBuilder.#tableChrome(opts));

    if (patch.columnCount != null) {
      requests.push({
        updateSectionStyle: {
          fields: "columnCount",
          range: rng(start, end, segmentId, tabId),
          sectionStyle: { columnCount: patch.columnCount },
        },
      });
    }
    return requests;
  }

  /** indentStart / indentFirstLine / indentEnd. Bullets hang unless firstLine is set. */
  static #indentFields(
    para: Record<string, unknown>,
    paraFields: string[],
    patch: StylePatch,
    isBullet: boolean,
  ): void {
    if (patch.indentEnd != null) {
      paraFields.push("indentEnd");
      para.indentEnd = pt(patch.indentEnd);
    }
    if (patch.indentStart != null && patch.indentFirstLine != null) {
      paraFields.push("indentStart", "indentFirstLine");
      para.indentStart = pt(patch.indentStart);
      para.indentFirstLine = pt(patch.indentFirstLine);
      return;
    }
    if (patch.indentStart != null) {
      paraFields.push("indentStart");
      para.indentStart = pt(patch.indentStart);
      if (isBullet) {
        paraFields.push("indentFirstLine");
        para.indentFirstLine = pt(hangingFirstLine(patch.indentStart));
      }
      return;
    }
    if (patch.indentFirstLine != null) {
      paraFields.push("indentFirstLine");
      para.indentFirstLine = pt(patch.indentFirstLine);
    }
  }

  /**
   * Column width, borders, padding, vertical align, fill, min row height.
   * Table node = whole table; cell id scopes column/row/cell.
   */
  static #tableChrome(opts: {
    cell?: [number, number];
    patch: StylePatch;
    segmentId?: string;
    tabId?: string;
    tableStart?: number;
  }): object[] {
    const { patch, segmentId, tabId } = opts;
    const tableStart = opts.tableStart;
    const needsTable =
      patch.columnWidth != null ||
      patch.minRowHeight != null ||
      patch.pinnedHeaderRows != null ||
      patch.preventOverflow != null ||
      patch.cellBackground ||
      patch.contentAlignment ||
      patch.cellPadding != null ||
      patch.borderColor;
    if (!needsTable) return [];
    if (tableStart == null) {
      throw new Error(
        "columnWidth, borders, cellPadding, contentAlignment, minRowHeight, pinnedHeaderRows, and cellBackground require a table or cell id",
      );
    }
    const startLoc = loc(tableStart, segmentId, tabId);
    const requests: object[] = [];
    if (patch.pinnedHeaderRows != null) {
      requests.push({
        pinTableHeaderRows: {
          pinnedHeaderRowsCount: patch.pinnedHeaderRows,
          tableStartLocation: startLoc,
        },
      });
    }
    if (patch.preventOverflow != null) {
      requests.push({
        updateTableRowStyle: {
          fields: "preventOverflow",
          tableRowStyle: { preventOverflow: patch.preventOverflow },
          tableStartLocation: startLoc,
          ...(opts.cell ? { rowIndices: [opts.cell[0]] } : {}),
        },
      });
    }
    if (patch.columnWidth != null) {
      if (patch.columnWidth < 5) {
        throw new Error("columnWidth must be at least 5 PT");
      }
      requests.push({
        updateTableColumnProperties: {
          fields: "widthType,width",
          tableColumnProperties: {
            width: pt(patch.columnWidth),
            widthType: "FIXED_WIDTH",
          },
          tableStartLocation: startLoc,
          ...(opts.cell ? { columnIndices: [opts.cell[1]] } : {}),
        },
      });
    }
    if (patch.minRowHeight != null) {
      requests.push({
        updateTableRowStyle: {
          fields: "minRowHeight",
          tableRowStyle: { minRowHeight: pt(patch.minRowHeight) },
          tableStartLocation: startLoc,
          ...(opts.cell ? { rowIndices: [opts.cell[0]] } : {}),
        },
      });
    }

    const tableCellStyle: Record<string, unknown> = {};
    const fields: string[] = [];
    if (patch.cellBackground) {
      fields.push("backgroundColor");
      tableCellStyle.backgroundColor = optionalColor(patch.cellBackground);
    }
    if (patch.contentAlignment) {
      fields.push("contentAlignment");
      tableCellStyle.contentAlignment = patch.contentAlignment;
    }
    if (patch.cellPadding != null) {
      const pad = pt(patch.cellPadding);
      fields.push("paddingTop", "paddingBottom", "paddingLeft", "paddingRight");
      tableCellStyle.paddingTop = pad;
      tableCellStyle.paddingBottom = pad;
      tableCellStyle.paddingLeft = pad;
      tableCellStyle.paddingRight = pad;
    }
    if (patch.borderColor) {
      const border = {
        color: optionalColor(patch.borderColor),
        dashStyle: "SOLID",
        width: pt(patch.borderWidth ?? 1),
      };
      fields.push("borderTop", "borderBottom", "borderLeft", "borderRight");
      tableCellStyle.borderTop = border;
      tableCellStyle.borderBottom = border;
      tableCellStyle.borderLeft = border;
      tableCellStyle.borderRight = border;
    } else if (patch.borderWidth != null) {
      throw new Error("borderWidth requires borderColor");
    }
    if (fields.length) {
      requests.push({
        updateTableCellStyle: {
          fields: fields.join(","),
          tableCellStyle,
          ...(opts.cell
            ? {
                tableRange: {
                  columnSpan: 1,
                  rowSpan: 1,
                  tableCellLocation: {
                    columnIndex: opts.cell[1],
                    rowIndex: opts.cell[0],
                    tableStartLocation: startLoc,
                  },
                },
              }
            : { tableStartLocation: startLoc }),
        },
      });
    }
    return requests;
  }

  /** Public wrapper for inline text styles after insert/replace. */
  static buildTextStyles(baseIndex: number, runs: TextRun[], segmentId?: string, tabId?: string): object[] {
    return RequestBuilder.#textStyleRequests(baseIndex, runs, segmentId, tabId);
  }

  static clearInlineStyles(startIndex: number, endIndex: number, segmentId?: string, tabId?: string): object {
    if (endIndex <= startIndex) {
      throw new Error("clearInlineStyles range is empty");
    }
    return {
      updateTextStyle: {
        fields:
          "bold,italic,underline,strikethrough,smallCaps,baselineOffset,link,weightedFontFamily,fontSize,foregroundColor,backgroundColor",
        range: rng(startIndex, endIndex, segmentId, tabId),
        textStyle: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
        },
      },
    };
  }

  /** First paragraph index inside a table cell — where insertText lands. */
  static cellInsertIndex(cell: { content?: DocElement[] }): number {
    return RequestBuilder.#cellInsertIndex(cell);
  }

  static textStyleRequests(baseIndex: number, runs: TextRun[], segmentId?: string, tabId?: string): object[] {
    return RequestBuilder.#textStyleRequests(baseIndex, runs, segmentId, tabId);
  }

  /** First paragraph index inside a table cell — where insertText lands. */
  static #cellInsertIndex(cell: { content?: DocElement[] }): number {
    const para = cell.content?.find((el) => el.paragraph != null) ?? cell.content?.[0];
    if (!para) throw new Error("table cell missing paragraph");
    return para.startIndex;
  }

  /** updateTextStyle requests for bold, italic, code, and links. */
  static #textStyleRequests(baseIndex: number, runs: TextRun[], segmentId?: string, tabId?: string): object[] {
    const requests: object[] = [];
    for (const run of runs) {
      if (run.end <= run.start) continue;
      const fields: string[] = [];
      const style: Record<string, unknown> = {};
      if (run.bold) {
        fields.push("bold");
        style.bold = true;
      }
      if (run.code) {
        fields.push("fontSize", "weightedFontFamily");
        style.fontSize = { magnitude: run.fontSize ?? 10, unit: "PT" };
        style.weightedFontFamily = { fontFamily: "Courier New" };
      }
      if (run.italic) {
        fields.push("italic");
        style.italic = true;
      }
      if (run.underline) {
        fields.push("underline");
        style.underline = true;
      }
      if (run.strikethrough) {
        fields.push("strikethrough");
        style.strikethrough = true;
      }
      if (run.fontSize && !run.code) {
        fields.push("fontSize");
        style.fontSize = { magnitude: run.fontSize, unit: "PT" };
      }
      if (run.foregroundColor) {
        fields.push("foregroundColor");
        style.foregroundColor = optionalColor(run.foregroundColor);
      }
      if (run.backgroundColor) {
        fields.push("backgroundColor");
        style.backgroundColor = optionalColor(run.backgroundColor);
      }
      if (run.fontFamily && !run.code) {
        fields.push("weightedFontFamily");
        style.weightedFontFamily = { fontFamily: run.fontFamily };
      }
      if (run.link) {
        fields.push("link");
        style.link = { url: run.link };
      }
      if (!fields.length) continue;
      requests.push({
        updateTextStyle: {
          fields: fields.join(","),
          range: rng(baseIndex + run.start, baseIndex + run.end, segmentId, tabId),
          textStyle: style,
        },
      });
    }
    return requests;
  }

  /** Adds a new document tab. */
  static addDocumentTab(title: string, opts: { index?: number } = {}): object {
    return {
      addDocumentTab: {
        tabProperties: {
          title,
          ...(opts.index != null ? { index: opts.index } : {}),
        },
      },
    };
  }

  /** Renames a document tab. */
  static renameTab(tabId: string, title: string): object {
    return {
      updateDocumentTabProperties: {
        fields: "title",
        tabProperties: {
          tabId,
          title,
        },
      },
    };
  }

  /** Moves/reorders a document tab to a zero-based index. */
  static moveTab(tabId: string, index: number): object {
    return {
      updateDocumentTabProperties: {
        fields: "index",
        tabProperties: {
          index,
          tabId,
        },
      },
    };
  }

  /** Deletes a document tab. */
  static deleteTab(tabId: string): object {
    return {
      deleteTab: {
        tabId,
      },
    };
  }

  /** Replaces all instances of text matching a criteria with replace text. */
  static replaceAllText(
    findText: string,
    replaceText: string,
    opts: {
      matchCase?: boolean;
      tabIds?: string[];
    } = {},
  ): object {
    const req: {
      replaceAllText: {
        containsText: {
          matchCase: boolean;
          text: string;
        };
        replaceText: string;
        tabsCriteria?: {
          tabIds: string[];
        };
      };
    } = {
      replaceAllText: {
        containsText: {
          matchCase: opts.matchCase ?? true,
          text: findText,
        },
        replaceText,
      },
    };
    if (opts.tabIds && opts.tabIds.length > 0) {
      req.replaceAllText.tabsCriteria = {
        tabIds: opts.tabIds,
      };
    }
    return req;
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

  /** Creates a footnote reference in the body. */
  static createFootnote(opts: { index: number; segmentId?: string; tabId?: string }): object {
    return {
      createFootnote: {
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

  /** Inserts chips and public images at in-paragraph indexes, highest offset first. */
  static insertInlineSpecials(
    /** Insertion options. */
    opts: {
      /** Character index of the start of the paragraph or cell text. */
      index: number;
      /** Header/footer segment id. */
      segmentId?: string;
      /** Specials whose offsets are relative to `index`. */
      specials?: ParagraphInlineSpecial[];
      /** Target tab id. */
      tabId?: string;
    },
  ): object[] {
    const specials = opts.specials;
    if (!specials?.length) return [];
    const ordered = [...specials].sort((a, b) => b.offset - a.offset);
    const reqs: object[] = [];
    for (const special of ordered) {
      const at = opts.index + special.offset;
      if (special.kind === "person") {
        reqs.push(
          RequestBuilder.insertPerson({
            email: special.email,
            index: at,
            segmentId: opts.segmentId,
            tabId: opts.tabId,
          }),
        );
      } else if (special.kind === "date") {
        reqs.push(
          RequestBuilder.insertDate({
            dateFormat: special.dateFormat,
            displayText: special.displayText,
            index: at,
            segmentId: opts.segmentId,
            tabId: opts.tabId,
            timestamp: special.timestamp,
          }),
        );
      } else if (special.kind === "richLink") {
        reqs.push(
          RequestBuilder.insertRichLink({
            index: at,
            segmentId: opts.segmentId,
            tabId: opts.tabId,
            uri: special.uri,
          }),
        );
      } else {
        reqs.push(
          RequestBuilder.insertInlineImage({
            heightPt: special.heightPt,
            index: at,
            segmentId: opts.segmentId,
            tabId: opts.tabId,
            uri: special.uri,
            widthPt: special.widthPt,
          }),
        );
      }
    }
    return reqs;
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
