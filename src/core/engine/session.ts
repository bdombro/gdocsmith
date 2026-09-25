/* The core session: documents opened or created in one run, and the document/tab/table handles steps edit through (G3 core API, M18). */

import type { DocCache } from "~/core/cache/docCache.ts";
import type { DocsClient, DriveApi, DriveComment, DrivePermission } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { anchorResolve, paragraphText, type RangeRef, rangeResolve } from "../lens/anchors.ts";
import { type MarkdownExport, tabMarkdownExport } from "../lens/export.ts";
import { markdownPut, type Placement, type WriteReport } from "../lens/put.ts";
import { type NodeInfo, type OutlineEntry, tabNodes, tabOutline } from "../lens/query.ts";
import blankDoc from "../model/blankDoc.json";
import { blocksCopy } from "../model/copy.ts";
import {
  blockFind,
  blocksDelete,
  containerOf,
  type EditTarget,
  paragraphSplice,
  paragraphStyleUpdate,
  stylePatchApply,
  textStyleUpdate,
} from "../model/edit.ts";
import { bulletsSet } from "../model/editLists.ts";
import {
  cellStyleSet,
  cellsMerge,
  cellsUnmerge,
  columnPropsSet,
  columnsDelete,
  columnsInsert,
  headerRowsPin,
  rowStyleSet,
  rowsDelete,
  rowsInsert,
} from "../model/editTables.ts";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { paragraphEmptyCreate } from "../model/invariants.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { dimensionFromPt, PARAGRAPH_STYLE_FIELDS, TEXT_STYLE_FIELDS } from "../model/styleValues.ts";
import { paragraphSymbols } from "../model/symbols.ts";
import type { DocModel, ParagraphBlock, TableBlock, TabModel, Tombstone } from "../model/types.ts";
import { commentAnchorsMatch, docLoad } from "./load.ts";
import type {
  CellRange,
  Changed,
  DocHandle,
  PageSetupPatch,
  ParagraphStylePatch,
  PermissionInput,
  Session,
  TabHandle,
  TabInfo,
  TableHandle,
  TabPosition,
  TextStyleMatch,
  TextStylePatch,
} from "./types.ts";

/** What a session talks to. */
export interface SessionOptions {
  /** Snapshot cache. */ cache?: DocCache;
  /** Docs client. */ client: DocsClient;
  /** Drive client. */ drive: DriveApi;
}

/** Document-level changes the flush applies outside the content batch. */
export interface DocIntents {
  /** Delete or trash (last). */ lifecycle?: "delete" | "trash";
  /** Permissions to add. */ permissionsAdd: PermissionInput[];
  /** Permissions to remove. */ permissionsRemove: Array<{ email?: string; permissionId?: string }>;
  /** New title. */ title?: string;
}

/** Everything the session knows about one document. */
export interface DocState {
  /** Alias. */ alias?: string;
  /** Loaded comments (fetched lazily). */ comments?: DriveComment[];
  /** How to create it (new documents). */ create?: { from?: string; title: string };
  /** The model as edited. */ current: DocModel;
  /** Real or provisional id. */ docId: string;
  /** Changes outside the content. */ intents: DocIntents;
  /** True when created this run. */ isNew: boolean;
  /** JSON the original model was parsed from. */ json: GoogleDoc;
  /** The model as loaded. */ original: DocModel;
  /** Created-tab counter (provisional ids `new:tab:<n>`). */ tabCounter: number;
  /** Blocks and atoms deleted. */ tombstones: Tombstone[];
}

/** Page sizes in PT (portrait). */
const PAGE_SIZES: Record<NonNullable<PageSetupPatch["size"]>, { height: number; width: number }> = {
  A3: { height: 1190.55, width: 841.89 },
  A4: { height: 841.89, width: 595.28 },
  A5: { height: 595.28, width: 419.53 },
  LEGAL: { height: 1008, width: 612 },
  LETTER: { height: 792, width: 612 },
  TABLOID: { height: 1224, width: 792 },
};

/** One run's session: documents in, handles out; nothing is sent until the flush. */
export class CoreSession implements Session {
  /** Documents by id. */ readonly docs = new Map<string, DocState>();
  /** Keys for every model in the run. */ readonly keys = new KeyAllocator();
  /** Clients. */ readonly opts: SessionOptions;
  /** The current step. */ stepIndex = 0;
  /** Per-step `force`. */ readonly stepForces = new Map<number, boolean>();

