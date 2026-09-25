/* Parses a raw Docs API document (or legacy single-body doc) into the v2 content model (see G3 D5-D11). */

import type { GoogleDoc } from "~/core/types.ts";
import type { KeyAllocator } from "./keys.ts";
import { listPresetsApply } from "./lists.ts";
import {
  type JsonObject,
  type RawDocumentTab,
  type RawParagraph,
  type RawParagraphElement,
  rawDocumentOf,
} from "./rawJson.ts";
import { styleCanonical, styleEqual, suggestionIdsEqual } from "./styleValues.ts";
import type {
  Atom,
  AtomType,
  Block,
  CellModel,
  DocModel,
  Inline,
  ListDef,
  NamedRangeDef,
  NewlineMark,
  ParagraphBlock,
  RowModel,
  SectionBreakBlock,
  TableBlock,
  TabModel,
  TextRun,
  TocBlock,
} from "./types.ts";

/** Thrown when a document's JSON violates an invariant `docModelParse` relies on. */
export class ParseError extends Error {}

/**
 * Parses a fetched document into a `DocModel`: every tab's content, styles, and lists, in depth-first
 * order. Never mutates `json`. A legacy (tab-less) document is synthesized into a single tab `t.0`.
 */
export function docModelParse(
  /** JSON returned by `documents.get`. */
  json: GoogleDoc,
  /** Parse-time options. */
  opts: {
    /** Real or `new:<alias>` document id to stamp onto the resulting model. */ docId: string;
    /** Key allocator shared across every tab in this parse. */ keys: KeyAllocator;
    /** Suggestions view mode the source JSON was fetched with (see G3 D37 `viewMode` guard). */ suggestionsViewMode?: string;
  },
): DocModel {
  const raw = rawDocumentOf(structuredClone(json) as GoogleDoc);
  const tabs: TabModel[] = raw.tabs?.length
    ? raw.tabs.flatMap((tab) => tabsFlattenDfs(tab, opts.keys))
    : [tabParse("t.0", raw.title ?? "", undefined, raw as unknown as RawDocumentTab, opts.keys)];
  const doc: DocModel = {
    docId: opts.docId,
    isNew: false,
    revisionId: raw.revisionId,
    suggestionsViewMode: opts.suggestionsViewMode,
    tabs,
    title: raw.title ?? "",
  };
  listPresetsApply(doc);
  return doc;
}

/** Recursively flattens a `RawTab` (and its `childTabs`) into depth-first `TabModel`s. */
function tabsFlattenDfs(
  /** Tab to flatten. */
  raw: import("./rawJson.ts").RawTab,
  /** Shared key allocator. */
  keys: KeyAllocator,
): TabModel[] {
  const tabId = raw.tabProperties?.tabId;
  if (!tabId) throw new ParseError("tab is missing tabProperties.tabId");
  const out = [
    tabParse(tabId, raw.tabProperties?.title ?? "", raw.tabProperties?.parentTabId, raw.documentTab ?? {}, keys),
  ];
  for (const child of raw.childTabs ?? []) out.push(...tabsFlattenDfs(child, keys));
  return out;
}

