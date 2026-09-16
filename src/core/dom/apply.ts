/*

Compile DomWriter mutations to Docs batchUpdate requests and apply them.

Insert after a heading splits at endIndex-1, then writes into the NEW
paragraph — the heading is never restyled. Consecutive new bullet siblings
become one createParagraphBullets range (shared listId). Agents never call
createParagraphBullets.

Nesting uses bullet.nestingLevel. Google counts leading tabs on
createParagraphBullets and strips them — indentStart alone does not change
nestingLevel. Apply prefixes `\t`.repeat(level) before creating bullets.
A non-bullet insert after a list item (and namedStyleType to a heading)
emits deleteParagraphBullets so inherited glyphs do not stick.

Explicit indentStart on a bullet still gets an 18pt hanging first-line
unless indentFirstLine is also passed. Quotes (no bullet) get indentStart
only. The same StylePatch fields work on insert and restyle.

*/

import { Gdoc } from "../gdoc.ts";
import { type GwsClient, gws } from "../gws.ts";
import { InlineMarkup, type InlineRunInput, type TextRun } from "../inline.ts";
import { RequestBuilder } from "../requests.ts";
import type { ApplySummary, GoogleDoc } from "../types.ts";
import type { ParagraphSpec } from "./element.ts";
import { assertWritable } from "./guards.ts";
import { type PageSetup, TABLE_INSERT_MIX_MSG } from "./ops.ts";
import { HANGING_INDENT_PT, hasIndent, omitIndent, pt, type StylePatch } from "./style.ts";
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
export function resolveNestingIndent(opts: {
  explicit?: { magnitude: number; unit: "PT" };
  indentFirstLine?: { magnitude: number; unit: "PT" };
  listId?: string;
  lists?: GoogleDoc["lists"];
  nestingLevel: number;
}): number | undefined {
  return resolveNestingStyle(opts)?.indentStart;
}