  constructor(
    /** Clients and cache. */
    opts: SessionOptions,
  ) {
    this.opts = opts;
  }

  /** Opens a document (once per run; reopening returns the same state). */
  async docOpen(docId: string, o: { alias?: string; forceFetch?: boolean } = {}): Promise<DocHandle> {
    const existing = this.docs.get(docId);
    if (existing) return new DocHandleImpl(this, existing);
    const loaded = await docLoad(docId, {
      cache: this.opts.cache,
      client: this.opts.client,
      forceFetch: o.forceFetch,
      keys: this.keys,
    });
    const state: DocState = {
      alias: o.alias,
      current: structuredClone(loaded.model),
      docId,
      intents: { permissionsAdd: [], permissionsRemove: [] },
      isNew: false,
      json: loaded.json,
      original: loaded.model,
      tabCounter: 0,
      tombstones: [],
    };
    this.docs.set(docId, state);
    return new DocHandleImpl(this, state);
  }

  /** Creates a document: blank, or a copy of `from` as it was loaded (a Drive copy made before any content lands). */
  async docCreate(o: { alias: string; from?: DocHandle; title: string }): Promise<DocHandle> {
    const docId = `new:${o.alias}`;
    if (this.docs.has(docId)) throw new CoreError("internal", `alias "${o.alias}" is already used`);
    const source = o.from ? this.docs.get(o.from.docId) : undefined;
    if (o.from && (!source || source.isNew))
      throw new CoreError("internal", "a document can only be copied from one opened in this run");
    const json = structuredClone(source ? source.json : (blankDoc as unknown as GoogleDoc)) as GoogleDoc;
    (json as unknown as JsonObject).title = o.title;
    const original = { ...docModelParse(json, { docId, keys: this.keys }), isNew: true };
    const state: DocState = {
      alias: o.alias,
      create: { from: source?.docId, title: o.title },
      current: structuredClone(original),
      docId,
      intents: { permissionsAdd: [], permissionsRemove: [] },
      isNew: true,
      json,
      original,
      tabCounter: 0,
      tombstones: [],
    };
    this.docs.set(docId, state);
    return new DocHandleImpl(this, state);
  }

  /** Starts a step. */
  stepBegin(stepIndex: number, o: { force?: boolean } = {}): void {
    this.stepIndex = stepIndex;
    this.stepForces.set(stepIndex, !!o.force);
  }

  /** Whether step `i` passed `force`. */
  stepForce(i: number): boolean {
    return this.stepForces.get(i) ?? false;
  }

  /** An edit target for a tab of a document, stamped with the current step. */
  target(state: DocState, tab: TabModel): EditTarget {
    return {
      ctx: {
        keys: this.keys,
        stamp: { force: this.stepForce(this.stepIndex), stepIndex: this.stepIndex },
        tombstones: state.tombstones,
      },
      tab,
    };
  }

  /** Loads a document's comments once (existing documents only). */
  async commentsFor(state: DocState): Promise<DriveComment[]> {
    if (state.isNew) return [];
    state.comments ??= await this.opts.drive.commentsList(state.docId);
    return state.comments;
  }
}

/** A document handle. */
class DocHandleImpl implements DocHandle {
  readonly alias?: string;
  readonly docId: string;
  readonly isNew: boolean;

  constructor(
    private readonly session: CoreSession,
    private readonly state: DocState,
  ) {
    this.alias = state.alias;
    this.docId = state.docId;
    this.isNew = state.isNew;
  }

  lifecycle(action: "delete" | "trash"): Changed {
    const changed = this.state.intents.lifecycle !== action;
    this.state.intents.lifecycle = action;
    return { changed };
  }

  permissionAdd(p: PermissionInput): Changed {
    this.state.intents.permissionsAdd.push(p);
    return { changed: true };
  }

  async permissionList(): Promise<DrivePermission[]> {
    const current = this.isNew ? [] : await this.session.opts.drive.listPermissions(this.docId);
    const removed = this.state.intents.permissionsRemove;
    const kept = current.filter(
      (p) =>
        !removed.some(
          (r) => r.permissionId === p.id || (r.email && r.email === (p as { emailAddress?: string }).emailAddress),
        ),
    );
    const pending = this.state.intents.permissionsAdd.map(
      (p, i) => ({ ...p, id: `pending:${i + 1}` }) as unknown as DrivePermission,
    );
    return [...kept, ...pending];
  }

