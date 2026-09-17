/* Parse Google Docs body.content (and header/footer/footnote segments) into tapes. */

import { Gdoc } from "~/core/gdoc.ts";
import { InlineMarkup } from "~/core/inline.ts";
import { Paragraph } from "~/core/paragraph.ts";
import { flattenTabs, overlayTab } from "~/core/tabs.ts";
import type { DocElement, GoogleDoc } from "~/core/types.ts";
import { computeCellChecksum, computeNodeChecksum } from "./checksum.ts";
import { hexColor, isMonospaceFont, uniformQueryTextStyle } from "./style.ts";
import {
  asAlignment,
  asContentAlignment,
  asNamedStyle,
  type CellParagraph,
  type DocNode,
  type DocSegment,
  type DocSegmentUse,
  type InlineChip,
  type InlineImage,
  isHeadingStyle,
  type NamedStyle,
  type TableCell,
} from "./types.ts";

/**
 * Body tape plus extra segments (headers, footers, footnotes).
 */
export type ParsedDocument = ParsedTape & {
  /** Auxiliary segments like headers, footers, and footnotes. */
  segments: DocSegment[];
};

/**
 * Result of flattening a documents.get payload into the body tape.
 */
export type ParsedTape = {
  /** Document ID. */
  documentId: string;
  /** Ordered nodes in document body tape. */
  nodes: DocNode[];
  /** Revision ID if returned by API. */
  revisionId?: string;
  /** Document title. */
  title: string;
};

/**
 * Assigns heading-scoped IDs ({headingId}.{checksum}) to nodes and table cells.
 * Pre-heading content receives "_preamble.{checksum}".
 * Duplicate checksums under the same heading receive an incremental suffix (.2, .3).
 */
export function assignScopedIds(
  /** Array of parsed document nodes. */
  nodes: DocNode[],
): void {
  let currentHeadingId = "_preamble";
  let tableIndexUnderHeading = 0;
  const sectionCounts = new Map<string, number>();

  for (const node of nodes) {
    if (node.kind === "paragraph" && isHeadingStyle(node.namedStyleType)) {
      currentHeadingId = node.headingId || `h.heading_${node.tapeIndex}`;
      tableIndexUnderHeading = 0;
      const csum = computeNodeChecksum(node);
      node.scopedId = `${currentHeadingId}.${csum}`;
      continue;
    }

    if (node.kind === "table") {
      tableIndexUnderHeading++;
      const tableTag = tableIndexUnderHeading === 1 ? "table" : `table${tableIndexUnderHeading}`;
      const csum = computeNodeChecksum(node);
      const base = `${currentHeadingId}.${tableTag}.${csum}`;
      const count = (sectionCounts.get(base) ?? 0) + 1;
      sectionCounts.set(base, count);
      node.scopedId = count === 1 ? base : `${base}.${count}`;

      if (node.table) {
        for (let r = 0; r < node.table.cells.length; r++) {
          const row = node.table.cells[r]!;
          for (let c = 0; c < row.length; c++) {
            const cell = row[c]!;
            const cellCsum = computeCellChecksum(cell);
            cell.scopedId = `${currentHeadingId}.${tableTag}.${r}.${c}.${cellCsum}`;
            if (cell.paragraphs && cell.paragraphs.length > 1) {
              for (let p = 1; p < cell.paragraphs.length; p++) {
                const para = cell.paragraphs[p]!;
                para.scopedId = `${currentHeadingId}.${tableTag}.${r}.${c}.${cellCsum}.${p}`;
              }
            }
          }
        }
      }
      continue;
    }

    const csum = computeNodeChecksum(node);
    const base = `${currentHeadingId}.${csum}`;
    const count = (sectionCounts.get(base) ?? 0) + 1;
    sectionCounts.set(base, count);
    node.scopedId = count === 1 ? base : `${base}.${count}`;
  }
}

/**
 * Alias for assignScopedIds.
 */
export const scopedIdsAssign = assignScopedIds;

/**
 * Body tape plus extra segments (headers, footers, footnotes).
 */
