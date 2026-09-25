/* Reconciles a block container (tab body or table cell): aligns blocks by key, then turns each gap of deleted and inserted blocks into requests at the location the API handles without disturbing kept paragraphs (G3 D16, D17, D21, M9). */

import { CoreError } from "../model/errors.ts";
import { styleEqual } from "../model/styleValues.ts";
import { paragraphSymbols, type Sym, symbolsUtf16Length } from "../model/symbols.ts";
import type { Block, BulletRef, ParagraphBlock, TableBlock } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import { type ReconcileContext, type RequestOrigin, requestPush } from "./context.ts";
import { newParagraphStylesEmit, paragraphReconcile, symbolsInsertEmit } from "./paragraph.ts";

/** A kept block: its original and final versions. */
interface KeptPair {
  /** Final version. */ f: Block;
  /** Original version. */ o: Block;
}

/** How a kept paragraph looks to its own reconcile after the gap after it merged into it. */
interface KeptOverride {
  /** Rewrite the whole paragraph style (its state now comes from another paragraph). */ forceFullStyle: boolean;
  /** The paragraph as the API now holds it, before its own edits. */ o: ParagraphBlock;
}

/** Where a run of new paragraphs goes in (D17). */
type InsertLocation =
  | { inherit: ParagraphBlock | undefined; kind: "after"; pos: number } // LOC_A: at A.end − 1, splitting A's newline off
  | { inherit: ParagraphBlock | undefined; kind: "before"; pos: number } // LOC_B: at the start of the paragraph after
  | { inherit: ParagraphBlock; kind: "reuse"; pos: number; reusedKey: string }; // LOC_R: into a deleted paragraph's kept newline

/**
 * Emits requests turning `oBlocks` into `fBlocks` (the same container, before and after). Kept blocks
 * must stay in order (a move is an internal error). Work goes from the container's end to its start,
 * so every request is valid in the original coordinates of what's still untouched.
 */
export function containerReconcile(
  /** Original blocks (with origins). */
  oBlocks: readonly Block[],
  /** Final blocks. */
  fBlocks: readonly Block[],
  /** Reconciliation state. */
  ctx: ReconcileContext,
): void {
  const oIndex = new Map(oBlocks.map((b, i) => [b.key, i]));
  const kept: Array<KeptPair & { fi: number; oi: number }> = [];
  fBlocks.forEach((f, fi) => {
    const oi = oIndex.get(f.key);
    if (oi === undefined) return;
    if (kept.length && oi <= kept[kept.length - 1].oi) {
      throw new CoreError("internal", `block ${f.key} moved; a move must be a delete plus a create`);
    }
    kept.push({ f, fi, o: oBlocks[oi], oi });
  });
  for (let g = kept.length; g >= 0; g--) {
    const a = kept[g - 1];
    const q = kept[g];
    const deleted = oBlocks.slice(a ? a.oi + 1 : 0, q ? q.oi : oBlocks.length);
    const inserted = fBlocks.slice(a ? a.fi + 1 : 0, q ? q.fi : fBlocks.length);
    const override = gapReconcile(a, q, deleted, inserted, ctx);
    if (a) keptReconcile(a, override, ctx);
  }
}

