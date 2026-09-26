/* Lens put: writes markdown back onto the model with the fewest edits: blocks aligned against what the markdown read as, paired blocks edited character by character, new blocks created "like typing" (G3 D25, D27, D29, D33–D35, M15). */

import { diffHunks } from "../diff/myers.ts";
import {
  blockFind,
  blocksDelete,
  type ContainerRef,
  containerOf,
  type EditTarget,
  paragraphSplice,
  paragraphStyleUpdate,
  paragraphsInsert,
  type SymSpec,
  textStyleUpdate,
} from "../model/edit.ts";
import { bulletsSet, listJoin, listKindSet, listRunsResolve, nestingSet } from "../model/editLists.ts";
import {
  columnsDelete,
  columnsInsert,
  pageBreakParagraphInsert,
  rowsDelete,
  rowsInsert,
  sectionBreakInsert,
  tableCreate,
} from "../model/editTables.ts";
import { headingStyleIs, textStyleEffective } from "../model/effectiveStyle.ts";
import { CoreError } from "../model/errors.ts";
import type { JsonObject } from "../model/rawJson.ts";
import {
  CODE_FONT,
  colorOptionalFromHex,
  dimensionFromPt,
  LINK_CHROME,
  monospaceFontIs,
  styleCanonical,
  styleEqual,
} from "../model/styleValues.ts";
import { paragraphSymbols, type Sym } from "../model/symbols.ts";
import type { Atom, AtomCreate, Block, DocModel, ParagraphBlock, TableBlock, TabModel } from "../model/types.ts";
import { anchorResolve, paragraphText, type RangeRef, type ResolvedRange, rangeResolve } from "./anchors.ts";
import { type BlockEdit, blockDiff } from "./blockDiff.ts";
import { parsedCanonical } from "./canonical.ts";
import { linkContext } from "./export.ts";
import {
  markdownParse,
  type ParsedBlock,
  type ParsedLink,
  type ParsedMarks,
  type ParsedSpan,
  type ParsedToken,
} from "./parse.ts";
import { type DirectiveAttrs, type ProjBlock, projectionBuild, type TokenRef, tokenOrdinals } from "./project.ts";
import { markdownRender } from "./render.ts";
import { tableAlign } from "./tableAlign.ts";

/** Where markdown goes. */
export type Placement =
  | { anchor: string; kind: "insert"; position: "after" | "before" }
  | { kind: "append" }
  | { kind: "replace"; range: RangeRef };

/** What a write did. */
export interface WriteReport {
  /** True when the model changed. */ changed: boolean;
  /** Keys of created blocks (use `new:<key>` as anchors). */ createdKeys: string[];
  /** Notes on lossy conversions. */ notes: string[];
}

/** Options for `markdownPut`. */
export interface PutOptions {
  /** How much an existing block is anchored (comments, suggestions, inbound links): heavier blocks win ties. */ anchorWeight?: (
    key: string,
  ) => number;
  /** The first new `#` heading becomes TITLE (D35). */ h1IsTitle?: boolean;
}

/** Token kinds whose atoms can be recreated elsewhere (a "move" deletes and recreates them). */
const RECREATABLE: ReadonlySet<string> = new Set(["date", "image", "pagebreak", "person", "richlink"]);

/** Paragraph style of a new code line without a code neighbor (D34). */
const CODE_PARAGRAPH_STYLE: JsonObject = {
  lineSpacing: 100,
  spaceAbove: { magnitude: 0, unit: "PT" },
  spaceBelow: { magnitude: 0, unit: "PT" },
};

/**
 * Writes markdown at a placement. A replace aligns the range's markdown as it reads now (P0) with the
 * new markdown (P1) and edits only what changed; inserts and appends create blocks. Frontmatter, when
 * present, must name this document and tab, and its revision (if any) must be current (`staleBase`).
 */
