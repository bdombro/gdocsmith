/* v2 core content model: per-run document/tab/block/inline types every later G3 module (parser, emulator, reconciler, lens, engine) shares. */

import type { JsonObject } from "./rawJson.ts";

/**
 * Docs API `createParagraphBullets` glyph presets (v2's own copy: v2 code never imports `src/core/dom/**`,
 * see the G3 import boundary). `src/core/model/lists.ts` (G3 M2) re-exports this type alongside the runtime
 * preset table.
 */
export type BulletPreset =
  | "BULLET_ARROW3D_CIRCLE_SQUARE"
  | "BULLET_ARROW_DIAMOND_DISC"
  | "BULLET_CHECKBOX"
  | "BULLET_DIAMONDX_ARROW3D_SQUARE"
  | "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE"
  | "BULLET_DIAMOND_CIRCLE_SQUARE"
  | "BULLET_DISC_CIRCLE_SQUARE"
  | "BULLET_LEFTTRIANGLE_DIAMOND_DISC"
  | "BULLET_STAR_CIRCLE_SQUARE"
  | "NUMBERED_DECIMAL_ALPHA_ROMAN"
  | "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS"
  | "NUMBERED_DECIMAL_NESTED"
  | "NUMBERED_UPPERALPHA_ALPHA_ROMAN"
  | "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL"
  | "NUMBERED_ZERODECIMAL_ALPHA_ROMAN";

/** Character-index range, end-exclusive. */
export interface Range {
  /** Exclusive end index. */ end: number;
  /** Inclusive start index. */ start: number;
}

/** Who caused a block/atom to exist or change, for guard waivers and error attribution. */
export interface EditStamp {
  /** Whether that step's own `force` waives findings this stamp would otherwise trigger. */ force: boolean;
  /** Index into the run's `steps` array. */ stepIndex: number;
}

/** A key kept for a block/atom the reconciler deleted, so guard/identity logic can still see what was removed. */
export interface Tombstone {
  /** The deleted key. */ key: string;
  /** What kind of thing this key named. */ kind: "atom" | "block";
  /** Step that caused the deletion. */ stamp: EditStamp;
  /** Tab the deletion happened in. */ tabId: string;
}

/** Reference to a paragraph's bullet/list membership. */
export interface BulletRef {
  /** List this paragraph belongs to. */ listId: string;
  /** 0-based nesting depth. */ nestingLevel: number;
  /** Explicit per-item text style override, if any. */ textStyle?: JsonObject;
}

/** A run of same-styled visible text inside a paragraph. */
export interface TextRun {
  /** Explicit (non-inherited) text style. */ style: JsonObject;
  /** Kept-run suggestion metadata (parsed docs only). */ suggestedDeletionIds?: string[];
  /** Kept-run suggestion metadata (parsed docs only). */ suggestedInsertionIds?: string[];
  /** Per-character-range suggested style edits (parsed docs only). */ suggestedTextStyleChanges?: JsonObject;
  /** Discriminant. */ kind: "text";
  /** Run text (no atoms; a run never crosses an atom boundary). */ text: string;
}

/** Kinds of non-text inline content; each occupies exactly one JS string unit except `equation`, which keeps its raw JSON length. */
export type AtomType =
  | "autoText"
  | "columnBreak"
  | "date"
  | "equation"
  | "footnoteRef"
  | "horizontalRule"
  | "image"
  | "pageBreak"
  | "person"
  | "richLink";

/** What to send when creating a brand-new atom (never used for a kept/parsed one). */
export type AtomCreate =
  | { type: "date"; dateFormat?: string; timestamp: string }
  | { type: "image"; alt?: string; heightPt?: number; uri: string; widthPt?: number }
  | { type: "pageBreak" }
  | { type: "person"; email: string }
  | { type: "richLink"; uri: string };