export function documentParse(
  /** Source document snapshot or loaded Gdoc instance. */
  source: GoogleDoc | Gdoc,
): ParsedDocument {
  const gdoc = source instanceof Gdoc ? source : new Gdoc(source, source.documentId ?? "");
  const data = tapeData(gdoc);
  return {
    documentId: gdoc.id || data.documentId || "",
    nodes: parseContent(data.body?.content ?? [], data),
    revisionId: data.revisionId,
    segments: parseSegments(data),
    title: data.title ?? "",
  };
}

/**
 * Alias for documentParse.
 */
export const parseDocument = documentParse;

/**
 * Builds the sibling tape from a raw payload or loaded Gdoc.
 */
export function tapeParse(
  /** Source document snapshot or loaded Gdoc instance. */
  source: GoogleDoc | Gdoc,
): ParsedTape {
  const doc = documentParse(source);
  return {
    documentId: doc.documentId,
    nodes: doc.nodes,
    revisionId: doc.revisionId,
    title: doc.title,
  };
}

/**
 * Alias for tapeParse.
 */
export const parseTape = tapeParse;

function parseContent(content: DocElement[], data: GoogleDoc): DocNode[] {
  const nodes: DocNode[] = [];
  let id = 1;
  for (const el of content) {
    const node = parseElement(el, data);
    if (node) nodes.push({ ...node, tapeIndex: id++ });
  }
  assignScopedIds(nodes);
  return nodes;
}

function parseSegments(data: GoogleDoc): DocSegment[] {
  const style = data.documentStyle ?? {};
  const out: DocSegment[] = [];
  for (const [id, header] of Object.entries(data.headers ?? {})) {
    out.push({
      kind: "header",
      nodes: parseContent(header.content ?? [], data),
      segmentId: header.headerId || id,
      use: headerUse(id, style),
    });
  }
  for (const [id, footer] of Object.entries(data.footers ?? {})) {
    out.push({
      kind: "footer",
      nodes: parseContent(footer.content ?? [], data),
      segmentId: footer.footerId || id,
      use: footerUse(id, style),
    });
  }
  for (const [id, note] of Object.entries(data.footnotes ?? {})) {
    out.push({
      kind: "footnote",
      nodes: parseContent(note.content ?? [], data),
      segmentId: note.footnoteId || id,
    });
  }
  return out;
}

function headerUse(id: string, style: NonNullable<GoogleDoc["documentStyle"]>): DocSegmentUse | undefined {
  if (id === style.defaultHeaderId) return "default";
  if (id === style.firstPageHeaderId) return "first";
  if (id === style.evenPageHeaderId) return "even";
  return undefined;
}

function footerUse(id: string, style: NonNullable<GoogleDoc["documentStyle"]>): DocSegmentUse | undefined {
  if (id === style.defaultFooterId) return "default";
  if (id === style.firstPageFooterId) return "first";
  if (id === style.evenPageFooterId) return "even";
  return undefined;
}

function parseElement(el: DocElement, data: GoogleDoc): DocNode | null {
  const start = el.startIndex ?? 0;
  const end = el.endIndex;
  if (el.paragraph) return parseParagraph(el, start, end, data);
  if (el.table) return parseTable(el, start, end, data);
  if (el.tableOfContents) {
    return { end, kind: "tableOfContents", start, tapeIndex: 0 };
  }
  if (el.sectionBreak) {
    const node: DocNode = { end, kind: "sectionBreak", start, tapeIndex: 0 };
    const cols = el.sectionBreak.sectionStyle?.columnCount;
    if (typeof cols === "number" && cols > 1) node.columnCount = cols;
    return node;
  }
  return null;
}