export function markdownPut(
  /** Tab being edited (and its step's edit context). */
  target: EditTarget,
  /** Document the tab belongs to. */
  doc: DocModel,
  /** Where the markdown goes. */
  placement: Placement,
  /** The markdown. */
  md: string,
  /** Anchor weights and heading options. */
  opts: PutOptions = {},
): WriteReport {
  const tab = target.tab;
  const p1 = markdownParse(md, { doc, tab });
  const fm = p1.frontmatter;
  if (fm?.revision !== undefined && fm.revision !== doc.revisionId) {
    throw new CoreError(
      "staleBase",
      "the document changed since this markdown was read; read it again and reapply the edit",
    );
  }
  if (fm?.doc !== undefined && fm.doc !== doc.docId)
    throw new CoreError("invalidPlacement", `this markdown is from document ${fm.doc}, not ${doc.docId}`);
  if (fm?.tab !== undefined && fm.tab !== tab.tabId)
    throw new CoreError("invalidPlacement", `this markdown is from tab ${fm.tab}, not ${tab.tabId}`);
  const mode = fm ? "frontmatter" : "plain";
  const state: PutState = {
    base: {},
    created: [],
    doc,
    h1IsTitle: !!opts.h1IsTitle,
    mode,
    notes: [],
    stylesNew: fm?.styles ?? {},
    tab,
    target,
    atoms: atomsSnapshot(tab),
    tokens: tokenOrdinals(tab),
    touched: false,
  };
  let range: ResolvedRange;
  let absorbed: string[] = [];
  if (placement.kind === "replace") range = rangeResolve(tab, placement.range);
  else if (placement.kind === "append") {
    // Appending absorbs the blank paragraphs at the end of the tab (all of it, when the tab is blank), so none is left over.
    let from = tab.blocks.length;
    while (from > 0 && blankIs(tab.blocks[from - 1])) from--;
    absorbed = tab.blocks.slice(from).map((b) => b.key);
    range = { containerRef: { kind: "body" }, from, to: from };
  } else {
    const found = anchorResolve(tab, placement.anchor);
    const index = tab.blocks.findIndex((b) => b.key === found.key);
    if (found.kind !== "block" || index < 0)
      throw new CoreError("invalidPlacement", "insert next to a top-level block");
    const at = placement.position === "after" ? index + 1 : index;
    range = { containerRef: { kind: "body" }, from: at, to: at };
  }
  const projection = projectionBuild(tab, range, { mode });
  state.base = projection.base;
  const p0 = range.to > range.from ? p0Parse(state, projection) : [];
  const projected = range.to > range.from ? projection.blocks : [];
  const edits = blockDiff(p0, p1.blocks, {
    anchorWeight: (o) => opts.anchorWeight?.(projected[o].key) ?? 0,
    stylesNew: state.stylesNew,
    stylesOld: projection.styles,
  });
  mixedKindListRefuse(p0, p1.blocks, edits);
  movesRefuse(edits, p0, p1.blocks, projected, projection.styles, state.stylesNew);
  const container = containerOf(tab, range.containerRef);
  // Cursor: where the next new block goes (after the previous block's owned invisible paragraphs, D25).
  let cursorKey: string | undefined = range.from > 0 ? container[range.from - 1].key : undefined;
  if (range.to > range.from && projection.leadingOwned.length) cursorKey = projection.leadingOwned.at(-1);
  const insertAt = () =>
    cursorKey === undefined ? 0 : containerOf(tab, range.containerRef).findIndex((b) => b.key === cursorKey) + 1;
  const pendingInserts: number[] = [];
  const flushInserts = () => {
    if (!pendingInserts.length) return;
    const keys = blocksCreate(
      state,
      range.containerRef,
      insertAt(),
      pendingInserts.map((n) => p1.blocks[n]),
    );
    if (keys.length) cursorKey = keys.at(-1);
    pendingInserts.length = 0;
  };
  for (const edit of edits) {
    if (edit.kind === "insert") {
      pendingInserts.push(edit.n);
      continue;
    }
    flushInserts();
    const proj = projected[edit.o];
    if (edit.kind === "delete") {
      blocksDelete(target, [proj.key, ...proj.owned]);
      state.touched = true;
      continue;
    }
    if (edit.kind === "pair") blockUpdate(state, proj, p0[edit.o], p1.blocks[edit.n]);
    cursorKey = proj.owned.at(-1) ?? proj.key;
  }
  flushInserts();
  if (absorbed.length && state.created.length) blocksDelete(target, absorbed);
  pendingLinksResolve(state);
  return { changed: state.touched, createdKeys: state.created, notes: state.notes };
}

/** Refuses moving a read-only table (the API can't recreate it): its markdown deleted in one place and written in another. */
function movesRefuse(
  edits: ReturnType<typeof blockDiff>,
  p0: readonly ParsedBlock[],
  p1: readonly ParsedBlock[],
  projected: readonly ProjBlock[],
  stylesOld: Record<string, DirectiveAttrs>,
  stylesNew: Record<string, DirectiveAttrs>,
): void {
  const hash = (b: ParsedBlock, styles: Record<string, DirectiveAttrs>) =>
    JSON.stringify(parsedCanonical([b], styles)[0]);
  const deleted = new Set(
    edits
      .filter((e) => e.kind === "delete" && projected[e.o].table?.readOnly)
      .map((e) => hash(p0[(e as { o: number }).o], stylesOld)),
  );
  for (const e of edits) {
    if (e.kind === "insert" && p1[e.n].kind === "table" && deleted.has(hash(p1[e.n], stylesNew))) {
      throw new CoreError(
        "unrecreatableMove",
        "a table markdown can't show (merged cells, several paragraphs in a cell) can't move: the Docs API can't recreate it",
      );
    }
  }
}

/** Refuses new or edited nested list items whose written kind differs from their parent list. */
function mixedKindListRefuse(
  oldBlocks: readonly ParsedBlock[],
  newBlocks: readonly ParsedBlock[],
  edits: readonly BlockEdit[],
): void {
  for (const edit of edits) {
    if (edit.kind === "delete") continue;
    const next = newBlocks[edit.n];
    if (edit.kind === "insert") {
      if (next.kind === "listItem" && next.list?.written) mixedKindListError(next);
      continue;
    }
    const previous = oldBlocks[edit.o];
    const previousMixed = previous.kind === "listItem" && previous.list?.written !== undefined;
    const nextMixed = next.kind === "listItem" && next.list?.written !== undefined;
    if (!previousMixed && !nextMixed) continue;
    const unchangedMixed =
      edit.kind === "keep" &&
      previous.kind === "listItem" &&
      next.kind === "listItem" &&
      previous.list?.kind === next.list?.kind &&
      previous.list?.depth === next.list?.depth &&
      previous.list?.written === next.list?.written;
    if (unchangedMixed) continue;
    if (nextMixed || next.kind === "listItem") mixedKindListError(nextMixed ? next : previous);
  }
}