/** Parses one tab's `documentTab` (or the legacy document root) into a `TabModel`. */
function tabParse(
  /** Real or synthesized (`t.0`) tab id. */
  tabId: string,
  /** Tab title. */
  title: string,
  /** Parent tab id, for nested tabs. */
  parentTabId: string | undefined,
  /** The tab's content and ancillary maps. */
  dt: RawDocumentTab,
  /** Shared key allocator. */
  keys: KeyAllocator,
): TabModel {
  const content = dt.body?.content ?? [];
  const first = content[0];
  if (!first?.sectionBreak || (first.startIndex ?? 0) !== 0) {
    throw new ParseError(`tab "${tabId}" body does not start with a leading section break at index 0`);
  }
  const leadingSectionStyle = styleCanonical(first.sectionBreak.sectionStyle ?? {}) as JsonObject;
  const blocks = content.slice(1).map((el) => blockParse(el, keys));

  const lists: Record<string, ListDef> = {};
  for (const [listId, def] of Object.entries(dt.lists ?? {})) {
    lists[listId] = { isNew: false, nestingLevels: def.listProperties?.nestingLevels ?? [] };
  }

  const namedRanges: NamedRangeDef[] = [];
  for (const entries of Object.values(dt.namedRanges ?? {})) {
    for (const entry of entries.namedRanges ?? []) {
      namedRanges.push({
        name: entry.name ?? entries.name ?? "",
        namedRangeId: entry.namedRangeId ?? "",
        ranges: (entry.ranges ?? []).map((r) => ({ end: r.endIndex ?? 0, start: r.startIndex ?? 0 })),
      });
    }
  }

  return {
    blocks,
    documentStyle: styleCanonical(dt.documentStyle ?? {}) as JsonObject,
    footnotes: (dt.footnotes ?? {}) as Record<string, JsonObject>,
    headersFooters: { footers: dt.footers ?? {}, headers: dt.headers ?? {} },
    inlineObjects: (dt.inlineObjects ?? {}) as Record<string, JsonObject>,
    isNew: false,
    leadingSectionStyle,
    lists,
    namedRanges,
    namedStyles: styleCanonical(dt.namedStyles ?? {}) as JsonObject,
    parentTabId,
    positionedObjects: (dt.positionedObjects ?? {}) as Record<string, JsonObject>,
    tabId,
    title,
  };
}

/** Parses one top-level (or in-cell) structural element into a `Block`. */
function blockParse(el: import("./rawJson.ts").RawStructuralElement, keys: KeyAllocator): Block {
  if (el.paragraph) return paragraphParse(el.paragraph, requireRange(el, "paragraph"), keys);
  if (el.table) return tableParse(el.table, requireRange(el, "table"), keys);
  if (el.tableOfContents) return tocParse(el, keys);
  if (el.sectionBreak) return sectionBreakParse(el.sectionBreak, requireRange(el, "sectionBreak"), keys);
  throw new ParseError("structural element has none of paragraph, table, tableOfContents, sectionBreak");
}

/** Parses one `Paragraph` body into a `ParagraphBlock`. */
function paragraphParse(p: RawParagraph, origin: { end: number; start: number }, keys: KeyAllocator): ParagraphBlock {
  const elements = p.elements ?? [];
  if (elements.length === 0) throw new ParseError("paragraph has no elements");

  const rawInlines: Inline[] = [];
  let newline: NewlineMark | undefined;
  elements.forEach((el, i) => {
    const isLast = i === elements.length - 1;
    if (!el.textRun) {
      rawInlines.push(atomFromElement(el, keys));
      return;
    }
    const content = el.textRun.content ?? "";
    const style = styleCanonical(el.textRun.textStyle ?? {}) as JsonObject;
    if (!isLast) {
      rawInlines.push({
        kind: "text",
        style,
        suggestedDeletionIds: el.textRun.suggestedDeletionIds,
        suggestedInsertionIds: el.textRun.suggestedInsertionIds,
        suggestedTextStyleChanges: el.textRun.suggestedTextStyleChanges,
        text: content,
      });
      return;
    }
    if (!content.endsWith("\n")) throw new ParseError("paragraph's last element does not end with a newline");
    newline = {
      style,
      suggestedDeletionIds: el.textRun.suggestedDeletionIds,
      suggestedInsertionIds: el.textRun.suggestedInsertionIds,
    };
    const visible = content.slice(0, -1);
    if (visible.length > 0) {
      rawInlines.push({
        kind: "text",
        style,
        suggestedDeletionIds: el.textRun.suggestedDeletionIds,
        suggestedInsertionIds: el.textRun.suggestedInsertionIds,
        suggestedTextStyleChanges: el.textRun.suggestedTextStyleChanges,
        text: visible,
      });
    }
  });
  if (!newline) throw new ParseError("paragraph has no trailing newline");

  const inlines = mergeAdjacentTextRuns(rawInlines);
  const rawStyle = { ...(p.paragraphStyle ?? {}) } as JsonObject;
  const headingId = typeof rawStyle.headingId === "string" ? rawStyle.headingId : undefined;
  delete rawStyle.headingId;

  const bullet = p.bullet
    ? {
        listId: p.bullet.listId ?? "",
        nestingLevel: p.bullet.nestingLevel ?? 0,
        textStyle: p.bullet.textStyle ? (styleCanonical(p.bullet.textStyle) as JsonObject) : undefined,
      }
    : undefined;

  const protectedFlag =
    Boolean(p.suggestedParagraphStyleChanges) ||
    Boolean(p.suggestedBulletChanges) ||
    Boolean(p.suggestedPositionedObjectIds) ||
    Boolean(newline.suggestedDeletionIds?.length) ||
    Boolean(newline.suggestedInsertionIds?.length) ||
    inlines.some((inline) =>
      inline.kind === "text"
        ? Boolean(inline.suggestedDeletionIds?.length || inline.suggestedInsertionIds?.length)
        : false,
    );

  return {
    bullet,
    headingId,
    inlines,
    key: keys.next("o"),
    kind: "paragraph",
    newline,
    origin,
    positionedObjectIds: p.positionedObjectIds,
    protected: protectedFlag,
    stamp: undefined,
    style: styleCanonical(rawStyle) as JsonObject,
    suggestionsRaw: protectedFlag
      ? {
          suggestedBulletChanges: p.suggestedBulletChanges,
          suggestedParagraphStyleChanges: p.suggestedParagraphStyleChanges,
          suggestedPositionedObjectIds: p.suggestedPositionedObjectIds,
        }
      : undefined,
  };
}

