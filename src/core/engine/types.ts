/* The core API the step layer calls: sessions, document/tab/table handles, and their value types (G3 core API, X2–X5, M18). */

import type { DrivePermission, DrivePermissionInput } from "~/core/gws.ts";
import type { RangeRef } from "../lens/anchors.ts";
import type { MarkdownExport } from "../lens/export.ts";
import type { Placement, WriteReport } from "../lens/put.ts";
import type { NodeInfo, OutlineEntry } from "../lens/query.ts";
import type { JsonObject } from "../model/rawJson.ts";
import type { BulletPreset } from "../model/types.ts";

export { CoreError, type CoreErrorCode } from "../model/errors.ts";
export type { MarkdownExport, NodeInfo, OutlineEntry, Placement, RangeRef, WriteReport };

/** Result of a mutating call: whether the model changed. */
export interface Changed {
  /** True iff the model changed (X4a). */ changed: boolean;
}

/** Where a tab goes among its siblings. */
export type TabPosition = { afterTab: string } | { beforeTab: string } | { index: number };

/** One tab of a document. */
export interface TabInfo {
  /** Parent tab id. */ parentTabId?: string;
  /** Tab id (provisional `new:tab:<n>` until created). */ tabId: string;
  /** Title. */ title: string;
}

/** A rectangle of table cells. */
export interface CellRange {
  /** Top-left column. */ column: number;
  /** Columns (default 1). */ columnSpan?: number;
  /** Top-left row. */ row: number;
  /** Rows (default 1). */ rowSpan?: number;
}

/** Run filter for `textStyleSet`: every set field must equal the run's explicit value (Docs API form; colors compared as colors). */
export type TextStyleMatch = JsonObject;

/** A text-style patch in Docs API form; `null` resets a field. */
export type TextStylePatch = JsonObject;

/** A paragraph-style patch in Docs API form; `null` resets a field. */
export type ParagraphStylePatch = JsonObject;

/** Page setup for a tab. */
export interface PageSetupPatch {
  /** Custom page height (PT, with width). */ heightPt?: number;
  /** Margins (PT). */ margins?: { bottom?: number; left?: number; right?: number; top?: number };
  /** Orientation. */ orientation?: "LANDSCAPE" | "PORTRAIT";
  /** Pageless (true) or pages (false). */ pageless?: boolean;
  /** Paper size. */ size?: "A3" | "A4" | "A5" | "LEGAL" | "LETTER" | "TABLOID";
  /** Custom page width (PT, with height). */ widthPt?: number;
}

/** A Drive permission to add. */
export type PermissionInput = DrivePermissionInput;

/** One run's core session. */
export interface Session {
  /** Creates a document (blank, or a copy of `from`). */
  docCreate(o: { alias: string; from?: DocHandle; title: string }): Promise<DocHandle>;
  /** Opens a document (once per run; later calls return the same handle). */
  docOpen(docId: string, o?: { alias?: string; forceFetch?: boolean }): Promise<DocHandle>;
  /** Marks the start of a step: its index stamps everything it changes; `force` waives the guard findings it causes. */
  stepBegin(stepIndex: number, o?: { force?: boolean }): void;
}

/** A document in the session. */
export interface DocHandle {
  /** Alias given at open/create. */ readonly alias?: string;
  /** Real id, or `new:<alias>`. */ readonly docId: string;
  /** True when created this run. */ readonly isNew: boolean;
  /** Deletes or trashes the document (last phase). */ lifecycle(action: "delete" | "trash"): Changed;
  /** Adds a Drive permission (last phase). */ permissionAdd(p: PermissionInput): Changed;
  /** Lists current permissions (with this run's pending changes). */ permissionList(): Promise<DrivePermission[]>;
  /** Removes a Drive permission (last phase). */ permissionRemove(p: {
    email?: string;
    permissionId?: string;
  }): Changed;
  /** Renames the document. */ rename(title: string): Changed;
  /** A tab by id or unique title; omitted means the only tab. */ tab(ref?: string): TabHandle;
  /** Creates a tab (optionally seeded with a copy of another tab's content). */ tabCreate(o: {
    from?: TabHandle;
    parentTab?: string;
    position?: TabPosition;
    title: string;
  }): TabHandle;
  /** The document's tabs, in order. */ tabs(): TabInfo[];
  /** The document's title. */ title(): string;
}

