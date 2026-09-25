/* Model editing primitives A: insert/delete blocks, splice paragraph content, and restyle text and paragraphs (G3 M6). */

import { headingStyleIs } from "./effectiveStyle.ts";
import { CoreError } from "./errors.ts";
import { containerNormalize, paragraphEmptyCreate } from "./invariants.ts";
import type { KeyAllocator } from "./keys.ts";
import type { JsonObject } from "./rawJson.ts";
import { styleCanonical, styleEqual } from "./styleValues.ts";
import { paragraphSymbols, paragraphSymbolsSet, type Sym } from "./symbols.ts";
import type {
  Atom,
  AtomCreate,
  Block,
  BulletRef,
  CellModel,
  EditStamp,
  ParagraphBlock,
  TabModel,
  Tombstone,
} from "./types.ts";

/** Per-step editing state shared by every primitive. */
export interface EditContext {
  /** Allocates keys for created blocks and atoms. */ keys: KeyAllocator;
  /** Stamp recorded on everything this step creates or touches. */ stamp: EditStamp;
  /** Receives one entry per deleted block or atom. */ tombstones: Tombstone[];
}

/** A tab being edited within one step. */
export interface EditTarget {
  /** Editing state. */ ctx: EditContext;
  /** Tab to edit in place. */ tab: TabModel;
}

/** Which block container an operation addresses: the tab body or one table cell. */
export type ContainerRef = { cellKey: string } | { kind: "body" };

/** One symbol to insert: a character run (split into code points), a new atom, or an existing atom (always refused: atoms can't move). */
export type SymSpec =
  | { atomKey: string }
  | { ch: string; style?: JsonObject }
  | { create: AtomCreate; style?: JsonObject };

/** A new paragraph's content and properties. */
export interface ParagraphSpec {
  /** List membership. */ bullet?: BulletRef;
  /** Explicit style of the trailing newline. */ newlineStyle?: JsonObject;
  /** Explicit paragraph style (`{}` = NORMAL_TEXT). */ style?: JsonObject;
  /** Visible content (explicit styles only; no neighbor inheritance). */ syms?: SymSpec[];
}

/** Where a block lives. */
export interface BlockLocation {
  /** The block. */ block: Block;
  /** Its container. */ container: ContainerRef;
  /** Its index in the container. */ index: number;
}

/** A text-style patch or filter in Docs API shape; in a patch, `null` resets a field to inherited. */
export type TextStylePatch = Record<string, unknown>;

/** The live block array of a container (a cell's paragraphs, or the tab body). */
export function containerOf(
  /** Tab to look in. */
  tab: TabModel,
  /** Container to resolve. */
  ref: ContainerRef,
): Block[] {
  if ("kind" in ref) return tab.blocks;
  const cell = cellFind(tab, ref.cellKey);
  if (!cell) throw new CoreError("internal", `no cell with key ${ref.cellKey}`);
  return cell.blocks;
}

/** Finds a block by key in the body or any table cell. */
export function blockFind(
  /** Tab to look in. */
  tab: TabModel,
  /** Block key. */
  key: string,
): BlockLocation | undefined {
  const bodyIndex = tab.blocks.findIndex((b) => b.key === key);
  if (bodyIndex >= 0) return { block: tab.blocks[bodyIndex], container: { kind: "body" }, index: bodyIndex };
  for (const block of tab.blocks) {
    if (block.kind !== "table") continue;
    for (const row of block.rows) {
      for (const cell of row.cells) {
        const index = cell.blocks.findIndex((b) => b.key === key);
        if (index >= 0) return { block: cell.blocks[index], container: { cellKey: cell.key }, index };
      }
    }
  }
  return undefined;
}