  permissionRemove(p: { email?: string; permissionId?: string }): Changed {
    this.state.intents.permissionsRemove.push(p);
    return { changed: true };
  }

  rename(title: string): Changed {
    if (this.title() === title) return { changed: false };
    this.state.intents.title = title;
    this.state.current.title = title;
    return { changed: true };
  }

  tab(ref?: string): TabHandle {
    return new TabHandleImpl(this.session, this.state, tabResolveRef(this.state.current, ref).tabId);
  }

  tabCreate(o: { from?: TabHandle; parentTab?: string; position?: TabPosition; title: string }): TabHandle {
    const doc = this.state.current;
    if (doc.tabs.some((t) => t.title.trim().toLowerCase() === o.title.trim().toLowerCase())) {
      throw new CoreError("tabTitleTaken", `a tab titled "${o.title}" already exists`);
    }
    const parentTabId = o.parentTab ? tabResolveRef(doc, o.parentTab).tabId : undefined;
    this.state.tabCounter++;
    const tabId = `new:tab:${this.state.tabCounter}`;
    const keys = this.session.keys;
    const tab: TabModel = {
      blocks: [
        paragraphEmptyCreate(
          keys,
          {},
          { force: this.session.stepForce(this.session.stepIndex), stepIndex: this.session.stepIndex },
        ),
      ],
      documentStyle: structuredClone(doc.tabs[0]?.documentStyle ?? {}),
      footnotes: {},
      headersFooters: {},
      inlineObjects: {},
      isNew: true,
      leadingSectionStyle: structuredClone(doc.tabs[0]?.leadingSectionStyle ?? {}),
      lists: {},
      namedRanges: [],
      namedStyles: structuredClone(doc.tabs[0]?.namedStyles ?? {}),
      parentTabId,
      positionedObjects: {},
      tabId,
      title: o.title,
    };
    tabInsert(doc, tab, o.position);
    if (o.from) {
      const fromHandle = o.from as TabHandleImpl;
      const source = fromHandle.model();
      const blank = tab.blocks[0].key;
      const target = this.session.target(this.state, tab);
      blocksCopy(
        { doc: fromHandle.docModel(), keys: source.blocks.map((b) => b.key), tab: source },
        target,
        { kind: "body" },
        0,
        { force: false, targetDocId: this.docId },
      );
      blocksDelete(target, [blank]);
    }
    return new TabHandleImpl(this.session, this.state, tabId);
  }

  tabs(): TabInfo[] {
    return this.state.current.tabs.map((t) => ({ parentTabId: t.parentTabId, tabId: t.tabId, title: t.title }));
  }

  title(): string {
    return this.state.current.title;
  }
}

/** A tab handle. */
class TabHandleImpl implements TabHandle {
  constructor(
    private readonly session: CoreSession,
    private readonly state: DocState,
    readonly tabId: string,
  ) {}

  /** The tab's current model. */
  model(): TabModel {
    const tab = this.state.current.tabs.find((t) => t.tabId === this.tabId);
    if (!tab) throw new CoreError("tabNotFound", `tab ${this.tabId} no longer exists`);
    return tab;
  }

  /** The document's current model. */
  docModel(): DocModel {
    return this.state.current;
  }

  bulletsSet(
    range: RangeRef,
    spec: { kind: "bullet" | "check" | "number"; preset?: import("../model/types.ts").BulletPreset } | null,
  ): Changed {
    return this.changes(() => bulletsSet(this.target(), this.paragraphKeys(range), spec));
  }

  async copyFrom(
    src: { range: RangeRef; tab: TabHandle },
    placement: Placement,
    o: { force?: boolean } = {},
  ): Promise<WriteReport> {
    const source = src.tab as TabHandleImpl;
    const sourceTab = source.model();
    const r = rangeResolve(sourceTab, src.range);
    const keys = containerOf(sourceTab, r.containerRef)
      .slice(r.from, r.to)
      .map((b) => b.key);
    const before = JSON.stringify(this.model());
    const { at, ref } = this.placementIndex(placement);
    const result = blocksCopy({ doc: source.docModel(), keys, tab: sourceTab }, this.target(), ref, at, {
      force: !!o.force,
      targetDocId: this.state.docId,
    });
    return { changed: before !== JSON.stringify(this.model()), createdKeys: result.keys, notes: result.notes };
  }