/** Explains how to make a mismatched nested list representable. */
function mixedKindListError(block: ParsedBlock): never {
  const list = block.list as NonNullable<ParsedBlock["list"]>;
  throw new CoreError(
    "unsupportedSyntax",
    `nested ${list.written ?? "different-kind"} items can't be authored or changed under a ${list.kind} list; Google Docs can't represent mixed-kind nesting. Use ${list.kind} markers for nested items`,
  );
}

/** State of one put. */
interface PutState {
  /** Every atom of the tab as the put started (moved atoms are recreated from these). */ atoms: Map<string, Atom>;
  /** Base directive style per named style type. */ base: Record<string, DirectiveAttrs>;
  /** Keys of created blocks. */ created: string[];
  /** The document. */ doc: DocModel;
  /** Whether the next new level-1 heading becomes TITLE. */ h1IsTitle: boolean;
  /** Frontmatter (directives) or plain. */ mode: "frontmatter" | "plain";
  /** Notes. */ notes: string[];
  /** Directive definitions of the new markdown. */ stylesNew: Record<string, DirectiveAttrs>;
  /** The tab. */ tab: TabModel;
  /** Edit target. */ target: EditTarget;
  /** The tab's tokens, by atom/block key. */ tokens: Map<string, TokenRef>;
  /** Whether anything changed. */ touched: boolean;
}

/** Parses the range's own rendering back (P0); its blocks line up one-to-one with the projection's. */
function p0Parse(state: PutState, projection: ReturnType<typeof projectionBuild>): ParsedBlock[] {
  const rendered = markdownRender(projection, { links: linkContext(state.doc, state.tab) });
  const blocks = markdownParse(rendered, { doc: state.doc, styles: projection.styles, tab: state.tab }).blocks;
  if (blocks.length !== projection.blocks.length) {
    throw new CoreError("internal", `the range read back as ${blocks.length} blocks, not ${projection.blocks.length}`);
  }
  return blocks;
}

/** One symbol of a parsed block. */
interface PSym {
  /** Character, or U+FFFC for a token. */ ch: string;
  /** Directive name. */ directive?: string;
  /** Diff identity. */ id: string;
  /** Marks. */ marks: ParsedMarks;
  /** The token, for token symbols. */ token?: ParsedToken;
}

/** A parsed block's spans as symbols. */
function pSymbols(spans: readonly ParsedSpan[]): PSym[] {
  const out: PSym[] = [];
  for (const span of spans) {
    if (span.kind === "token") {
      const t = span.token;
      out.push({
        ch: "￼",
        id: "ordinal" in t ? `￼${t.kind}:${t.ordinal}` : `￼new:${JSON.stringify(t)}`,
        marks: span.marks,
        token: t,
      });
    } else
      for (const ch of Array.from(span.text)) out.push({ ch, directive: span.directive, id: ch, marks: span.marks });
  }
  return out;
}

/** Edits one paired block: kind first (so list and heading rules apply to the right paragraph), then its content and styles. */
function blockUpdate(state: PutState, proj: ProjBlock, b0: ParsedBlock, b1: ParsedBlock): void {
  if (proj.kind === "table" && b0.kind === "table" && b1.kind === "table") {
    tableUpdate(state, proj, b0, b1);
    return;
  }
  if (
    proj.kind === "table" ||
    b0.kind === "table" ||
    b1.kind === "table" ||
    b0.kind === "token" ||
    b1.kind === "token"
  ) {
    if (JSON.stringify(b0) === JSON.stringify(b1)) return;
    throw new CoreError("unsupportedSyntax", "a table or token block can't turn into text or back");
  }
  const found = blockFind(state.tab, proj.key);
  if (found?.block.kind !== "paragraph") throw new CoreError("internal", `no paragraph ${proj.key}`);
  kindChange(state, found.block, b0, b1);
  contentUpdate(state, proj, b0, b1);
}

/**
 * Edits a paired simple table through its markdown: rows and columns aligned (`tableAlign`), deleted
 * and inserted with the table primitives, kept cells edited character by character, new cells
 * filled, and column alignment changes applied to the column's paragraphs. A read-only table can't
 * change (`readOnlyTable`).
 */