/** Inserts new paragraphs at `index` of a container and returns their keys; the container is then normalized (G3 D10). */
export function paragraphsInsert(
  /** Tab being edited. */
  target: EditTarget,
  /** Container to insert into. */
  ref: ContainerRef,
  /** Position among the container's blocks. */
  index: number,
  /** Paragraphs to create, in order. */
  specs: readonly ParagraphSpec[],
): string[] {
  const blocks = containerOf(target.tab, ref);
  if (index < 0 || index > blocks.length) throw new CoreError("internal", `insert index ${index} is out of range`);
  const created = specs.map((spec) => {
    const paragraph = paragraphEmptyCreate(target.ctx.keys, spec.style ? { ...spec.style } : {}, target.ctx.stamp);
    if (spec.bullet) paragraph.bullet = { ...spec.bullet };
    if (spec.newlineStyle) paragraph.newline = { style: styleCanonical(spec.newlineStyle) as JsonObject };
    paragraphSymbolsSet(paragraph, symbolsFromSpecs(target.ctx, spec.syms ?? [], {}));
    return paragraph;
  });
  blocks.splice(index, 0, ...created);
  containerRenormalize(target, ref);
  return created.map((p) => p.key);
}

/** Deletes blocks (anywhere in the tab), recording tombstones for them and every atom they held, then renormalizes the touched containers. */
export function blocksDelete(
  /** Tab being edited. */
  target: EditTarget,
  /** Keys of blocks to delete. */
  keys: readonly string[],
): void {
  const touched = new Map<string, ContainerRef>();
  for (const key of keys) {
    const found = blockFind(target.tab, key);
    if (!found) throw new CoreError("internal", `no block with key ${key}`);
    const blocks = containerOf(target.tab, found.container);
    blocks.splice(blocks.indexOf(found.block), 1);
    tombstonesAdd(target, found.block);
    touched.set("kind" in found.container ? "body" : found.container.cellKey, found.container);
  }
  for (const ref of touched.values()) containerRenormalize(target, ref);
}

/**
 * Replaces `deleteCount` symbols at symbol offset `at` of a paragraph with `insert`. Inserted
 * characters without an explicit style take the previous symbol's style, else the next one's,
 * else the newline's (F28); deleted atoms get tombstones. Refuses newlines (use `paragraphsInsert`),
 * page breaks (a page break is its own paragraph), existing atoms (`atomMove`), and invalid creates.
 */
export function paragraphSplice(
  /** Tab being edited. */
  target: EditTarget,
  /** Paragraph key. */
  key: string,
  /** Symbol offset. */
  at: number,
  /** Symbols to delete. */
  deleteCount: number,
  /** Symbols to insert. */
  insert: readonly SymSpec[],
): void {
  const paragraph = paragraphRequire(target.tab, key);
  const syms = paragraphSymbols(paragraph);
  if (at < 0 || deleteCount < 0 || at + deleteCount > syms.length) {
    throw new CoreError(
      "internal",
      `splice [${at}, ${at + deleteCount}) is outside the paragraph (${syms.length} symbols)`,
    );
  }
  const neighbor = syms[at - 1] ?? syms[at + deleteCount];
  const inherited = neighbor ? symStyle(neighbor) : paragraph.newline.style;
  const inserted = symbolsFromSpecs(target.ctx, insert, inherited);
  const removed = syms.splice(at, deleteCount, ...inserted);
  for (const sym of removed) {
    if (sym.kind === "atom") target.ctx.tombstones.push(tombstone(target, sym.atom.key, "atom"));
  }
  paragraphSymbolsSet(paragraph, syms);
  paragraph.stamp = target.ctx.stamp;
}

/**
 * Restyles symbols `[from, to)` of a paragraph with a Docs-shaped patch (`null` resets a field). With
 * `where`, only symbols whose explicit values equal every `where` field change. When every symbol of a
 * non-empty paragraph changes, the newline changes too (except `link`), as the API does (F10).
 */