/** Reconciles one gap between kept blocks `a` and `q` (either may be absent); returns how `a` now looks when the gap merged into it. */
function gapReconcile(
  a: KeptPair | undefined,
  q: KeptPair | undefined,
  deleted: readonly Block[],
  inserted: readonly Block[],
  ctx: ReconcileContext,
): KeptOverride | undefined {
  if (!deleted.length && !inserted.length) return undefined;
  const aO = a?.o.kind === "paragraph" ? a.o : undefined;
  const qO = q?.o.kind === "paragraph" ? q.o : undefined;
  const qF = q?.f.kind === "paragraph" ? q.f : undefined;
  // The newline before a table/TOC/section break, or a container's last newline, can't be deleted.
  const protectedNewline = !qO;
  const newParagraphs = inserted.map((b) => {
    if (b.kind !== "paragraph") throw new CoreError("internal", "new tables and section breaks are reconciled in M10");
    return b;
  });
  const origin: RequestOrigin = {
    key: newParagraphs[0]?.key ?? deleted[0]?.key,
    stepIndex: newParagraphs[0]?.stamp?.stepIndex,
  };
  let beforePos = qO ? originOf(qO).start : undefined;
  if (deleted.length) {
    const first = originOf(deleted[0]).start;
    const last = deleted[deleted.length - 1];
    const lastEnd = originOf(last).end;
    if (!protectedNewline) {
      rangeDelete(first, lastEnd, ctx, origin);
      beforePos = first;
    } else if (newParagraphs.length) {
      if (last.kind !== "paragraph")
        throw new CoreError("internal", "the block before a protected newline must be a paragraph (V1/V2)");
      rangeDelete(first, lastEnd - 1, ctx, origin);
      streamInsert(newParagraphs, { inherit: last, kind: "reuse", pos: first, reusedKey: last.key }, ctx);
      return undefined;
    } else {
      if (!aO || !a || last.kind !== "paragraph")
        throw new CoreError("internal", "a merge needs a kept paragraph before the deleted blocks");
      const aOrigin = originOf(aO);
      rangeDelete(aOrigin.end - 1, lastEnd - 1, ctx, origin);
      // A delete starting inside A keeps A's state; one starting at A's start (A empty) keeps the deleted paragraph's (F7).
      const aEmpty = aOrigin.end - aOrigin.start === 1;
      if (!aEmpty)
        return { forceFullStyle: false, o: { ...aO, newline: { ...aO.newline, style: last.newline.style } } };
      if (last.headingId)
        ctx.identityTransfers.push({ fromKey: last.key, headingId: last.headingId, tabId: ctx.tabId, toKey: a.f.key });
      return {
        forceFullStyle: true,
        o: { ...aO, bullet: last.bullet, headingId: last.headingId, newline: { ...last.newline }, style: last.style },
      };
    }
  }
  if (!newParagraphs.length) return undefined;
  // Items continuing the next paragraph's list go in before it and inherit its bullet.
  let split = newParagraphs.length;
  while (split > 0 && qF?.bullet && bulletSame(newParagraphs[split - 1].bullet, qF.bullet)) split--;
  const head = newParagraphs.slice(0, split);
  const tail = newParagraphs.slice(split);
  if (tail.length && beforePos !== undefined) streamInsert(tail, { inherit: qF, kind: "before", pos: beforePos }, ctx);
  if (!head.length) return undefined;
  const joinsA = aO?.bullet && bulletSame(head[0].bullet, aO.bullet);
  if (aO && (protectedNewline || joinsA || beforePos === undefined)) {
    streamInsert(head, { inherit: aO, kind: "after", pos: originOf(aO).end - 1 }, ctx);
  } else if (beforePos !== undefined) {
    streamInsert(head, { inherit: qF, kind: "before", pos: beforePos }, ctx);
  } else {
    throw new CoreError("internal", "no paragraph to insert next to");
  }
  return undefined;
}

/** Reconciles one kept block (paragraph content and style; tables' cells). */
function keptReconcile(pair: KeptPair, override: KeptOverride | undefined, ctx: ReconcileContext): void {
  const { f, o } = pair;
  if (o.kind === "paragraph" && f.kind === "paragraph") {
    paragraphReconcile(override?.o ?? o, f, ctx, { forceFullStyle: override?.forceFullStyle });
  } else if (o.kind === "table" && f.kind === "table") {
    tableCellsReconcile(o, f, ctx);
  } else if (o.kind === "sectionBreak" && f.kind === "sectionBreak") {
    if (!styleEqual(o.sectionStyle, f.sectionStyle))
      throw new CoreError("internal", "section style changes are reconciled in M10");
  }
}

/** Reconciles a kept table whose structure and styles are unchanged: each cell's content, last cell first. */
function tableCellsReconcile(o: TableBlock, f: TableBlock, ctx: ReconcileContext): void {
  const shape = (t: TableBlock) =>
    JSON.stringify({
      columns: t.columns,
      rows: t.rows.map((r) => ({ cells: r.cells.map((c) => [c.key, c.style]), key: r.key, style: r.style })),
    });
  if (shape(o) !== shape(f)) throw new CoreError("internal", "table structure and style changes are reconciled in M10");
  for (let r = o.rows.length - 1; r >= 0; r--) {
    for (let c = o.rows[r].cells.length - 1; c >= 0; c--) {
      containerReconcile(o.rows[r].cells[c].blocks, f.rows[r].cells[c].blocks, ctx);
    }
  }
}

/**
 * Inserts new paragraphs at one location (emitted last-first, so they land in order), then gives
 * each its bullet and full styles. Each paragraph inherits the bullet of the paragraph it was split
 * from; a new paragraph that shouldn't have it is unbulleted (other bullet changes belong to M10).
 */