function tableUpdate(state: PutState, proj: ProjBlock, b0: ParsedBlock, b1: ParsedBlock): void {
  const t0 = b0.table as NonNullable<ParsedBlock["table"]>;
  const t1 = b1.table as NonNullable<ParsedBlock["table"]>;
  if (JSON.stringify(t0) === JSON.stringify(t1)) return;
  if (proj.table?.readOnly) {
    throw new CoreError(
      "readOnlyTable",
      "this table has merged cells or several paragraphs in a cell, which markdown can't show; edit it with table operations",
    );
  }
  const { target } = state;
  const key = proj.key;
  const align = tableAlign(t0.rows, t1.rows);
  const table = () => blockFind(state.tab, key)?.block as TableBlock;
  const colDeletes = align.columns.filter((c) => c.n === undefined).map((c) => c.o as number);
  const rowDeletes = align.rows.filter((r) => r.n === undefined).map((r) => r.o as number);
  if (colDeletes.length === table().columns.length) {
    // Every column replaced: the table is recreated.
    const at = state.tab.blocks.findIndex((b) => b.key === key);
    blocksDelete(target, [key]);
    const rows = t1.rows.map((row) =>
      row.map((cell) => pSymbols(cell).map((sym) => symSpec(state, cellParagraphProbe(), sym, undefined))),
    );
    state.created.push(tableCreate(target, at, { alignments: t1.alignments, rows }));
    state.touched = true;
    return;
  }
  state.touched = true;
  if (colDeletes.length) columnsDelete(target, key, colDeletes);
  if (rowDeletes.length) rowsDelete(target, key, rowDeletes);
  const finalCols = align.columns.filter((c) => c.n !== undefined);
  finalCols.forEach((c, index) => {
    if (c.o === undefined) columnsInsert(target, key, index, 1);
  });
  const finalRows = align.rows.filter((r) => r.n !== undefined);
  finalRows.forEach((r, index) => {
    if (r.o === undefined) rowsInsert(target, key, index, 1);
  });
  finalRows.forEach((r, ri) => {
    finalCols.forEach((c, ci) => {
      const cell = table().rows[ri].cells[ci];
      const paragraph = cell.blocks[0];
      const before = r.o !== undefined && c.o !== undefined ? (t0.rows[r.o]?.[c.o] ?? []) : [];
      spansUpdate(state, paragraph.key, before, t1.rows[r.n as number]?.[c.n as number] ?? []);
      const alignment = t1.alignments[c.n as number];
      const was = c.o !== undefined ? t0.alignments[c.o] : undefined;
      if (alignment !== was || c.o === undefined) {
        const current = (blockFind(state.tab, paragraph.key)?.block as ParagraphBlock | undefined)?.style.alignment;
        const want = alignment ?? (was !== undefined ? "START" : current);
        if (want !== current) paragraphStyleUpdate(target, paragraph.key, { alignment: want ?? null });
      }
    });
  });
}

/** Notes (once per kind pair) that a nested list item took its list's kind instead of the one written. */
function nestedKindNote(state: PutState, block: ParsedBlock): void {
  const list = block.list;
  if (!list?.written) return;
  const note = `nested ${list.written} items became ${list.kind} items: Google Docs can't nest a different kind of list inside another`;
  if (!state.notes.includes(note)) state.notes.push(note);
}

/** Changes a paired paragraph's kind in place: heading level, list kind or depth, code, or plain (D35). */
function kindChange(state: PutState, p: ParagraphBlock, b0: ParsedBlock, b1: ParsedBlock): void {
  const { target } = state;
  const same =
    b0.kind === b1.kind &&
    b0.headingLevel === b1.headingLevel &&
    b0.list?.kind === b1.list?.kind &&
    b0.list?.depth === b1.list?.depth;
  if (same) return;
  state.touched = true;
  if (b0.kind === "listItem" && b1.kind !== "listItem") bulletsSet(target, [p.key], null);
  if (b1.kind === "heading") {
    const current = p.style.namedStyleType as string | undefined;
    const keep = (current === "TITLE" && b1.headingLevel === 1) || (current === "SUBTITLE" && b1.headingLevel === 2);
    if (!keep) paragraphStyleUpdate(target, p.key, { namedStyleType: `HEADING_${b1.headingLevel}` });
  } else if (b0.kind === "heading") paragraphStyleUpdate(target, p.key, { namedStyleType: "NORMAL_TEXT" });
  if (b1.kind === "listItem" && b1.list) {
    nestedKindNote(state, b1);
    const kind = b1.list.kind;
    if (b0.kind !== "listItem") bulletsSet(target, [p.key], { kind });
    else if (b0.list?.kind !== kind) listKindSet(target, [p.key], kind);
    const now = blockFind(state.tab, p.key)?.block as ParagraphBlock | undefined;
    if (now?.bullet?.nestingLevel !== b1.list.depth) {
      const { lossy } = nestingSet(target, p.key, b1.list.depth);
      if (lossy) state.notes.push("a nesting change moved an item out of a custom list (its look may change)");
    }
  }
  if (b1.kind === "codeLine" || b0.kind === "codeLine") {
    const syms = paragraphSymbols(p).length;
    if (syms)
      textStyleUpdate(target, p.key, 0, syms, {
        weightedFontFamily: b1.kind === "codeLine" ? { fontFamily: CODE_FONT, weight: 400 } : null,
      });
  }
}

/**
 * Edits a paired paragraph's content. Model symbols are aligned with P0's (the markdown hides some:
 * trimmed or normalized whitespace), then P0 → P1 hunks are applied through that map, last first;
 * symbols kept but restyled in the markdown get only the fields the markdown expresses.
 */
function contentUpdate(state: PutState, proj: ProjBlock, b0: ParsedBlock, b1: ParsedBlock): void {
  const spans = (b: ParsedBlock): ParsedSpan[] =>
    b.kind === "codeLine" ? [{ kind: "text", marks: {}, text: codeText(b) }] : b.spans;
  spansUpdate(state, proj.key, spans(b0), spans(b1));
}

