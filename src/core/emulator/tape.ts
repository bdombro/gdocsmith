/* Flat, one-cell-per-JSON-index tape representation of a tab's body, and its lossless JSON round-trip (see G3 M3). Lower-level than src/core/model/: works directly off raw Docs JSON, unaware of the content model's merged runs or protection flags. */

import type { GoogleDoc } from "~/core/types.ts";
import {
  type JsonObject,
  type RawDocumentTab,
  type RawParagraph,
  type RawParagraphElement,
  type RawStructuralElement,
  type RawTab,
  type RawTable,
  rawDocumentOf,
} from "../model/rawJson.ts";
import { styleCanonical, styleEqual, suggestionIdsEqual } from "../model/styleValues.ts";

/** Suggestion metadata attached to a character, newline, row, or cell tape cell. */
export interface Sugg {
  /** Suggested-deletion ids, when any. */ delIds?: string[];
  /** Suggested-insertion ids, when any. */ insIds?: string[];
}

/** Everything needed to rebuild a paragraph's wrapper (style, heading, bullet, suggestions) from its terminating newline cell. */
export interface NlPara {
  /** Raw bullet reference (`listId`/`nestingLevel`/`textStyle`), passed through as originally provided. */ bullet?: JsonObject;
  /** Heading id, lifted out of `style`. */ headingId?: string;
  /** Positioned (floating) object ids anchored to this paragraph. */ positionedObjectIds?: string[];
  /** Explicit paragraph style (`headingId` excluded). */ style: JsonObject;
  /** Raw suggestion payloads (`suggestedBulletChanges`/`suggestedParagraphStyleChanges`/`suggestedPositionedObjectIds`), when any. */ suggestionsRaw?: JsonObject;
}

/** One JSON-index-worth of tab body content. Tables/TOC nest their own markers directly into the same flat sequence, matching how the real API indexes them. */
export type TapeCell =
  | { ch: string; style: JsonObject; sugg?: Sugg; t: "char" }
  | { raw: JsonObject; span: number; style?: JsonObject; sugg?: Sugg; t: "atom" }
  | { t: "atomCont" }
  | { para: NlPara; style: JsonObject; sugg?: Sugg; t: "nl" }
  | { raw: JsonObject; t: "sectionBreak" }
  | { raw: JsonObject; t: "tableStart" }
  | { style: JsonObject; sugg?: Sugg; t: "rowStart" }
  | { style: JsonObject; sugg?: Sugg; t: "cellStart" }
  | { t: "tableEnd" }
  | { raw: JsonObject; t: "tocStart" }
  | { t: "tocEnd" };

/** One tab's tape and its ancillary (non-body) maps, passed through verbatim. */
export interface TabState {
  /** Explicit tab-level document style. */ documentStyle: JsonObject;
  /** Footer bodies, passed through verbatim. */ footers: JsonObject;
  /** Footnote bodies, passed through verbatim. */ footnotes: JsonObject;
  /** Header bodies, passed through verbatim. */ headers: JsonObject;
  /** Inline (image/drawing) object definitions. */ inlineObjects: JsonObject;
  /** List definitions, keyed by list id. */ lists: JsonObject;
  /** Named ranges, passed through verbatim. */ namedRanges: JsonObject;
  /** Named-style definitions. */ namedStyles: JsonObject;
  /** Parent tab id, for nested tabs. */ parentTabId?: string;
  /** Positioned (floating) object definitions. */ positionedObjects: JsonObject;
  /** Flat, one-cell-per-index body content. */ tape: TapeCell[];
  /** Tab id. */ tabId: string;
  /** Tab title. */ title: string;
}

/** A whole document's emulator state: every tab, DFS-flattened. */
export interface EmulatorState {
  /** Document id. */ documentId?: string;
  /** Revision id. */ revisionId?: string;
  /** Every tab, in DFS order. */ tabs: TabState[];
  /** Document title. */ title?: string;
}

const ATOM_KEYS = [
  "autoText",
  "columnBreak",
  "date",
  "equation",
  "footnoteReference",
  "horizontalRule",
  "inlineObjectElement",
  "pageBreak",
  "person",
  "richLink",
] as const;