  delete(): Changed {
    const doc = this.state.current;
    const doomed = new Set([this.tabId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of doc.tabs)
        if (t.parentTabId && doomed.has(t.parentTabId) && !doomed.has(t.tabId))
          grew = doomed.add(t.tabId) !== undefined;
    }
    doc.tabs = doc.tabs.filter((t) => !doomed.has(t.tabId));
    return { changed: true };
  }

  editText(
    find: string | RegExp,
    replace: string,
    o: { matchCase?: boolean; range?: RangeRef } = {},
  ): Changed & { count: number } {
    let count = 0;
    const changed = this.changes(() => {
      const pattern =
        typeof find === "string"
          ? new RegExp(escapeRegExp(find), o.matchCase === false ? "gi" : "g")
          : new RegExp(find.source, find.flags.includes("g") ? find.flags : `${find.flags}g`);
      for (const key of this.paragraphKeys(o.range ?? { kind: "tab" }, true)) {
        const p = blockFind(this.model(), key)?.block as ParagraphBlock;
        const text = paragraphText(p);
        const matches = [...text.matchAll(pattern)].filter((m) => m[0] && !m[0].includes("￼"));
        for (const m of matches.reverse()) {
          const from = symbolIndex(p, m.index ?? 0);
          const to = symbolIndex(p, (m.index ?? 0) + m[0].length);
          const first = paragraphSymbols(p)[from];
          const style = first?.kind === "char" ? first.style : undefined;
          paragraphSplice(this.target(), key, from, to - from, replace ? [{ ch: replace, style }] : []);
          count++;
        }
      }
    });
    return { changed: changed.changed, count };
  }

  markdown(o: { range?: RangeRef; skipFrontmatter?: boolean } = {}): MarkdownExport {
    const tab = this.model();
    return tabMarkdownExport(this.state.current, tab, rangeResolve(tab, o.range ?? { kind: "tab" }), {
      skipFrontmatter: o.skipFrontmatter,
    });
  }

  move(p: TabPosition): Changed {
    const doc = this.state.current;
    const before = doc.tabs.map((t) => t.tabId).join();
    const tab = this.model();
    doc.tabs = doc.tabs.filter((t) => t !== tab);
    tabInsert(doc, tab, p);
    return { changed: before !== doc.tabs.map((t) => t.tabId).join() };
  }

  nodes(o: { includeCells?: boolean; range?: RangeRef } = {}): NodeInfo[] {
    const tab = this.model();
    return tabNodes(tab, o, nodeContext(this.session, this.state, tab));
  }

  outline(): OutlineEntry[] {
    return tabOutline(this.model());
  }

  pageSetupSet(p: PageSetupPatch): Changed {
    return this.changes(() => {
      const tab = this.model();
      const style: JsonObject = { ...tab.documentStyle };
      if (p.pageless !== undefined)
        style.documentFormat = {
          ...((style.documentFormat as JsonObject | undefined) ?? {}),
          documentMode: p.pageless ? "PAGELESS" : "PAGES",
        };
      let size = p.size
        ? PAGE_SIZES[p.size]
        : p.widthPt && p.heightPt
          ? { height: p.heightPt, width: p.widthPt }
          : undefined;
      if (p.orientation) {
        const current = size ?? {
          height:
            ((style.pageSize as JsonObject | undefined)?.height as { magnitude?: number } | undefined)?.magnitude ??
            792,
          width:
            ((style.pageSize as JsonObject | undefined)?.width as { magnitude?: number } | undefined)?.magnitude ?? 612,
        };
        const landscape = current.width > current.height;
        size =
          (p.orientation === "LANDSCAPE") === landscape ? current : { height: current.width, width: current.height };
      }
      if (size) style.pageSize = { height: dimensionFromPt(size.height), width: dimensionFromPt(size.width) };
      for (const [side, value] of Object.entries(p.margins ?? {})) {
        if (value !== undefined) style[`margin${side[0].toUpperCase()}${side.slice(1)}`] = dimensionFromPt(value);
      }
      tab.documentStyle = style;
    });
  }

