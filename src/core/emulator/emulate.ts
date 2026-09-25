/* Applies Docs API batchUpdate requests to an EmulatorState tape (see G3 M3). */

import type { GoogleDoc } from "~/core/types.ts";
import { listPresetInfer, listPresetTable } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import type { BulletPreset } from "../model/types.ts";
import {
  deleteTableColumn,
  deleteTableRow,
  insertTable,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  pinTableHeaderRows,
  unmergeTableCells,
  updateTableCellStyle,
  updateTableColumnProperties,
  updateTableRowStyle,
} from "./emulateTables.ts";
import { applyStyleFields, parseFields } from "./fieldMask.ts";
import { docStateBuild, docStateJson, type EmulatorState, type NlPara, type TabState, type TapeCell } from "./tape.ts";

/** Reason an emulated request was rejected. */
export type EmulatorErrorCode =
  | "DELETE_LAST_NEWLINE"
  | "DELETE_NEWLINE_BEFORE_STRUCTURE"
  | "DELETE_PARTIAL_STRUCTURE"
  | "INSERT_OUTSIDE_PARAGRAPH"
  | "RANGE_AT_SEGMENT_END"
  | "SURROGATE_SPLIT"
  | "TAB_REQUIRED"
  | "UNKNOWN_REQUEST";

/** Thrown when a request violates a Docs API structural rule the emulator enforces. */
export class EmulatorError extends Error {
  /** Machine-readable reason. */ code: EmulatorErrorCode;
  /** Index of the request (within the batch) that failed. */ requestIndex: number;

  constructor(code: EmulatorErrorCode, requestIndex: number, message: string) {
    super(message);
    this.code = code;
    this.requestIndex = requestIndex;
  }
}

/** Per-batch mutable context: which request is running, and counters for minting new heading/list/image/tab ids. */
export interface EmulateContext {
  idCounters: { heading: number; image: number; list: number; tab: number };
  requestIndex: number;
}

/** Applies a batch of Docs API `batchUpdate` requests to `json` in order, returning the resulting document and one (empty) reply per request. Throws `EmulatorError` on the first invalid request. */
export function requestsEmulate(
  /** Document JSON to start from. */
  json: GoogleDoc,
  /** Requests to apply, in order. */
  requests: readonly JsonObject[],
): { json: GoogleDoc; replies: JsonObject[] } {
  const state = docStateBuild(json);
  const ctx: EmulateContext = { idCounters: { heading: 0, image: 0, list: 0, tab: 0 }, requestIndex: 0 };
  const replies = requests.map((req, i) => {
    ctx.requestIndex = i;
    return requestApply(state, req, ctx);
  });
  return { json: docStateJson(state), replies };
}