/** Full Docs list indent pair, or undefined for level 0 with no explicit indent. */
export function resolveNestingStyle(opts: {
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

function stockListIndent(nestingLevel: number): ListIndent {
  return {
    indentFirstLine: STOCK_NESTING_HANGING_PT + nestingLevel * STOCK_NESTING_INDENT_PT,
    indentStart: STOCK_NESTING_INDENT_PT + nestingLevel * STOCK_NESTING_INDENT_PT,
  };
}

/** Compiled surgical write ready to send (or inspect in tests). */
export type CompiledDomWrite = {
  requests: object[];
  requestOrigins: Array<{ mutationIndexes: number[] }>;
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
  tapeIndex: number;
  images?: DocNode["images"];
  kind: DocNode["kind"];
  namedStyleType?: DocNode["namedStyleType"];
  start: number;
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
export function compileDom(
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

  const push = (reqs: object[], mutationIndexes: number[]) => {
    for (const r of reqs) {
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
        throw new Error(LAST_PARAGRAPH_MSG);
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

    const delta = 1 + parsed.bodies.join("\n").length;
    let cursor = writeAt;
    for (let i = 0; i < op.specs.length; i++) {
      const spec = op.specs[i]!;
      const id = op.ids[i]!;
      const start = cursor;
      const end = start + parsed.bodies[i]?.length + 1;
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

/** Constructs an updateDocumentStyle batchUpdate request for page geometry and margins. */
export function buildDocumentStyleRequest(pageSetup: PageSetup, tabId?: string): object {
  if ((pageSetup as any).pageless !== undefined || (pageSetup as any).mode === "PAGELESS") {
    throw new Error(
      "Pageless mode cannot be set via API: Google Docs REST API does not support toggling pageless mode (web UI only).",
    );
  }
  const documentStyle: Record<string, unknown> = {};
  const fields: string[] = [];
  if (pageSetup.margins) {
    if (pageSetup.margins.top != null) {
      documentStyle.marginTop = pt(pageSetup.margins.top);
      fields.push("marginTop");
    }
    if (pageSetup.margins.bottom != null) {
      documentStyle.marginBottom = pt(pageSetup.margins.bottom);
      fields.push("marginBottom");
    }
    if (pageSetup.margins.left != null) {
      documentStyle.marginLeft = pt(pageSetup.margins.left);
      fields.push("marginLeft");
    }
    if (pageSetup.margins.right != null) {
      documentStyle.marginRight = pt(pageSetup.margins.right);
      fields.push("marginRight");
    }
  }
  if (pageSetup.orientation || pageSetup.pageSize || pageSetup.pageWidth != null || pageSetup.pageHeight != null) {
    let w = pageSetup.pageWidth ?? (pageSetup.orientation === "LANDSCAPE" ? 792 : 612);
    let h = pageSetup.pageHeight ?? (pageSetup.orientation === "LANDSCAPE" ? 612 : 792);
    if (pageSetup.pageSize === "LEGAL") {
      w = pageSetup.orientation === "LANDSCAPE" ? 1008 : 612;
      h = pageSetup.orientation === "LANDSCAPE" ? 612 : 1008;
    } else if (pageSetup.pageSize === "TABLOID") {
      w = pageSetup.orientation === "LANDSCAPE" ? 1224 : 792;
      h = pageSetup.orientation === "LANDSCAPE" ? 792 : 1224;
    } else if (pageSetup.pageSize === "A4") {
      w = pageSetup.orientation === "LANDSCAPE" ? 841.89 : 595.28;
      h = pageSetup.orientation === "LANDSCAPE" ? 595.28 : 841.89;
    }
    documentStyle.pageSize = {
      height: pt(h),
      width: pt(w),
    };
    fields.push("pageSize");
  }
  return RequestBuilder.updateDocumentStyle({
    documentStyle,
    fields: fields.join(","),
    tabId,
  });
}

/** Sends compiled requests via GwsClient. Accepts one writer or several (body + segments). */
export async function applyDom(
  documentId: string,
  writer: DomWriter | DomWriter[],
  opts: {
    client?: GwsClient;
    doc?: GoogleDoc;
    dryRun?: boolean;
    force?: boolean;
    pageSetup?: PageSetup;
    plan?: Array<{
      action: string;
      index: number;
      target: { id: number | string; namedStyleType?: string; text?: string };
    }>;
  } = {},
): Promise<CompiledDomWrite> {
  const client = opts.client ?? gws;
  const writers = Array.isArray(writer) ? writer : [writer];
  const compiled = mergeCompiled(
    writers.map((w) => compileDom(w, { force: opts.force, lists: opts.doc?.lists ?? w.lists })),
  );
  if (opts.pageSetup) {
    const styleReq = buildDocumentStyleRequest(opts.pageSetup, writers[0]?.tabId);
    compiled.requests.unshift(styleReq);
    compiled.requestOrigins.unshift({ mutationIndexes: [] });
    compiled.summary.requestCount = compiled.requests.length;
  }
  if (opts.dryRun || !compiled.requests.length) return compiled;

  try {
    await client.batchUpdate(documentId, compiled.requests);
  } catch (err) {
    throw wrapBatchUpdateError(err, {
      batch: "main",
      origins: compiled.requestOrigins,
      plan: opts.plan,
    });
  }

  for (const table of compiled.tableInserts) {
    try {
      const data = await client.getDocument(documentId);
      const gdoc = table.tabId ? new Gdoc(data, documentId).withTab(table.tabId) : new Gdoc(data, documentId);
      const tableEl = gdoc.findInsertedTableAt(table.insertIndex) ?? gdoc.findTableAt(table.insertIndex);
      if (!tableEl?.table) continue;
      const fill = RequestBuilder.buildTableFill(
        table.rows.length > 1,
        table.rows,
        tableEl,
        table.segmentId,
        table.tabId,
      );
      if (fill.length) {
        await client.batchUpdate(documentId, fill);
      }
    } catch (err) {
      throw wrapBatchUpdateError(err, { batch: "table-fill", plan: opts.plan });
    }
  }

  if (compiled.rowFills && compiled.rowFills.length > 0) {
    try {
      const data = await client.getDocument(documentId);
      const rowFillReqs: object[] = [];
      for (const fill of compiled.rowFills) {
        const gdoc = fill.tabId ? new Gdoc(data, documentId).withTab(fill.tabId) : new Gdoc(data, documentId);
        const tableEl = gdoc.findTableAt(fill.tableStart);
        if (!tableEl?.table?.tableRows) continue;
        const targetRowIdx = fill.insertBelow ? fill.rowIndex + 1 : fill.rowIndex;
        const row = tableEl.table.tableRows[targetRowIdx];
        if (!row?.tableCells) continue;
        const cellsToFill: Array<{ idx: number; text: string }> = [];
        for (let c = 0; c < fill.cells.length; c++) {
          const text = fill.cells[c];
          if (!text) continue;
          const cell = row.tableCells[c];
          if (!cell) continue;
          const idx = RequestBuilder.cellInsertIndex(cell);
          cellsToFill.push({ idx, text });
        }
        cellsToFill.sort((a, b) => b.idx - a.idx);
        for (const item of cellsToFill) {
          const { runs, text: plain } = InlineMarkup.parse(item.text);
          const line = plain.endsWith("\n") ? plain : `${plain}\n`;
          rowFillReqs.push({
            insertText: {
              location: {
                index: item.idx,
                ...(fill.segmentId ? { segmentId: fill.segmentId } : {}),
                ...(fill.tabId ? { tabId: fill.tabId } : {}),
              },
              text: line,
            },
          });
          const textEnd = item.idx + Math.max(0, line.length - (line.endsWith("\n") ? 1 : 0));
          if (textEnd > item.idx) {
            rowFillReqs.push(RequestBuilder.clearInlineStyles(item.idx, textEnd, fill.segmentId, fill.tabId));
          }
          rowFillReqs.push(...RequestBuilder.textStyleRequests(item.idx, runs, fill.segmentId, fill.tabId));
        }
      }
      if (rowFillReqs.length > 0) {
        await client.batchUpdate(documentId, rowFillReqs);
      }
    } catch (err) {
      throw wrapBatchUpdateError(err, { batch: "table-fill", plan: opts.plan });
    }
  }

  return compiled;
}

function mergeCompiled(parts: CompiledDomWrite[]): CompiledDomWrite {
  const out: CompiledDomWrite = {
    requests: [],
    requestOrigins: [],
    summary: { deleteChars: 0, insertChars: 0, requestCount: 0, tables: 0 },
    tableInserts: [],
  };
  for (const part of parts) {
    out.requests.push(...part.requests);
    out.requestOrigins.push(...part.requestOrigins);
    out.tableInserts.push(...part.tableInserts);
    if (part.rowFills) {
      out.rowFills = [...(out.rowFills ?? []), ...part.rowFills];
    }
    out.summary.deleteChars += part.summary.deleteChars;
    out.summary.insertChars += part.summary.insertChars;
    out.summary.tables += part.summary.tables;
  }
  out.summary.requestCount = out.requests.length;
  return out;
}

/**
 * Maps a Docs `requests[n]` API error back to mutation/op indexes.
 * A single batchUpdate is atomic; table fills are a second call.
 */
export function wrapBatchUpdateError(
  err: unknown,
  opts: {
    batch: "main" | "table-fill";
    origins?: Array<{ mutationIndexes: number[] }>;
    plan?: Array<{
      action: string;
      index: number;
      target: { id: number | string; namedStyleType?: string; text?: string };
    }>;
  },
): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (opts.batch === "table-fill") {
    return new Error(
      `${raw}\nFailed during table cell fill (second batchUpdate). The table may already exist from the first call. Restore the pinned revision if the Doc looks half-written.`,
    );
  }
  const idx = parseGoogleRequestIndex(raw);
  const origin = idx != null && opts.origins ? opts.origins[idx] : undefined;
  const ops = origin?.mutationIndexes ?? [];
  const labels = ops.map((i) => {
    const p = opts.plan?.find((op) => op.index === i);
    if (!p) return `ops[${i}]`;
    const preview = p.target.text ?? p.target.namedStyleType ?? "";
    return `ops[${i}] ${p.action} #${p.target.id}${preview ? ` ${JSON.stringify(preview)}` : ""}`;
  });
  const where = idx != null ? `API requests[${idx}]${labels.length ? ` ← ${labels.join("; ")}` : ""}. ` : "";
  return new Error(`${where}${raw}\nThat batchUpdate is atomic — none of its requests applied.`);
}

/** Parses `requests[12]` from a Docs/gws error string. */
export function parseGoogleRequestIndex(message: string): number | undefined {
  const m = /\brequests\[(\d+)\]/.exec(message);
  if (!m) return undefined;
  return Number(m[1]);
}

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

function isLastLiveNode(live: Map<number, Live>, node: Live): boolean {
  for (const n of live.values()) {
    if (n.tapeIndex !== node.tapeIndex && n.start > node.start) return false;
  }
  return true;
}

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

function requireLivePara(node: Live, cell: [number, number], para?: number): CellParagraph {
  const tableCell = requireLiveCell(node, cell);
  const i = para ?? 0;
  const hit = tableCell.paragraphs[i];
  if (!hit) {
    throw new Error(`No paragraph ${i} in cell [${cell[0]}, ${cell[1]}] (${tableCell.paragraphs.length} paragraphs)`);
  }
  return hit;
}

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
