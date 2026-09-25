/* Applies Docs API batchUpdate requests to an EmulatorState tape (see G3 M3). */

import type { GoogleDoc } from "~/core/types.ts";
import {
  DATE_ELEMENT_DEFAULTS,
  LINK_CHROME_COLOR,
  SECTION_STYLE_DEFAULT,
  TEXT_STYLE_INHERIT_DROP_FIELDS,
} from "../model/apiFacts.ts";
import blankTab from "../model/blankTab.json";
import { listPresetInfer, listPresetTable } from "../model/lists.ts";
import type { JsonObject, RawDocumentTab } from "../model/rawJson.ts";
import { styleCanonical, styleEqual } from "../model/styleValues.ts";
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
import {
  docStateBuild,
  docStateJson,
  type EmulatorState,
  type NlPara,
  type TabState,
  type TapeCell,
  tabStateBuild,
} from "./tape.ts";

/** Reason an emulated request was rejected. */
export type EmulatorErrorCode =
  | "DELETE_LAST_NEWLINE"
  | "DELETE_NEWLINE_BEFORE_STRUCTURE"
  | "DELETE_PARTIAL_STRUCTURE"
  | "INSERT_OUTSIDE_PARAGRAPH"
  | "INVALID_FIELD"
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
  idCounters: { chip: number; heading: number; image: number; list: number; tab: number };
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
  const ctx: EmulateContext = { idCounters: idCountersSeed(json), requestIndex: 0 };
  const replies = requests.map((req, i) => {
    ctx.requestIndex = i;
    return requestApply(state, req, ctx);
  });
  return { json: docStateJson(state), replies };
}

/** Minted-id prefixes, by counter. */
const MINT_PREFIXES = {
  chip: "emu.chip.",
  heading: "emu.h.",
  image: "emu.io.",
  list: "emu.list.",
  tab: "emu.t.",
} as const;

/** Starts each id counter past the highest id an earlier batch already minted into `json`, so ids stay unique across batches. */
function idCountersSeed(json: GoogleDoc): EmulateContext["idCounters"] {
  const text = JSON.stringify(json);
  const counters = { chip: 0, heading: 0, image: 0, list: 0, tab: 0 };
  for (const [counter, prefix] of Object.entries(MINT_PREFIXES) as Array<[keyof typeof counters, string]>) {
    for (const match of text.matchAll(new RegExp(`${prefix.replace(/\./g, "\\.")}(\\d+)`, "g"))) {
      counters[counter] = Math.max(counters[counter], Number(match[1]));
    }
  }
  return counters;
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
  if (req.insertDate)
    return insertAtomRequestApply(state, req.insertDate as JsonObject, ctx, "dateElement", "dateElementProperties");
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

/** Tape indices of the newline of every paragraph that overlaps `[start, end)` (paragraph requests apply to each such paragraph). */
function paragraphNewlinesOverlapping(tape: TapeCell[], start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i < Math.max(end, start + 1) && i < tape.length; i++) {
    let nl = i;
    while (nl < tape.length && tape[nl].t !== "nl") {
      if (tape[nl].t !== "char" && tape[nl].t !== "atom" && tape[nl].t !== "atomCont") break;
      nl++;
    }
    if (tape[nl]?.t === "nl") {
      out.push(nl);
      i = nl;
    }
  }
  return out;
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
  // Merge identity (F7): a delete starting strictly inside paragraph A that consumes A's newline leaves
  // one paragraph carrying A's whole state; one starting at a paragraph's start removes it cleanly.
  let aNl = start;
  while (aNl < end && tab.tape[aNl].t !== "nl") aNl++;
  const aPara =
    aNl < end && start > paragraphStartBefore(tab.tape, start) ? (tab.tape[aNl] as { para: NlPara }).para : undefined;
  tab.tape.splice(start, end - start);
  if (aPara) {
    let survivor = start;
    while (tab.tape[survivor] && tab.tape[survivor].t !== "nl") survivor++;
    const nl = tab.tape[survivor];
    if (nl?.t === "nl") nl.para = aPara;
  }
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
  const patch = linkNormalize((req.textStyle as JsonObject) ?? {}, tab.tabId);
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t === "atomCont") continue;
    if (cell.t !== "char" && cell.t !== "nl" && cell.t !== "atom")
      throw new EmulatorError(
        "INSERT_OUTSIDE_PARAGRAPH",
        ctx.requestIndex,
        `text style range at index ${i} covers a non-text element`,
      );
    cell.style = textStyleApply(tab, i, cell.style ?? {}, patch, fields);
  }
  // Whole-paragraph rule (F10): a range covering all of a paragraph's text also restyles its newline (never its link).
  const nl = tab.tape[end];
  const nlFields = fields.filter((f) => f !== "link");
  const coversText = end > start && tab.tape[end - 1].t !== "nl" && paragraphStartBefore(tab.tape, end - 1) >= start;
  if (nl?.t === "nl" && coversText && nlFields.length) nl.style = textStyleApply(tab, end, nl.style, patch, nlFields);
  return {};
}