/** Dispatches one request to its handler by its single top-level key. */
function requestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  if (req.insertText) return insertTextRequestApply(state, req.insertText as JsonObject, ctx);
  if (req.deleteContentRange) return deleteContentRangeRequestApply(state, req.deleteContentRange as JsonObject, ctx);
  if (req.updateTextStyle) return updateTextStyleRequestApply(state, req.updateTextStyle as JsonObject, ctx);
  if (req.updateParagraphStyle)
    return updateParagraphStyleRequestApply(state, req.updateParagraphStyle as JsonObject, ctx);
  if (req.createParagraphBullets)
    return createParagraphBulletsRequestApply(state, req.createParagraphBullets as JsonObject, ctx);
  if (req.deleteParagraphBullets)
    return deleteParagraphBulletsRequestApply(state, req.deleteParagraphBullets as JsonObject, ctx);
  if (req.insertPageBreak) return insertPageBreakRequestApply(state, req.insertPageBreak as JsonObject, ctx);
  if (req.insertSectionBreak) return insertSectionBreakRequestApply(state, req.insertSectionBreak as JsonObject, ctx);
  if (req.updateSectionStyle) return updateSectionStyleRequestApply(state, req.updateSectionStyle as JsonObject, ctx);
  if (req.insertPerson)
    return insertAtomRequestApply(state, req.insertPerson as JsonObject, ctx, "person", "personProperties");
  if (req.insertDate) return insertAtomRequestApply(state, req.insertDate as JsonObject, ctx, "date", "dateProperties");
  if (req.insertRichLink)
    return insertAtomRequestApply(state, req.insertRichLink as JsonObject, ctx, "richLink", "richLinkProperties");
  if (req.insertInlineImage) return insertInlineImageRequestApply(state, req.insertInlineImage as JsonObject, ctx);
  if (req.insertTable) return insertTableRequestApply(state, req.insertTable as JsonObject, ctx);
  if (req.insertTableRow) return insertTableRowRequestApply(state, req.insertTableRow as JsonObject, ctx);
  if (req.insertTableColumn) return insertTableColumnRequestApply(state, req.insertTableColumn as JsonObject, ctx);
  if (req.deleteTableRow) return deleteTableRowRequestApply(state, req.deleteTableRow as JsonObject, ctx);
  if (req.deleteTableColumn) return deleteTableColumnRequestApply(state, req.deleteTableColumn as JsonObject, ctx);
  if (req.mergeTableCells) return mergeTableCellsRequestApply(state, req.mergeTableCells as JsonObject, ctx);
  if (req.unmergeTableCells) return unmergeTableCellsRequestApply(state, req.unmergeTableCells as JsonObject, ctx);
  if (req.updateTableCellStyle)
    return updateTableCellStyleRequestApply(state, req.updateTableCellStyle as JsonObject, ctx);
  if (req.updateTableColumnProperties)
    return updateTableColumnPropertiesRequestApply(state, req.updateTableColumnProperties as JsonObject, ctx);
  if (req.updateTableRowStyle)
    return updateTableRowStyleRequestApply(state, req.updateTableRowStyle as JsonObject, ctx);
  if (req.pinTableHeaderRows) return pinTableHeaderRowsRequestApply(state, req.pinTableHeaderRows as JsonObject, ctx);
  if (req.createNamedRange || req.deleteNamedRange) {
    throw new EmulatorError("UNKNOWN_REQUEST", ctx.requestIndex, "named ranges are out of scope for v2 (see G3 D3)");
  }
  if (req.addDocumentTab) return addDocumentTabRequestApply(state, req.addDocumentTab as JsonObject, ctx);
  if (req.deleteTab) return deleteTabRequestApply(state, req.deleteTab as JsonObject);
  if (req.updateDocumentTabProperties)
    return updateDocumentTabPropertiesRequestApply(state, req.updateDocumentTabProperties as JsonObject, ctx);
  if (req.updateDocumentStyle)
    return updateDocumentStyleRequestApply(state, req.updateDocumentStyle as JsonObject, ctx);
  throw new EmulatorError(
    "UNKNOWN_REQUEST",
    ctx.requestIndex,
    `unrecognized (or not yet implemented) request kind: ${Object.keys(req).join(", ")}`,
  );
}

/** Resolves a request's target tab by `tabId`, defaulting to the only tab in a single-tab document. */
export function tabResolve(state: EmulatorState, tabId: string | undefined, requestIndex: number): TabState {
  if (tabId) {
    const tab = state.tabs.find((t) => t.tabId === tabId);
    if (!tab) throw new EmulatorError("UNKNOWN_REQUEST", requestIndex, `unknown tabId "${tabId}"`);
    return tab;
  }
  if (state.tabs.length === 1) return state.tabs[0];
  throw new EmulatorError("TAB_REQUIRED", requestIndex, "document has more than one tab and no tabId was given");
}

/** Resolves a `range: {startIndex, endIndex, tabId}` field. */
export function rangeResolve(
  state: EmulatorState,
  range: JsonObject | undefined,
  ctx: EmulateContext,
): { end: number; start: number; tab: TabState } {
  if (!range) throw new EmulatorError("UNKNOWN_REQUEST", ctx.requestIndex, "missing range");
  return {
    end: range.endIndex as number,
    start: range.startIndex as number,
    tab: tabResolve(state, range.tabId as string | undefined, ctx.requestIndex),
  };
}

// --- insertText ---

function insertTextRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const text = req.text;
  if (typeof text !== "string")
    throw new EmulatorError("UNKNOWN_REQUEST", ctx.requestIndex, "insertText.text must be a string");
  const location = req.location as JsonObject | undefined;
  const endOfSegmentLocation = req.endOfSegmentLocation as JsonObject | undefined;
  const tabId = (location?.tabId ?? endOfSegmentLocation?.tabId) as string | undefined;
  const tab = tabResolve(state, tabId, ctx.requestIndex);
  const idx = endOfSegmentLocation ? tab.tape.length - 1 : (location?.index as number);
  insertTextCore(tab, idx, text, ctx);
  return {};
}

