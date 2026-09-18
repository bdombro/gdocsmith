/* Compile DomWriter mutations to Docs batchUpdate requests and apply them. */

import { InlineMarkup, type InlineRunInput, type TextRun } from "~/core/inline.ts";
import { RequestBuilder } from "~/core/requests.ts";
import type { ApplySummary, GoogleDoc } from "~/core/types.ts";
import type { ParagraphInlineSpecial, ParagraphSpec } from "./element.ts";
import { assertWritable } from "./guards.ts";
import { TABLE_INSERT_MIX_MSG } from "./ops.ts";
import { HANGING_INDENT_PT, hasIndent, omitIndent, type StylePatch } from "./style.ts";
import {
  type CellParagraph,
  type DocNode,
  type InlineImage,
  isHeadingStyle,
  type NamedStyle,
  type ParagraphAlignment,
  type TableCell,
} from "./types.ts";
import type { DomMutation, DomWriter } from "./write.ts";

/** Docs rejects deleteContentRange through the body's trailing newline. */
export const LAST_PARAGRAPH_MSG =
  "Cannot remove the last paragraph of the document (Docs rejects deleteContentRange through the trailing newline). Use innerText to clear it.";

/** Stock Docs nesting step (0.5in) when listProperties.nestingLevels is absent. */
export const STOCK_NESTING_INDENT_PT = 36;
/** Hanging indent for the glyph (indentStart − indentFirstLine). Docs default is 0.25in. */
export const STOCK_NESTING_HANGING_PT = HANGING_INDENT_PT;

/** Indent pair for one list nesting level (Docs defaults). */
export type ListIndent = {
  indentFirstLine: number;
  indentStart: number;
};

/**
 * Resolves indentStart + indentFirstLine for a nested bullet.
 * Docs places the glyph at indentFirstLine and the text at indentStart
 * (18pt hanging). Setting indentStart alone leaves the glyph at level 0
 * and only shifts the text — looks like `- \titem`, not a nested bullet.
 * Explicit indentStart still gets a matching hanging first-line unless
 * indentFirstLine is also passed.
 */
export function nestingIndentResolve(opts: {
  explicit?: { magnitude: number; unit: "PT" };
  indentFirstLine?: { magnitude: number; unit: "PT" };
  listId?: string;
  lists?: GoogleDoc["lists"];
  nestingLevel: number;
}): number | undefined {
  return nestingStyleResolve(opts)?.indentStart;
}

/** Resolves indentStart + indentFirstLine for a nested bullet (alias for nestingIndentResolve). */
export const resolveNestingIndent = nestingIndentResolve;

/** Full Docs list indent pair, or undefined for level 0 with no explicit indent. */
export function nestingStyleResolve(opts: {
  explicit?: { magnitude: number; unit: "PT" };
  indentFirstLine?: { magnitude: number; unit: "PT" };
  listId?: string;
  lists?: GoogleDoc["lists"];
  nestingLevel: number;
}): ListIndent | undefined {
  if (opts.explicit) {
    const indentStart = opts.explicit.magnitude;
    const indentFirstLine = opts.indentFirstLine?.magnitude ?? Math.max(0, indentStart - STOCK_NESTING_HANGING_PT);
    return { indentFirstLine, indentStart };
  }
  if (opts.nestingLevel <= 0) return undefined;
  const fromList = listNestingStyle(opts.lists, opts.listId, opts.nestingLevel);
  if (fromList) return fromList;
  return stockListIndent(opts.nestingLevel);
}

/** Full Docs list indent pair (alias for nestingStyleResolve). */
export const resolveNestingStyle = nestingStyleResolve;

/** Maps bullet preset name to general bullet glyph kind. */
function bulletType(preset?: string): "NUMBERED" | "BULLET" | "CHECKBOX" | undefined {
  if (!preset) return undefined;
  if (preset.startsWith("NUMBERED_")) return "NUMBERED";
  if (preset === "BULLET_CHECKBOX") return "CHECKBOX";
  return "BULLET";
}

/** indentStart / firstLine / end from a createElement spec (after bullets). */
function indentPatchFromSpec(spec: ParagraphSpec): StylePatch {
  const patch: StylePatch = {};
  if (spec.indentStart) patch.indentStart = spec.indentStart.magnitude;
  else if (spec.style?.indentStart != null) patch.indentStart = spec.style.indentStart;
  if (spec.style?.indentFirstLine != null) {
    patch.indentFirstLine = spec.style.indentFirstLine;
  }
  if (spec.style?.indentEnd != null) patch.indentEnd = spec.style.indentEnd;
  return patch;
}

/** Generates standard Google Docs bullet indentation values for a given nesting depth. */
function stockListIndent(nestingLevel: number): ListIndent {
  return {
    indentFirstLine: STOCK_NESTING_HANGING_PT + nestingLevel * STOCK_NESTING_INDENT_PT,
    indentStart: STOCK_NESTING_INDENT_PT + nestingLevel * STOCK_NESTING_INDENT_PT,
  };
}

/** Compiled surgical write ready to send (or inspect in tests). */
export type CompiledDomWrite = {
  requestOrigins: Array<{ mutationIndexes: number[] }>;
  requests: object[];
  rowFills?: Array<{
    cells: string[];
    insertBelow: boolean;
    rowIndex: number;
    segmentId?: string;
    tabId?: string;
    tableStart: number;
  }>;
  summary: ApplySummary;
  tableInserts: Array<{
    /** Per-cell inline specials aligned with `rows`. */
    cellSpecials?: Array<Array<ParagraphInlineSpecial[] | undefined>>;
    insertIndex: number;
    rows: string[][];
    segmentId?: string;
    tabId?: string;
  }>;
};

type Live = {
  alignment?: ParagraphAlignment;
  bullet?: DocNode["bullet"];
  cells?: TableCell[][];
  end: number;
  images?: DocNode["images"];
  kind: DocNode["kind"];
  namedStyleType?: DocNode["namedStyleType"];
  start: number;
  tapeIndex: number;
  text?: string;
};

