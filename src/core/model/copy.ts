/* Copies blocks between tabs or documents with flattened styles and recreated atoms, and assigns one paragraph's content onto another (G3 M8). */

import { diffHunks } from "../diff/myers.ts";
import {
  blockFind,
  type ContainerRef,
  containerOf,
  type EditTarget,
  paragraphSplice,
  type SymSpec,
  symbolsFromSpecs,
} from "./edit.ts";
import { paragraphStyleEffective, textStyleEffective } from "./effectiveStyle.ts";
import { CoreError } from "./errors.ts";
import { containerNormalize, paragraphEmptyCreate } from "./invariants.ts";
import { LIST_DEFAULT_PRESET, listKind, listPresetTable } from "./lists.ts";
import type { JsonObject } from "./rawJson.ts";
import { PARAGRAPH_STYLE_FIELDS, styleCanonical, styleEqual, TEXT_STYLE_FIELDS } from "./styleValues.ts";
import { paragraphSymbols, paragraphSymbolsSet, type Sym, symbolId } from "./symbols.ts";
import type {
  Atom,
  AtomCreate,
  Block,
  CellModel,
  DocModel,
  Inline,
  ParagraphBlock,
  TableBlock,
  TabModel,
} from "./types.ts";

/** What to copy: blocks (by key, in order) of one tab. */
export interface CopySource {
  /** Source document (for cross-document links). */ doc: DocModel;
  /** Block keys, in order. */ keys: readonly string[];
  /** Source tab. */ tab: TabModel;
}

/** Result of a copy. */
export interface CopyResult {
  /** Keys of the created blocks (not counting normalization paragraphs). */ keys: string[];
  /** Human-readable notes about lossy conversions. */ notes: string[];
}

/**
 * Copies source blocks into a container at `index`. Styles are flattened (each created paragraph and
 * run carries the minimum explicit style that makes it look as it did in the source); chips and
 * public images become creates; each contiguous source list run becomes a new list; links to headings
 * copied in the same call become pending links to the copies (other same-document links are kept,
 * cross-document ones become Docs URLs). Things the API can't recreate (equations, rules, footnote
 * references, drawings, Drive-only images, TOCs, section breaks, …) raise `unrecreatableCopy`
 * unless `force`, which drops them with a note.
 */
export function blocksCopy(
  /** What to copy. */
  source: CopySource,
  /** Tab being edited. */
  target: EditTarget,
  /** Container to insert into. */
  ref: ContainerRef,
  /** Position among the container's blocks. */
  index: number,
  /** `force` drops what can't be recreated instead of refusing. */
  opts: { force: boolean; targetDocId: string },
): CopyResult {
  const state: CopyState = {
    headingKeys: new Map(),
    listMap: new Map(),
    notes: [],
    opts,
    prevListId: undefined,
    source,
    target,
  };
  const created: Block[] = [];
  for (const key of source.keys) {
    const found = blockFind(source.tab, key);
    if (!found) throw new CoreError("internal", `no source block with key ${key}`);
    const block = found.block;
    if (block.kind === "paragraph") {
      const copy = paragraphCopy(state, block);
      if (copy) created.push(copy);
    } else {
      state.prevListId = undefined;
      if (block.kind === "table") {
        if (!("kind" in ref)) throw new CoreError("invalidPlacement", "a table can't be copied into a table cell");
        created.push(tableCopy(state, block));
      } else unrecreatable(state, block.kind === "toc" ? "a table of contents" : "a section break");
    }
  }
  for (const block of created) linksRewrite(state, block);
  const blocks = containerOf(target.tab, ref);
  blocks.splice(index, 0, ...created);
  if ("kind" in ref) {
    // S1: a new table must follow a new paragraph.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const prev = blocks[i - 1];
      if (
        blocks[i].kind === "table" &&
        created.includes(blocks[i]) &&
        !(prev?.kind === "paragraph" && prev.key.startsWith("n"))
      ) {
        blocks.splice(i, 0, paragraphEmptyCreate(target.ctx.keys, {}, target.ctx.stamp));
      }
    }
    target.tab.blocks = containerNormalize(blocks, target.ctx.keys, target.ctx.stamp);
  }
  return { keys: created.map((b) => b.key), notes: state.notes };
}