/** One non-text inline element (chip, image, footnote reference, break, equation, …). */
export interface Atom {
  /** Set only for a brand-new atom the reconciler must insert. */ create?: AtomCreate;
  /** Stable key: `o<N>` if parsed from JSON, `n<N>` if created this run. */ key: string;
  /** Discriminant. */ kind: "atom";
  /** Exact JSON index-span length (1 for every kind except `equation`). */ length: number;
  /** Original JSON payload for a kept atom (omitted for `create`d ones). */ raw?: JsonObject;
  /** Explicit style, when the atom carries one (e.g. a chip's textStyle). */ style?: JsonObject;
  /** Which kind of atom this is. */ type: AtomType;
}

/** One element inside a paragraph: visible text or a non-text atom. */
export type Inline = Atom | TextRun;

/** A paragraph's trailing `\n`, kept separate from its visible content because deletes/merges can transfer it independently. */
export interface NewlineMark {
  /** Explicit style of the newline character itself. */ style: JsonObject;
  /** Kept-newline suggestion metadata. */ suggestedDeletionIds?: string[];
  /** Kept-newline suggestion metadata. */ suggestedInsertionIds?: string[];
}

/** One paragraph block (a container of inline content, one trailing newline). */
export interface ParagraphBlock {
  /** List membership, if any. */ bullet?: BulletRef;
  /** Heading id; only meaningful when `style.namedStyleType` is a heading. */ headingId?: string;
  /** Visible content in order. */ inlines: Inline[];
  /** Stable key: `o<N>` if parsed, `n<N>` if created this run. */ key: string;
  /** Discriminant. */ kind: "paragraph";
  /** The paragraph's trailing newline. */ newline: NewlineMark;
  /** Original JSON index range, when parsed from an existing doc. */ origin?: Range;
  /** IDs of positioned (floating) objects anchored to this paragraph; preserved, never created. */ positionedObjectIds?: string[];
  /** True when any run, atom, bullet, or the newline carries a live suggestion. */ protected: boolean;
  /** Which step created/last touched this paragraph, if any. */ stamp?: EditStamp;
  /** Explicit (non-inherited) paragraph style, `headingId` omitted. */ style: JsonObject;
  /** Raw suggestion payloads kept for guard/anchor detection (paragraph-level). */ suggestionsRaw?: JsonObject;
}

/** One table column's shared properties (width, etc). */
export interface ColumnModel {
  /** Stable key. */ key: string;
  /** Explicit column properties (e.g. `width`). */ props: JsonObject;
}

/** One table cell (a nested block container). */
export interface CellModel {
  /** Cell content; only paragraphs are supported (nested tables/TOC raise a parse error). */ blocks: ParagraphBlock[];
  /** Stable key. */ key: string;
  /** Original JSON index range, when parsed. */ origin?: Range;
  /** Explicit cell style. */ style: JsonObject;
}

/** One table row. */
export interface RowModel {
  /** Cells in column order. */ cells: CellModel[];
  /** Stable key. */ key: string;
  /** Original JSON index range, when parsed. */ origin?: Range;
  /** Explicit row style. */ style: JsonObject;
}

/** A table block. */
export interface TableBlock {
  /** Column definitions, one per column. */ columns: ColumnModel[];
  /** Stable key. */ key: string;
  /** Discriminant. */ kind: "table";
  /** Original JSON index range, when parsed. */ origin?: Range;
  /** True when any cell/row carries a live suggestion. */ protected: boolean;
  /** Rows in order. */ rows: RowModel[];
  /** Which step created/last touched this table, if any. */ stamp?: EditStamp;
}

/** An opaque Table of Contents block; v2 never edits its content, only preserves or deletes it whole. */
export interface TocBlock {
  /** Stable key. */ key: string;
  /** Discriminant. */ kind: "toc";
  /** Exact JSON index-span length. */ length: number;
  /** Original JSON index range. */ origin: Range;
  /** Original JSON payload (opaque). */ raw: JsonObject;
}