  paragraphStyleSet(range: RangeRef, patch: ParagraphStylePatch | "clear"): Changed {
    const resolved: JsonObject =
      patch === "clear"
        ? Object.fromEntries(PARAGRAPH_STYLE_FIELDS.filter((f) => f !== "namedStyleType").map((f) => [f, null]))
        : patch;
    return this.changes(() => {
      for (const key of this.paragraphKeys(range, true)) paragraphStyleUpdate(this.target(), key, resolved);
    });
  }

  remove(range: RangeRef): Changed {
    const tab = this.model();
    const r = rangeResolve(tab, range);
    const keys = containerOf(tab, r.containerRef)
      .slice(r.from, r.to)
      .map((b) => b.key);
    return this.changes(() => {
      if (keys.length) blocksDelete(this.target(), keys);
    });
  }

  rename(title: string): Changed {
    const tab = this.model();
    if (tab.title === title) return { changed: false };
    if (this.state.current.tabs.some((t) => t !== tab && t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
      throw new CoreError("tabTitleTaken", `a tab titled "${title}" already exists`);
    }
    tab.title = title;
    return { changed: true };
  }

  sectionStyleSet(anchor: string, patch: JsonObject): Changed {
    return this.changes(() => {
      const tab = this.model();
      const target = anchorResolve(tab, anchor);
      const block = tab.blocks.find((b) => b.key === target.key);
      if (block?.kind !== "sectionBreak") throw new CoreError("anchorNotFound", `"${anchor}" isn't a section break`);
      block.sectionStyle = stylePatchApply(block.sectionStyle, patch);
    });
  }

  table(anchor: string): TableHandle {
    const tab = this.model();
    const target = anchorResolve(tab, anchor);
    const block = tab.blocks.find((b) => b.key === target.key);
    if (block?.kind !== "table") throw new CoreError("anchorNotFound", `"${anchor}" isn't a table`);
    return new TableHandleImpl(this, block.key);
  }

  textStyleSet(
    range: RangeRef,
    patch: TextStylePatch | "clear",
    o: { match?: { occurrence?: number; text: string }; where?: TextStyleMatch } = {},
  ): Changed {
    const resolved: JsonObject =
      patch === "clear"
        ? Object.fromEntries(TEXT_STYLE_FIELDS.filter((f) => f !== "link").map((f) => [f, null]))
        : patch;
    return this.changes(() => {
      let seen = 0;
      for (const key of this.paragraphKeys(range, true)) {
        const p = blockFind(this.model(), key)?.block as ParagraphBlock;
        const symbols = paragraphSymbols(p).length;
        if (!o.match) {
          if (symbols) textStyleUpdate(this.target(), key, 0, symbols, resolved, { where: o.where });
          continue;
        }
        const text = paragraphText(p);
        for (let at = text.indexOf(o.match.text); at >= 0; at = text.indexOf(o.match.text, at + 1)) {
          seen++;
          if (o.match.occurrence !== undefined && seen !== o.match.occurrence) continue;
          textStyleUpdate(this.target(), key, symbolIndex(p, at), symbolIndex(p, at + o.match.text.length), resolved, {
            where: o.where,
          });
        }
      }
      if (o.match && !seen) throw new CoreError("anchorNotFound", `"${o.match.text}" doesn't occur in that range`);
    });
  }

  async writeMarkdown(md: string, placement: Placement, o: { h1IsTitle?: boolean } = {}): Promise<WriteReport> {
    const weight = await this.anchorWeights();
    return markdownPut(this.target(), this.state.current, placement, md, {
      anchorWeight: weight,
      h1IsTitle: o.h1IsTitle,
    });
  }

  /** An edit target for this tab. */
  target(): EditTarget {
    return this.session.target(this.state, this.model());
  }

  /** Runs `fn` and reports whether the tab (or the document's tab list) changed. */
  changes(fn: () => void): Changed {
    const before = JSON.stringify(this.state.current.tabs);
    fn();
    return { changed: before !== JSON.stringify(this.state.current.tabs) };
  }

  /** Keys of the paragraphs a range covers (with `deep`, including those in its tables' cells). */
  paragraphKeys(range: RangeRef, deep = false): string[] {
    const tab = this.model();
    const r = rangeResolve(tab, range);
    const blocks = containerOf(tab, r.containerRef).slice(r.from, r.to);
    return blocks.flatMap((b): string[] => {
      if (b.kind === "paragraph") return [b.key];
      if (deep && b.kind === "table")
        return b.rows.flatMap((row) => row.cells.flatMap((c) => c.blocks.map((p) => p.key)));
      return [];
    });
  }

  /** Where a placement puts new blocks. */
  placementIndex(placement: Placement): { at: number; ref: import("../model/edit.ts").ContainerRef } {
    const tab = this.model();
    if (placement.kind === "append") return { at: tab.blocks.length, ref: { kind: "body" } };
    if (placement.kind === "insert") {
      const target = anchorResolve(tab, placement.anchor);
      const i = tab.blocks.findIndex((b) => b.key === target.key);
      if (i < 0) throw new CoreError("invalidPlacement", "insert next to a top-level block");
      return { at: placement.position === "after" ? i + 1 : i, ref: { kind: "body" } };
    }
    const r = rangeResolve(tab, placement.range);
    const keys = containerOf(tab, r.containerRef)
      .slice(r.from, r.to)
      .map((b) => b.key);
    if (keys.length) blocksDelete(this.target(), keys);
    return { at: r.from, ref: r.containerRef };
  }

  /** Anchor weights for markdown write-back: commented, suggestion-bearing, and linked blocks win ties. */
  async anchorWeights(): Promise<(key: string) => number> {
    const tab = this.model();
    const context = nodeContext(this.session, this.state, tab);
    const heavy = new Set<string>([...(context.commented ?? [])]);
    for (const b of tab.blocks) {
      if ((b.kind === "paragraph" || b.kind === "table") && b.protected) heavy.add(b.key);
      if (b.kind === "paragraph" && b.headingId && context.linkedHeadingIds?.has(b.headingId)) heavy.add(b.key);
    }
    return (key) => (heavy.has(key) ? 1 : 0);
  }
}

/** A table handle. */
class TableHandleImpl implements TableHandle {
  constructor(
    private readonly tab: TabHandleImpl,
    private readonly key: string,
  ) {}