type CompiledOp =
  | {
      afterId: number;
      ids: number[];
      joinListId?: string;
      mutationIndexes: number[];
      position: "afterend" | "beforebegin";
      specs: ParagraphSpec[];
      type: "insertParagraphs";
    }
  | {
      afterId: number;
      cellSpecials?: Array<Array<ParagraphInlineSpecial[] | undefined>>;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      rows: string[][];
      type: "insertTable";
    }
  | {
      cell?: [number, number];
      mutationIndexes: number[];
      nodeId: number;
      para?: number;
      runs?: InlineRunInput[];
      text: string;
      type: "innerText";
    }
  | {
      mutationIndexes: number[];
      namedStyleType: NamedStyle;
      nodeId: number;
      type: "namedStyleType";
    }
  | {
      cell?: [number, number];
      mutationIndexes: number[];
      nodeId: number;
      para?: number;
      patch: StylePatch;
      type: "style";
    }
  | {
      mutationIndexes: number[];
      nodeId: number;
      preset: string;
      type: "bullets";
    }
  | {
      afterId: number;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      type: "insertPageBreak";
    }
  | { mutationIndexes: number[]; nodeId: number; type: "remove" }
  | {
      cell: [number, number];
      cells?: string[];
      insertBelow?: boolean;
      mutationIndexes: number[];
      nodeId: number;
      type: "insertTableRow";
    }
  | {
      cell: [number, number];
      mutationIndexes: number[];
      nodeId: number;
      type: "deleteTableRow";
    }
  | {
      cell: [number, number];
      insertRight?: boolean;
      mutationIndexes: number[];
      nodeId: number;
      type: "insertTableColumn";
    }
  | {
      cell: [number, number];
      mutationIndexes: number[];
      nodeId: number;
      type: "deleteTableColumn";
    }
  | {
      afterId: number;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      sectionType?: "CONTINUOUS" | "NEXT_PAGE";
      type: "insertSectionBreak";
    }
  | {
      afterId: number;
      email: string;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      type: "insertPerson";
    }
  | {
      afterId: number;
      mimeType?: string;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      title?: string;
      uri: string;
      type: "insertRichLink";
    }
  | {
      afterId: number;
      dateFormat?: string;
      displayText?: string;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      timestamp?: string;
      type: "insertDate";
    }
  | {
      afterId: number;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      text?: string;
      type: "createFootnote";
    }
  | {
      afterId: number;
      heightPt?: number;
      mutationIndexes: number[];
      newId: number;
      position: "afterend" | "beforebegin";
      uri: string;
      widthPt?: number;
      type: "insertInlineImage";
    };

