/* Applies Docs API batchUpdate requests to an EmulatorState tape (see G3 M3). */

import type { GoogleDoc } from "~/core/types.ts";
import { listLevelIndent, listPresetInfer, listPresetTable } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { styleCanonical } from "../model/styleValues.ts";
import type { BulletPreset } from "../model/types.ts";
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

/** Per-batch mutable context: which request is running, and counters for minting new heading/list ids. */
interface EmulateContext {
  idCounters: { heading: number; list: number };
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
  const ctx: EmulateContext = { idCounters: { heading: 0, list: 0 }, requestIndex: 0 };
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
  throw new EmulatorError(
    "UNKNOWN_REQUEST",
    ctx.requestIndex,
    `unrecognized (or not yet implemented) request kind: ${Object.keys(req).join(", ")}`,
  );
}

/** Resolves a request's target tab by `tabId`, defaulting to the only tab in a single-tab document. */
function tabResolve(state: EmulatorState, tabId: string | undefined, requestIndex: number): TabState {
  if (tabId) {
    const tab = state.tabs.find((t) => t.tabId === tabId);
    if (!tab) throw new EmulatorError("UNKNOWN_REQUEST", requestIndex, `unknown tabId "${tabId}"`);
    return tab;
  }
  if (state.tabs.length === 1) return state.tabs[0];
  throw new EmulatorError("TAB_REQUIRED", requestIndex, "document has more than one tab and no tabId was given");
}

/** Resolves a `range: {startIndex, endIndex, tabId}` field. */
function rangeResolve(
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

/** Throws `RANGE_AT_SEGMENT_END` when a style/bullet range's `end` reaches the segment's final newline (see G3 F9). */
function segmentEndValidate(tab: TabState, end: number, ctx: EmulateContext): void {
  if (end === tab.tape.length) {
    throw new EmulatorError(
      "RANGE_AT_SEGMENT_END",
      ctx.requestIndex,
      "range must end before the segment's final newline",
    );
  }
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
  let pos = idx;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === "\n") {
      let j = pos;
      while (tab.tape[j]?.t !== "nl") j++;
      const originalNl = tab.tape[j] as Extract<TapeCell, { t: "nl" }>;
      const newPara: NlPara = structuredClone(originalNl.para);
      if (newPara.headingId) newPara.headingId = mintHeadingId(ctx);
      tab.tape.splice(pos, 0, { para: newPara, style, t: "nl" });
    } else {
      tab.tape.splice(pos, 0, { ch, style, t: "char" });
    }
    pos += 1;
  }
}

/** Validates that `idx` names a position inside a paragraph (F5): not past the segment end, and not on a structural marker or atom continuation. */
function insertPositionValidate(tab: TabState, idx: number, ctx: EmulateContext): void {
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
function styleForInsertAt(tape: TapeCell[], idx: number): JsonObject {
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
function structuralSpans(tape: TapeCell[]): Array<{ end: number; start: number }> {
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
  segmentEndValidate(tab, end, ctx);
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
  segmentEndValidate(tab, end, ctx);
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

/** Applies a field-masked style patch (F10): a listed field absent (or `null`) in `patch` resets to inherited; otherwise it's set (canonicalized). */
function applyStyleFields(target: JsonObject, patch: JsonObject, fields: readonly string[]): void {
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined || value === null) delete target[field];
    else target[field] = styleCanonical(value);
  }
}

function parseFields(fields: unknown): string[] {
  return typeof fields === "string"
    ? fields
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
}

// --- createParagraphBullets / deleteParagraphBullets ---

function createParagraphBulletsRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  segmentEndValidate(tab, end, ctx);
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
  segmentEndValidate(tab, end, ctx);
  deleteParagraphBulletsApply(tab, start, end);
  return {};
}

/** Removes bullet membership and sets `indentStart`/`indentFirstLine` from the level's default indent (G3 apiFacts `BULLETS_DELETE_INDENT`, confirmed by G3 M5). */
function deleteParagraphBulletsApply(tab: TabState, start: number, end: number): void {
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t !== "nl" || !cell.para.bullet) continue;
    const level = ((cell.para.bullet as JsonObject).nestingLevel as number | undefined) ?? 0;
    const indent = listLevelIndent({ isNew: false, nestingLevels: [] }, level);
    cell.para.bullet = undefined;
    cell.para.style = {
      ...cell.para.style,
      indentFirstLine: { magnitude: indent.indentFirstLine, unit: "PT" },
      indentStart: { magnitude: indent.indentStart, unit: "PT" },
    };
  }
}

function mintHeadingId(ctx: EmulateContext): string {
  ctx.idCounters.heading += 1;
  return `emu.h.${ctx.idCounters.heading}`;
}

function mintListId(ctx: EmulateContext): string {
  ctx.idCounters.list += 1;
  return `emu.list.${ctx.idCounters.list}`;
}