/** Inserts `text` (UTF-16 units; embedded `\n` splits the paragraph per G3 F6) at tape position `idx`. */
function insertTextCore(tab: TabState, idx: number, text: string, ctx: EmulateContext): void {
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const originalKeepsLaterSide = idx === paragraphStartBefore(tab.tape, idx);
  let pos = idx;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === "\n") {
      paragraphSplitAt(tab, pos, style, ctx, originalKeepsLaterSide);
    } else {
      tab.tape.splice(pos, 0, { ch, style, t: "char" });
    }
    pos += 1;
  }
}

/** Finds the start of the paragraph containing tape position `pos`: the position right after the nearest preceding structural boundary (a newline, table/TOC/section marker, or the start of the tape). */
function paragraphStartBefore(tape: TapeCell[], pos: number): number {
  const boundaries: ReadonlySet<TapeCell["t"]> = new Set([
    "nl",
    "sectionBreak",
    "tableStart",
    "rowStart",
    "cellStart",
    "tableEnd",
    "tocStart",
    "tocEnd",
  ]);
  let i = pos;
  while (i > 0 && !boundaries.has(tape[i - 1].t)) i--;
  return i;
}

/**
 * Splits the paragraph containing tape position `pos` by inserting a fresh `nl` cell there, copying
 * the containing paragraph's style/bullet. Identity (headingId) is content-based, not
 * position-based (G3 F6, corrected): it stays with whichever side contains the first character of
 * the paragraph's *original* (pre-this-request) content.
 * - `originalKeepsLaterSide` true (nothing original precedes the whole insertion, i.e. it starts
 *   exactly at the paragraph's own original start — the "prepend" case, C03): the new `nl` at `pos`
 *   gets a freshly minted id; the original (later) `nl` cell is untouched, keeping its original id.
 * - `originalKeepsLaterSide` false (some original content precedes — covers both a genuine
 *   mid-paragraph split, C02, and an append at the paragraph's own end−1, C04): the new `nl` at
 *   `pos` instead gets the *original* identity (copied as-is); the original `nl` cell (now the
 *   later fragment's terminator) gets a freshly minted id instead.
 * Reused by insertPageBreak/insertSectionBreak/insertTable, which all split a paragraph before
 * inserting; C18/C19/C23/C24 (G3 M5) still need to confirm they follow the same rule.
 */
export function paragraphSplitAt(
  tab: TabState,
  pos: number,
  style: JsonObject,
  ctx: EmulateContext,
  originalKeepsLaterSide: boolean,
): void {
  let j = pos;
  while (tab.tape[j]?.t !== "nl") j++;
  const originalNl = tab.tape[j] as Extract<TapeCell, { t: "nl" }>;
  if (originalKeepsLaterSide) {
    const newPara: NlPara = structuredClone(originalNl.para);
    if (newPara.headingId) newPara.headingId = mintHeadingId(ctx);
    tab.tape.splice(pos, 0, { para: newPara, style, t: "nl" });
  } else {
    const earlierPara: NlPara = structuredClone(originalNl.para);
    tab.tape.splice(pos, 0, { para: earlierPara, style, t: "nl" });
    if (originalNl.para.headingId) originalNl.para = { ...originalNl.para, headingId: mintHeadingId(ctx) };
  }
}

/** Validates that `idx` names a position inside a paragraph (F5): not past the segment end, and not on a structural marker or atom continuation. */
export function insertPositionValidate(tab: TabState, idx: number, ctx: EmulateContext): void {
  if (idx === tab.tape.length) {
    throw new EmulatorError("RANGE_AT_SEGMENT_END", ctx.requestIndex, "cannot insert past the segment's final newline");
  }
  if (idx < 0 || idx > tab.tape.length) {
    throw new EmulatorError("UNKNOWN_REQUEST", ctx.requestIndex, `insert index ${idx} is out of bounds`);
  }
  const cell = tab.tape[idx];
  if (cell.t !== "char" && cell.t !== "atom" && cell.t !== "nl") {
    throw new EmulatorError(
      "INSERT_OUTSIDE_PARAGRAPH",
      ctx.requestIndex,
      `insert index ${idx} is not inside a paragraph`,
    );
  }
}