function parseParagraph(el: DocElement, start: number, end: number, data: GoogleDoc): DocNode {
  const paragraph = el.paragraph!;
  const hasPageBreak = (paragraph.elements ?? []).some((item) => item.pageBreak);
  const named = asNamedStyle(paragraph.paragraphStyle?.namedStyleType) ?? "NORMAL_TEXT";
  const text = Paragraph.text(paragraph, true);
  if (hasPageBreak && !text.trim()) {
    return { end, kind: "pageBreak", start, tapeIndex: 0 };
  }
  const markup = InlineMarkup.serialize(Paragraph.elements(paragraph)).replace(/\n$/, "");
  const node: DocNode = {
    end,
    kind: "paragraph",
    namedStyleType: named,
    start,
    tapeIndex: 0,
    text,
  };
  if (markup && markup !== text) node.markup = markup;
  const bullet = parseBullet(paragraph, data);
  if (bullet) node.bullet = bullet;
  const images = parseImages(paragraph, data);
  if (images.length) node.images = images;
  const chips = parseChips(paragraph);
  if (chips.length) node.chips = chips;
  if (paragraph.paragraphStyle?.headingId) {
    node.headingId = paragraph.paragraphStyle.headingId;
  }
  applyParagraphStyle(node, paragraph.paragraphStyle);
  const style = queryStyleFromParagraph(paragraph);
  if (style) node.style = style;
  const footnotes = footnoteIds(paragraph);
  if (footnotes.length) node.footnoteIds = footnotes;
  if ((paragraph.elements ?? []).some((item) => item.equation)) {
    node.hasEquation = true;
  }
  if ((paragraph.elements ?? []).some((item) => item.horizontalRule)) {
    node.hasHorizontalRule = true;
  }
  if (isCodeParagraph(paragraph, named, bullet, node)) {
    node.isCode = true;
  }
  return node;
}

function queryStyleFromParagraph(
  paragraph: NonNullable<DocElement["paragraph"]>,
): ReturnType<typeof uniformQueryTextStyle> {
  const styles: Array<Record<string, unknown> | undefined> = [];
  for (const el of paragraph.elements ?? []) {
    const content = el.textRun?.content ?? "";
    if (!content.replace(/\n/g, "")) continue;
    styles.push(el.textRun?.textStyle);
  }
  return uniformQueryTextStyle(styles);
}

function ptMagnitude(dim?: { magnitude?: number; unit?: string }): number | undefined {
  if (!dim) return undefined;
  if (typeof dim.magnitude === "number") return dim.magnitude;
  if (dim.unit === "PT") return 0;
  return undefined;
}

function applyParagraphStyle(
  target: {
    alignment?: DocNode["alignment"];
    indentEnd?: DocNode["indentEnd"];
    indentFirstLine?: DocNode["indentFirstLine"];
    indentStart?: DocNode["indentStart"];
    lineSpacing?: number;
    shading?: string;
    spaceAbove?: number;
    spaceBelow?: number;
  },
  style: NonNullable<DocElement["paragraph"]>["paragraphStyle"],
): void {
  if (!style) return;
  const align = asAlignment(style.alignment);
  if (align) target.alignment = align;
  const indentStart = ptMagnitude(style.indentStart);
  if (indentStart != null) {
    target.indentStart = { magnitude: indentStart, unit: "PT" };
  }
  const indentFirstLine = ptMagnitude(style.indentFirstLine);
  if (indentFirstLine != null) {
    target.indentFirstLine = { magnitude: indentFirstLine, unit: "PT" };
  }
  const indentEnd = ptMagnitude(style.indentEnd);
  if (indentEnd != null) {
    target.indentEnd = { magnitude: indentEnd, unit: "PT" };
  }
  if (typeof style.lineSpacing === "number") target.lineSpacing = style.lineSpacing;
  if (typeof style.spaceAbove?.magnitude === "number") {
    target.spaceAbove = style.spaceAbove.magnitude;
  }
  if (typeof style.spaceBelow?.magnitude === "number") {
    target.spaceBelow = style.spaceBelow.magnitude;
  }
  const shade = hexColor(style.shading?.backgroundColor?.color?.rgbColor);
  if (shade) target.shading = shade;
}

function footnoteIds(paragraph: NonNullable<DocElement["paragraph"]>): string[] {
  const ids: string[] = [];
  for (const el of paragraph.elements ?? []) {
    const id = el.footnoteReference?.footnoteId;
    if (id) ids.push(id);
  }
  return ids;
}

function parseCellParagraph(paraEl: DocElement | undefined, data: GoogleDoc, row: number, col: number): CellParagraph {
  const para = paraEl?.paragraph;
  const start = paraEl?.startIndex ?? 0;
  const end = paraEl?.endIndex ?? start;
  const text = para ? Paragraph.text(para, true) : "";
  const markup = para ? InlineMarkup.serialize(Paragraph.elements(para)).replace(/\n$/, "") : "";
  const cell: CellParagraph = { end, start, text };
  if (markup && markup !== text) cell.markup = markup;
  if (para) applyParagraphStyle(cell, para.paragraphStyle);
  if (para) {
    const style = queryStyleFromParagraph(para);
    if (style) cell.style = style;
    const cellImgs = parseImages(para, data).map((img) => ({
      ...img,
      col,
      row,
    }));
    if (cellImgs.length) cell.images = cellImgs;
    const cellChips = parseChips(para);
    if (cellChips.length) cell.chips = cellChips;
    if ((para.elements ?? []).some((item) => item.equation)) {
      cell.hasEquation = true;
    }
    if ((para.elements ?? []).some((item) => item.horizontalRule)) {
      cell.hasHorizontalRule = true;
    }
  }
  return cell;
}