/** Edits one paragraph (a block, or a table cell's) from spans as read to spans as written. */
function spansUpdate(state: PutState, key: string, spans0: readonly ParsedSpan[], spans1: readonly ParsedSpan[]): void {
  const { target } = state;
  const proj = { key };
  const found = blockFind(state.tab, key);
  const paragraph = found?.block as ParagraphBlock;
  const model = paragraphSymbols(paragraph);
  const s0 = pSymbols(spans0);
  const s1 = pSymbols(spans1);
  const map = modelMap(model, s0);
  const hunks = diffHunks(
    s0.map((s) => s.id),
    s1.map((s) => s.id),
  );
  // Kept symbols whose markdown formatting changed.
  let ai = 0;
  let bi = 0;
  const restyles: Array<{ at: number; from: PSym; to: PSym }> = [];
  for (const h of [...hunks, { aEnd: s0.length, aStart: s0.length, bEnd: s1.length, bStart: s1.length }]) {
    for (; ai < h.aStart; ai++, bi++) {
      const at = map.matched[ai];
      if (at === undefined) continue;
      tokenLabelCheck(state, s1[bi]);
      if (JSON.stringify(s0[ai].marks) !== JSON.stringify(s1[bi].marks) || s0[ai].directive !== s1[bi].directive) {
        restyles.push({ at, from: s0[ai], to: s1[bi] });
      }
    }
    ai = h.aEnd;
    bi = h.bEnd;
  }
  for (const r of restyles) {
    const patch = restylePatch(state, paragraph, model[r.at], r.from, r.to);
    if (Object.keys(patch).length) {
      textStyleUpdate(target, proj.key, r.at, r.at + 1, patch);
      state.touched = true;
    }
  }
  for (const h of [...hunks].reverse()) {
    const from = map.position(h.aStart);
    const to = map.position(h.aEnd);
    const current = paragraphSymbols(blockFind(state.tab, proj.key)?.block as ParagraphBlock);
    const neighbor = current[from - 1] ?? current[to];
    const specs = s1.slice(h.bStart, h.bEnd).map((sym) => symSpec(state, paragraph, sym, neighbor));
    paragraphSplice(target, proj.key, from, to - from, specs);
    state.touched = true;
  }
}

/** Maps P0 symbol positions to model symbol indices (unmatched model symbols are hidden by the markdown). */
function modelMap(
  model: readonly Sym[],
  s0: readonly PSym[],
): { matched: Array<number | undefined>; position: (i: number) => number } {
  const modelIds = model.map((s) => (s.kind === "atom" ? "￼" : s.ch === "\t" ? "\t" : s.ch));
  const p0Ids = s0.map((s) => s.ch);
  const hunks = diffHunks(modelIds, p0Ids);
  const matched: Array<number | undefined> = new Array(s0.length).fill(undefined);
  const groupStart: Array<number | undefined> = new Array(s0.length).fill(undefined);
  let mi = 0;
  let pi = 0;
  for (const h of [...hunks, { aEnd: model.length, aStart: model.length, bEnd: s0.length, bStart: s0.length }]) {
    for (; mi < h.aStart; mi++, pi++) matched[pi] = mi;
    for (let k = h.bStart; k < h.bEnd; k++) groupStart[k] = h.aStart;
    mi = h.aEnd;
    pi = h.bEnd;
  }
  const lastMatchedEnd = (() => {
    for (let k = s0.length - 1; k >= 0; k--) if (matched[k] !== undefined) return (matched[k] as number) + 1;
    return 0;
  })();
  return {
    matched,
    position: (i) => (i >= s0.length ? lastMatchedEnd : (matched[i] ?? groupStart[i] ?? lastMatchedEnd)),
  };
}

/** Refuses a changed label on an existing token (D29). */
function tokenLabelCheck(state: PutState, b: PSym): void {
  const t = b.token;
  if (!t || !("ordinal" in t) || t.label === undefined) return;
  const current = [...state.tokens.values()].find((x) => x.kind === t.kind && x.ordinal === t.ordinal);
  const norm = (s: string | undefined) =>
    (s ?? "")
      .replace(/[{}|\n\r]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40)
      .trim();
  if (current && norm(current.label) !== norm(t.label)) {
    throw new CoreError(
      "tokenLabelChanged",
      `{{${t.kind}:${t.ordinal}}} is "${current.label ?? ""}", not "${t.label}"; tokens can't be edited through their labels`,
    );
  }
}

/** The splice spec for one new symbol: a character styled "like typing" (D34), a new atom, or a recreated moved one. */
function symSpec(state: PutState, p: ParagraphBlock, sym: PSym, neighbor: Sym | undefined): SymSpec {
  if (sym.token) {
    const t = sym.token;
    if ("ordinal" in t) {
      const atom = atomByToken(state, t.kind, t.ordinal);
      if (!RECREATABLE.has(t.kind))
        throw new CoreError(
          "unrecreatableMove",
          `{{${t.kind}:${t.ordinal}}} can't move: the Docs API can't recreate it`,
        );
      const create = atom ? atomCreateFrom(state, atom) : undefined;
      if (!create) throw new CoreError("unrecreatableMove", `{{${t.kind}:${t.ordinal}}} can't be recreated here`);
      return { create, style: atom?.style };
    }
    if ("create" in t) return { create: t.create };
    throw new CoreError("unsupportedSyntax", "page and section breaks go on a line of their own");
  }
  return { ch: sym.ch, style: typedStyle(state, p, sym, neighbor) };
}