export function textStyleUpdate(
  /** Tab being edited. */
  target: EditTarget,
  /** Paragraph key. */
  key: string,
  /** First symbol offset. */
  from: number,
  /** Exclusive end symbol offset. */
  to: number,
  /** Fields to set (`null` resets). */
  patch: TextStylePatch,
  /** Optional filter on the symbols' explicit values. */
  opts: { where?: TextStylePatch } = {},
): void {
  const paragraph = paragraphRequire(target.tab, key);
  const syms = paragraphSymbols(paragraph);
  if (from < 0 || to > syms.length || from > to) {
    throw new CoreError("internal", `style range [${from}, ${to}) is outside the paragraph (${syms.length} symbols)`);
  }
  let changedAll = syms.length > 0 && from === 0 && to === syms.length;
  for (let i = from; i < to; i++) {
    const sym = syms[i];
    if (opts.where && !styleMatches(symStyle(sym), opts.where)) {
      changedAll = false;
      continue;
    }
    if (sym.kind === "char") syms[i] = { ...sym, style: stylePatchApply(sym.style, patch) };
    else syms[i] = { atom: { ...sym.atom, style: stylePatchApply(sym.atom.style ?? {}, patch) }, kind: "atom" };
  }
  paragraphSymbolsSet(paragraph, syms);
  if (changedAll) {
    const { link: _link, ...newlinePatch } = patch;
    paragraph.newline = { ...paragraph.newline, style: stylePatchApply(paragraph.newline.style, newlinePatch) };
  }
  paragraph.stamp = target.ctx.stamp;
}

/**
 * Applies a Docs-shaped paragraph-style patch (`null` resets a field). Becoming a heading removes the
 * bullet and, coming from a non-heading, leaves `headingId` for the API to mint; leaving a heading
 * drops `headingId`; heading-to-heading keeps it (F16).
 */
export function paragraphStyleUpdate(
  /** Tab being edited. */
  target: EditTarget,
  /** Paragraph key. */
  key: string,
  /** Fields to set (`null` resets). */
  patch: JsonObject,
): void {
  if ("headingId" in patch) throw new CoreError("internal", "headingId is read-only");
  const paragraph = paragraphRequire(target.tab, key);
  const wasHeading = headingStyleIs(paragraph.style.namedStyleType as string | undefined);
  paragraph.style = stylePatchApply(paragraph.style, patch);
  const isHeading = headingStyleIs(paragraph.style.namedStyleType as string | undefined);
  if (isHeading) {
    delete paragraph.bullet;
    if (!wasHeading) delete paragraph.headingId;
  } else {
    delete paragraph.headingId;
  }
  paragraph.stamp = target.ctx.stamp;
}

/** Returns `style` with a patch applied: `null`/`undefined` values delete the field, others are canonicalized. */
export function stylePatchApply(
  /** Style to start from (not mutated). */
  style: JsonObject,
  /** Fields to set (`null` resets). */
  patch: JsonObject,
): JsonObject {
  const out = { ...style };
  for (const [field, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[field];
    else out[field] = styleCanonical(value);
  }
  return out;
}

/** Expands symbol specs into symbols (characters without an explicit style take `inherited`), validating atom creates. */
export function symbolsFromSpecs(
  /** Editing state (allocates atom keys). */
  ctx: EditContext,
  /** Specs to expand. */
  specs: readonly SymSpec[],
  /** Style for characters and atoms without an explicit one. */
  inherited: JsonObject,
): Sym[] {
  return specs.flatMap((spec) => symsFromSpec(ctx, spec, inherited));
}

/** The paragraph with `key`, or a `CoreError`. */
function paragraphRequire(tab: TabModel, key: string): ParagraphBlock {
  const found = blockFind(tab, key);
  if (found?.block.kind !== "paragraph") throw new CoreError("internal", `no paragraph with key ${key}`);
  return found.block;
}

/** Finds a table cell by key. */
function cellFind(tab: TabModel, cellKey: string): CellModel | undefined {
  for (const block of tab.blocks) {
    if (block.kind !== "table") continue;
    for (const row of block.rows) {
      const cell = row.cells.find((c) => c.key === cellKey);
      if (cell) return cell;
    }
  }
  return undefined;
}

/** Re-establishes V1/V2 for one container after an insert or delete. */
function containerRenormalize(target: EditTarget, ref: ContainerRef): void {
  if ("kind" in ref) {
    target.tab.blocks = containerNormalize(target.tab.blocks, target.ctx.keys, target.ctx.stamp);
    return;
  }
  const cell = cellFind(target.tab, ref.cellKey);
  if (cell && cell.blocks.at(-1)?.kind !== "paragraph") {
    cell.blocks.push(paragraphEmptyCreate(target.ctx.keys, undefined, target.ctx.stamp));
  }
}

/** Records tombstones for a deleted block and every atom inside it. */
function tombstonesAdd(target: EditTarget, block: Block): void {
  target.ctx.tombstones.push(tombstone(target, block.key, "block"));
  const paragraphs: ParagraphBlock[] =
    block.kind === "paragraph"
      ? [block]
      : block.kind === "table"
        ? block.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks))
        : [];
  for (const p of paragraphs) {
    for (const inline of p.inlines) {
      if (inline.kind === "atom") target.ctx.tombstones.push(tombstone(target, inline.key, "atom"));
    }
  }
}