/** Builds an `EmulatorState` from a fetched (or legacy single-body) document. Never mutates `json`. */
export function docStateBuild(
  /** JSON returned by `documents.get`. */
  json: GoogleDoc,
): EmulatorState {
  const raw = rawDocumentOf(structuredClone(json) as GoogleDoc);
  const tabs: TabState[] = raw.tabs?.length
    ? raw.tabs.flatMap((t) => tabsFlattenDfs(t))
    : [tabStateBuild("t.0", raw.title ?? "", undefined, raw as unknown as RawDocumentTab)];
  return { documentId: raw.documentId, revisionId: raw.revisionId, tabs, title: raw.title };
}

/** Rebuilds a `GoogleDoc` from an `EmulatorState`, recomputing every JSON index and re-grouping character cells into runs by canonical style and suggestion ids. */
export function docStateJson(
  /** State to serialize. */
  state: EmulatorState,
): GoogleDoc {
  const built = state.tabs.map((tab) => tabJsonBuild(tab));
  const byId = new Map(state.tabs.map((tab, i) => [tab.tabId, built[i]]));
  const roots: JsonObject[] = [];
  state.tabs.forEach((tab, i) => {
    const parent = tab.parentTabId ? byId.get(tab.parentTabId) : undefined;
    if (parent) {
      const childTabs = (parent.childTabs as JsonObject[] | undefined) ?? [];
      childTabs.push(built[i]);
      parent.childTabs = childTabs;
    } else {
      roots.push(built[i]);
    }
  });
  return {
    documentId: state.documentId,
    revisionId: state.revisionId,
    tabs: roots,
    title: state.title,
  } as unknown as GoogleDoc;
}

/** Recursively flattens a `RawTab` (and its `childTabs`) into depth-first `TabState`s. */
function tabsFlattenDfs(raw: RawTab): TabState[] {
  const tabId = raw.tabProperties?.tabId;
  if (!tabId) throw new Error("tab is missing tabProperties.tabId");
  const out = [
    tabStateBuild(tabId, raw.tabProperties?.title ?? "", raw.tabProperties?.parentTabId, raw.documentTab ?? {}),
  ];
  for (const child of raw.childTabs ?? []) out.push(...tabsFlattenDfs(child));
  return out;
}

/** Builds one tab's tape and ancillary maps. */
function tabStateBuild(tabId: string, title: string, parentTabId: string | undefined, dt: RawDocumentTab): TabState {
  const tape: TapeCell[] = [];
  for (const el of dt.body?.content ?? []) tapeAppendElement(tape, el);
  return {
    documentStyle: (dt.documentStyle ?? {}) as JsonObject,
    footers: (dt.footers ?? {}) as JsonObject,
    footnotes: (dt.footnotes ?? {}) as JsonObject,
    headers: (dt.headers ?? {}) as JsonObject,
    inlineObjects: (dt.inlineObjects ?? {}) as JsonObject,
    lists: (dt.lists ?? {}) as JsonObject,
    namedRanges: (dt.namedRanges ?? {}) as JsonObject,
    namedStyles: (dt.namedStyles ?? {}) as JsonObject,
    parentTabId,
    positionedObjects: (dt.positionedObjects ?? {}) as JsonObject,
    tabId,
    tape,
    title,
  };
}

/** Appends one structural element's cells onto a tape (recursing into tables). */
function tapeAppendElement(tape: TapeCell[], el: RawStructuralElement): void {
  if (el.paragraph) {
    tapeAppendParagraph(tape, el.paragraph);
  } else if (el.table) {
    tapeAppendTable(tape, el.table);
  } else if (el.tableOfContents) {
    const span = (el.endIndex ?? 0) - (el.startIndex ?? 0);
    tape.push({ raw: (el.tableOfContents ?? {}) as JsonObject, t: "tocStart" });
    for (let i = 1; i < span - 1; i++) tape.push({ t: "atomCont" });
    tape.push({ t: "tocEnd" });
  } else if (el.sectionBreak) {
    tape.push({ raw: (el.sectionBreak ?? {}) as JsonObject, t: "sectionBreak" });
  } else {
    throw new Error("structural element has none of paragraph, table, tableOfContents, sectionBreak");
  }
}