/** A new character's explicit style (D34): frontmatter mode = base + directive + emphasis vs the named style; plain mode = the neighbor's with emphasis replaced. */
function typedStyle(state: PutState, p: ParagraphBlock, sym: PSym, neighbor: Sym | undefined): JsonObject {
  if (state.mode === "frontmatter") {
    const type = (p.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
    const attrs: DirectiveAttrs = {
      ...(state.base[type] ?? {}),
      ...(sym.directive ? state.stylesNew[sym.directive] : {}),
    };
    const named = textStyleEffective(state.tab, p, {});
    const out: JsonObject = {};
    for (const [field, value] of Object.entries(apiStyleOf(attrs)))
      if (!styleEqual(named[field], value)) out[field] = value;
    return emphasisApply(state, out, sym.marks, named);
  }
  const base = neighbor ? (neighbor.kind === "atom" ? (neighbor.atom.style ?? {}) : neighbor.style) : p.newline.style;
  return emphasisApply(state, { ...base }, sym.marks, textStyleEffective(state.tab, p, {}));
}

/** Sets or clears the markdown-expressible fields (bold, italic, strikethrough, code font, link + chrome) to match `marks`. */
function emphasisApply(state: PutState, style: JsonObject, marks: ParsedMarks, named: JsonObject): JsonObject {
  const out = { ...style };
  const set = (field: string, on: boolean) => {
    if (on) out[field] = true;
    else if (named[field] === true) out[field] = false;
    else delete out[field];
  };
  set("bold", !!marks.bold);
  set("italic", !!marks.italic);
  set("strikethrough", !!marks.strike);
  const font = (out.weightedFontFamily as { fontFamily?: string } | undefined)?.fontFamily;
  if (marks.code) out.weightedFontFamily = { fontFamily: CODE_FONT, weight: 400 };
  else if (font && monospaceFontIs(font)) delete out.weightedFontFamily;
  if (marks.link) {
    out.link = linkJson(state, marks.link);
    out.underline = LINK_CHROME.underline;
    out.foregroundColor = colorOptionalFromHex(String(LINK_CHROME.foregroundColor));
  } else if (out.link) {
    delete out.link;
    if (out.underline === true) delete out.underline;
    if (styleEqual(out.foregroundColor, colorOptionalFromHex(String(LINK_CHROME.foregroundColor))))
      delete out.foregroundColor;
  }
  return styleCanonical(out) as JsonObject;
}

/** The patch for a kept symbol whose markdown formatting changed: only the fields the change affects. */
function restylePatch(state: PutState, p: ParagraphBlock, sym: Sym, from: PSym, to: PSym): JsonObject {
  const current = sym.kind === "atom" ? (sym.atom.style ?? {}) : sym.style;
  const named = textStyleEffective(state.tab, p, {});
  const next = emphasisApply(state, current, to.marks, named);
  const patch: JsonObject = {};
  const fields = new Set<string>();
  const m0 = from.marks;
  const m1 = to.marks;
  if (!!m0.bold !== !!m1.bold) fields.add("bold");
  if (!!m0.italic !== !!m1.italic) fields.add("italic");
  if (!!m0.strike !== !!m1.strike) fields.add("strikethrough");
  if (!!m0.code !== !!m1.code) fields.add("weightedFontFamily");
  if (JSON.stringify(m0.link) !== JSON.stringify(m1.link))
    for (const f of ["link", "underline", "foregroundColor"]) fields.add(f);
  if (from.directive !== to.directive && state.mode === "frontmatter") {
    const type = (p.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
    const attrs = apiStyleOf({ ...(state.base[type] ?? {}), ...(to.directive ? state.stylesNew[to.directive] : {}) });
    const was = apiStyleOf({
      ...(state.base[type] ?? {}),
      ...(from.directive ? (state.stylesNew[from.directive] ?? {}) : {}),
    });
    for (const field of new Set([...Object.keys(attrs), ...Object.keys(was)])) {
      fields.add(field);
      next[field] = styleEqual(named[field], attrs[field]) ? undefined : attrs[field];
    }
  }
  for (const field of fields) {
    if (!styleEqual(current[field], next[field])) patch[field] = next[field] === undefined ? null : next[field];
  }
  return patch;
}

/** Frontmatter-form attributes as Docs API style fields. */
function apiStyleOf(attrs: DirectiveAttrs): JsonObject {
  const out: JsonObject = {};
  for (const [field, value] of Object.entries(attrs)) {
    if (field === "foregroundColor" || field === "backgroundColor") out[field] = colorOptionalFromHex(String(value));
    else if (field === "fontSize") out.fontSize = dimensionFromPt(Number(value));
    else if (field === "fontFamily" || field === "fontWeight") {
      const font = (out.weightedFontFamily as { fontFamily?: string; weight?: number } | undefined) ?? {};
      out.weightedFontFamily =
        field === "fontFamily"
          ? { weight: 400, ...font, fontFamily: String(value) }
          : { ...font, weight: Number(value) };
    } else if (field === "baselineOffset") out.baselineOffset = value;
    else out[field] = value;
  }
  return styleCanonical(out) as JsonObject;
}

/** A lens link as model link JSON (pending forms resolved by `pendingLinksResolve`). */
function linkJson(state: PutState, link: ParsedLink): JsonObject {
  switch (link.kind) {
    case "url":
      return { url: link.url };
    case "tab":
      return { tabId: link.tabId };
    case "bookmark":
      return { bookmark: { id: link.id, tabId: link.tabId ?? state.tab.tabId } };
    case "heading":
      return { heading: { id: link.headingId, tabId: link.tabId ?? state.tab.tabId } };
    case "pending":
      return { heading: { key: link.key, tabId: link.tabId } };
    case "pendingText":
      return { heading: { pendingText: link.text, tabId: state.tab.tabId } };
  }
}

/** Creates new blocks at container index `at` (D34): paragraphs styled like their same-kind neighbors, list runs joined per L1–L3, tables, and breaks. */
function blocksCreate(state: PutState, ref: ContainerRef, at: number, blocks: readonly ParsedBlock[]): string[] {
  const { target } = state;
  const keys: string[] = [];
  let index = at;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.kind === "table") {
      if (!("kind" in ref)) throw new CoreError("invalidPlacement", "a table can't go inside a table cell");
      const rows = (b.table?.rows ?? []).map((row) =>
        row.map((cell) => pSymbols(cell).map((s) => symSpec(state, cellParagraphProbe(), s, undefined))),
      );
      const key = tableCreate(target, index, { alignments: b.table?.alignments, rows });
      keys.push(key);
      index = containerOf(state.tab, ref).findIndex((x) => x.key === key) + 1;
      i++;
      continue;
    }
    if (b.kind === "token") {
      if (!("kind" in ref)) throw new CoreError("invalidPlacement", "breaks can't go inside a table cell");
      const t = b.token as ParsedToken;
      let key: string;
      if ("pageBreak" in t || ("ordinal" in t && t.kind === "pagebreak")) key = pageBreakParagraphInsert(target, index);
      else if ("sectionBreak" in t) key = sectionBreakInsert(target, index, t.sectionBreak);
      else
        throw new CoreError(
          "unrecreatableMove",
          `{{${"kind" in t ? t.kind : "token"}}} can't move: the Docs API can't recreate it`,
        );
      keys.push(key);
      index = containerOf(state.tab, ref).findIndex((x) => x.key === key) + 1;
      i++;
      continue;
    }
    // A run of paragraph-like blocks.
    let j = i;
    while (j < blocks.length && blocks[j].kind !== "table" && blocks[j].kind !== "token") j++;
    const run = blocks.slice(i, j);
    const specs = run.map((block) => {
      const style = paragraphStyleFor(state, ref, index, block);
      const probe: ParagraphBlock = {
        inlines: [],
        key: "probe",
        kind: "paragraph",
        newline: { style: {} },
        protected: false,
        style,
      };
      const syms =
        block.kind === "codeLine"
          ? pSymbols([{ kind: "text", marks: { code: true }, text: codeText(block) }])
          : pSymbols(block.spans);
      return { style, syms: syms.map((s) => symSpec(state, probe, s, undefined)) };
    });
    const created = paragraphsInsert(target, ref, index, specs);
    for (const block of run) nestedKindNote(state, block);
    // List membership per markdown list: items of one kind share a list, even across items of
    // another kind nested between them; each kind's first stretch takes a list via L1–L3.
    let k = 0;
    while (k < run.length) {
      const list = run[k].list;
      if (run[k].kind !== "listItem" || !list) {
        k++;
        continue;
      }
      let end = k;
      while (end < run.length && run[end].kind === "listItem" && run[end].list?.group === list.group) end++;
      const listByKind = new Map<string, string>();
      let m = k;
      while (m < end) {
        const kind = run[m].list?.kind ?? "bullet";
        let n = m;
        while (n < end && (run[n].list?.kind ?? "bullet") === kind) n++;
        const stretch = created.slice(m, n);
        const nestings = run.slice(m, n).map((x) => x.list?.depth ?? 0);
        const known = listByKind.get(kind);
        if (known) listJoin(target, ref, stretch, known, nestings);
        else {
          listByKind.set(
            kind,
            listRunsResolve(
              target,
              ref,
              stretch,
              nestings.map((nesting) => ({ kind, nesting })),
            ),
          );
        }
        m = n;
      }
      k = end;
    }
    keys.push(...created);
    index = containerOf(state.tab, ref).findIndex((x) => x.key === created.at(-1)) + 1;
    i = j;
  }
  state.created.push(...keys);
  if (keys.length) state.touched = true;
  return keys;
}