/** Compiles a write session to Docs API requests. Does not call the API. */
export function domCompile(
  writer: DomWriter,
  opts: { force?: boolean; lists?: GoogleDoc["lists"] } = {},
): CompiledDomWrite {
  const force = opts.force ?? writer.force;
  const seg = writer.segmentId;
  const tab = writer.tabId;
  if (!force) {
    for (const m of writer.mutations()) {
      if (m.type === "insertAdjacent" && m.spec.kind === "paragraph") {
        assertWritable(m.spec);
      }
      if (m.type === "innerText") {
        const orig = writer.originalNodes().find((n) => n.tapeIndex === m.nodeId);
        assertWritable(
          m.cell
            ? { text: m.text }
            : {
                bullet: orig?.bullet,
                namedStyleType: orig?.namedStyleType,
                text: m.text,
              },
        );
      }
    }
  }
  assertTableInsertIsolation(writer.mutations());

  const live = new Map<number, Live>();
  for (const n of writer.originalNodes()) {
    live.set(n.tapeIndex, {
      ...(n.alignment ? { alignment: n.alignment } : {}),
      ...(n.bullet ? { bullet: { ...n.bullet } } : {}),
      ...(n.images ? { images: n.images.map((img) => ({ ...img })) } : {}),
      ...(n.table?.cells ? { cells: cloneCells(n.table.cells) } : {}),
      end: n.end,
      tapeIndex: n.tapeIndex,
      kind: n.kind,
      namedStyleType: n.namedStyleType,
      start: n.start,
      text: n.text,
    });
  }

  const requests: object[] = [];
  const requestOrigins: CompiledDomWrite["requestOrigins"] = [];
  const tableInserts: CompiledDomWrite["tableInserts"] = [];
  const rowFills: NonNullable<CompiledDomWrite["rowFills"]> = [];
  let deleteChars = 0;
  let insertChars = 0;
  let tables = 0;
  /** Exclusive end of this tape; Docs rejects style ranges that are not strictly below it. */
  let segmentEnd = 1;
  for (const n of writer.originalNodes()) {
    if (n.end > segmentEnd) segmentEnd = n.end;
  }

  const push = (reqs: object[], mutationIndexes: number[]) => {
    for (const r of reqs) {
      segmentEnd += requestContentDelta(r);
      const range = requestStyleRange(r);
      if (range && !clipStyleRangeToSegment(range, segmentEnd)) continue;
      requestOrigins.push({ mutationIndexes });
      requests.push(r);
    }
  };

  for (const op of attachJoinListId(coalesce(writer.mutations()), writer.originalNodes())) {
    if (op.type === "innerText") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`innerText target ${op.nodeId} is gone`);
      if (op.cell) {
        const cell = requireLivePara(node, op.cell, op.para);
        const oldEnd = cell.end;
        const cellLive: Live = {
          end: cell.end,
          tapeIndex: node.tapeIndex,
          images: cell.images,
          kind: "paragraph",
          start: cell.start,
        };
        const { length, plain, reqs } = compileInnerText(cellLive, op.text, seg, tab, op.runs);
        push(reqs, op.mutationIndexes);
        const imageChars = imageCharCount(cellLive);
        const oldTextLen = Math.max(0, oldEnd - cell.start - 1 - imageChars);
        deleteChars += oldTextLen;
        insertChars += length;
        cell.text = plain;
        packImagesAfterText(cellLive, plain.length);
        cell.end = cellLive.end;
        cell.images = cellLive.images;
        const delta = cell.end - oldEnd;
        shiftTableCells(node, oldEnd, delta, op.cell, op.para);
        node.end += delta;
        syncTableImages(node);
        shiftLive(live, oldEnd, delta, node.tapeIndex);
        continue;
      }
      const oldEnd = node.end;
      const { length, plain, reqs } = compileInnerText(node, op.text, seg, tab, op.runs);
      push(reqs, op.mutationIndexes);
      const imageChars = imageCharCount(node);
      const oldTextLen = Math.max(0, oldEnd - node.start - 1 - imageChars);
      deleteChars += oldTextLen;
      insertChars += length;
      node.text = plain;
      packImagesAfterText(node, plain.length);
      const delta = node.end - oldEnd;
      shiftLive(live, oldEnd, delta, node.tapeIndex);
      continue;
    }

    if (op.type === "style") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`style target ${op.nodeId} is gone`);
      const range = op.cell ? requireLivePara(node, op.cell, op.para) : node;
      const tableWide = node.kind === "table" && !op.cell;
      push(
        RequestBuilder.applyStyle({
          cell: op.cell,
          cellRanges: tableWide ? cellParaRanges(node.cells) : undefined,
          end: range.end,
          isBullet: Boolean(!op.cell && node.bullet),
          patch: op.patch,
          segmentId: seg,
          start: range.start,
          tabId: tab,
          tableStart: node.kind === "table" ? node.start : undefined,
          tableWide,
        }),
        op.mutationIndexes,
      );
      if (op.patch.alignment) range.alignment = op.patch.alignment;
      continue;
    }

    if (op.type === "bullets") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`bullets target ${op.nodeId} is gone`);
      const run = liveListRun(live, node);
      const first = run[0]!;
      const last = run[run.length - 1]!;
      push([RequestBuilder.createParagraphBullets(first.start, last.end, op.preset, seg, tab)], op.mutationIndexes);
      continue;
    }

    if (op.type === "namedStyleType") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`namedStyleType target ${op.nodeId} is gone`);
      if (node.kind !== "paragraph") {
        throw new Error("namedStyleType is only supported on paragraph nodes");
      }
      push([RequestBuilder.namedStyle(node.start, node.end, op.namedStyleType, seg, tab)], op.mutationIndexes);
      node.namedStyleType = op.namedStyleType;
      if (isHeadingStyle(op.namedStyleType)) {
        push([RequestBuilder.deleteParagraphBullets(node.start, node.end, seg, tab)], op.mutationIndexes);
        delete node.bullet;
      }
      continue;
    }

    if (op.type === "remove") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`remove target ${op.nodeId} is gone`);
      if (isLastLiveNode(live, node)) {
        if (node.start > 1) {
          const prev = findPrecedingLiveNode(live, node);
          const len = node.end - node.start;
          if (prev && prev.kind === "paragraph") {
            push(
              [
                {
                  deleteContentRange: {
                    range: atRng(node.start - 1, node.end - 1, seg, tab),
                  },
                },
              ],
              op.mutationIndexes,
            );
            if (node.namedStyleType !== prev.namedStyleType) {
              push(
                [RequestBuilder.namedStyle(prev.start, node.start, prev.namedStyleType ?? "NORMAL_TEXT", seg, tab)],
                op.mutationIndexes,
              );
            }
            if (node.bullet && !prev.bullet) {
              push([RequestBuilder.deleteParagraphBullets(prev.start, node.start, seg, tab)], op.mutationIndexes);
            }
            deleteChars += len;
            shiftLive(live, node.end, -len, node.tapeIndex);
            live.delete(op.nodeId);
            continue;
          }
        }
        // Sole paragraph in doc or preceded by non-paragraph: clear content and reset style
        const textLen = Math.max(0, node.end - node.start - 1);
        if (textLen > 0) {
          push(
            [
              {
                deleteContentRange: {
                  range: atRng(node.start, node.end - 1, seg, tab),
                },
              },
            ],
            op.mutationIndexes,
          );
          deleteChars += textLen;
          shiftLive(live, node.end - 1, -textLen, node.tapeIndex);
          node.end -= textLen;
        }
        if (isHeadingStyle(node.namedStyleType)) {
          push([RequestBuilder.namedStyle(node.start, node.end, "NORMAL_TEXT", seg, tab)], op.mutationIndexes);
          node.namedStyleType = "NORMAL_TEXT";
        }
        if (node.bullet) {
          push([RequestBuilder.deleteParagraphBullets(node.start, node.end, seg, tab)], op.mutationIndexes);
          delete node.bullet;
        }
        node.text = "";
        continue;
      }
      const len = node.end - node.start;
      push(
        [
          {
            deleteContentRange: {
              range: atRng(node.start, node.end, seg, tab),
            },
          },
        ],
        op.mutationIndexes,
      );
      deleteChars += len;
      shiftLive(live, node.end, -len, node.tapeIndex);
      live.delete(op.nodeId);
      continue;
    }

    if (op.type === "insertTable") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insert table: missing anchor ${op.afterId}`);
      const { reqs, writeAt } = compileSplit(anchor, op.position, seg, tab);
      push(reqs, op.mutationIndexes);
      push(
        [
          {
            insertTable: {
              columns: Math.max(...op.rows.map((r) => r.length), 1),
              location: atLoc(writeAt, seg, tab),
              rows: op.rows.length,
            },
          },
        ],
        op.mutationIndexes,
      );
      tables += 1;
      tableInserts.push({
        ...(op.cellSpecials ? { cellSpecials: op.cellSpecials } : {}),
        insertIndex: writeAt,
        rows: op.rows,
        ...(seg ? { segmentId: seg } : {}),
        ...(tab ? { tabId: tab } : {}),
      });
      const created: Live = {
        end: writeAt + 1,
        tapeIndex: op.newId,
        kind: "table",
        start: writeAt,
      };
      live.set(created.tapeIndex, created);
      shiftLive(live, writeAt, 1, created.tapeIndex);
      continue;
    }

    if (op.type === "insertPageBreak") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insert pageBreak: missing anchor ${op.afterId}`);
      const { reqs, writeAt } = compileSplit(anchor, op.position, seg, tab);
      push(reqs, op.mutationIndexes);
      push([RequestBuilder.insertPageBreak(writeAt, seg, tab)], op.mutationIndexes);
      insertChars += 1;
      live.set(op.newId, {
        end: writeAt + 1,
        tapeIndex: op.newId,
        kind: "pageBreak",
        start: writeAt,
      });
      shiftLive(live, writeAt, 1, op.newId);
      continue;
    }

    if (op.type === "insertTableRow") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`insertTableRow target ${op.nodeId} is gone`);
      if (node.kind !== "table") throw new Error(`insertTableRow target ${op.nodeId} is not a table`);
      push(
        [
          RequestBuilder.insertTableRow({
            columnIndex: op.cell[1],
            insertBelow: op.insertBelow !== false,
            rowIndex: op.cell[0],
            segmentId: seg,
            tabId: tab,
            tableStart: node.start,
          }),
        ],
        op.mutationIndexes,
      );
      if (op.cells && op.cells.length > 0) {
        rowFills.push({
          cells: op.cells,
          insertBelow: op.insertBelow !== false,
          rowIndex: op.cell[0],
          segmentId: seg,
          tabId: tab,
          tableStart: node.start,
        });
      }
      continue;
    }

    if (op.type === "deleteTableRow") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`deleteTableRow target ${op.nodeId} is gone`);
      if (node.kind !== "table") throw new Error(`deleteTableRow target ${op.nodeId} is not a table`);
      push(
        [
          RequestBuilder.deleteTableRow({
            columnIndex: op.cell[1],
            rowIndex: op.cell[0],
            segmentId: seg,
            tabId: tab,
            tableStart: node.start,
          }),
        ],
        op.mutationIndexes,
      );
      continue;
    }

    if (op.type === "insertTableColumn") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`insertTableColumn target ${op.nodeId} is gone`);
      if (node.kind !== "table") throw new Error(`insertTableColumn target ${op.nodeId} is not a table`);
      push(
        [
          RequestBuilder.insertTableColumn({
            columnIndex: op.cell[1],
            insertRight: op.insertRight !== false,
            rowIndex: op.cell[0],
            segmentId: seg,
            tabId: tab,
            tableStart: node.start,
          }),
        ],
        op.mutationIndexes,
      );
      continue;
    }

    if (op.type === "deleteTableColumn") {
      const node = live.get(op.nodeId);
      if (!node) throw new Error(`deleteTableColumn target ${op.nodeId} is gone`);
      if (node.kind !== "table") throw new Error(`deleteTableColumn target ${op.nodeId} is not a table`);
      push(
        [
          RequestBuilder.deleteTableColumn({
            columnIndex: op.cell[1],
            rowIndex: op.cell[0],
            segmentId: seg,
            tabId: tab,
            tableStart: node.start,
          }),
        ],
        op.mutationIndexes,
      );
      continue;
    }

    if (op.type === "insertSectionBreak") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insertSectionBreak anchor ${op.afterId} is gone`);
      const splitIdx = op.position === "beforebegin" ? anchor.start : anchor.end;
      push(
        [
          RequestBuilder.insertSectionBreak({
            index: splitIdx,
            sectionType: op.sectionType,
            segmentId: seg,
            tabId: tab,
          }),
        ],
        op.mutationIndexes,
      );
      live.set(op.newId, {
        end: splitIdx + 1,
        tapeIndex: op.newId,
        kind: "sectionBreak",
        start: splitIdx,
      });
      shiftLive(live, splitIdx, 1, op.newId);
      continue;
    }

    if (op.type === "insertPerson") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insertPerson anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push(
        [
          RequestBuilder.insertPerson({
            email: op.email,
            index: split.writeAt,
            segmentId: seg,
            tabId: tab,
          }),
        ],
        op.mutationIndexes,
      );
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt,
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }

    if (op.type === "insertRichLink") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insertRichLink anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push(
        [
          RequestBuilder.insertRichLink({
            index: split.writeAt,
            mimeType: op.mimeType,
            segmentId: seg,
            tabId: tab,
            title: op.title,
            uri: op.uri,
          }),
        ],
        op.mutationIndexes,
      );
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt,
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }

    if (op.type === "insertDate") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insertDate anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push(
        [
          RequestBuilder.insertDate({
            dateFormat: op.dateFormat,
            displayText: op.displayText,
            index: split.writeAt,
            segmentId: seg,
            tabId: tab,
            timestamp: op.timestamp,
          }),
        ],
        op.mutationIndexes,
      );
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt,
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }

    if (op.type === "createFootnote") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`createFootnote anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push(
        [
          RequestBuilder.createFootnote({
            index: split.writeAt,
            segmentId: seg,
            tabId: tab,
          }),
        ],
        op.mutationIndexes,
      );
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt,
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }

    if (op.type === "insertInlineImage") {
      const anchor = live.get(op.afterId);
      if (!anchor) throw new Error(`insertInlineImage anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push(
        [
          RequestBuilder.insertInlineImage({
            heightPt: op.heightPt,
            index: split.writeAt,
            segmentId: seg,
            tabId: tab,
            uri: op.uri,
            widthPt: op.widthPt,
          }),
        ],
        op.mutationIndexes,
      );
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt,
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }

    const anchor = live.get(op.afterId);
    if (!anchor) {
      throw new Error(`insert paragraphs: missing anchor ${op.afterId}`);
    }
    const { reqs: splitReqs, writeAt } = compileSplit(anchor, op.position, seg, tab);
    push(splitReqs, op.mutationIndexes);
    insertChars += 1;

    const allBullets = op.specs.length > 0 && op.specs.every((s) => s.bullet);
    const inheritedList = op.position === "afterend" && anchor.kind === "paragraph" && Boolean(anchor.bullet);
    const neighborLevel = anchor.bullet?.nestingLevel ?? 0;
    const firstSpec = op.specs[0];
    const firstPreset = firstSpec?.bullet?.preset;
    const specBulletType = firstPreset ? bulletType(firstPreset) : undefined;
    const anchorBulletType =
      anchor.bullet?.type ?? (anchor.bullet?.preset ? bulletType(anchor.bullet.preset) : undefined);
    const sameBulletType = !anchorBulletType || !specBulletType || anchorBulletType === specBulletType;
    const samePreset = !anchor.bullet?.preset || !firstPreset || anchor.bullet.preset === firstPreset;

    const peerJoin =
      allBullets &&
      inheritedList &&
      sameBulletType &&
      samePreset &&
      op.specs.every((s) => (s.bullet?.nestingLevel ?? 0) === neighborLevel);
    const parsed = parseSpecsInline(op.specs, {
      leadingTabs: allBullets && !peerJoin,
    });
    if (parsed.plain.length) {
      push(
        [
          {
            insertText: {
              location: atLoc(writeAt, seg, tab),
              text: parsed.plain,
            },
          },
        ],
        op.mutationIndexes,
      );
      insertChars += parsed.plain.length;
      push([RequestBuilder.clearInlineStyles(writeAt, writeAt + parsed.plain.length, seg, tab)], op.mutationIndexes);
    }

    const rangeEnd = writeAt + parsed.plain.length + 1;
    const style = op.specs[0]?.namedStyleType ?? "NORMAL_TEXT";
    push([RequestBuilder.namedStyle(writeAt, rangeEnd, style, seg, tab)], op.mutationIndexes);
    {
      let offset = 0;
      for (let i = 0; i < op.specs.length; i++) {
        const spec = op.specs[i]!;
        const start = writeAt + offset;
        const end = start + parsed.plains[i]?.length + 1;
        const patch = omitIndent({
          ...(spec.alignment ? { alignment: spec.alignment } : {}),
          ...spec.style,
        });
        if (Object.keys(patch).length) {
          push(RequestBuilder.applyStyle({ end, patch, segmentId: seg, start, tabId: tab }), op.mutationIndexes);
        }
        offset += parsed.plains[i]?.length + 1;
      }
    }
    push(RequestBuilder.buildTextStyles(writeAt, parsed.runs, seg, tab), op.mutationIndexes);

    if (allBullets && !peerJoin) {
      const preset = op.specs[0]?.bullet?.preset ?? "BULLET_DISC_CIRCLE_SQUARE";
      // Tabs only count when the paragraph is not already a list item.
      // Delete inherited glyphs on the NEW range only — expanding onto the
      // neighbor would flatten existing nested items (they have no tabs left).
      push([RequestBuilder.deleteParagraphBullets(writeAt, rangeEnd, seg, tab)], op.mutationIndexes);
      push([RequestBuilder.createParagraphBullets(writeAt, rangeEnd, preset, seg, tab)], op.mutationIndexes);
    } else if (!allBullets) {
      // splitAfter a list item continues the list. Headings and prose must not
      // keep the glyph.
      push([RequestBuilder.deleteParagraphBullets(writeAt, rangeEnd, seg, tab)], op.mutationIndexes);
    }

    {
      let offset = 0;
      for (let i = 0; i < op.specs.length; i++) {
        const spec = op.specs[i]!;
        const start = writeAt + offset;
        const end = start + parsed.plains[i]?.length + 1;
        const indentPatch = indentPatchFromSpec(spec);
        if (hasIndent(indentPatch)) {
          push(
            RequestBuilder.applyStyle({
              end,
              isBullet: Boolean(spec.bullet),
              patch: indentPatch,
              segmentId: seg,
              start,
              tabId: tab,
            }),
            op.mutationIndexes,
          );
        }
        offset += parsed.plains[i]?.length + 1;
      }
    }

    const specialCount = op.specs.reduce((n, s) => n + (s.specials?.length ?? 0), 0);
    if (specialCount > 0) {
      let specialOffset = 0;
      const specialStarts: Array<{ index: number; specials?: ParagraphInlineSpecial[] }> = [];
      for (let i = 0; i < op.specs.length; i++) {
        const spec = op.specs[i]!;
        const tabs = allBullets && !peerJoin && spec.bullet ? spec.bullet.nestingLevel : 0;
        specialStarts.push({ index: writeAt + specialOffset + tabs, specials: spec.specials });
        specialOffset += parsed.plains[i]?.length + 1;
      }
      for (let i = specialStarts.length - 1; i >= 0; i--) {
        const item = specialStarts[i]!;
        push(
          RequestBuilder.insertInlineSpecials({
            index: item.index,
            segmentId: seg,
            specials: item.specials,
            tabId: tab,
          }),
          op.mutationIndexes,
        );
      }
      insertChars += specialCount;
    }

    const delta = 1 + parsed.bodies.join("\n").length + specialCount;
    let cursor = writeAt;
    for (let i = 0; i < op.specs.length; i++) {
      const spec = op.specs[i]!;
      const id = op.ids[i]!;
      const start = cursor;
      const nSpecials = spec.specials?.length ?? 0;
      const end = start + parsed.bodies[i]?.length + 1 + nSpecials;
      live.set(id, {
        ...(spec.alignment ? { alignment: spec.alignment } : {}),
        ...(spec.bullet
          ? {
              bullet: {
                ...(op.joinListId ? { listId: op.joinListId } : {}),
                nestingLevel: spec.bullet.nestingLevel,
                preset: spec.bullet.preset,
                type: bulletType(spec.bullet.preset),
              },
            }
          : {}),
        end,
        kind: "paragraph",
        namedStyleType: spec.namedStyleType,
        start,
        tapeIndex: id,
        text: parsed.bodies[i],
      });
      cursor = end;
    }
    shiftLive(live, writeAt, delta, ...op.ids);
  }

  return {
    requestOrigins,
    requests,
    rowFills: rowFills.length ? rowFills : undefined,
    summary: {
      deleteChars,
      insertChars,
      requestCount: requests.length,
      tables,
    },
    tableInserts,
  };
}

/** Compiles a write session to Docs API requests (alias for domCompile). */
export const compileDom = domCompile;
/** Groups consecutive sibling bullet inserts into one createParagraphBullets. */
function coalesce(mutations: DomMutation[]): CompiledOp[] {
  const out: CompiledOp[] = [];
  let i = 0;
  while (i < mutations.length) {
    const m = mutations[i]!;
    if (
      m.type === "innerText" ||
      m.type === "remove" ||
      m.type === "namedStyleType" ||
      m.type === "style" ||
      m.type === "bullets" ||
      m.type === "insertTableRow" ||
      m.type === "deleteTableRow" ||
      m.type === "insertTableColumn" ||
      m.type === "deleteTableColumn"
    ) {
      out.push({ ...m, mutationIndexes: [m.opIndex ?? i] });
      i++;
      continue;
    }
    if (m.spec.kind === "pageBreak") {
      out.push({
        afterId: m.anchorId,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        type: "insertPageBreak",
      });
      i++;
      continue;
    }
    if (m.spec.kind === "sectionBreak") {
      out.push({
        afterId: m.anchorId,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        sectionType: m.spec.sectionType,
        type: "insertSectionBreak",
      });
      i++;
      continue;
    }
    if (m.spec.kind === "person") {
      out.push({
        afterId: m.anchorId,
        email: m.spec.email,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        type: "insertPerson",
      });
      i++;
      continue;
    }
    if (m.spec.kind === "richLink") {
      out.push({
        afterId: m.anchorId,
        mimeType: m.spec.mimeType,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        title: m.spec.title,
        type: "insertRichLink",
        uri: m.spec.uri,
      });
      i++;
      continue;
    }
    if (m.spec.kind === "date") {
      out.push({
        afterId: m.anchorId,
        dateFormat: m.spec.dateFormat,
        displayText: m.spec.displayText,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        timestamp: m.spec.timestamp,
        type: "insertDate",
      });
      i++;
      continue;
    }
    if (m.spec.kind === "footnote") {
      out.push({
        afterId: m.anchorId,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        text: m.spec.text,
        type: "createFootnote",
      });
      i++;
      continue;
    }
    if (m.spec.kind === "inlineImage") {
      out.push({
        afterId: m.anchorId,
        heightPt: m.spec.heightPt,
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        type: "insertInlineImage",
        uri: m.spec.uri,
        widthPt: m.spec.widthPt,
      });
      i++;
      continue;
    }
    if (m.spec.kind === "table") {
      out.push({
        afterId: m.anchorId,
        ...(m.spec.table.cellSpecials ? { cellSpecials: m.spec.table.cellSpecials } : {}),
        mutationIndexes: [m.opIndex ?? i],
        newId: m.newId,
        position: m.position,
        rows: m.spec.table.rows,
        type: "insertTable",
      });
      i++;
      continue;
    }
    if (!m.spec.bullet) {
      out.push({
        afterId: m.anchorId,
        ids: [m.newId],
        mutationIndexes: [m.opIndex ?? i],
        position: m.position,
        specs: [m.spec],
        type: "insertParagraphs",
      });
      i++;
      continue;
    }

    const run: Extract<DomMutation, { type: "insertAdjacent" }>[] = [m];
    let j = i + 1;
    while (j < mutations.length) {
      const next = mutations[j]!;
      if (next.type !== "insertAdjacent") break;
      if (next.spec.kind !== "paragraph" || !next.spec.bullet) break;
      const prev = run[run.length - 1]!;
      if (next.position !== "afterend" || next.anchorId !== prev.newId) break;
      if (next.spec.bullet.preset !== m.spec.bullet.preset) break;
      run.push(next);
      j++;
    }
    out.push({
      afterId: m.anchorId,
      ids: run.map((r) => r.newId),
      mutationIndexes: run.map((r, k) => r.opIndex ?? i + k),
      position: m.position,
      specs: run.map((r) => r.spec as ParagraphSpec),
      type: "insertParagraphs",
    });
    i = j;
  }
  return out;
}

/** Compiles splitBefore/splitAfter paragraph break requests at anchor position. */
function compileSplit(
  anchor: Live,
  position: "afterend" | "beforebegin",
  segmentId?: string,
  tabId?: string,
): { reqs: object[]; writeAt: number } {
  if (position === "beforebegin") {
    return {
      reqs: [RequestBuilder.splitBefore(anchor.start, segmentId, tabId)],
      writeAt: anchor.start,
    };
  }
  // Tables are not paragraphs — end-1 is inside a cell. Insert at table.end
  // (start of the following body paragraph).
  if (anchor.kind !== "paragraph") {
    return {
      reqs: [RequestBuilder.splitBefore(anchor.end, segmentId, tabId)],
      writeAt: anchor.end,
    };
  }
  return {
    reqs: [RequestBuilder.splitAfter(anchor.end, segmentId, tabId)],
    writeAt: anchor.end,
  };
}

/** Compiles replacement innerText requests, inline styles, and image preservations. */
function compileInnerText(
  node: Live,
  text: string,
  segmentId?: string,
  tabId?: string,
  customRuns?: InlineRunInput[],
): { length: number; plain: string; reqs: object[] } {
  const { runs: parsedRuns, text: plain } = InlineMarkup.parse(text);
  const runs = InlineMarkup.resolveRuns(plain, parsedRuns, customRuns);
  const images = [...(node.images ?? [])].sort((a, b) => a.start - b.start);
  const reqs = images.length
    ? replaceTextKeepingImages(node, plain, images, segmentId, tabId)
    : RequestBuilder.replaceInnerText(node.start, node.end, plain, segmentId, tabId);
  if (plain.length) {
    reqs.push(RequestBuilder.clearInlineStyles(node.start, node.start + plain.length, segmentId, tabId));
  }
  reqs.push(...RequestBuilder.buildTextStyles(node.start, runs, segmentId, tabId));
  return { length: plain.length, plain, reqs };
}

/** Deletes text runs only; inline images stay. New caption is inserted before them. */
function replaceTextKeepingImages(
  node: Live,
  plain: string,
  images: NonNullable<Live["images"]>,
  segmentId?: string,
  tabId?: string,
): object[] {
  const contentEnd = Math.max(node.start, node.end - 1);
  const gaps: Array<{ end: number; start: number }> = [];
  let cursor = node.start;
  for (const img of images) {
    if (img.start > cursor) gaps.push({ end: img.start, start: cursor });
    cursor = Math.max(cursor, img.end);
  }
  if (contentEnd > cursor) gaps.push({ end: contentEnd, start: cursor });

  const reqs: object[] = [];
  for (const gap of gaps.reverse()) {
    if (gap.end > gap.start) {
      reqs.push({
        deleteContentRange: {
          range: atRng(gap.start, gap.end, segmentId, tabId),
        },
      });
    }
  }
  if (plain.length) {
    reqs.push({
      insertText: {
        location: atLoc(node.start, segmentId, tabId),
        text: plain,
      },
    });
  }
  return reqs;
}

/** Builds Docs API location object with optional segment and tab identifiers. */
function atLoc(
  index: number,
  segmentId?: string,
  tabId?: string,
): { index: number; segmentId?: string; tabId?: string } {
  return {
    index,
    ...(segmentId ? { segmentId } : {}),
    ...(tabId ? { tabId } : {}),
  };
}

/** Builds Docs API range object with optional segment and tab identifiers. */
function atRng(
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

/** Sums character length of all inline images in a live node. */
function imageCharCount(node: Live): number {
  let n = 0;
  for (const img of node.images ?? []) n += Math.max(0, img.end - img.start);
  return n;
}

/** After innerText, images pack immediately after the new caption. */
function packImagesAfterText(node: Live, plainLen: number): void {
  const images = node.images;
  if (!images?.length) {
    node.end = node.start + plainLen + 1;
    return;
  }
  let pos = node.start + plainLen;
  for (const img of [...images].sort((a, b) => a.start - b.start)) {
    const w = Math.max(1, img.end - img.start);
    img.start = pos;
    img.end = pos + w;
    pos += w;
  }
  node.end = pos + 1;
}

/** Parse each spec on its own so a stray backtick cannot eat the next bullet. */
function parseSpecsInline(
  specs: ParagraphSpec[],
  opts: { leadingTabs?: boolean } = {},
): {
  bodies: string[];
  plain: string;
  plains: string[];
  runs: TextRun[];
} {
  let offset = 0;
  const bodies: string[] = [];
  const plains: string[] = [];
  const runs: TextRun[] = [];
  for (const spec of specs) {
    const parsed = InlineMarkup.parse(spec.text);
    const resolvedRuns = InlineMarkup.resolveRuns(parsed.text, parsed.runs, spec.runs);
    const tabs = opts.leadingTabs && spec.bullet ? "\t".repeat(spec.bullet.nestingLevel) : "";
    for (const run of resolvedRuns) {
      runs.push({
        ...run,
        end: run.end + offset + tabs.length,
        start: run.start + offset + tabs.length,
      });
    }
    bodies.push(parsed.text);
    plains.push(`${tabs}${parsed.text}`);
    offset += tabs.length + parsed.text.length + 1;
  }
  return { bodies, plain: plains.join("\n"), plains, runs };
}

/**
 * insertTable only shifts live indexes by 1. Mixing remove/edits of other
 * nodes in the same compile hits the new table. Style on the inserted table is ok.
 */
function assertTableInsertIsolation(mutations: DomMutation[]): void {
  const tableIds = new Set<number>();
  for (const m of mutations) {
    if (m.type === "insertAdjacent" && m.spec.kind === "table") {
      tableIds.add(m.newId);
    }
  }
  if (!tableIds.size) return;
  for (const m of mutations) {
    if (m.type === "insertAdjacent" && m.spec.kind === "table") continue;
    if (m.type === "style" && tableIds.has(m.nodeId) && !m.cell) continue;
    throw new Error(TABLE_INSERT_MIX_MSG);
  }
}

/** Collects all live nodes sharing the same bullet listId run. */
function liveListRun(live: Map<number, Live>, node: Live): Live[] {
  const listId = node.bullet?.listId;
  if (!listId) return [node];
  return [...live.values()].filter((n) => n.bullet?.listId === listId).sort((a, b) => a.start - b.start);
}

/** Paragraph ranges inside table cells (skip unindexed insert placeholders). */
function cellParaRanges(cells: TableCell[][] | undefined): Array<{ end: number; start: number }> {
  const out: Array<{ end: number; start: number }> = [];
  for (const row of cells ?? []) {
    for (const cell of row) {
      for (const p of cell.paragraphs ?? [cell]) {
        if (p.start >= 0 && p.end > p.start) out.push({ end: p.end, start: p.start });
      }
    }
  }
  return out;
}

/** Finds the live node immediately preceding the given node. */
function findPrecedingLiveNode(live: Map<number, Live>, node: Live): Live | undefined {
  let prev: Live | undefined;
  for (const n of live.values()) {
    if (n.tapeIndex !== node.tapeIndex && n.end <= node.start) {
      if (!prev || n.end > prev.end) {
        prev = n;
      }
    }
  }
  return prev;
}

/** Checks whether a live node is the last node on the tape. */
function isLastLiveNode(live: Map<number, Live>, node: Live): boolean {
  for (const n of live.values()) {
    if (n.tapeIndex !== node.tapeIndex && n.start > node.start) return false;
  }
  return true;
}

/** Shifts live node character indexes by delta across mutations. */
function shiftLive(live: Map<number, Live>, fromIndex: number, delta: number, ...except: number[]): void {
  if (!delta) return;
  const skip = new Set(except);
  for (const n of live.values()) {
    if (skip.has(n.tapeIndex)) continue;
    if (n.start >= fromIndex) {
      n.start += delta;
      n.end += delta;
      shiftImages(n, fromIndex, delta);
      shiftTableCells(n, fromIndex, delta);
    } else if (n.end > fromIndex) {
      n.end += delta;
      shiftImages(n, fromIndex, delta);
      shiftTableCells(n, fromIndex, delta);
    }
  }
}

/** Adjusts inline image character offsets following text mutations. */
function shiftImages(node: { images?: InlineImage[] }, fromIndex: number, delta: number): void {
  for (const img of node.images ?? []) {
    if (img.start >= fromIndex) {
      img.start += delta;
      img.end += delta;
    } else if (img.end > fromIndex) {
      img.end += delta;
    }
  }
}

/** Deep clones a 2D table cell grid including cell paragraphs and images. */
function cloneCells(cells: TableCell[][]): TableCell[][] {
  return cells.map((row) =>
    row.map((cell) => ({
      ...cell,
      paragraphs: (cell.paragraphs ?? [{ ...cell }]).map((p) => ({
        ...p,
        ...(p.images ? { images: p.images.map((img) => ({ ...img })) } : {}),
      })),
      ...(cell.images ? { images: cell.images.map((img) => ({ ...img })) } : {}),
    })),
  );
}

/** Asserts that a live table node has cells at the specified coordinates. */
function requireLiveCell(node: Live, cell: [number, number]): TableCell & { paragraphs: CellParagraph[] } {
  if (node.kind !== "table" || !node.cells) {
    throw new Error("cell: [row, col] is only valid on a table node");
  }
  const [r, c] = cell;
  const hit = node.cells[r]?.[c];
  if (!hit) {
    throw new Error(`No cell [${r}, ${c}] — table is ${node.cells.length}×${node.cells[0]?.length ?? 0}`);
  }
  if (!hit.paragraphs?.length) {
    hit.paragraphs = [{ end: hit.end, start: hit.start, text: hit.text }];
  }
  return hit as TableCell & { paragraphs: CellParagraph[] };
}

/** Asserts that a live table cell contains the specified paragraph index. */
function requireLivePara(node: Live, cell: [number, number], para?: number): CellParagraph {
  const tableCell = requireLiveCell(node, cell);
  const i = para ?? 0;
  const hit = tableCell.paragraphs[i];
  if (!hit) {
    throw new Error(`No paragraph ${i} in cell [${cell[0]}, ${cell[1]}] (${tableCell.paragraphs.length} paragraphs)`);
  }
  return hit;
}

/** Shifts internal character indexes of table cells and their paragraphs. */
function shiftTableCells(
  node: Live,
  fromIndex: number,
  delta: number,
  except?: [number, number],
  exceptPara?: number,
): void {
  if (!delta || !node.cells) return;
  const skipPara = exceptPara ?? 0;
  for (let r = 0; r < node.cells.length; r++) {
    const row = node.cells[r]!;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]!;
      const paras = cell.paragraphs ?? [cell];
      for (let p = 0; p < paras.length; p++) {
        if (except && except[0] === r && except[1] === c && p === skipPara) continue;
        const para = paras[p]!;
        if (para.start >= fromIndex) {
          para.start += delta;
          para.end += delta;
          shiftImages(para, fromIndex, delta);
        } else if (para.end > fromIndex) {
          para.end += delta;
          shiftImages(para, fromIndex, delta);
        }
      }
      const head = paras[0];
      if (head) {
        cell.start = head.start;
        cell.end = paras[paras.length - 1]?.end;
        cell.images = head.images;
        cell.text = head.text;
      }
    }
  }
}

/** Synchronizes cell images up to the parent table node for querying. */
function syncTableImages(node: Live): void {
  if (!node.cells) return;
  const images: InlineImage[] = [];
  for (let r = 0; r < node.cells.length; r++) {
    const row = node.cells[r]!;
    for (let c = 0; c < row.length; c++) {
      for (const img of row[c]?.images ?? []) {
        images.push({ ...img, col: c, row: r });
      }
    }
  }
  if (images.length) node.images = images;
  else delete node.images;
}

/** Resolves list nesting style from document list definition properties. */
function listNestingStyle(
  lists: GoogleDoc["lists"] | undefined,
  listId: string | undefined,
  nestingLevel: number,
): ListIndent | undefined {
  if (!listId || !lists) return undefined;
  const level = lists[listId]?.listProperties?.nestingLevels?.[nestingLevel];
  if (!level || typeof level !== "object") return undefined;
  const start = (level as { indentStart?: { magnitude?: number } }).indentStart;
  const first = (level as { indentFirstLine?: { magnitude?: number } }).indentFirstLine;
  if (typeof start?.magnitude !== "number") return undefined;
  return {
    indentFirstLine:
      typeof first?.magnitude === "number" ? first.magnitude : Math.max(0, start.magnitude - STOCK_NESTING_HANGING_PT),
    indentStart: start.magnitude,
  };
}

/** Docs Range on a batchUpdate request. */
type DocsRange = {
  /** Exclusive end index. */
  endIndex: number;
  /** Inclusive start index. */
  startIndex: number;
};

/**
 * Clips a style/bullet range so endIndex stays strictly below the segment end.
 * Docs rejects `updateParagraphStyle` / bullet ranges whose endIndex is the last
 * newline of the tab (`Index N must be less than the end index of the referenced segment`).
 * Returns false when the clipped range is empty and the request should be dropped.
 */
function clipStyleRangeToSegment(
  /** Range to clip in place. */
  range: DocsRange,
  /** Exclusive segment end after prior content mutations in this compile. */
  segmentEnd: number,
): boolean {
  const maxEnd = segmentEnd - 1;
  if (range.endIndex > maxEnd) range.endIndex = maxEnd;
  return range.endIndex > range.startIndex;
}

/** Character-length delta a content-mutating request applies to the segment. */
function requestContentDelta(
  /** Compiled Docs batchUpdate request. */
  request: object,
): number {
  if ("insertText" in request) {
    const text = (request as { insertText: { text?: string } }).insertText.text;
    return typeof text === "string" ? text.length : 0;
  }
  if ("insertPageBreak" in request || "insertSectionBreak" in request) return 1;
  if (
    "insertPerson" in request ||
    "insertDate" in request ||
    "insertRichLink" in request ||
    "insertInlineImage" in request
  ) {
    return 1;
  }
  if ("deleteContentRange" in request) {
    const range = (request as { deleteContentRange: { range: DocsRange } }).deleteContentRange.range;
    return -(range.endIndex - range.startIndex);
  }
  return 0;
}

/** Paragraph/text style or bullet range, if this request has one. */
function requestStyleRange(
  /** Compiled Docs batchUpdate request. */
  request: object,
): DocsRange | undefined {
  if ("updateParagraphStyle" in request) {
    return (request as { updateParagraphStyle: { range: DocsRange } }).updateParagraphStyle.range;
  }
  if ("updateTextStyle" in request) {
    return (request as { updateTextStyle: { range: DocsRange } }).updateTextStyle.range;
  }
  if ("createParagraphBullets" in request) {
    return (request as { createParagraphBullets: { range: DocsRange } }).createParagraphBullets.range;
  }
  if ("deleteParagraphBullets" in request) {
    return (request as { deleteParagraphBullets: { range: DocsRange } }).deleteParagraphBullets.range;
  }
  return undefined;
}

/** Expand createParagraphBullets onto a neighboring existing list. */
function attachJoinListId(ops: CompiledOp[], original: DocNode[]): CompiledOp[] {
  const byId = new Map(original.map((n) => [n.tapeIndex, n]));
  return ops.map((op) => {
    if (op.type !== "insertParagraphs") return op;
    if (!op.specs[0]?.bullet) return op;
    const anchor = byId.get(op.afterId);
    const listId = anchor?.bullet?.listId;
    if (!listId) return op;
    return { ...op, joinListId: listId };
  });
}