function parseTable(el: DocElement, start: number, end: number, data: GoogleDoc): DocNode {
  const cells: TableCell[][] = [];
  const images: InlineImage[] = [];
  const tableRows = el.table?.tableRows ?? [];
  for (let r = 0; r < tableRows.length; r++) {
    const row: TableCell[] = [];
    const tableCells = tableRows[r]?.tableCells ?? [];
    for (let c = 0; c < tableCells.length; c++) {
      const tableCell = tableCells[c];
      const paras = (tableCell?.content ?? [])
        .filter((item) => item.paragraph)
        .map((item) => parseCellParagraph(item, data, r, c));
      const first = paras[0] ?? { end: start, start, text: "" };
      const paragraphs = paras.length ? paras : [first];
      const cell: TableCell = {
        ...first,
        paragraphs,
      };
      const bg = hexColor(tableCell?.tableCellStyle?.backgroundColor?.color?.rgbColor);
      if (bg) cell.backgroundColor = bg;
      for (const p of paragraphs) {
        if (p.images?.length) images.push(...p.images);
      }
      row.push(cell);
    }
    cells.push(row);
  }
  const node: DocNode = { end, kind: "table", start, table: { cells }, tapeIndex: 0 };
  const widths = (el.table?.tableStyle?.tableColumnProperties ?? []).map((p) =>
    p.widthType === "FIXED_WIDTH" && typeof p.width?.magnitude === "number" ? p.width.magnitude : undefined,
  );
  if (widths.length && widths.every((w) => w === widths[0]) && widths[0] != null) {
    node.table!.columnWidth = widths[0];
  }
  const firstStyle = tableRows[0]?.tableCells?.[0]?.tableCellStyle;
  const pad = firstStyle?.paddingTop?.magnitude;
  if (typeof pad === "number") node.table!.cellPadding = pad;
  const align = asContentAlignment(firstStyle?.contentAlignment);
  if (align) node.table!.contentAlignment = align;
  const borderHex = hexColor(firstStyle?.borderTop?.color?.color?.rgbColor);
  if (borderHex) node.table!.borderColor = borderHex;
  const minH = tableRows[0]?.tableRowStyle?.minRowHeight?.magnitude;
  if (typeof minH === "number") node.table!.minRowHeight = minH;
  let pinned = 0;
  for (let r = 0; r < tableRows.length; r++) {
    if (tableRows[r]?.tableRowStyle?.tableHeader) pinned++;
    else break;
  }
  if (pinned > 0) node.table!.pinnedHeaderRows = pinned;
  const preventOverflow = tableRows.some((r) => r?.tableRowStyle?.preventOverflow);
  if (preventOverflow) node.table!.preventOverflow = true;
  if (images.length) node.images = images;
  return node;
}

function parseListType(levelProps?: Record<string, unknown>): "NUMBERED" | "BULLET" | "CHECKBOX" | undefined {
  if (!levelProps) return undefined;
  const glyphType = typeof levelProps.glyphType === "string" ? levelProps.glyphType : undefined;
  if (glyphType && glyphType !== "GLYPH_TYPE_UNSPECIFIED" && glyphType !== "NONE") {
    return "NUMBERED";
  }
  const glyphSymbol = typeof levelProps.glyphSymbol === "string" ? levelProps.glyphSymbol : undefined;
  if (glyphSymbol) {
    if (glyphSymbol === "❑" || glyphSymbol === "☑" || glyphSymbol === "☐") {
      return "CHECKBOX";
    }
    return "BULLET";
  }
  return undefined;
}