/** Appends one paragraph's cells: a char cell per UTF-16 unit of visible text, one atom+atomCont run per non-text element, and a terminating nl cell. */
function tapeAppendParagraph(tape: TapeCell[], p: RawParagraph): void {
  const elements = p.elements ?? [];
  const rawParaStyle = { ...(p.paragraphStyle ?? {}) } as JsonObject;
  const headingId = typeof rawParaStyle.headingId === "string" ? rawParaStyle.headingId : undefined;
  delete rawParaStyle.headingId;
  const bullet = p.bullet
    ? ({ listId: p.bullet.listId, nestingLevel: p.bullet.nestingLevel, textStyle: p.bullet.textStyle } as JsonObject)
    : undefined;

  elements.forEach((el, i) => {
    const isLast = i === elements.length - 1;
    if (el.textRun) {
      const content = el.textRun.content ?? "";
      const style = styleCanonical(el.textRun.textStyle ?? {}) as JsonObject;
      const sugg = suggFromIds(el.textRun.suggestedDeletionIds, el.textRun.suggestedInsertionIds);
      for (let j = 0; j < content.length; j++) {
        const isLastChar = isLast && j === content.length - 1;
        if (isLastChar && content[j] === "\n") {
          tape.push({
            para: {
              bullet,
              headingId,
              positionedObjectIds: p.positionedObjectIds,
              style: styleCanonical(rawParaStyle) as JsonObject,
              suggestionsRaw: paragraphSuggestionsRaw(p),
            },
            style,
            sugg,
            t: "nl",
          });
        } else {
          tape.push({ ch: content[j], style, sugg, t: "char" });
        }
      }
    } else {
      const atom = atomFromRawElement(el);
      tape.push({ raw: atom.raw, span: atom.span, style: atom.style, sugg: atom.sugg, t: "atom" });
      for (let k = 1; k < atom.span; k++) tape.push({ t: "atomCont" });
    }
  });
}

/** Maps a non-text `RawParagraphElement` to its tape atom fields, stripping style/suggestions out of `raw` (kept denormalized on the cell so edits can update them without touching the identity payload). */
function atomFromRawElement(el: RawParagraphElement): {
  raw: JsonObject;
  span: number;
  style?: JsonObject;
  sugg?: Sugg;
} {
  for (const key of ATOM_KEYS) {
    const payload = (el as unknown as JsonObject)[key] as JsonObject | undefined;
    if (payload === undefined) continue;
    const { suggestedDeletionIds, suggestedInsertionIds, textStyle, ...variantRest } = payload;
    return {
      raw: { [key]: variantRest },
      span: (el.endIndex ?? 0) - (el.startIndex ?? 0),
      style: textStyle ? (styleCanonical(textStyle as JsonObject) as JsonObject) : undefined,
      sugg: suggFromIds(suggestedDeletionIds as string[] | undefined, suggestedInsertionIds as string[] | undefined),
    };
  }
  throw new Error("paragraph element has no recognized non-text variant");
}

/** Captures a paragraph's suggestion payloads, or `undefined` when it carries none. */
function paragraphSuggestionsRaw(p: RawParagraph): JsonObject | undefined {
  if (!p.suggestedBulletChanges && !p.suggestedParagraphStyleChanges && !p.suggestedPositionedObjectIds)
    return undefined;
  return {
    suggestedBulletChanges: p.suggestedBulletChanges,
    suggestedParagraphStyleChanges: p.suggestedParagraphStyleChanges,
    suggestedPositionedObjectIds: p.suggestedPositionedObjectIds,
  };
}

/** Appends a table's cells: start marker, then each row's marker and each cell's marker plus its (paragraph-only) content, then the end marker. */
function tapeAppendTable(tape: TapeCell[], t: RawTable): void {
  tape.push({ raw: { columns: t.columns, rows: t.rows, tableStyle: t.tableStyle } as JsonObject, t: "tableStart" });
  for (const row of t.tableRows ?? []) {
    tape.push({
      style: styleCanonical(row.tableRowStyle ?? {}) as JsonObject,
      sugg: suggFromIds(row.suggestedDeletionIds, row.suggestedInsertionIds),
      t: "rowStart",
    });
    for (const cell of row.tableCells ?? []) {
      tape.push({
        style: styleCanonical(cell.tableCellStyle ?? {}) as JsonObject,
        sugg: suggFromIds(cell.suggestedDeletionIds, cell.suggestedInsertionIds),
        t: "cellStart",
      });
      for (const el of cell.content ?? []) tapeAppendElement(tape, el);
    }
  }
  tape.push({ t: "tableEnd" });
}

