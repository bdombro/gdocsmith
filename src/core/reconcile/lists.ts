/* The bullet pass: after content is reconciled, brings every paragraph's list membership to its final state within what createParagraphBullets can do (G3 D19, F11, F12, M10). */

import { CoreError } from "../model/errors.ts";
import { layoutCompute } from "../model/layout.ts";
import { LIST_DEFAULT_PRESET, listKind, listPresetTable } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { styleEqual } from "../model/styleValues.ts";
import type { Block, BulletPreset, BulletRef, ParagraphBlock, Range, TabModel } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import { type ReconcileContext, type RequestOrigin, requestPush } from "./context.ts";

/** The indent fields bullet requests overwrite. */
const INDENT_FIELDS = ["indentFirstLine", "indentStart"] as const;

/**
 * Emits the bullet requests for a fully content-reconciled tab (every position is final; bullet
 * requests leave positions unchanged, since the tabs a create inserts it also consumes). Works in
 * document order, so each run sees its predecessor in its final state:
 * - removal → `deleteParagraphBullets`, then indents back to their final values (F12);
 * - joining the preceding paragraph's list at nesting 0 with the same preset → one direct create (F11);
 * - a new list, or anything else → the list's whole contiguous run is rebuilt: unbullet, insert
 *   leading tabs, create, restore indents (D19). The API can't give a rebuilt run its old id, so
 *   existing lists are recorded as rebuilt. A run whose predecessor is a same-preset list item would
 *   be swallowed by that list: `unrealizableList`.
 */
export function bulletsReconcile(
  /** Final tab (content reconciled). */
  final: TabModel,
  /** Reconciliation state (its `bulletsNow` says each paragraph's membership after the content pass). */
  ctx: ReconcileContext,
): void {
  const layout = layoutCompute(final);
  const containers: Block[][] = [final.blocks];
  for (const block of final.blocks) {
    if (block.kind === "table")
      for (const row of block.rows) for (const cell of row.cells) containers.push(cell.blocks);
  }
  for (const blocks of containers) containerBulletsReconcile(final, blocks, layout.blockRanges, ctx);
}