/** A tab in the session. */
export interface TabHandle {
  /** Tab id (provisional until created). */ readonly tabId: string;
  /** Bullets (or, with `null`, unbullets) the paragraphs of a range. */ bulletsSet(
    range: RangeRef,
    spec: { kind: "bullet" | "check" | "number"; preset?: BulletPreset } | null,
  ): Changed;
  /** Copies another tab's range here. */ copyFrom(
    src: { range: RangeRef; tab: TabHandle },
    placement: Placement,
    o?: { force?: boolean },
  ): Promise<WriteReport>;
  /** Deletes the tab. */ delete(): Changed;
  /** Replaces text (visible text only; atoms untouched). */ editText(
    find: string | RegExp,
    replace: string,
    o?: { matchCase?: boolean; range?: RangeRef },
  ): Changed & { count: number };
  /** Exports markdown. */ markdown(o?: { range?: RangeRef; skipFrontmatter?: boolean }): MarkdownExport;
  /** Moves the tab among its siblings. */ move(p: TabPosition): Changed;
  /** Node summaries. */ nodes(o?: { includeCells?: boolean; range?: RangeRef }): NodeInfo[];
  /** Heading outline. */ outline(): OutlineEntry[];
  /** Sets page setup. */ pageSetupSet(p: PageSetupPatch): Changed;
  /** Sets (or, with "clear", resets) paragraph style over a range. */ paragraphStyleSet(
    range: RangeRef,
    patch: ParagraphStylePatch | "clear",
  ): Changed;
  /** Deletes a range. */ remove(range: RangeRef): Changed;
  /** Renames the tab. */ rename(title: string): Changed;
  /** Patches a section break's style. */ sectionStyleSet(anchor: string, patch: JsonObject): Changed;
  /** A table by anchor. */ table(anchor: string): TableHandle;
  /** Sets (or, with "clear", resets) text style over a range, optionally only on text matches or runs matching `where` (X4b). */ textStyleSet(
    range: RangeRef,
    patch: TextStylePatch | "clear",
    o?: { match?: { occurrence?: number; text: string }; where?: TextStyleMatch },
  ): Changed;
  /** Writes markdown. */ writeMarkdown(
    md: string,
    placement: Placement,
    o?: { h1IsTitle?: boolean },
  ): Promise<WriteReport>;
}

/** A table in the session. */
export interface TableHandle {
  /** Patches cell style over a rectangle. */ cellStyleSet(r: CellRange, patch: JsonObject): Changed;
  /** Merges a rectangle (other cells must be blank). */ cellsMerge(r: CellRange): Changed;
  /** Unmerges a merged cell. */ cellsUnmerge(r: CellRange): Changed;
  /** Deletes columns. */ columnsDelete(cols: number[]): Changed;
  /** Inserts columns. */ columnsInsert(at: number, count: number): Changed;
  /** Sets column widths (`null` = even). */ columnWidthsSet(
    w: Array<{ col: number; widthPt: number | null }>,
  ): Changed;
  /** Pins header rows. */ headerRowsPin(n: number): Changed;
  /** Deletes rows. */ rowsDelete(rows: number[]): Changed;
  /** Inserts rows, optionally filling cells with inline markdown. */ rowsInsert(
    at: number,
    count: number,
    cells?: string[][],
  ): Changed;
  /** Patches row styles. */ rowStyleSet(rows: number[], patch: JsonObject): Changed;
}