/** A mid-body section break (the body's leading section break is modeled as `TabModel.leadingSectionStyle`, not a block). */
export interface SectionBreakBlock {
  /** Set only for a brand-new section break the reconciler must insert. */ create?: {
    sectionType: "CONTINUOUS" | "NEXT_PAGE";
  };
  /** Stable key. */ key: string;
  /** Discriminant. */ kind: "sectionBreak";
  /** Original JSON index range, when parsed. */ origin?: Range;
  /** Explicit section style. */ sectionStyle: JsonObject;
}

/** One top-level content block inside a tab body or a table cell. */
export type Block = ParagraphBlock | SectionBreakBlock | TableBlock | TocBlock;

/** A list definition (Docs API `nestingLevels`, optionally recognized as one of the standard presets). */
export interface ListDef {
  /** True when this list was created this run (no Docs `listId` yet). */ isNew: boolean;
  /** Raw per-level definitions, as read from (or about to be written to) the Docs API. */ nestingLevels: JsonObject[];
  /** Recognized standard preset, when the glyph fields exactly match one. */ preset?: BulletPreset;
}

/** One tab's full content model. */
export interface TabModel {
  /** Top-level content blocks (document order). */ blocks: Block[];
  /** Explicit tab-level document style overrides. */ documentStyle: JsonObject;
  /** Footnote bodies, keyed by footnote id (content preserved, never edited by v2; see G3 D3). */ footnotes: Record<
    string,
    JsonObject
  >;
  /** Headers/footers, preserved verbatim (out of v2 scope; see G3 D3). */ headersFooters: JsonObject;
  /** True when this tab was created this run (no Docs `tabId` yet). */ isNew: boolean;
  /** Inline (image/drawing) object definitions, keyed by id. */ inlineObjects: Record<string, JsonObject>;
  /** The body's leading (unconditional) section break style. */ leadingSectionStyle: JsonObject;
  /** List definitions, keyed by list id (`new:list:<n>` for lists created this run). */ lists: Record<string, ListDef>;
  /** Named ranges, preserved verbatim; guard-checked, never created by v2. */ namedRanges: NamedRangeDef[];
  /** Named-style (NORMAL_TEXT, HEADING_1, …) definitions for this tab. */ namedStyles: JsonObject;
  /** Parent tab id, for nested tabs. */ parentTabId?: string;
  /** Positioned (floating) object definitions, keyed by id; preserved, never created. */ positionedObjects: Record<
    string,
    JsonObject
  >;
  /** Stable tab id (real once parsed/flushed, `new:<key>` before). */ tabId: string;
  /** Tab title. */ title: string;
}

/** One named range, kept for guard checks (v2 never creates or edits named ranges; see G3 D3). */
export interface NamedRangeDef {
  /** Human-assigned name. */ name: string;
  /** Unique identifier. */ namedRangeId: string;
  /** Disjoint index ranges this name covers, within this tab. */ ranges: Range[];
}

/** A whole document's per-run model: every tab, in depth-first order. */
export interface DocModel {
  /** Real or `new:<alias>` document id. */ docId: string;
  /** True when this document was created this run. */ isNew: boolean;
  /** Docs API revision id this model was parsed from (absent for a brand-new doc). */ revisionId?: string;
  /** The suggestions view mode the source JSON was fetched with (see G3 D37 `viewMode` guard). */ suggestionsViewMode?: string;
  /** Every tab, depth-first. */ tabs: TabModel[];
  /** Document title. */ title: string;
}

/** Where a paragraph's identity (`headingId`) moved to during reconciliation, for equivalence checks and the guard. */
export interface IdentityTransfer {
  /** Key the identity moved from (`null` when the identity is brand new). */ fromKey: string | null;
  /** The heading id that moved (or was newly minted). */ headingId: string | null;
  /** Tab the transfer happened in. */ tabId: string;
  /** Key the identity moved to (`null` when the identity was dropped entirely). */ toKey: string | null;
}