/** Builds a suggestion bag from raw id arrays, or `undefined` when both are empty. */
function suggFromIds(del?: string[], ins?: string[]): Sugg | undefined {
  if (!del?.length && !ins?.length) return undefined;
  return { delIds: del?.length ? del : undefined, insIds: ins?.length ? ins : undefined };
}

/** True when two suggestion bags name the same delete/insert id sets. */
function suggEqual(a: Sugg | undefined, b: Sugg | undefined): boolean {
  return suggestionIdsEqual(a?.delIds, b?.delIds) && suggestionIdsEqual(a?.insIds, b?.insIds);
}

/** `{ suggestedDeletionIds?, suggestedInsertionIds? }`, only present when non-empty. */
function suggFieldsFor(sugg: Sugg | undefined): JsonObject {
  const out: JsonObject = {};
  if (sugg?.delIds?.length) out.suggestedDeletionIds = sugg.delIds;
  if (sugg?.insIds?.length) out.suggestedInsertionIds = sugg.insIds;
  return out;
}

/** Rebuilds one tab's `tabProperties`/`documentTab` JSON from its `TabState`. */
function tabJsonBuild(tab: TabState): JsonObject {
  const reader = new TapeReader(tab.tape);
  const content = reader.readContent(new Set());
  return {
    documentTab: {
      body: { content },
      documentStyle: tab.documentStyle,
      footers: tab.footers,
      footnotes: tab.footnotes,
      headers: tab.headers,
      inlineObjects: tab.inlineObjects,
      lists: tab.lists,
      namedRanges: tab.namedRanges,
      namedStyles: tab.namedStyles,
      positionedObjects: tab.positionedObjects,
    },
    tabProperties: { parentTabId: tab.parentTabId, tabId: tab.tabId, title: tab.title },
  };
}

/** Stateful, index-tracking reader that turns a flat tape back into nested Docs API JSON. */
class TapeReader {
  #tape: TapeCell[];
  #i = 0;
  #index = 0;

  constructor(tape: TapeCell[]) {
    this.#tape = tape;
  }

  /** Reads structural elements until `stopTypes` is seen (or the tape ends). */
  readContent(stopTypes: ReadonlySet<TapeCell["t"]>): JsonObject[] {
    const out: JsonObject[] = [];
    while (this.#i < this.#tape.length && !stopTypes.has(this.#tape[this.#i].t)) out.push(this.#readOneElement());
    return out;
  }

  #readOneElement(): JsonObject {
    const cell = this.#tape[this.#i];
    if (cell.t === "sectionBreak") return this.#readSectionBreak();
    if (cell.t === "tocStart") return this.#readToc();
    if (cell.t === "tableStart") return this.#readTable();
    return this.#readParagraph();
  }

  #readSectionBreak(): JsonObject {
    const start = this.#index;
    const cell = this.#tape[this.#i] as Extract<TapeCell, { t: "sectionBreak" }>;
    this.#advance(1);
    return { endIndex: this.#index, sectionBreak: cell.raw, startIndex: start };
  }