function parseBullet(paragraph: NonNullable<DocElement["paragraph"]>, data: GoogleDoc): DocNode["bullet"] | undefined {
  if (!paragraph.bullet) return undefined;
  const lists = data.lists ?? data.tabs?.[0]?.documentTab?.lists ?? {};
  let listId = paragraph.bullet.listId;
  if (!listId) {
    const ids = Object.keys(lists);
    if (ids.length === 1) listId = ids[0];
  }
  const nestingLevel = Paragraph.bulletNestingLevel(paragraph);
  const bullet: NonNullable<DocNode["bullet"]> = {
    nestingLevel,
  };
  if (listId) {
    bullet.listId = listId;
    const levelProps = lists[listId]?.listProperties?.nestingLevels?.[nestingLevel] as
      | Record<string, unknown>
      | undefined;
    const type = parseListType(levelProps);
    if (type) bullet.type = type;
  }
  return bullet;
}

function parseChips(paragraph: NonNullable<DocElement["paragraph"]>): InlineChip[] {
  const chips: InlineChip[] = [];
  for (const el of paragraph.elements ?? []) {
    const start = el.startIndex ?? 0;
    const end = el.endIndex ?? start + 1;
    if (el.richLink?.richLinkProperties) {
      const props = el.richLink.richLinkProperties;
      const chip: InlineChip = {
        end,
        kind: "richLink",
        start,
        title: props.title ?? "",
        uri: props.uri ?? "",
      };
      if (el.richLink?.richLinkId) chip.richLinkId = el.richLink.richLinkId;
      if (props.mimeType) chip.mimeType = props.mimeType;
      chips.push(chip);
    } else if (el.person?.personProperties) {
      const props = el.person.personProperties;
      chips.push({
        end,
        kind: "person",
        personId: el.person.personId,
        start,
        title: props.name || props.email || "Person",
        uri: props.email ? `mailto:${props.email}` : "",
      });
    } else if (el.dateElement?.dateElementProperties) {
      const props = el.dateElement.dateElementProperties;
      chips.push({
        dateId: el.dateElement.dateId,
        end,
        kind: "date",
        start,
        title: props.displayText || "Date",
        uri: "",
      });
    }
  }
  return chips;
}

function parseImages(paragraph: NonNullable<DocElement["paragraph"]>, data: GoogleDoc): InlineImage[] {
  const images: InlineImage[] = [];
  for (const el of paragraph.elements ?? []) {
    const objectId = el.inlineObjectElement?.inlineObjectId;
    if (!objectId) continue;
    const start = el.startIndex ?? 0;
    const end = el.endIndex ?? start + 1;
    const size = data.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject?.size;
    const image: InlineImage = { end, objectId, start };
    const widthPt = size?.width?.magnitude;
    const heightPt = size?.height?.magnitude;
    if (typeof widthPt === "number") image.widthPt = widthPt;
    if (typeof heightPt === "number") image.heightPt = heightPt;
    images.push(image);
  }
  return images;
}

function tapeData(gdoc: Gdoc): GoogleDoc {
  const data = gdoc.data;
  if (gdoc.tabId) return overlayTab(data, gdoc.tabId);
  const flat = flattenTabs(data.tabs);
  if (flat.length === 1 && !data.body?.content?.length) {
    return overlayTab(data, flat[0]?.tabId);
  }
  return data;
}

function isCodeParagraph(
  paragraph: DocElement["paragraph"],
  namedStyle: NamedStyle,
  bullet: DocNode["bullet"] | undefined,
  node: DocNode,
): boolean {
  if (namedStyle !== "NORMAL_TEXT") return false;
  if (bullet) return false;
  if (node.images?.length || node.chips?.length || node.footnoteIds?.length) return false;
  if (node.hasEquation || node.hasHorizontalRule) return false;
  if (!node.text?.trim()) return false;

  const elements = paragraph?.elements ?? [];
  for (const el of elements) {
    if (!el.textRun) return false;
  }

  const textRuns = elements
    .map((el) => el.textRun)
    .filter((r): r is NonNullable<typeof r> => Boolean(r?.content?.replace(/\n/g, "")));

  if (textRuns.length === 0) return false;

  return textRuns.every((r) => {
    const font =
      (r.textStyle?.weightedFontFamily as { fontFamily?: string } | undefined)?.fontFamily ??
      (r.textStyle as { fontFamily?: string } | undefined)?.fontFamily;
    return isMonospaceFont(font);
  });
}