/** Merges consecutive `TextRun`s that share style and suggestion state (Docs API often splits one run into several with identical style). */
function mergeAdjacentTextRuns(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    const prev = out.at(-1);
    if (
      inline.kind === "text" &&
      prev?.kind === "text" &&
      styleEqual(prev.style, inline.style) &&
      suggestionIdsEqual(prev.suggestedDeletionIds, inline.suggestedDeletionIds) &&
      suggestionIdsEqual(prev.suggestedInsertionIds, inline.suggestedInsertionIds)
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + inline.text } as TextRun;
    } else {
      out.push(inline);
    }
  }
  return out;
}

/** Maps a non-text `RawParagraphElement` variant to its `Atom`. */
function atomFromElement(el: RawParagraphElement, keys: KeyAllocator): Atom {
  const variants: Array<{ style?: JsonObject; type: AtomType }> = [
    { style: el.person?.textStyle, type: "person" },
    { style: el.richLink?.textStyle, type: "richLink" },
    { style: el.date?.textStyle, type: "date" },
    { style: el.inlineObjectElement?.textStyle, type: "image" },
    { style: el.footnoteReference?.textStyle, type: "footnoteRef" },
    { style: el.horizontalRule?.textStyle, type: "horizontalRule" },
    { style: el.pageBreak?.textStyle, type: "pageBreak" },
    { style: el.columnBreak?.textStyle, type: "columnBreak" },
    { type: "equation" },
    { style: el.autoText?.textStyle, type: "autoText" },
  ];
  const keyOf: Record<AtomType, keyof RawParagraphElement> = {
    autoText: "autoText",
    columnBreak: "columnBreak",
    date: "date",
    equation: "equation",
    footnoteRef: "footnoteReference",
    horizontalRule: "horizontalRule",
    image: "inlineObjectElement",
    pageBreak: "pageBreak",
    person: "person",
    richLink: "richLink",
  };
  for (const variant of variants) {
    const payload = el[keyOf[variant.type]];
    if (payload === undefined) continue;
    const { endIndex, startIndex, ...rawRest } = el;
    return {
      key: keys.next("o"),
      kind: "atom",
      length: (endIndex ?? 0) - (startIndex ?? 0),
      raw: rawRest as JsonObject,
      style: variant.style ? (styleCanonical(variant.style) as JsonObject) : undefined,
      type: variant.type,
    };
  }
  throw new ParseError("paragraph element has no recognized non-text variant");
}

