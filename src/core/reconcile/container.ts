/* Reconciles a block container (tab body or table cell): aligns blocks by key, then turns each gap of deleted and inserted blocks into requests at the location the API handles without disturbing kept paragraphs (G3 D16, D17, D21, M9). */

import { SECTION_STYLE_DEFAULT } from "../model/apiFacts.ts";
import { CoreError } from "../model/errors.ts";
import { blockLength } from "../model/layout.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { styleEqual } from "../model/styleValues.ts";
import { paragraphSymbols, type Sym } from "../model/symbols.ts";
import type { Block, BulletRef, ParagraphBlock, SectionBreakBlock } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import { inCellRun, type ReconcileContext, type RequestOrigin, requestPush } from "./context.ts";
import { newParagraphStylesEmit, paragraphReconcile, symbolsInsertEmit } from "./paragraph.ts";
import { type CellFill, cellEmptyParagraph, tableNewEmit, tableReconcile } from "./tables.ts";

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
  | { inherit: ParagraphBlock; kind: "reuse"; pos: number; reusedKey?: string }; // LOC_R: into a kept empty paragraph (a deleted one's newline, or one just split off)

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
  const origin: RequestOrigin = {
    key: inserted[0]?.key ?? deleted[0]?.key,
    stepIndex: inserted[0] && "stamp" in inserted[0] ? inserted[0].stamp?.stepIndex : undefined,
  };
  let beforePos = qO ? originOf(qO).start : undefined;
  if (deleted.length) {
    const first = originOf(deleted[0]).start;
    const last = deleted[deleted.length - 1];
    const lastEnd = originOf(last).end;
    if (!protectedNewline) {
      rangeDelete(first, lastEnd, ctx, origin);
      beforePos = first;
    } else if (inserted.length) {
      if (last.kind !== "paragraph") {
        throw new CoreError("internal", "the block before a protected newline must be a paragraph (V1/V2)");
      }
      rangeDelete(first, lastEnd - 1, ctx, origin);
      streamInsert(inserted, { inherit: last, kind: "reuse", pos: first, reusedKey: last.key }, ctx);
      return undefined;
    } else {
      if (!aO || !a || last.kind !== "paragraph") {
        throw new CoreError("internal", "a merge needs a kept paragraph before the deleted blocks");
      }
      const aOrigin = originOf(aO);
      rangeDelete(aOrigin.end - 1, lastEnd - 1, ctx, origin);
      // A delete starting inside A keeps A's state; one starting at A's start (A empty) keeps the deleted paragraph's (F7).
      const aEmpty = aOrigin.end - aOrigin.start === 1;
      if (!aEmpty)
        return { forceFullStyle: false, o: { ...aO, newline: { ...aO.newline, style: last.newline.style } } };
      if (last.headingId) {
        ctx.identityTransfers.push({ fromKey: last.key, headingId: last.headingId, tabId: ctx.tabId, toKey: a.f.key });
      }
      return {
        forceFullStyle: true,
        o: { ...aO, bullet: last.bullet, headingId: last.headingId, newline: { ...last.newline }, style: last.style },
      };
    }
  }
  if (!inserted.length) return undefined;
  // Items continuing the next paragraph's list go in before it and inherit its bullet.
  let split = inserted.length;
  while (
    split > 0 &&
    qF?.bullet &&
    inserted[split - 1].kind === "paragraph" &&
    bulletSame((inserted[split - 1] as ParagraphBlock).bullet, qF.bullet)
  )
    split--;
  const head = inserted.slice(0, split);
  const tail = inserted.slice(split);
  // What splitting Q copies: its bullet as the content pass left it (the bullet pass runs later).
  const qNow = qF && { ...qF, bullet: ctx.bulletsNow.has(qF.key) ? ctx.bulletsNow.get(qF.key) : qF.bullet };
  if (tail.length && beforePos !== undefined)
    streamInsert(tail, { inherit: qNow, kind: "before", pos: beforePos }, ctx);
  if (!head.length) return undefined;
  const hasStructure = head.some((b) => b.kind !== "paragraph");
  const first = head[0];
  const joinsA = aO?.bullet && first.kind === "paragraph" && bulletSame(first.bullet, aO.bullet);
  // After A, the stream can't end in a page break (the API would leave an empty paragraph after it).
  const endsInPageBreak = (() => {
    const lastBlock = head[head.length - 1];
    return lastBlock.kind === "paragraph" && pageBreakParagraphIs(lastBlock);
  })();
  if (beforePos !== undefined && (!aO || hasStructure || endsInPageBreak || !(protectedNewline || joinsA))) {
    streamInsert(head, { inherit: qNow, kind: "before", pos: beforePos }, ctx);
  } else if (aO && !hasStructure) {
    streamInsert(head, { inherit: aO, kind: "after", pos: originOf(aO).end - 1 }, ctx);
  } else if (aO) {
    // New structure after A with nothing splittable after it: split A's newline off, then fill that empty paragraph.
    const pos = originOf(aO).end - 1;
    requestPush(ctx, RequestBuilder.insertTextAt(pos, "\n", ctx.tabId), origin);
    streamInsert(head, { inherit: aO, kind: "reuse", pos: pos + 1 }, ctx);
  } else {
    throw new CoreError("internal", "no paragraph to insert next to");
  }
  return undefined;
}