/** One container's bullet pass. */
function containerBulletsReconcile(
  tab: TabModel,
  blocks: readonly Block[],
  ranges: ReadonlyMap<string, Range>,
  ctx: ReconcileContext,
): void {
  const now = (p: ParagraphBlock) => (ctx.bulletsNow.has(p.key) ? ctx.bulletsNow.get(p.key) : p.bullet);
  let i = 0;
  while (i < blocks.length) {
    const p = paragraphAt(blocks, i);
    if (!p || bulletSame(now(p), p.bullet)) {
      i++;
      continue;
    }
    if (!p.bullet) {
      let end = i;
      while (
        paragraphAt(blocks, end + 1) &&
        !paragraphAt(blocks, end + 1)?.bullet &&
        now(paragraphAt(blocks, end + 1) as ParagraphBlock)
      )
        end++;
      const members = blocks.slice(i, end + 1) as ParagraphBlock[];
      bulletsRemove(members, ranges, ctx, now);
      i = end + 1;
      continue;
    }
    const listId = p.bullet.listId;
    const isNew = listId.startsWith("new:");
    let groupEnd = i;
    while (true) {
      const next = paragraphAt(blocks, groupEnd + 1);
      if (!next?.bullet || next.bullet.listId !== listId || bulletSame(now(next), next.bullet)) break;
      groupEnd++;
    }
    const group = blocks.slice(i, groupEnd + 1) as ParagraphBlock[];
    const def = tab.lists[listId];
    const preset: BulletPreset = def?.preset ?? LIST_DEFAULT_PRESET[def ? listKind(def, 0) : "bullet"];
    const pred = paragraphAt(blocks, i - 1);
    const predPreset = pred?.bullet ? tab.lists[pred.bullet.listId]?.preset : undefined;
    const predSwallows = !!pred?.bullet && predPreset === preset;
    if (!isNew && pred?.bullet?.listId === listId && predSwallows && group.every((m) => m.bullet?.nestingLevel === 0)) {
      bulletsCreate(group, preset, def?.nestingLevels ?? [], ranges, ctx, now);
      i = groupEnd + 1;
      continue;
    }
    // Rebuild the list's whole contiguous run.
    let runStart = i;
    while (!isNew && paragraphAt(blocks, runStart - 1)?.bullet?.listId === listId) runStart--;
    let runEnd = groupEnd;
    while (paragraphAt(blocks, runEnd + 1)?.bullet?.listId === listId) runEnd++;
    const runPred = paragraphAt(blocks, runStart - 1);
    const runPredPreset = runPred?.bullet ? tab.lists[runPred.bullet.listId]?.preset : undefined;
    if (runPred?.bullet && runPredPreset === preset) {
      throw new CoreError(
        "unrealizableList",
        "this list directly follows another list of the same style, so Google Docs would merge them; put a paragraph between them or change one list's style",
      );
    }
    const run = blocks.slice(runStart, runEnd + 1) as ParagraphBlock[];
    if (runPred?.bullet && (run[0].bullet?.nestingLevel ?? 0) > 0) {
      throw new CoreError(
        "unrealizableList",
        "Google Docs can't start a new list at a nested level right after another list; put a paragraph between them",
      );
    }
    if (!isNew) {
      ctx.listRebuilds.push({ keys: run.map((m) => m.key), listId, lossy: !def?.preset });
    } else if (listSeenElsewhere(blocks, listId, runStart, runEnd)) {
      // Items of another list between this one's: the API can't nest a different kind of list inside
      // a new one (live N7–N9: bulleting over list items re-lists them).
      throw new CoreError(
        "unrealizableList",
        nestedSpanEnd(tab, blocks, listId, runStart) === undefined
          ? "a new list's items must be consecutive"
          : "Google Docs can't nest a different kind of list inside a new list; nest items of the same kind",
      );
    }
    bulletsCreate(run, preset, listPresetTable()[preset] ?? [], ranges, ctx, now);
    i = runEnd + 1;
  }
}

/** Unbullets consecutive paragraphs, then restores their final indents (the API sets `indentStart` to 0 and drops `indentFirstLine`, F12). */
function bulletsRemove(
  members: readonly ParagraphBlock[],
  ranges: ReadonlyMap<string, Range>,
  ctx: ReconcileContext,
  now: (p: ParagraphBlock) => BulletRef | undefined,
): void {
  const first = rangeOf(ranges, members[0]);
  const last = rangeOf(ranges, members[members.length - 1]);
  requestPush(
    ctx,
    RequestBuilder.deleteParagraphBullets(first.start, last.end, undefined, ctx.tabId),
    originOf(members[0]),
  );
  for (const m of members) indentsRestore(m, unbulletedIndents(now(m)?.nestingLevel ?? 0), ranges, ctx);
}

/** The indents `deleteParagraphBullets` leaves on an item at `nesting` (F12, live N10). */
function unbulletedIndents(nesting: number): JsonObject {
  if (!nesting) return { indentStart: { magnitude: 0, unit: "PT" } };
  const indent = { magnitude: 36 * nesting, unit: "PT" };
  return { indentFirstLine: indent, indentStart: indent };
}