/** Style for newly inserted characters: the previous character in the same paragraph, else the next one, else the newline (G3 F6). */
export function styleForInsertAt(tape: TapeCell[], idx: number): JsonObject {
  const prev = idx > 0 ? tape[idx - 1] : undefined;
  if (prev?.t === "char") return prev.style;
  if (prev?.t === "atom") return prev.style ?? {};
  if (prev?.t === "atomCont") {
    let j = idx - 1;
    while (tape[j]?.t === "atomCont") j--;
    const atomCell = tape[j];
    if (atomCell?.t === "atom") return atomCell.style ?? {};
  }
  const next = tape[idx];
  if (next?.t === "char") return next.style;
  if (next?.t === "atom") return next.style ?? {};
  if (next?.t === "nl") return next.style;
  return {};
}

// --- deleteContentRange ---

function deleteContentRangeRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  deleteRangeValidate(tab, start, end, ctx);
  tab.tape.splice(start, end - start);
  return {};
}

/** Validates F7/F8: no last-newline delete, no partial atom/table/TOC delete, no orphaned newline-before-structure delete, no surrogate-pair split. */
function deleteRangeValidate(tab: TabState, start: number, end: number, ctx: EmulateContext): void {
  if (typeof start !== "number" || typeof end !== "number" || end <= start) {
    throw new EmulatorError("UNKNOWN_REQUEST", ctx.requestIndex, "range must have endIndex > startIndex");
  }
  if (end > tab.tape.length) {
    throw new EmulatorError("RANGE_AT_SEGMENT_END", ctx.requestIndex, "range extends past the end of the segment");
  }
  if (end === tab.tape.length) {
    throw new EmulatorError("DELETE_LAST_NEWLINE", ctx.requestIndex, "cannot delete the final newline of the segment");
  }
  const spans = structuralSpans(tab.tape);
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t === "atom" || cell.t === "atomCont") {
      let atomStart = i;
      while (tab.tape[atomStart]?.t === "atomCont") atomStart--;
      const atomCell = tab.tape[atomStart] as Extract<TapeCell, { t: "atom" }>;
      const atomEnd = atomStart + atomCell.span;
      if (start > atomStart || end < atomEnd) {
        throw new EmulatorError(
          "DELETE_PARTIAL_STRUCTURE",
          ctx.requestIndex,
          "range partially overlaps an atomic (unsplittable) element",
        );
      }
    }
    if (
      cell.t === "tableStart" ||
      cell.t === "tocStart" ||
      cell.t === "tableEnd" ||
      cell.t === "tocEnd" ||
      cell.t === "rowStart" ||
      cell.t === "cellStart"
    ) {
      const span = spans.find((s) => i >= s.start && i < s.end);
      if (span && (start > span.start || end < span.end)) {
        throw new EmulatorError(
          "DELETE_PARTIAL_STRUCTURE",
          ctx.requestIndex,
          "range partially overlaps a table or table of contents",
        );
      }
    }
    if (cell.t === "nl" && i === end - 1) {
      const next = tab.tape[i + 1];
      if (next && (next.t === "tableStart" || next.t === "tocStart" || next.t === "sectionBreak")) {
        throw new EmulatorError(
          "DELETE_NEWLINE_BEFORE_STRUCTURE",
          ctx.requestIndex,
          "cannot delete the newline immediately before a table, TOC, or section break without also deleting it",
        );
      }
    }
  }
  const startCell = tab.tape[start];
  if (startCell?.t === "char" && isLowSurrogate(startCell.ch) && start > 0) {
    const before = tab.tape[start - 1];
    if (before?.t === "char" && isHighSurrogate(before.ch)) {
      throw new EmulatorError("SURROGATE_SPLIT", ctx.requestIndex, "range starts inside a surrogate pair");
    }
  }
  const lastIncluded = tab.tape[end - 1];
  if (lastIncluded?.t === "char" && isHighSurrogate(lastIncluded.ch)) {
    const after = tab.tape[end];
    if (after?.t === "char" && isLowSurrogate(after.ch)) {
      throw new EmulatorError("SURROGATE_SPLIT", ctx.requestIndex, "range ends inside a surrogate pair");
    }
  }
}