/** Reconciles one kept block (paragraph content and style; tables' cells). */
function keptReconcile(pair: KeptPair, override: KeptOverride | undefined, ctx: ReconcileContext): void {
  const { f, o } = pair;
  if (o.kind === "paragraph" && f.kind === "paragraph") {
    const before = override?.o ?? o;
    ctx.bulletsNow.set(f.key, before.bullet);
    // When membership changes, the bullet pass sets the indents.
    const skipFields = bulletSame(before.bullet, f.bullet) ? [] : ["indentFirstLine", "indentStart"];
    paragraphReconcile(before, f, ctx, { forceFullStyle: override?.forceFullStyle, skipBullets: true, skipFields });
  } else if (o.kind === "table" && f.kind === "table") {
    tableReconcile(
      o,
      f,
      ctx,
      (oc, fc) => inCellRun(ctx, () => containerReconcile(oc.blocks, fc.blocks, ctx)),
      cellFillFor(ctx),
    );
  } else if (o.kind === "sectionBreak" && f.kind === "sectionBreak") {
    const range = originOf(o);
    sectionStyleEmit(o.sectionStyle, f, range.start, ctx);
  }
}

/** Fills a new (empty) cell: its paragraphs go into the cell's only paragraph, with full styles. */
function cellFillFor(ctx: ReconcileContext): CellFill {
  return (cell, contentStart) =>
    inCellRun(ctx, () =>
      streamInsert(
        cell.blocks,
        { inherit: cellEmptyParagraph(cell.key, contentStart), kind: "reuse", pos: contentStart },
        ctx,
      ),
    );
}

/** Updates a section break at `index` whose style is `before` to its final style (changed fields only). */
function sectionStyleEmit(before: JsonObject, f: SectionBreakBlock, index: number, ctx: ReconcileContext): void {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(f.sectionStyle)])]
    .filter((field) => field !== "sectionType" && !styleEqual(before[field], f.sectionStyle[field]))
    .sort();
  if (!fields.length) return;
  const style: JsonObject = {};
  for (const field of fields) if (f.sectionStyle[field] !== undefined) style[field] = f.sectionStyle[field];
  requestPush(ctx, RequestBuilder.sectionStyleUpdate(index, index + 1, style, fields, ctx.tabId), { key: f.key });
}

/**
 * Inserts new blocks at one location (emitted last-first, so they land in order), then gives each new
 * paragraph its full styles. A new table or section break goes in at a paragraph start, where the API
 * splits off an empty paragraph before it; the new paragraph that must precede it (S1) fills that
 * paragraph instead of adding one. Bullets are left to the bullet pass, which starts from the bullet
 * each new paragraph inherited from the paragraph it was split from.
 */
function streamInsert(blocks: readonly Block[], loc: InsertLocation, ctx: ReconcileContext): void {
  const last = blocks.length - 1;
  let fillSplit = false;
  for (let i = last; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "table" || b.kind === "sectionBreak") {
      if (loc.kind === "after") throw new CoreError("internal", "structure can't go in after a paragraph's text");
      if (b.kind === "table") tableNewEmit(b, loc.pos, ctx, cellFillFor(ctx));
      else {
        const sectionType =
          b.create?.sectionType ??
          (b.sectionStyle.sectionType as "CONTINUOUS" | "NEXT_PAGE" | undefined) ??
          "CONTINUOUS";
        requestPush(ctx, RequestBuilder.insertSectionBreak({ index: loc.pos, sectionType, tabId: ctx.tabId }), {
          key: b.key,
        });
        sectionStyleEmit({ ...SECTION_STYLE_DEFAULT, sectionType }, b, loc.pos + 1, ctx);
      }
      fillSplit = true;
      continue;
    }
    if (b.kind !== "paragraph") throw new CoreError("internal", "a table of contents can't be created");
    const origin: RequestOrigin = { key: b.key, stepIndex: b.stamp?.stepIndex };
    const syms = paragraphSymbols(b);
    const pageBreak = pageBreakParagraphIs(b);
    if (fillSplit) {
      if (pageBreak) throw new CoreError("internal", "a new table or section break can't follow a page break (S1)");
      paragraphTextInsert(loc.pos, syms, { leadingNewline: false, trailingNewline: false }, ctx, origin);
      fillSplit = false;
    } else if (loc.kind === "after") {
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
  if (fillSplit) throw new CoreError("internal", "a new table or section break must follow a new paragraph (S1)");
  const lastBlock = blocks[last];
  if (loc.kind === "reuse" && loc.reusedKey && loc.inherit.headingId && lastBlock.kind === "paragraph") {
    ctx.identityTransfers.push({
      fromKey: loc.reusedKey,
      headingId: loc.inherit.headingId,
      tabId: ctx.tabId,
      toKey: lastBlock.key,
    });
  }
  // Each new paragraph holds the bullet of the paragraph it was split from until the bullet pass (lists.ts).
  let start = loc.kind === "after" ? loc.pos + 1 : loc.pos;
  for (const b of blocks) {
    if (b.kind === "paragraph") {
      ctx.bulletsNow.set(b.key, loc.inherit?.bullet);
      newParagraphStylesEmit(start, b, ctx);
    }
    start += blockLength(b);
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