/** A new paragraph's style: a same-kind neighbor's explicit style (previous visible, else next), with the kind's named style (D34, D35). */
function paragraphStyleFor(state: PutState, ref: ContainerRef, at: number, b: ParsedBlock): JsonObject {
  const blocks = containerOf(state.tab, ref);
  const kindOf = (p: ParagraphBlock) =>
    headingStyleIs(p.style.namedStyleType as string | undefined)
      ? "heading"
      : p.bullet
        ? "listItem"
        : isCodeParagraph(state, p)
          ? "codeLine"
          : "paragraph";
  const want = b.kind;
  const neighbor = [...blocks.slice(0, at).reverse(), ...blocks.slice(at)].find(
    (x): x is ParagraphBlock =>
      x.kind === "paragraph" && (x.inlines.length > 0 || x.bullet !== undefined) && kindOf(x) === want,
  );
  const style: JsonObject = neighbor ? { ...neighbor.style } : want === "codeLine" ? { ...CODE_PARAGRAPH_STYLE } : {};
  delete style.indentFirstLine;
  delete style.indentStart;
  if (want === "heading") {
    let type = `HEADING_${b.headingLevel ?? 1}`;
    if (b.headingLevel === 1 && state.h1IsTitle) {
      type = "TITLE";
      state.h1IsTitle = false;
    }
    style.namedStyleType = type;
  } else delete style.namedStyleType;
  return style;
}