/**
 * Makes an existing paragraph's content equal `sourceSyms` with the fewest symbol edits (so kept
 * atoms, e.g. images, survive), then gives every symbol the source's style and the paragraph the
 * source's style. Source atoms must be creates or atoms already in this paragraph.
 */
export function paragraphAssign(
  /** Tab being edited. */
  target: EditTarget,
  /** Paragraph key. */
  key: string,
  /** Content to end up with. */
  sourceSyms: readonly Sym[],
  /** Paragraph style to end up with. */
  sourceStyle: JsonObject,
): void {
  const found = blockFind(target.tab, key);
  if (found?.block.kind !== "paragraph") throw new CoreError("internal", `no paragraph with key ${key}`);
  const paragraph = found.block;
  const current = paragraphSymbols(paragraph);
  const hunks = diffHunks(current.map(symbolId), sourceSyms.map(symbolId));
  for (const h of [...hunks].reverse()) {
    const insert: SymSpec[] = sourceSyms.slice(h.bStart, h.bEnd).map(symSpecOf);
    paragraphSplice(target, key, h.aStart, h.aEnd - h.aStart, insert);
  }
  const final = paragraphSymbols(paragraph).map((sym, i): Sym => {
    const src = sourceSyms[i];
    if (sym.kind === "char" && src.kind === "char") return { ...sym, style: src.style };
    if (sym.kind === "atom" && src.kind === "atom") {
      const atom: Atom = { ...sym.atom };
      if (src.atom.style) atom.style = src.atom.style;
      else delete atom.style;
      return { atom, kind: "atom" };
    }
    return sym;
  });
  paragraphSymbolsSet(paragraph, final);
  paragraph.style = { ...sourceStyle };
  paragraph.stamp = target.ctx.stamp;
}

/** Mutable state of one `blocksCopy` call. */
interface CopyState {
  /** Source heading id → key of its copy. */ headingKeys: Map<string, string>;
  /** Source list id → new list id, for the current contiguous run. */ listMap: Map<string, string>;
  /** Notes collected so far. */ notes: string[];
  /** Call options. */ opts: { force: boolean; targetDocId: string };
  /** List id of the previous copied paragraph (ends a run when it changes). */ prevListId: string | undefined;
  /** What's being copied. */ source: CopySource;
  /** Where it's going. */ target: EditTarget;
}