/** Normalizes a `{headingId}` link to the `{heading: {id, tabId}}` form the API reads back (F17). */
function linkNormalize(patch: JsonObject, tabId: string): JsonObject {
  const link = patch.link as JsonObject | undefined;
  if (!link || typeof link.headingId !== "string") return patch;
  return { ...patch, link: { heading: { id: link.headingId, tabId: (link.tabId as string | undefined) ?? tabId } } };
}

/** Applies a text-style patch to one cell's style, mirroring the API's link chrome and its dropping of values equal to the inherited ones (F17). */
function textStyleApply(
  tab: TabState,
  index: number,
  style: JsonObject,
  patch: JsonObject,
  fields: string[],
): JsonObject {
  const next = applyStyleFields(style, patch, fields);
  if (fields.includes("link")) {
    if (patch.link) {
      if (!fields.includes("underline")) next.underline = true;
      if (!fields.includes("foregroundColor")) next.foregroundColor = styleCanonical(LINK_CHROME_COLOR);
    } else {
      if (!fields.includes("underline") && next.underline === true) delete next.underline;
      if (!fields.includes("foregroundColor") && styleEqual(next.foregroundColor, styleCanonical(LINK_CHROME_COLOR)))
        delete next.foregroundColor;
    }
  }
  for (const field of TEXT_STYLE_INHERIT_DROP_FIELDS) {
    if (!fields.includes(field) || next[field] === undefined) continue;
    if (styleEqual(next[field], inheritedTextStyleValue(tab, index, field))) delete next[field];
  }
  return next;
}

/** The value a text-style field inherits at tape `index`: the paragraph's named style, else NORMAL_TEXT. */
function inheritedTextStyleValue(tab: TabState, index: number, field: string): unknown {
  let nlIndex = index;
  while (tab.tape[nlIndex] && tab.tape[nlIndex].t !== "nl") nlIndex++;
  const nl = tab.tape[nlIndex];
  const type = (nl?.t === "nl" ? (nl.para.style.namedStyleType as string | undefined) : undefined) ?? "NORMAL_TEXT";
  const styles = ((tab.namedStyles.styles as JsonObject[] | undefined) ?? []).filter(
    (st) => st.namedStyleType === type || st.namedStyleType === "NORMAL_TEXT",
  );
  const own = styles.find((st) => st.namedStyleType === type)?.textStyle as JsonObject | undefined;
  const normal = styles.find((st) => st.namedStyleType === "NORMAL_TEXT")?.textStyle as JsonObject | undefined;
  return own?.[field] ?? normal?.[field];
}

function updateParagraphStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  const fields = parseFields(req.fields);
  const patch = (req.paragraphStyle as JsonObject) ?? {};
  if (fields.includes("namedStyleType") && typeof patch.namedStyleType !== "string") {
    throw new EmulatorError(
      "INVALID_FIELD",
      ctx.requestIndex,
      "Named style property is not inherited and cannot be cleared.",
    );
  }
  for (const i of paragraphNewlinesOverlapping(tab.tape, start, end)) {
    const cell = tab.tape[i] as Extract<TapeCell, { t: "nl" }>;
    const style = applyStyleFields(cell.para.style, patch, fields);
    // `direction` reads back explicitly even after a reset (F10).
    if (style.direction === undefined) style.direction = "LEFT_TO_RIGHT";
    cell.para = { ...cell.para, style };
    if (fields.includes("namedStyleType")) {
      const newType = patch.namedStyleType as string;
      const wasHeading = Boolean(cell.para.headingId);
      const becomesHeading = newType !== "NORMAL_TEXT";
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

/**
 * Bullets every unbulleted paragraph in `[start, end)` (F11). Already-bulleted paragraphs are left
 * untouched, leading tabs included. An unbulleted paragraph right after a same-preset list item joins
 * that list at nesting 0 (its leading tabs are consumed and ignored); otherwise the run becomes one
 * new list whose leading tabs set nesting. It never joins the following list. Each bulleted paragraph
 * takes its level's indents, and its bullet takes the level's text style.
 */
function createParagraphBulletsApply(
  tab: TabState,
  start: number,
  end: number,
  bulletPreset: BulletPreset,
  ctx: EmulateContext,
): void {
  let pos = start;
  let boundEnd = end;
  let newListId: string | undefined;
  let prevMintedHere = false;
  while (pos < boundEnd) {
    const pStart = paragraphStartBefore(tab.tape, pos);
    let nlIndex = pos;
    while (tab.tape[nlIndex]?.t !== "nl") nlIndex++;
    const nlCell = tab.tape[nlIndex] as Extract<TapeCell, { t: "nl" }>;
    if (nlCell.para.bullet) {
      prevMintedHere = false;
      pos = nlIndex + 1;
      continue;
    }
    let tabCount = 0;
    while (tab.tape[pStart + tabCount]?.t === "char" && (tab.tape[pStart + tabCount] as { ch: string }).ch === "\t")
      tabCount++;
    if (tabCount > 0) {
      tab.tape.splice(pStart, tabCount);
      nlIndex -= tabCount;
      boundEnd -= tabCount;
    }
    let listId: string;
    let nesting: number;
    const joinId = prevMintedHere ? undefined : sameListBefore(tab, pStart, bulletPreset);
    if (joinId) {
      listId = joinId;
      nesting = 0;
    } else {
      newListId ??= listMint(tab, bulletPreset, ctx);
      listId = newListId;
      nesting = Math.min(tabCount, 8);
    }
    prevMintedHere = listId === newListId;
    const level =
      (
        ((tab.lists[listId] as JsonObject | undefined)?.listProperties as JsonObject | undefined)?.nestingLevels as
          | JsonObject[]
          | undefined
      )?.[nesting] ?? {};
    const style: JsonObject = { ...nlCell.para.style };
    for (const field of ["indentFirstLine", "indentStart"]) {
      if (level[field] !== undefined) style[field] = styleCanonical(level[field]);
      else delete style[field];
    }
    const bullet: JsonObject = { listId, nestingLevel: nesting };
    if (level.textStyle) bullet.textStyle = level.textStyle;
    nlCell.para = { ...nlCell.para, bullet, style };
    pos = nlIndex + 1;
  }
}

/** The list id of the paragraph immediately before `pStart` when it's a list item whose inferred preset is `bulletPreset`. */
function sameListBefore(tab: TabState, pStart: number, bulletPreset: BulletPreset): string | undefined {
  const prev = pStart > 0 ? tab.tape[pStart - 1] : undefined;
  if (prev?.t !== "nl" || !prev.para.bullet) return undefined;
  const prevListId = (prev.para.bullet as JsonObject).listId as string | undefined;
  const listDef = prevListId ? (tab.lists[prevListId] as JsonObject | undefined) : undefined;
  const nestingLevels = (listDef?.listProperties as JsonObject | undefined)?.nestingLevels as JsonObject[] | undefined;
  return prevListId && nestingLevels && listPresetInfer(nestingLevels, listPresetTable()) === bulletPreset
    ? prevListId
    : undefined;
}

/** Mints a new list whose definition is the recorded preset's nine levels. */
function listMint(tab: TabState, bulletPreset: BulletPreset, ctx: EmulateContext): string {
  const listId = mintListId(ctx);
  const presetLevels = listPresetTable()[bulletPreset];
  tab.lists[listId] = {
    listProperties: { nestingLevels: structuredClone(presetLevels ?? Array.from({ length: 9 }, () => ({}))) },
  };
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
  for (const i of paragraphNewlinesOverlapping(tab.tape, start, end)) {
    const cell = tab.tape[i] as Extract<TapeCell, { t: "nl" }>;
    if (!cell.para.bullet) continue;
    const style: JsonObject = { ...cell.para.style, indentStart: { unit: "PT" } };
    delete style.indentFirstLine;
    cell.para = { ...cell.para, bullet: undefined, style };
  }
}

export function mintHeadingId(ctx: EmulateContext): string {
  ctx.idCounters.heading += 1;
  return `${MINT_PREFIXES.heading}${ctx.idCounters.heading}`;
}

export function mintListId(ctx: EmulateContext): string {
  ctx.idCounters.list += 1;
  return `${MINT_PREFIXES.list}${ctx.idCounters.list}`;
}

function mintInlineObjectId(ctx: EmulateContext): string {
  ctx.idCounters.image += 1;
  return `${MINT_PREFIXES.image}${ctx.idCounters.image}`;
}

function mintChipId(ctx: EmulateContext): string {
  ctx.idCounters.chip += 1;
  return `${MINT_PREFIXES.chip}${ctx.idCounters.chip}`;
}

function mintTabId(ctx: EmulateContext): string {
  ctx.idCounters.tab += 1;
  return `${MINT_PREFIXES.tab}${ctx.idCounters.tab}`;
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
  tab.tape.splice(idx + 1, 0, { raw: { sectionStyle: { ...SECTION_STYLE_DEFAULT, sectionType } }, t: "sectionBreak" });
  return {};
}

/** SectionStyle fields the API accepts (`columnCount` is not one, F26). */
const SECTION_STYLE_FIELDS: ReadonlySet<string> = new Set([
  "columnProperties",
  "columnSeparatorStyle",
  "contentDirection",
  "defaultFooterId",
  "defaultHeaderId",
  "evenPageFooterId",
  "evenPageHeaderId",
  "firstPageFooterId",
  "firstPageHeaderId",
  "flipPageOrientation",
  "marginBottom",
  "marginFooter",
  "marginHeader",
  "marginLeft",
  "marginRight",
  "marginTop",
  "pageNumberStart",
  "sectionType",
  "useFirstPageHeaderFooter",
]);

/**
 * Applies a field-masked style patch to every section break (the tab's leading one included) whose
 * index falls in `range` (F26): columns need `paddingEnd` each and get server-computed widths, and a
 * range starting at 0 (the first section) switches a pageless doc to `PAGES`.
 */
function updateSectionStyleRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const { end, start, tab } = rangeResolve(state, req.range as JsonObject, ctx);
  const fields = parseFields(req.fields);
  const patch = (req.sectionStyle as JsonObject) ?? {};
  const unknown = Object.keys(patch).find((k) => !SECTION_STYLE_FIELDS.has(k));
  if (unknown) throw new EmulatorError("INVALID_FIELD", ctx.requestIndex, `Unknown name "${unknown}" in sectionStyle`);
  const columns = patch.columnProperties as JsonObject[] | undefined;
  if (fields.includes("columnProperties") && columns?.some((c) => c.paddingEnd === undefined)) {
    throw new EmulatorError(
      "INVALID_FIELD",
      ctx.requestIndex,
      "Column padding must be set in order to update column properties.",
    );
  }
  for (let i = start; i < end; i++) {
    const cell = tab.tape[i];
    if (cell.t !== "sectionBreak") continue;
    const sectionStyle = applyStyleFields((cell.raw.sectionStyle as JsonObject | undefined) ?? {}, patch, fields);
    if (Array.isArray(sectionStyle.columnProperties)) {
      sectionStyle.columnProperties = sectionColumnsSize(
        tab,
        sectionStyle,
        sectionStyle.columnProperties as JsonObject[],
      );
    }
    cell.raw.sectionStyle = sectionStyle;
  }
  if (start === 0) {
    const documentFormat = {
      ...((tab.documentStyle.documentFormat as JsonObject | undefined) ?? {}),
      documentMode: "PAGES",
    };
    tab.documentStyle = { ...tab.documentStyle, documentFormat };
  }
  return {};
}

/** Gives each section column the width the server computes: (page width − left/right margins − Σ paddingEnd) / n. */
function sectionColumnsSize(tab: TabState, sectionStyle: JsonObject, columns: JsonObject[]): JsonObject[] {
  const pt = (d: unknown): number => ((d as JsonObject | undefined)?.magnitude as number | undefined) ?? 0;
  const pageWidth = pt((tab.documentStyle.pageSize as JsonObject | undefined)?.width);
  const margins =
    pt(sectionStyle.marginLeft ?? tab.documentStyle.marginLeft) +
    pt(sectionStyle.marginRight ?? tab.documentStyle.marginRight);
  const padding = columns.reduce((sum, c) => sum + pt(c.paddingEnd), 0);
  const width = (pageWidth - margins - padding) / columns.length;
  return columns.map((c) => ({ ...c, width: { magnitude: width, unit: "PT" } }));
}

// --- insertPerson / insertDate / insertRichLink / insertInlineImage ---

/** Id field each chip kind is minted under. */
const CHIP_ID_FIELDS = { dateElement: "dateId", person: "personId", richLink: "richLinkId" } as const;

/** Inserts a single-index chip atom (person, date, or rich link) at `location`, minting its id; dates get the server's defaults (F25). */
function insertAtomRequestApply(
  state: EmulatorState,
  req: JsonObject,
  ctx: EmulateContext,
  type: keyof typeof CHIP_ID_FIELDS,
  propertiesField: string,
): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const properties =
    type === "dateElement" ? dateElementPropertiesFill(req[propertiesField] as JsonObject) : req[propertiesField];
  const raw = { [type]: { [CHIP_ID_FIELDS[type]]: mintChipId(ctx), [propertiesField]: properties } };
  tab.tape.splice(idx, 0, { raw, span: 1, style, t: "atom" });
  return {};
}