/** Finds every table/TOC's `[start, end)` span (matching `*Start`/`*End` markers; tables and TOCs never nest). */
export function structuralSpans(tape: TapeCell[]): Array<{ end: number; start: number }> {
  const spans: Array<{ end: number; start: number }> = [];
  const stack: number[] = [];
  tape.forEach((cell, i) => {
    if (cell.t === "tableStart" || cell.t === "tocStart") stack.push(i);
    else if (cell.t === "tableEnd" || cell.t === "tocEnd") {
      const openIndex = stack.pop();
      if (openIndex !== undefined) spans.push({ end: i + 1, start: openIndex });
    }
  });
  return spans;
}

function isHighSurrogate(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}

// --- updateTextStyle / updateParagraphStyle ---

function updateTextStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  const fields = parseFields(req.fields);
  const patch = (req.textStyle as JsonObject) ?? {};
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t === "atomCont") continue;
    const styleRef = styleRefFor(cell);
    if (!styleRef)
      throw new EmulatorError(
        "INSERT_OUTSIDE_PARAGRAPH",
        ctx.requestIndex,
        `text style range at index ${i} covers a non-text element`,
      );
    applyStyleFields(styleRef, patch, fields);
  }
  return {};
}

/** Returns the mutable style object a text-style update should write into, allocating one for an atom that had none yet. */
function styleRefFor(cell: TapeCell): JsonObject | undefined {
  if (cell.t === "char" || cell.t === "nl") return cell.style;
  if (cell.t === "atom") {
    if (!cell.style) cell.style = {};
    return cell.style;
  }
  return undefined;
}

function updateParagraphStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  const fields = parseFields(req.fields);
  const patch = (req.paragraphStyle as JsonObject) ?? {};
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t !== "nl") continue;
    applyStyleFields(cell.para.style, patch, fields);
    if (fields.includes("namedStyleType")) {
      const newType = patch.namedStyleType as string | undefined;
      const wasHeading = Boolean(cell.para.headingId);
      const becomesHeading = typeof newType === "string" && newType !== "NORMAL_TEXT";
      if (!wasHeading && becomesHeading) cell.para.headingId = mintHeadingId(ctx);
      else if (wasHeading && !becomesHeading) cell.para.headingId = undefined;
    }
  }
  return {};
}

// --- createParagraphBullets / deleteParagraphBullets ---

function createParagraphBulletsRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  createParagraphBulletsApply(tab, start, end, req.bulletPreset as BulletPreset, ctx);
  return {};
}

/** Removes and counts leading tab characters (nesting), then joins or mints a list per paragraph in `[start, end)` (G3 M3). */
function createParagraphBulletsApply(
  tab: TabState,
  start: number,
  end: number,
  bulletPreset: BulletPreset,
  ctx: EmulateContext,
): void {
  let pos = start;
  let boundEnd = end;
  while (pos < boundEnd) {
    const pStart = pos;
    let tabCount = 0;
    while (tab.tape[pos]?.t === "char" && (tab.tape[pos] as Extract<TapeCell, { t: "char" }>).ch === "\t") {
      tabCount++;
      pos++;
    }
    if (tabCount > 0) {
      tab.tape.splice(pStart, tabCount);
      pos -= tabCount;
      boundEnd -= tabCount;
    }
    let nlIndex = pos;
    while (tab.tape[nlIndex]?.t !== "nl") nlIndex++;
    const nlCell = tab.tape[nlIndex] as Extract<TapeCell, { t: "nl" }>;
    const nesting = Math.min(tabCount, 8);
    nlCell.para.bullet = { listId: listIdForJoin(tab, pStart, bulletPreset, ctx), nestingLevel: nesting } as JsonObject;
    pos = nlIndex + 1;
  }
}

/** Joins the list of the paragraph immediately before `pStart` when its inferred preset matches; otherwise mints a new list from the preset table. */
function listIdForJoin(tab: TabState, pStart: number, bulletPreset: BulletPreset, ctx: EmulateContext): string {
  if (pStart > 0) {
    const prev = tab.tape[pStart - 1];
    if (prev?.t === "nl" && prev.para.bullet) {
      const prevListId = (prev.para.bullet as JsonObject).listId as string | undefined;
      const listDef = prevListId ? (tab.lists[prevListId] as JsonObject | undefined) : undefined;
      const nestingLevels = (listDef?.listProperties as JsonObject | undefined)?.nestingLevels as
        | JsonObject[]
        | undefined;
      if (prevListId && nestingLevels && listPresetInfer(nestingLevels, listPresetTable()) === bulletPreset)
        return prevListId;
    }
  }
  const listId = mintListId(ctx);
  const presetLevels = listPresetTable()[bulletPreset];
  tab.lists[listId] = { listProperties: { nestingLevels: presetLevels ?? Array.from({ length: 9 }, () => ({})) } };
  return listId;
}

function deleteParagraphBulletsRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  deleteParagraphBulletsApply(tab, start, end);
  return {};
}

/**
 * Removes bullet membership: `indentFirstLine` is dropped entirely (reverts to inherited) and
 * `indentStart` is set to an explicit empty dimension (`{unit: "PT"}`, no magnitude — an explicit
 * reset to 0, not "unset"). Confirmed live (G3 M5) at nesting level 0 and level 3: the reset is
 * flat and does not depend on the paragraph's prior nesting level.
 */
function deleteParagraphBulletsApply(tab: TabState, start: number, end: number): void {
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t !== "nl" || !cell.para.bullet) continue;
    cell.para.bullet = undefined;
    const style: JsonObject = { ...cell.para.style, indentStart: { unit: "PT" } };
    delete style.indentFirstLine;
    cell.para.style = style;
  }
}

export function mintHeadingId(ctx: EmulateContext): string {
  ctx.idCounters.heading += 1;
  return `emu.h.${ctx.idCounters.heading}`;
}

export function mintListId(ctx: EmulateContext): string {
  ctx.idCounters.list += 1;
  return `emu.list.${ctx.idCounters.list}`;
}

function mintInlineObjectId(ctx: EmulateContext): string {
  ctx.idCounters.image += 1;
  return `emu.io.${ctx.idCounters.image}`;
}

function mintTabId(ctx: EmulateContext): string {
  ctx.idCounters.tab += 1;
  return `emu.t.${ctx.idCounters.tab}`;
}

// --- insertPageBreak / insertSectionBreak / updateSectionStyle ---

/** Inserts a page break: an atom followed by a fresh newline that splits the paragraph (2 indices total, G3 F14). */
function insertPageBreakRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const originalKeepsLaterSide = idx === paragraphStartBefore(tab.tape, idx);
  tab.tape.splice(idx, 0, { raw: { pageBreak: {} }, span: 1, style, t: "atom" });
  paragraphSplitAt(tab, idx + 1, style, ctx, originalKeepsLaterSide);
  return {};
}

/** Inserts a section break: a fresh newline that splits the paragraph, then the break marker itself (2 indices total, G3 F15). */
function insertSectionBreakRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const originalKeepsLaterSide = idx === paragraphStartBefore(tab.tape, idx);
  paragraphSplitAt(tab, idx, style, ctx, originalKeepsLaterSide);
  const sectionType = (req.sectionType as string | undefined) ?? "CONTINUOUS";
  tab.tape.splice(idx + 1, 0, { raw: { sectionStyle: { sectionType } }, t: "sectionBreak" });
  return {};
}

/** Applies a field-masked style patch to every section break (and the tab's leading section) whose index falls in `range`. */
function updateSectionStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  const fields = parseFields(req.fields);
  const patch = (req.sectionStyle as JsonObject) ?? {};
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t !== "sectionBreak") continue;
    const sectionStyle = { ...((cell.raw.sectionStyle as JsonObject | undefined) ?? {}) };
    applyStyleFields(sectionStyle, patch, fields);
    cell.raw.sectionStyle = sectionStyle;
  }
  return {};
}

// --- insertPerson / insertDate / insertRichLink / insertInlineImage ---

/** Inserts a single-index chip atom (person, date, or rich link) at `location`. */
function insertAtomRequestApply(
  state: EmulatorState,
  req: JsonObject,
  ctx: EmulateContext,
  type: "date" | "person" | "richLink",
  propertiesField: string,
): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  tab.tape.splice(idx, 0, { raw: { [type]: { [propertiesField]: req[propertiesField] } }, span: 1, style, t: "atom" });
  return {};
}

/** Inserts an inline image: mints a new `inlineObjects` entry with the given `sourceUri`, then a single-index atom referencing it. */
function insertInlineImageRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const objectId = mintInlineObjectId(ctx);
  tab.inlineObjects[objectId] = {
    inlineObjectProperties: { embeddedObject: { imageProperties: { sourceUri: req.uri } } },
  };
  tab.tape.splice(idx, 0, { raw: { inlineObjectElement: { inlineObjectId: objectId } }, span: 1, style, t: "atom" });
  return {};
}