/** Parses a `Table` body into a `TableBlock`. */
function tableParse(
  t: import("./rawJson.ts").RawTable,
  origin: { end: number; start: number },
  keys: KeyAllocator,
): TableBlock {
  const rows = (t.tableRows ?? []).map((row) => rowParse(row, keys));
  const columnCount = t.columns ?? rows[0]?.cells.length ?? 0;
  const columnProps =
    (t.tableStyle as { tableColumnProperties?: JsonObject[] } | undefined)?.tableColumnProperties ?? [];
  const columns = Array.from({ length: columnCount }, (_, i) => ({ key: keys.next("o"), props: columnProps[i] ?? {} }));
  const protectedFlag = rows.some((row) =>
    row.cells.some((cell) => cell.blocks.some((b) => b.kind === "paragraph" && b.protected)),
  );
  return { columns, key: keys.next("o"), kind: "table", origin, protected: protectedFlag, rows, stamp: undefined };
}

/** Parses a `TableRow` into a `RowModel`. */
function rowParse(row: import("./rawJson.ts").RawTableRow, keys: KeyAllocator): RowModel {
  const cells = (row.tableCells ?? []).map((cell) => cellParse(cell, keys));
  return {
    cells,
    key: keys.next("o"),
    origin:
      row.startIndex !== undefined && row.endIndex !== undefined
        ? { end: row.endIndex, start: row.startIndex }
        : undefined,
    style: styleCanonical(row.tableRowStyle ?? {}) as JsonObject,
  };
}

/** Parses a `TableCell` into a `CellModel`; a nested table/TOC/section-break inside a cell is a parse error (v2 only supports paragraph-only cells, see G3 D10 V3). */
function cellParse(cell: import("./rawJson.ts").RawTableCell, keys: KeyAllocator): CellModel {
  const blocks = (cell.content ?? []).map((el) => {
    if (!el.paragraph) throw new ParseError("table cell contains a nested structure other than a paragraph");
    return paragraphParse(el.paragraph, requireRange(el, "paragraph"), keys);
  });
  return {
    blocks,
    key: keys.next("o"),
    origin:
      cell.startIndex !== undefined && cell.endIndex !== undefined
        ? { end: cell.endIndex, start: cell.startIndex }
        : undefined,
    style: styleCanonical(cell.tableCellStyle ?? {}) as JsonObject,
  };
}

/** Parses an opaque `TableOfContents` element into a `TocBlock`; its content is never inspected or edited (see G3 D3). */
function tocParse(el: import("./rawJson.ts").RawStructuralElement, keys: KeyAllocator): TocBlock {
  const origin = requireRange(el, "tableOfContents");
  return {
    key: keys.next("o"),
    kind: "toc",
    length: origin.end - origin.start,
    origin,
    raw: el.tableOfContents as JsonObject,
  };
}

/** Parses a mid-body `SectionBreak` element into a `SectionBreakBlock`. */
function sectionBreakParse(
  sb: import("./rawJson.ts").RawSectionBreak,
  origin: { end: number; start: number },
  keys: KeyAllocator,
): SectionBreakBlock {
  return {
    key: keys.next("o"),
    kind: "sectionBreak",
    origin,
    sectionStyle: styleCanonical(sb.sectionStyle ?? {}) as JsonObject,
  };
}

/** Reads a structural element's `[startIndex, endIndex)`, throwing if either is missing. */
function requireRange(el: import("./rawJson.ts").RawStructuralElement, what: string): { end: number; start: number } {
  if (el.startIndex === undefined || el.endIndex === undefined) {
    throw new ParseError(`${what} element is missing startIndex/endIndex`);
  }
  return { end: el.endIndex, start: el.startIndex };
}