/** True when a paragraph reads as a code line (monospace runs, no bullet). */
function isCodeParagraph(state: PutState, p: ParagraphBlock): boolean {
  return (
    !p.bullet &&
    p.inlines.length > 0 &&
    p.inlines.every((i) => {
      if (i.kind !== "text") return false;
      const font = (textStyleEffective(state.tab, p, i).weightedFontFamily as { fontFamily?: string } | undefined)
        ?.fontFamily;
      return !i.text.trim() || (!!font && monospaceFontIs(font));
    })
  );
}

/** A throwaway paragraph used to style new table-cell text. */
function cellParagraphProbe(): ParagraphBlock {
  return { inlines: [], key: "probe", kind: "paragraph", newline: { style: {} }, protected: false, style: {} };
}

/** A code line's text. */
function codeText(b: ParsedBlock): string {
  return b.spans.map((s) => (s.kind === "text" ? s.text : "")).join("");
}

/** True for a plain paragraph with no visible content. */
function blankIs(block: Block): boolean {
  return (
    block.kind === "paragraph" &&
    !block.bullet &&
    !headingStyleIs(block.style.namedStyleType as string | undefined) &&
    block.inlines.every((i) => i.kind === "text" && !i.text.trim())
  );
}

/** The atom a token names (from the snapshot, so it's found even after its paragraph was deleted). */
function atomByToken(state: PutState, kind: string, ordinal: number): Atom | undefined {
  const token = [...state.tokens.values()].find((t) => t.kind === kind && t.ordinal === ordinal);
  if (!token) throw new CoreError("anchorNotFound", `there's no {{${kind}:${ordinal}}} in this tab`);
  return state.atoms.get(token.key);
}

/** Every atom of a tab, by key. */
function atomsSnapshot(tab: TabModel): Map<string, Atom> {
  const out = new Map<string, Atom>();
  for (const block of tab.blocks) {
    const paragraphs =
      block.kind === "paragraph"
        ? [block]
        : block.kind === "table"
          ? block.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks))
          : [];
    for (const p of paragraphs)
      for (const inline of p.inlines) if (inline.kind === "atom") out.set(inline.key, structuredClone(inline));
  }
  return out;
}

/** How to recreate an existing atom elsewhere, when the API can. */
function atomCreateFrom(state: PutState, atom: Atom): AtomCreate | undefined {
  if (atom.create) return atom.create;
  const raw = (atom.raw ?? {}) as Record<string, JsonObject | undefined>;
  if (atom.type === "person") {
    const email = (raw.person?.personProperties as JsonObject | undefined)?.email;
    return typeof email === "string" ? { email, type: "person" } : undefined;
  }
  if (atom.type === "date") {
    const props = raw.dateElement?.dateElementProperties as JsonObject | undefined;
    return typeof props?.timestamp === "string"
      ? { dateFormat: props.dateFormat as string | undefined, timestamp: props.timestamp, type: "date" }
      : undefined;
  }
  if (atom.type === "richLink") {
    const uri = (raw.richLink?.richLinkProperties as JsonObject | undefined)?.uri;
    return typeof uri === "string" ? { type: "richLink", uri } : undefined;
  }
  if (atom.type === "image") {
    const id = (raw.inlineObjectElement?.inlineObjectId ?? "") as string;
    const embedded = (state.tab.inlineObjects[id]?.inlineObjectProperties as JsonObject | undefined)?.embeddedObject as
      | JsonObject
      | undefined;
    const uri = (embedded?.imageProperties as JsonObject | undefined)?.sourceUri;
    return typeof uri === "string" && uri.startsWith("https://") ? { type: "image", uri } : undefined;
  }
  if (atom.type === "pageBreak") return { type: "pageBreak" };
  return undefined;
}

/** Second pass: links to headings that only exist in the new markdown point at the created headings (by key). */
function pendingLinksResolve(state: PutState): void {
  const created = state.created
    .map((key) => blockFind(state.tab, key)?.block)
    .filter(
      (b): b is ParagraphBlock =>
        b?.kind === "paragraph" && headingStyleIs(b.style.namedStyleType as string | undefined),
    );
  const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const visit = (p: ParagraphBlock) => {
    for (const inline of p.inlines) {
      const heading = (inline.style?.link as JsonObject | undefined)?.heading as JsonObject | undefined;
      if (typeof heading?.pendingText !== "string") continue;
      const match = created.find((h) => norm(paragraphText(h)) === norm(heading.pendingText as string));
      if (!match) throw new CoreError("linkTargetNotFound", `no heading "${heading.pendingText}" was created`);
      (inline.style as JsonObject).link = { heading: { key: match.key, tabId: state.tab.tabId } };
    }
  };
  for (const block of state.tab.blocks) {
    if (block.kind === "paragraph") visit(block);
    else if (block.kind === "table")
      for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(visit);
  }
}