/** Bullets a consecutive run: unbullet whatever is bulleted, insert nesting tabs, create, restore indents. */
function bulletsCreate(
  members: readonly ParagraphBlock[],
  preset: BulletPreset,
  levels: readonly JsonObject[],
  ranges: ReadonlyMap<string, Range>,
  ctx: ReconcileContext,
  now: (p: ParagraphBlock) => BulletRef | undefined,
): void {
  const first = rangeOf(ranges, members[0]);
  const last = rangeOf(ranges, members[members.length - 1]);
  const origin = originOf(members[0]);
  if (members.some((m) => now(m))) {
    requestPush(ctx, RequestBuilder.deleteParagraphBullets(first.start, last.end, undefined, ctx.tabId), origin);
    // Unbulleted nested items keep an indent, which createParagraphBullets would add to their tabs' nesting.
    for (const m of members) {
      if (!now(m)?.nestingLevel) continue;
      const range = rangeOf(ranges, m);
      requestPush(
        ctx,
        RequestBuilder.paragraphStyleUpdate(range.start, range.end, {}, [...INDENT_FIELDS], ctx.tabId),
        originOf(m),
      );
    }
  }
  let tabs = 0;
  for (const m of [...members].reverse()) {
    const nesting = m.bullet?.nestingLevel ?? 0;
    if (nesting > 0) {
      requestPush(
        ctx,
        RequestBuilder.insertTextAt(rangeOf(ranges, m).start, "\t".repeat(nesting), ctx.tabId),
        originOf(m),
      );
      tabs += nesting;
    }
  }
  requestPush(
    ctx,
    RequestBuilder.createParagraphBullets(first.start, last.end + tabs, preset, undefined, ctx.tabId),
    origin,
  );
  for (const m of members) {
    const level = (levels[m.bullet?.nestingLevel ?? 0] ?? {}) as JsonObject;
    const after: JsonObject = {};
    for (const field of INDENT_FIELDS) if (level[field] !== undefined) after[field] = level[field];
    indentsRestore(m, after, ranges, ctx);
  }
}

/** Sets a paragraph's indents to their final values when the API left them as `after`. */
function indentsRestore(
  m: ParagraphBlock,
  after: JsonObject,
  ranges: ReadonlyMap<string, Range>,
  ctx: ReconcileContext,
): void {
  const fields = INDENT_FIELDS.filter((field) => !styleEqual(after[field], m.style[field]));
  if (!fields.length) return;
  const style: JsonObject = {};
  for (const field of fields) if (m.style[field] !== undefined) style[field] = m.style[field];
  const range = rangeOf(ranges, m);
  requestPush(ctx, RequestBuilder.paragraphStyleUpdate(range.start, range.end, style, fields, ctx.tabId), originOf(m));
}

/**
 * The last index of `listId`'s span from `start` when every item between its members is a list item
 * nested deeper than the member before it; `undefined` when something else interrupts the list.
 */
function nestedSpanEnd(tab: TabModel, blocks: readonly Block[], listId: string, start: number): number | undefined {
  let last = start;
  for (let i = start; i < blocks.length; i++) if (paragraphAt(blocks, i)?.bullet?.listId === listId) last = i;
  let depth = 0;
  for (let i = start; i <= last; i++) {
    const p = paragraphAt(blocks, i);
    if (!p?.bullet) return undefined;
    if (p.bullet.listId === listId) depth = p.bullet.nestingLevel;
    else if (p.bullet.nestingLevel <= depth || !tab.lists[p.bullet.listId]) return undefined;
  }
  return last;
}

/** True when `listId` has members outside `[start, end]` in this container. */
function listSeenElsewhere(blocks: readonly Block[], listId: string, start: number, end: number): boolean {
  return blocks.some((b, i) => (i < start || i > end) && b.kind === "paragraph" && b.bullet?.listId === listId);
}

/** The paragraph at `i`, if the block there is one. */
function paragraphAt(blocks: readonly Block[], i: number): ParagraphBlock | undefined {
  const block = blocks[i];
  return block?.kind === "paragraph" ? block : undefined;
}

/** A block's final range. */
function rangeOf(ranges: ReadonlyMap<string, Range>, block: Block): Range {
  const range = ranges.get(block.key);
  if (!range) throw new CoreError("internal", `no layout for block ${block.key}`);
  return range;
}

/** Request origin for a paragraph. */
function originOf(p: ParagraphBlock): RequestOrigin {
  return { key: p.key, stepIndex: p.stamp?.stepIndex };
}

/** True when two bullets are the same membership (both absent counts). */
function bulletSame(a: BulletRef | undefined, b: BulletRef | undefined): boolean {
  return a?.listId === b?.listId && (a?.nestingLevel ?? 0) === (b?.nestingLevel ?? 0);
}