/** Fills a date chip's locale/format defaults and, for the default format, its en-US `displayText` in UTC (F25). */
function dateElementPropertiesFill(props: JsonObject | undefined): JsonObject {
  const filled: JsonObject = { ...DATE_ELEMENT_DEFAULTS, ...props };
  const isDefaultFormat =
    filled.dateFormat === DATE_ELEMENT_DEFAULTS.dateFormat && filled.timeFormat === DATE_ELEMENT_DEFAULTS.timeFormat;
  if (isDefaultFormat && typeof filled.timestamp === "string" && filled.displayText === undefined) {
    filled.displayText = new Date(filled.timestamp).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    });
  }
  return filled;
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
    objectId,
  };
  tab.tape.splice(idx, 0, { raw: { inlineObjectElement: { inlineObjectId: objectId } }, span: 1, style, t: "atom" });
  return { insertInlineImage: { objectId } };
}

// --- table structural requests ---

function insertTableRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const location = req.location as JsonObject;
  const tab = tabResolve(state, location.tabId as string | undefined, ctx.requestIndex);
  const idx = location.index as number;
  insertPositionValidate(tab, idx, ctx);
  const style = styleForInsertAt(tab.tape, idx);
  const originalKeepsLaterSide = idx === paragraphStartBefore(tab.tape, idx);
  // New cells take the insertion point's text style; at a heading's start, also the heading's named text style (F13).
  let nlIndex = idx;
  while (tab.tape[nlIndex]?.t !== "nl") nlIndex++;
  const namedType = (tab.tape[nlIndex] as Extract<TapeCell, { t: "nl" }>).para.style.namedStyleType as
    | string
    | undefined;
  const namedText = ((tab.namedStyles.styles as JsonObject[] | undefined) ?? []).find(
    (st) => st.namedStyleType === namedType,
  )?.textStyle as JsonObject | undefined;
  const cellTextStyle =
    originalKeepsLaterSide && namedType && namedType !== "NORMAL_TEXT"
      ? (styleCanonical({ ...namedText, ...style }) as JsonObject)
      : style;
  insertTable(tab, idx, req.rows as number, req.columns as number, cellTextStyle, (pos) =>
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

/** Creates a tab from the blank-tab template (F19), placed among its siblings at `index` (default: last); the reply carries its index and nesting level. */
function addDocumentTabRequestApply(state: EmulatorState, req: JsonObject, ctx: EmulateContext): JsonObject {
  const tabId = mintTabId(ctx);
  const tabProperties = (req.tabProperties as JsonObject) ?? {};
  const title = (tabProperties.title as string | undefined) ?? "";
  const parentTabId = tabProperties.parentTabId as string | undefined;
  const tab = tabStateBuild(tabId, title, parentTabId, structuredClone(blankTab) as RawDocumentTab);
  const siblings = tabSiblings(state, parentTabId);
  const index = Math.min((tabProperties.index as number | undefined) ?? siblings.length, siblings.length);
  tabsInsert(state, [tab], parentTabId, index);
  const nestingLevel = tabDepth(state, tab);
  const reply: JsonObject = { index, tabId, title };
  if (parentTabId) reply.parentTabId = parentTabId;
  if (nestingLevel) reply.nestingLevel = nestingLevel;
  return { addDocumentTab: { tabProperties: reply } };
}

/** Deletes a tab and every descendant tab (F19). */
function deleteTabRequestApply(state: EmulatorState, req: JsonObject): JsonObject {
  const [from, to] = tabSubtreeRange(state, req.tabId as string);
  state.tabs.splice(from, to - from);
  return {};
}

/** Applies a field-masked patch to a tab's `title` and/or `index` among its siblings (a move); `tabProperties.tabId` names the tab (F19). */
function updateDocumentTabPropertiesRequestApply(
  state: EmulatorState,
  req: JsonObject,
  ctx: EmulateContext,
): JsonObject {
  const patch = (req.tabProperties as JsonObject) ?? {};
  const tab = tabResolve(state, patch.tabId as string, ctx.requestIndex);
  const fields = parseFields(req.fields);
  if (fields.includes("title") && typeof patch.title === "string") tab.title = patch.title;
  if (fields.includes("index") && typeof patch.index === "number") {
    const [from, to] = tabSubtreeRange(state, tab.tabId);
    const moved = state.tabs.splice(from, to - from);
    tabsInsert(state, moved, tab.parentTabId, Math.min(patch.index, tabSiblings(state, tab.parentTabId).length));
  }
  return {};
}

/** Tabs sharing `parentTabId` (root tabs when undefined), in order. */
function tabSiblings(state: EmulatorState, parentTabId: string | undefined): TabState[] {
  return state.tabs.filter((t) => t.parentTabId === parentTabId);
}

/** Depth of a tab (0 for root tabs). */
function tabDepth(state: EmulatorState, tab: TabState): number {
  let depth = 0;
  let parent = tab.parentTabId;
  while (parent) {
    depth++;
    parent = state.tabs.find((t) => t.tabId === parent)?.parentTabId;
  }
  return depth;
}

/** `[start, end)` of a tab and its descendants in the DFS-ordered `state.tabs`. */
function tabSubtreeRange(state: EmulatorState, tabId: string): [number, number] {
  const from = state.tabs.findIndex((t) => t.tabId === tabId);
  if (from < 0) return [0, 0];
  const depth = tabDepth(state, state.tabs[from]);
  let to = from + 1;
  while (to < state.tabs.length && tabDepth(state, state.tabs[to]) > depth) to++;
  return [from, to];
}

/** Inserts DFS-ordered `tabs` (a subtree) as the `index`-th child of `parentTabId`. */
function tabsInsert(state: EmulatorState, tabs: TabState[], parentTabId: string | undefined, index: number): void {
  const siblings = tabSiblings(state, parentTabId);
  let at: number;
  if (index < siblings.length) at = state.tabs.indexOf(siblings[index]);
  else if (siblings.length) at = tabSubtreeRange(state, siblings[siblings.length - 1].tabId)[1];
  else at = parentTabId ? tabSubtreeRange(state, parentTabId)[1] : state.tabs.length;
  state.tabs.splice(at, 0, ...tabs);
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