/** Copies one paragraph (or drops it when it only held something unrecreatable). */
function paragraphCopy(state: CopyState, src: ParagraphBlock): ParagraphBlock | undefined {
  const { target } = state;
  const namedStyleType = (src.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
  const style = paragraphStyleFlatten(state, src, namedStyleType);
  const paragraph = paragraphEmptyCreate(target.ctx.keys, style, target.ctx.stamp);
  const specs: SymSpec[] = [];
  for (const inline of src.inlines) {
    if (inline.kind === "text") {
      specs.push({ ch: inline.text, style: textStyleFlatten(state, src, inline.style, namedStyleType) });
      continue;
    }
    const create = atomCreateOf(state, inline);
    if (create === "pageBreak") {
      if (src.inlines.length !== 1) unrecreatable(state, "a page break inside text");
      else
        paragraph.inlines = [
          { create: { type: "pageBreak" }, key: target.ctx.keys.next("n"), kind: "atom", length: 1, type: "pageBreak" },
        ];
      continue;
    }
    if (create)
      specs.push({
        create,
        style: inline.style ? textStyleFlatten(state, src, inline.style, namedStyleType) : undefined,
      });
  }
  if (specs.length) paragraphSymbolsSet(paragraph, symbolsFromSpecs(target.ctx, specs, {}));
  paragraph.newline = { style: textStyleFlatten(state, src, src.newline.style, namedStyleType) };
  if (src.protected) state.notes.push("copied text includes pending suggestions as plain text");
  if (src.bullet) {
    if (src.bullet.listId !== state.prevListId) state.listMap.clear();
    paragraph.bullet = { listId: listFor(state, src.bullet.listId), nestingLevel: src.bullet.nestingLevel };
    const level = target.tab.lists[paragraph.bullet.listId]?.nestingLevels[src.bullet.nestingLevel] as
      | JsonObject
      | undefined;
    if (level?.textStyle) paragraph.bullet.textStyle = styleCanonical(level.textStyle) as JsonObject;
  }
  state.prevListId = src.bullet?.listId;
  if (src.headingId) state.headingKeys.set(src.headingId, paragraph.key);
  const onlyDropped = src.inlines.length > 0 && paragraph.inlines.length === 0;
  return onlyDropped && !src.bullet && namedStyleType === "NORMAL_TEXT" ? undefined : paragraph;
}

/** Copies a table: structure, row/cell/column styles, and every cell's paragraphs. */
function tableCopy(state: CopyState, src: TableBlock): TableBlock {
  const { keys } = state.target.ctx;
  return {
    columns: src.columns.map((c) => ({ key: keys.next("n"), props: structuredClone(c.props) })),
    key: keys.next("n"),
    kind: "table",
    protected: false,
    rows: src.rows.map((row) => ({
      cells: row.cells.map((cell): CellModel => {
        const blocks = cell.blocks.map((p) => paragraphCopy(state, p)).filter((p): p is ParagraphBlock => !!p);
        state.prevListId = undefined;
        if (!blocks.length) blocks.push(paragraphEmptyCreate(keys, {}, state.target.ctx.stamp));
        return { blocks, key: keys.next("n"), style: structuredClone(cell.style) };
      }),
      key: keys.next("n"),
      style: structuredClone(row.style),
    })),
    stamp: state.target.ctx.stamp,
  };
}

/** The new list a source list maps to in the current run (created on first use). */
function listFor(state: CopyState, srcListId: string): string {
  const existing = state.listMap.get(srcListId);
  if (existing) return existing;
  const srcDef = state.source.tab.lists[srcListId];
  const preset = srcDef?.preset ?? LIST_DEFAULT_PRESET[srcDef ? listKind(srcDef, 0) : "bullet"];
  if (!srcDef?.preset) state.notes.push(`a custom list was copied as the default ${preset} list`);
  const listId = `new:list:${state.target.ctx.keys.next("n")}`;
  state.target.tab.lists[listId] = {
    isNew: true,
    nestingLevels: structuredClone([...(listPresetTable()[preset] ?? [])]) as JsonObject[],
    preset,
  };
  state.listMap.set(srcListId, listId);
  return listId;
}

/** The create spec that recreates a source atom, `"pageBreak"` for a page break, or `undefined` after reporting it unrecreatable. */
function atomCreateOf(state: CopyState, atom: Atom): AtomCreate | "pageBreak" | undefined {
  const raw = atom.raw ?? {};
  if (atom.create) return atom.create.type === "pageBreak" ? "pageBreak" : atom.create;
  switch (atom.type) {
    case "person": {
      const email = ((raw.person as JsonObject)?.personProperties as JsonObject | undefined)?.email;
      if (typeof email === "string") return { email, type: "person" };
      break;
    }
    case "date": {
      const props = (raw.dateElement as JsonObject | undefined)?.dateElementProperties as JsonObject | undefined;
      if (typeof props?.timestamp === "string") {
        return { dateFormat: props.dateFormat as string | undefined, timestamp: props.timestamp, type: "date" };
      }
      break;
    }
    case "richLink": {
      const uri = ((raw.richLink as JsonObject)?.richLinkProperties as JsonObject | undefined)?.uri;
      if (typeof uri === "string") return { type: "richLink", uri };
      break;
    }
    case "image": {
      const id = (raw.inlineObjectElement as JsonObject | undefined)?.inlineObjectId as string | undefined;
      const embedded = (state.source.tab.inlineObjects[id ?? ""]?.inlineObjectProperties as JsonObject | undefined)
        ?.embeddedObject as JsonObject | undefined;
      const uri = (embedded?.imageProperties as JsonObject | undefined)?.sourceUri;
      if (typeof uri === "string" && uri.startsWith("https://")) {
        const size = embedded?.size as { height?: { magnitude?: number }; width?: { magnitude?: number } } | undefined;
        return { heightPt: size?.height?.magnitude, type: "image", uri, widthPt: size?.width?.magnitude };
      }
      unrecreatable(state, "a Drive-hosted image");
      return undefined;
    }
    case "pageBreak":
      return "pageBreak";
  }
  unrecreatable(state, ATOM_LABELS[atom.type]);
  return undefined;
}

/** How unrecreatable atoms are named in errors and notes. */
const ATOM_LABELS: Record<Atom["type"], string> = {
  autoText: "an auto-text field",
  columnBreak: "a column break",
  date: "a date chip",
  equation: "an equation",
  footnoteRef: "a footnote reference",
  horizontalRule: "a horizontal rule",
  image: "an image",
  pageBreak: "a page break",
  person: "a person chip",
  richLink: "a rich link",
};

/** Refuses (or, with `force`, notes dropping) something the API can't recreate. */
function unrecreatable(state: CopyState, what: string): void {
  if (!state.opts.force) {
    throw new CoreError("unrecreatableCopy", `the source contains ${what}, which the Docs API can't recreate`);
  }
  state.notes.push(`dropped ${what} (the Docs API can't recreate it)`);
}

/** The minimum explicit paragraph style that looks like `src` under the target tab's named styles. */
function paragraphStyleFlatten(state: CopyState, src: ParagraphBlock, namedStyleType: string): JsonObject {
  const srcEffective = paragraphStyleEffective(state.source.tab, src);
  const probe = { ...src, style: { namedStyleType } };
  const base = paragraphStyleEffective(state.target.tab, probe);
  const out: JsonObject = namedStyleType === "NORMAL_TEXT" ? {} : { namedStyleType };
  for (const field of PARAGRAPH_STYLE_FIELDS) {
    if (field === "namedStyleType" || srcEffective[field] === undefined) continue;
    if (!styleEqual(srcEffective[field], base[field])) out[field] = srcEffective[field];
  }
  return out;
}

/** The minimum explicit text style that looks like `style` did in `src`, under the target tab's named styles. */
function textStyleFlatten(
  state: CopyState,
  src: ParagraphBlock,
  style: JsonObject,
  namedStyleType: string,
): JsonObject {
  const srcEffective = textStyleEffective(state.source.tab, src, { style });
  const probe = { ...src, style: { namedStyleType } };
  const base = textStyleEffective(state.target.tab, probe, {});
  const out: JsonObject = {};
  for (const field of TEXT_STYLE_FIELDS) {
    if (srcEffective[field] === undefined) continue;
    if (!styleEqual(srcEffective[field], base[field])) out[field] = srcEffective[field];
  }
  return out;
}

/** Retargets links in a copied block: to copied headings as pending links; cross-document ones as Docs URLs. */
function linksRewrite(state: CopyState, block: Block): void {
  const paragraphs =
    block.kind === "paragraph"
      ? [block]
      : block.kind === "table"
        ? block.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks))
        : [];
  for (const p of paragraphs) {
    p.inlines = p.inlines.map((inline): Inline => {
      const link = inline.style?.link as JsonObject | undefined;
      if (!link) return inline;
      const next = linkRetarget(state, link);
      if (next === link) return inline;
      return { ...inline, style: { ...inline.style, link: next } } as Inline;
    });
  }
}

/** The link a copied link should become. */
function linkRetarget(state: CopyState, link: JsonObject): JsonObject {
  const heading = link.heading as { id?: string; tabId?: string } | undefined;
  const copiedKey = heading?.id ? state.headingKeys.get(heading.id) : undefined;
  if (copiedKey) return { heading: { key: copiedKey, tabId: state.target.tab.tabId } };
  const sameDoc = state.source.doc.docId === state.opts.targetDocId;
  if (sameDoc || link.url) return link;
  const base = `https://docs.google.com/document/d/${state.source.doc.docId}/edit`;
  const tabId = heading?.tabId ?? (link.tabId as string | undefined);
  const query = tabId ? `?tab=${tabId}` : "";
  return { url: heading?.id ? `${base}${query}#heading=${heading.id}` : `${base}${query}` };
}

/** A splice spec that reproduces a source symbol. */
function symSpecOf(sym: Sym): SymSpec {
  if (sym.kind === "char") return { ch: sym.ch, style: sym.style };
  if (sym.atom.create) return { create: sym.atom.create, style: sym.atom.style };
  return { atomKey: sym.atom.key };
}