  cellStyleSet(r: CellRange, patch: JsonObject): Changed {
    return this.tab.changes(() => cellStyleSet(this.tab.target(), this.key, r, patch));
  }

  cellsMerge(r: CellRange): Changed {
    return this.tab.changes(() => cellsMerge(this.tab.target(), this.key, r));
  }

  cellsUnmerge(r: CellRange): Changed {
    return this.tab.changes(() => cellsUnmerge(this.tab.target(), this.key, r));
  }

  columnsDelete(cols: number[]): Changed {
    return this.tab.changes(() => columnsDelete(this.tab.target(), this.key, cols));
  }

  columnsInsert(at: number, count: number): Changed {
    return this.tab.changes(() => columnsInsert(this.tab.target(), this.key, at, count));
  }

  columnWidthsSet(w: Array<{ col: number; widthPt: number | null }>): Changed {
    return this.tab.changes(() => {
      for (const { col, widthPt } of w) {
        columnPropsSet(
          this.tab.target(),
          this.key,
          col,
          widthPt === null
            ? { width: null, widthType: "EVENLY_DISTRIBUTED" }
            : { width: dimensionFromPt(widthPt), widthType: "FIXED_WIDTH" },
        );
      }
    });
  }

  headerRowsPin(n: number): Changed {
    return this.tab.changes(() => headerRowsPin(this.tab.target(), this.key, n));
  }

  rowsDelete(rows: number[]): Changed {
    return this.tab.changes(() => rowsDelete(this.tab.target(), this.key, rows));
  }

  rowsInsert(at: number, count: number, cells?: string[][]): Changed {
    return this.tab.changes(() => {
      const keys = rowsInsert(this.tab.target(), this.key, at, count);
      if (!cells) return;
      const table = blockFind(this.tab.model(), this.key)?.block as TableBlock;
      keys.forEach((rowKey, i) => {
        const row = table.rows.find((r) => r.key === rowKey);
        row?.cells.forEach((cell, c) => {
          const text = cells[i]?.[c];
          if (text) paragraphSplice(this.tab.target(), cell.blocks[0].key, 0, 0, [{ ch: text }]);
        });
      });
    });
  }