  #readToc(): JsonObject {
    const start = this.#index;
    const cell = this.#tape[this.#i] as Extract<TapeCell, { t: "tocStart" }>;
    this.#advance(1);
    while (this.#tape[this.#i]?.t === "atomCont") this.#advance(1);
    this.#advance(1); // tocEnd
    return { endIndex: this.#index, startIndex: start, tableOfContents: cell.raw };
  }

  #readTable(): JsonObject {
    const start = this.#index;
    const cell = this.#tape[this.#i] as Extract<TapeCell, { t: "tableStart" }>;
    this.#advance(1);
    const tableRows: JsonObject[] = [];
    while (this.#tape[this.#i]?.t === "rowStart") tableRows.push(this.#readRow());
    this.#advance(1); // tableEnd
    return { endIndex: this.#index, startIndex: start, table: { ...cell.raw, tableRows } };
  }

  #readRow(): JsonObject {
    const start = this.#index;
    const cell = this.#tape[this.#i] as Extract<TapeCell, { t: "rowStart" }>;
    this.#advance(1);
    const tableCells: JsonObject[] = [];
    while (this.#tape[this.#i]?.t === "cellStart") tableCells.push(this.#readCell());
    return {
      endIndex: this.#index,
      startIndex: start,
      tableCells,
      tableRowStyle: cell.style,
      ...suggFieldsFor(cell.sugg),
    };
  }

  #readCell(): JsonObject {
    const start = this.#index;
    const cell = this.#tape[this.#i] as Extract<TapeCell, { t: "cellStart" }>;
    this.#advance(1);
    const content = this.readContent(new Set(["cellStart", "rowStart", "tableEnd"]));
    return {
      content,
      endIndex: this.#index,
      startIndex: start,
      tableCellStyle: cell.style,
      ...suggFieldsFor(cell.sugg),
    };
  }

  #readParagraph(): JsonObject {
    const start = this.#index;
    const elements: JsonObject[] = [];
    let runStart = this.#index;
    let buf: { sugg?: Sugg; style: JsonObject; text: string } | undefined;
    const flush = () => {
      if (!buf) return;
      elements.push({
        endIndex: runStart + buf.text.length,
        startIndex: runStart,
        textRun: { content: buf.text, textStyle: buf.style, ...suggFieldsFor(buf.sugg) },
      });
      buf = undefined;
    };

    let paraOut: JsonObject | undefined;
    while (true) {
      const cell = this.#tape[this.#i];
      if (!cell) throw new Error("paragraph runs off the end of the tape without a newline");
      if (cell.t === "char") {
        if (buf && styleEqual(buf.style, cell.style) && suggEqual(buf.sugg, cell.sugg)) {
          buf.text += cell.ch;
        } else {
          flush();
          runStart = this.#index;
          buf = { sugg: cell.sugg, style: cell.style, text: cell.ch };
        }
        this.#advance(1);
        continue;
      }
      if (cell.t === "atom") {
        flush();
        const atomStart = this.#index;
        const variantKey = Object.keys(cell.raw)[0];
        const variantPayload: JsonObject = { ...(cell.raw[variantKey] as JsonObject) };
        if (cell.style) variantPayload.textStyle = cell.style;
        Object.assign(variantPayload, suggFieldsFor(cell.sugg));
        elements.push({ [variantKey]: variantPayload, endIndex: atomStart + cell.span, startIndex: atomStart });
        this.#advance(cell.span);
        runStart = this.#index;
        continue;
      }
      if (cell.t === "nl") {
        if (buf && styleEqual(buf.style, cell.style) && suggEqual(buf.sugg, cell.sugg)) {
          buf.text += "\n";
          flush();
        } else {
          flush();
          runStart = this.#index;
          buf = { sugg: cell.sugg, style: cell.style, text: "\n" };
          flush();
        }
        const suggestions = cell.para.suggestionsRaw as
          | {
              suggestedBulletChanges?: JsonObject;
              suggestedParagraphStyleChanges?: JsonObject;
              suggestedPositionedObjectIds?: JsonObject;
            }
          | undefined;
        paraOut = {
          bullet: cell.para.bullet,
          elements,
          paragraphStyle:
            cell.para.headingId !== undefined
              ? { ...cell.para.style, headingId: cell.para.headingId }
              : cell.para.style,
          positionedObjectIds: cell.para.positionedObjectIds,
          suggestedBulletChanges: suggestions?.suggestedBulletChanges,
          suggestedParagraphStyleChanges: suggestions?.suggestedParagraphStyleChanges,
          suggestedPositionedObjectIds: suggestions?.suggestedPositionedObjectIds,
        };
        this.#advance(1);
        break;
      }
      throw new Error(`unexpected tape cell type "${cell.t}" inside a paragraph`);
    }
    return { endIndex: this.#index, paragraph: paraOut, startIndex: start };
  }

  #advance(n: number): void {
    this.#i += n;
    this.#index += n;
  }
}