function streamInsert(paragraphs: readonly ParagraphBlock[], loc: InsertLocation, ctx: ReconcileContext): void {
  const last = paragraphs.length - 1;
  for (let i = last; i >= 0; i--) {
    const p = paragraphs[i];
    const origin: RequestOrigin = { key: p.key, stepIndex: p.stamp?.stepIndex };
    const syms = paragraphSymbols(p);
    const pageBreak = pageBreakParagraphIs(p);
    if (loc.kind === "after") {
      if (pageBreak) {
        if (i === last)
          throw new CoreError("internal", "a new page break can't be the last paragraph inserted after another");
        requestPush(ctx, RequestBuilder.insertPageBreak(loc.pos + 1, undefined, ctx.tabId), origin);
      } else paragraphTextInsert(loc.pos, syms, { leadingNewline: true, trailingNewline: false }, ctx, origin);
    } else if (pageBreak) {
      if (loc.kind === "reuse" && i === last)
        throw new CoreError("internal", "a new page break can't reuse a deleted paragraph's newline");
      requestPush(ctx, RequestBuilder.insertPageBreak(loc.pos, undefined, ctx.tabId), origin);
    } else {
      const trailingNewline = !(loc.kind === "reuse" && i === last);
      paragraphTextInsert(loc.pos, syms, { leadingNewline: false, trailingNewline }, ctx, origin);
    }
  }
  if (loc.kind === "reuse" && loc.inherit.headingId) {
    ctx.identityTransfers.push({
      fromKey: loc.reusedKey,
      headingId: loc.inherit.headingId,
      tabId: ctx.tabId,
      toKey: paragraphs[last].key,
    });
  }
  let start = loc.kind === "after" ? loc.pos + 1 : loc.pos;
  for (const p of paragraphs) {
    const inherited = loc.inherit?.bullet;
    ctx.inherited.set(p.key, inherited);
    const length = symbolsUtf16Length(paragraphSymbols(p)) + 1;
    if (inherited && !p.bullet) {
      requestPush(ctx, RequestBuilder.deleteParagraphBullets(start, start + length, undefined, ctx.tabId), {
        key: p.key,
        stepIndex: p.stamp?.stepIndex,
      });
    } else if (p.bullet && !bulletSame(p.bullet, inherited)) {
      throw new CoreError("internal", "new list membership is reconciled in M10");
    }
    newParagraphStylesEmit(start, p, ctx);
    start += length;
  }
}

/** Inserts one paragraph's content at `pos`, with a newline before (LOC_A) or after (LOC_B) it, in as few requests as possible. */
function paragraphTextInsert(
  pos: number,
  syms: readonly Sym[],
  newlines: { leadingNewline: boolean; trailingNewline: boolean },
  ctx: ReconcileContext,
  origin: RequestOrigin,
): void {
  const text = syms.every((s) => s.kind === "char")
    ? syms.map((s) => (s.kind === "char" ? s.ch : "")).join("")
    : undefined;
  if (text !== undefined) {
    const full = `${newlines.leadingNewline ? "\n" : ""}${text}${newlines.trailingNewline ? "\n" : ""}`;
    if (full) requestPush(ctx, RequestBuilder.insertTextAt(pos, full, ctx.tabId), origin);
    return;
  }
  // Mixed content: newline first (after) or last (before), content inserted at `pos` around it.
  if (newlines.trailingNewline) requestPush(ctx, RequestBuilder.insertTextAt(pos, "\n", ctx.tabId), origin);
  symbolsInsertEmit(pos, syms, ctx, origin);
  if (newlines.leadingNewline) requestPush(ctx, RequestBuilder.insertTextAt(pos, "\n", ctx.tabId), origin);
}

/** Deletes `[start, end)` when non-empty and records it. */
function rangeDelete(start: number, end: number, ctx: ReconcileContext, origin: RequestOrigin): void {
  if (end <= start) return;
  requestPush(ctx, RequestBuilder.contentRangeDelete(start, end, ctx.tabId), origin);
  ctx.deletedRanges.push({ end, start });
}

/** A parsed block's original range, or an internal error. */
function originOf(block: Block): { end: number; start: number } {
  const origin = block.origin;
  if (!origin) throw new CoreError("internal", `block ${block.key} has no original range`);
  return origin;
}

/** True when two bullets are the same list membership (both absent counts). */
function bulletSame(a: BulletRef | undefined, b: BulletRef | undefined): boolean {
  return a?.listId === b?.listId && a?.nestingLevel === b?.nestingLevel;
}

/** True for a paragraph holding only a page break (P1). */
function pageBreakParagraphIs(p: ParagraphBlock): boolean {
  return p.inlines.length === 1 && p.inlines[0].kind === "atom" && p.inlines[0].type === "pageBreak";
}