  rowStyleSet(rows: number[], patch: JsonObject): Changed {
    return this.tab.changes(() => rowStyleSet(this.tab.target(), this.key, rows, patch));
  }
}

/** A tab by id or unique (trimmed, case-insensitive) title; omitted means the only tab. */
function tabResolveRef(doc: DocModel, ref: string | undefined): TabModel {
  if (ref === undefined) {
    if (doc.tabs.length === 1) return doc.tabs[0];
    throw new CoreError(
      "tabRequired",
      `this document has ${doc.tabs.length} tabs; name one: ${doc.tabs.map((t) => `"${t.title}"`).join(", ")}`,
    );
  }
  const byId = doc.tabs.find((t) => t.tabId === ref);
  if (byId) return byId;
  const wanted = ref.trim().toLowerCase();
  const byTitle = doc.tabs.filter((t) => t.title.trim().toLowerCase() === wanted);
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1)
    throw new CoreError("tabRequired", `${byTitle.length} tabs are titled "${ref}"; use a tab id`);
  throw new CoreError("tabNotFound", `no tab "${ref}" (tabs: ${doc.tabs.map((t) => `"${t.title}"`).join(", ")})`);
}

/** Inserts a tab (and keeps DFS order) at a position among its siblings. */
function tabInsert(doc: DocModel, tab: TabModel, position: TabPosition | undefined): void {
  const siblings = doc.tabs.filter((t) => t.parentTabId === tab.parentTabId);
  let index = siblings.length;
  if (position && "index" in position) index = Math.max(0, Math.min(position.index, siblings.length));
  else if (position) {
    const ref = tabResolveRef(doc, "afterTab" in position ? position.afterTab : position.beforeTab);
    const at = siblings.indexOf(ref);
    if (at < 0) throw new CoreError("invalidPlacement", `"${ref.title}" isn't a sibling of that tab`);
    index = "afterTab" in position ? at + 1 : at;
  }
  const subtreeEnd = (t: TabModel) => {
    let end = doc.tabs.indexOf(t) + 1;
    const inSubtree = (x: TabModel): boolean =>
      !!x.parentTabId &&
      (x.parentTabId === t.tabId || inSubtree(doc.tabs.find((y) => y.tabId === x.parentTabId) as TabModel));
    while (end < doc.tabs.length && inSubtree(doc.tabs[end])) end++;
    return end;
  };
  let at: number;
  if (index < siblings.length) at = doc.tabs.indexOf(siblings[index]);
  else if (siblings.length) at = subtreeEnd(siblings[siblings.length - 1]);
  else
    at = tab.parentTabId ? subtreeEnd(doc.tabs.find((t) => t.tabId === tab.parentTabId) as TabModel) : doc.tabs.length;
  doc.tabs.splice(at, 0, tab);
}

/** Flags from outside the tab: commented blocks (if comments are loaded), inbound-linked headings (across loaded documents), named-range blocks. */
function nodeContext(session: CoreSession, state: DocState, tab: TabModel) {
  const commented = new Set<string>();
  if (state.comments) {
    const originalTab = state.original.tabs.find((t) => t.tabId === tab.tabId);
    for (const anchor of commentAnchorsMatch(state.original, state.comments)) {
      for (const o of anchor.occurrences.filter((x) => x.tabId === tab.tabId)) {
        for (const b of originalTab?.blocks ?? [])
          if (b.origin && b.origin.start < o.range.end && b.origin.end > o.range.start) commented.add(b.key);
      }
    }
  }
  const linkedHeadingIds = new Set<string>();
  for (const doc of session.docs.values()) {
    for (const t of doc.original.tabs) {
      for (const b of t.blocks) {
        if (b.kind !== "paragraph") continue;
        for (const inline of b.inlines) {
          const heading = (inline.style?.link as JsonObject | undefined)?.heading as { id?: string } | undefined;
          if (heading?.id) linkedHeadingIds.add(heading.id);
        }
      }
    }
  }
  const namedRangeKeys = new Set<string>();
  for (const range of tab.namedRanges) {
    for (const r of range.ranges)
      for (const b of tab.blocks)
        if (b.origin && b.origin.start < r.end && b.origin.end > r.start) namedRangeKeys.add(b.key);
  }
  return { commented, linkedHeadingIds, namedRangeKeys };
}

/** The symbol index at a UTF-16 offset of a paragraph's text. */
function symbolIndex(p: ParagraphBlock, offset: number): number {
  let units = 0;
  const syms = paragraphSymbols(p);
  for (let i = 0; i < syms.length; i++) {
    if (units >= offset) return i;
    const s = syms[i];
    units += s.kind === "atom" ? 1 : s.ch.length;
  }
  return syms.length;
}

/** Escapes a string for use in a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