// --- table structural requests ---

function insertTableRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const originalKeepsLaterSide = idx === paragraphStartBefore(tab.tape, idx);
  insertTable(tab, idx, req.rows as number, req.columns as number, style, (pos) =>
    paragraphSplitAt(tab, pos, style, ctx, originalKeepsLaterSide),
  );
  return {};
}

/** Reads `{ tableStartLocation: { index, tabId }, rowIndex?, columnIndex? }` common to every table structural request. */
function tableCellLocationResolve(
  state: EmulatorState,
  req: JsonObject,
  ctx: EmulateContext,
): { columnIndex: number; rowIndex: number; tab: TabState; tableStart: number } {
  const cellLocation = req.tableCellLocation as JsonObject;
  const tableStartLocation = cellLocation.tableStartLocation as JsonObject;
  const tab = tabResolve(state, tableStartLocation.tabId as string | undefined, ctx.requestIndex);
  return {
    columnIndex: (cellLocation.columnIndex as number | undefined) ?? 0,
    rowIndex: (cellLocation.rowIndex as number | undefined) ?? 0,
    tab,
    tableStart: tableStartLocation.index as number,
  };
}

function insertTableRowRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { columnIndex: _columnIndex, rowIndex, tab, tableStart } = tableCellLocationResolve(state, req, ctx);
  insertTableRow(tab, tableStart, rowIndex, Boolean(req.insertBelow));
  return {};
}

function insertTableColumnRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { columnIndex, tab, tableStart } = tableCellLocationResolve(state, req, ctx);
  insertTableColumn(tab, tableStart, columnIndex, Boolean(req.insertRight));
  return {};
}

function deleteTableRowRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { rowIndex, tab, tableStart } = tableCellLocationResolve(state, req, ctx);
  deleteTableRow(tab, tableStart, rowIndex);
  return {};
}

function deleteTableColumnRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { columnIndex, tab, tableStart } = tableCellLocationResolve(state, req, ctx);
  deleteTableColumn(tab, tableStart, columnIndex);
  return {};
}

function mergeTableCellsRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const range = req.tableRange as JsonObject;
  const { columnIndex, rowIndex, tab, tableStart } = tableCellLocationResolve(
    state,
    { tableCellLocation: range.tableCellLocation },
    ctx,
  );
  mergeTableCells(tab, tableStart, rowIndex, columnIndex, range.rowSpan as number, range.columnSpan as number);
  return {};
}

function unmergeTableCellsRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const range = req.tableRange as JsonObject;
  const { columnIndex, rowIndex, tab, tableStart } = tableCellLocationResolve(
    state,
    { tableCellLocation: range.tableCellLocation },
    ctx,
  );
  unmergeTableCells(tab, tableStart, rowIndex, columnIndex);
  return {};
}

function updateTableCellStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const fields = parseFields(req.fields);
  const patch = (req.tableCellStyle as JsonObject) ?? {};
  if (req.tableRange) {
    const range = req.tableRange as JsonObject;
    const { columnIndex, rowIndex, tab, tableStart } = tableCellLocationResolve(
      state,
      { tableCellLocation: range.tableCellLocation },
      ctx,
    );
    updateTableCellStyle(
      tab,
      tableStart,
      rowIndex,
      columnIndex,
      range.rowSpan as number | undefined,
      range.columnSpan as number | undefined,
      patch,
      fields,
    );
  } else {
    const startLocation = req.tableStartLocation as JsonObject;
    const tab = tabResolve(state, startLocation.tabId as string | undefined, ctx.requestIndex);
    updateTableCellStyle(tab, startLocation.index as number, undefined, undefined, undefined, undefined, patch, fields);
  }
  return {};
}

function updateTableColumnPropertiesRequestApply(
  state: EmulatorState,
  req: JsonObject,
  ctx: EmulateContext,
): JsonObject {
  const startLocation = req.tableStartLocation as JsonObject;
  const tab = tabResolve(state, startLocation.tabId as string | undefined, ctx.requestIndex);
  updateTableColumnProperties(
    tab,
    startLocation.index as number,
    req.columnIndices as number[],
    (req.tableColumnProperties as JsonObject) ?? {},
    parseFields(req.fields),
  );
  return {};
}

function updateTableRowStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const startLocation = req.tableStartLocation as JsonObject;
  const tab = tabResolve(state, startLocation.tabId as string | undefined, ctx.requestIndex);
  updateTableRowStyle(
    tab,
    startLocation.index as number,
    req.rowIndices as number[],
    (req.tableRowStyle as JsonObject) ?? {},
    parseFields(req.fields),
  );
  return {};
}

function pinTableHeaderRowsRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const startLocation = req.tableStartLocation as JsonObject;
  const tab = tabResolve(state, startLocation.tabId as string | undefined, ctx.requestIndex);
  pinTableHeaderRows(tab, startLocation.index as number, req.pinnedHeaderRowsCount as number);
  return {};
}

// --- tab / document-style requests ---

/** Creates a brand-new tab with a blank template body (leading section break + one empty paragraph). */
function addDocumentTabRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const tabId = mintTabId(ctx);
  const tabProperties = (req.tabProperties as JsonObject) ?? {};
  const title = (tabProperties.title as string | undefined) ?? "";
  const parentTabId = tabProperties.parentTabId as string | undefined;
  const index = tabProperties.index as number | undefined;
  const tab: TabState = {
    documentStyle: {},
    footers: {},
    footnotes: {},
    headers: {},
    inlineObjects: {},
    lists: {},
    namedRanges: {},
    namedStyles: { styles: [] },
    parentTabId,
    positionedObjects: {},
    tabId,
    tape: [
      { raw: { sectionStyle: {} }, t: "sectionBreak" },
      { para: { style: {} }, style: {}, t: "nl" },
    ],
    title,
  };
  if (typeof index === "number") state.tabs.splice(index, 0, tab);
  else state.tabs.push(tab);
  return { tabProperties: { index, parentTabId, tabId, title } };
}

/** Deletes a tab and every descendant tab (matched by `parentTabId`, transitively). */
function deleteTabRequestApply(state: EmulatorState, req: JsonObject): JsonObject {
  const tabId = req.tabId as string;
  const toRemove = new Set<string>([tabId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tab of state.tabs) {
      if (tab.parentTabId && toRemove.has(tab.parentTabId) && !toRemove.has(tab.tabId)) {
        toRemove.add(tab.tabId);
        changed = true;
      }
    }
  }
  state.tabs = state.tabs.filter((t) => !toRemove.has(t.tabId));
  return {};
}

/** Applies a field-masked patch to a tab's `title` and/or `index` (a move). */
function updateDocumentTabPropertiesRequestApply(
  state: EmulatorState,
  req: JsonObject,
  ctx: EmulateContext,
): JsonObject {
  const tab = tabResolve(state, req.tabId as string, ctx.requestIndex);
  const fields = parseFields(req.fields);
  const patch = (req.tabProperties as JsonObject) ?? {};
  if (fields.includes("title") && typeof patch.title === "string") tab.title = patch.title;
  if (fields.includes("index") && typeof patch.index === "number") {
    const from = state.tabs.indexOf(tab);
    state.tabs.splice(from, 1);
    state.tabs.splice(patch.index, 0, tab);
  }
  return {};
}

/** Applies a field-masked patch (dotted paths allowed, e.g. `pageSize.width`) to a tab's document style. */
function updateDocumentStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const tab = tabResolve(state, req.tabId as string | undefined, ctx.requestIndex);
  const fields = parseFields(req.fields);
  const patch = (req.documentStyle as JsonObject) ?? {};
  const target = { ...tab.documentStyle };
  for (const field of fields) {
    const parts = field.split(".");
    dottedFieldSet(target, parts, dottedFieldGet(patch, parts));
  }
  tab.documentStyle = target;
  return {};
}

/** Reads a (possibly nested) dotted field path out of a JSON object. */
function dottedFieldGet(obj: JsonObject, parts: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === undefined || cur === null || typeof cur !== "object") return undefined;
    cur = (cur as JsonObject)[part];
  }
  return cur;
}

/** Sets (or, if `value` is nullish, deletes) a dotted field path on a JSON object, per F10's mask semantics. */
function dottedFieldSet(target: JsonObject, parts: readonly string[], value: unknown): void {
  if (parts.length === 1) {
    if (value === undefined || value === null) delete target[parts[0]];
    else target[parts[0]] = value;
    return;
  }
  const [head, ...rest] = parts;
  const next = { ...((target[head] as JsonObject | undefined) ?? {}) };
  dottedFieldSet(next, rest, value);
  target[head] = next;
}