/** One tombstone for this step and tab. */
function tombstone(target: EditTarget, key: string, kind: Tombstone["kind"]): Tombstone {
  return { key, kind, stamp: target.ctx.stamp, tabId: target.tab.tabId };
}

/** A symbol's explicit style. */
function symStyle(sym: Sym): JsonObject {
  return sym.kind === "atom" ? (sym.atom.style ?? {}) : sym.style;
}

/** Expands one spec into symbols, validating atom creates. */
function symsFromSpec(ctx: EditContext, spec: SymSpec, inherited: JsonObject): Sym[] {
  if ("atomKey" in spec) {
    throw new CoreError("atomMove", `atom ${spec.atomKey} can't be moved or re-inserted (the API can't move content)`);
  }
  if ("ch" in spec) {
    if (spec.ch.includes("\n")) throw new CoreError("internal", "a newline splits a paragraph; use paragraphsInsert");
    const style = spec.style ? (styleCanonical(spec.style) as JsonObject) : inherited;
    return Array.from(spec.ch).map((ch) => ({ ch, kind: "char", style }));
  }
  atomCreateValidate(spec.create);
  const atom: Atom = { create: spec.create, key: ctx.keys.next("n"), kind: "atom", length: 1, type: spec.create.type };
  const style = spec.style ? (styleCanonical(spec.style) as JsonObject) : inherited;
  if (Object.keys(style).length) atom.style = style;
  return [{ atom, kind: "atom" }];
}

/** Rejects creates the API would refuse (or that belong to another primitive). */
function atomCreateValidate(create: AtomCreate): void {
  const httpsIs = (uri: string) => /^https:\/\/\S+$/.test(uri);
  if (create.type === "pageBreak") {
    throw new CoreError("invalidAtom", "a page break is its own paragraph; it can't be spliced into text");
  }
  if (create.type === "person" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(create.email)) {
    throw new CoreError("invalidAtom", `person chip needs an email address, got "${create.email}"`);
  }
  if (
    create.type === "date" &&
    (!/^\d{4}-\d{2}-\d{2}/.test(create.timestamp) || Number.isNaN(Date.parse(create.timestamp)))
  ) {
    throw new CoreError("invalidAtom", `date chip needs an ISO 8601 timestamp, got "${create.timestamp}"`);
  }
  if ((create.type === "richLink" || create.type === "image") && !httpsIs(create.uri)) {
    throw new CoreError("invalidAtom", `${create.type} needs an https URL, got "${create.uri}"`);
  }
}

/** True when `style` explicitly carries every `where` value. */
function styleMatches(style: JsonObject, where: JsonObject): boolean {
  return Object.entries(where).every(([field, value]) => style[field] !== undefined && styleEqual(style[field], value));
}
