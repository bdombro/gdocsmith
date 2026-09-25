/* Model editing primitives B (lists): bullet membership, nesting, kind, and preset changes under the L1–L3 joining rules (G3 D10, M7). */

import { blockFind, type ContainerRef, containerOf, type EditTarget } from "./edit.ts";
import { headingStyleIs } from "./effectiveStyle.ts";
import { CoreError } from "./errors.ts";
import { LIST_DEFAULT_PRESET, listKind, listLevelIndent, listPresetTable } from "./lists.ts";
import type { JsonObject } from "./rawJson.ts";
import { styleCanonical } from "./styleValues.ts";
import type { Block, BulletPreset, ListDef, ParagraphBlock, TabModel } from "./types.ts";

/** A list membership kind. */
export type ListKind = "bullet" | "check" | "number";

/** What one paragraph of a run should become. */
export interface BulletIntent {
  /** Membership kind. */ kind: ListKind;
  /** 0-based nesting level (0–8). */ nesting: number;
  /** Preset for a new list (default per kind). */ preset?: BulletPreset;
}

/** Outcome of a nesting or kind change. */
export interface ListChangeResult {
  /** True when the item's original list matches no preset, so the API rebuild can't keep its look (`listRebuildLossy`). */ lossy: boolean;
}

/** Glyph prefixes that mean someone typed a bullet instead of making one (ported from v1 `dom/guards.ts`). */
const FAKE_BULLET_PREFIX = /^\s*(?:[-–—*•◦●○■‣·]|\d+[.)])\s+/;

/**
 * Gives consecutive paragraphs (all in `ref`, in order) list membership per L1–L3 and returns the
 * list id: join the preceding paragraph's list when it's the same kind and every item shares its
 * nesting or that list has an exact preset (L1); else the following paragraph's list when it's the
 * same kind and every item shares its nesting (L2); else a new list (L3). Each item gets explicit
 * indents (a same-list, same-level neighbor's, else the level default) and its level's bullet text style.
 */
export function listRunsResolve(
  /** Tab being edited. */
  target: EditTarget,
  /** Container holding the paragraphs. */
  ref: ContainerRef,
  /** Paragraph keys, consecutive and in order. */
  keys: readonly string[],
  /** One intent per key (all the same kind). */
  intents: readonly BulletIntent[],
): string {
  const blocks = containerOf(target.tab, ref);
  const first = blocks.findIndex((b) => b.key === keys[0]);
  const kind = intents[0].kind;
  const before = paragraphListItem(blocks[first - 1]);
  const after = paragraphListItem(blocks[first + keys.length]);
  let listId: string | undefined;
  if (before && itemKind(target.tab, before) === kind) {
    const def = target.tab.lists[before.bullet.listId];
    const presetOk = !intents[0].preset || def?.preset === intents[0].preset;
    if (presetOk && (intents.every((i) => i.nesting === before.bullet.nestingLevel) || def?.preset)) {
      listId = before.bullet.listId;
    }
  }
  if (!listId && after && itemKind(target.tab, after) === kind) {
    if (intents.every((i) => i.nesting === after.bullet.nestingLevel)) listId = after.bullet.listId;
  }
  listId ??= listCreate(target, intents[0].preset ?? LIST_DEFAULT_PRESET[kind]);
  keys.forEach((key, i) => {
    const paragraph = blocks.find((b) => b.key === key) as ParagraphBlock;
    membershipSet(target, blocks, paragraph, listId, intents[i].nesting);
  });
  return listId;
}

/**
 * Bullets, re-kinds, or (with `null`) unbullets paragraphs. Refuses headings (`headingBullet`), empty
 * paragraphs (`listItemEmpty`), and text starting with a typed glyph or tab (`fakeBulletPrefix`).
 * Unbulleting mirrors the API: `indentFirstLine` is dropped and `indentStart` set to 0 (F12).
 */
export function bulletsSet(
  /** Tab being edited. */
  target: EditTarget,
  /** Paragraph keys (any containers; consecutive keys in one container form one run). */
  keys: readonly string[],
  /** Kind and optional preset, or `null` to remove bullets. */
  spec: { kind: ListKind; preset?: BulletPreset } | null,
): void {
  if (spec === null) {
    for (const key of keys) {
      const paragraph = paragraphRequire(target.tab, key);
      if (!paragraph.bullet) continue;
      delete paragraph.bullet;
      const style: JsonObject = { ...paragraph.style, indentStart: { magnitude: 0, unit: "PT" } };
      delete style.indentFirstLine;
      paragraph.style = style;
      paragraph.stamp = target.ctx.stamp;
    }
    return;
  }
  const pending = keys.filter((key) => {
    const paragraph = paragraphRequire(target.tab, key);
    bulletableAssert(paragraph);
    if (!paragraph.bullet) return true;
    const def = target.tab.lists[paragraph.bullet.listId];
    const sameKind = itemKind(target.tab, paragraph as ListItem) === spec.kind;
    return !sameKind || (spec.preset !== undefined && def?.preset !== spec.preset);
  });
  for (const run of runsGroup(target.tab, pending)) {
    const intents = run.keys.map((key) => ({
      kind: spec.kind,
      nesting: paragraphRequire(target.tab, key).bullet?.nestingLevel ?? 0,
      preset: spec.preset,
    }));
    listRunsResolve(target, run.ref, run.keys, intents);
  }
}

/** Moves one list item to `level`; it takes a list via L1–L3, so a list with an exact preset keeps its id. */
export function nestingSet(
  /** Tab being edited. */
  target: EditTarget,
  /** List item key. */
  key: string,
  /** New 0-based nesting level (0–8). */
  level: number,
): ListChangeResult {
  if (level < 0 || level > 8) throw new CoreError("internal", `nesting level ${level} is outside 0–8`);
  const { paragraph, ref } = listItemRequire(target.tab, key);
  const lossy = !target.tab.lists[paragraph.bullet.listId]?.preset;
  const kind = itemKind(target.tab, paragraph);
  listRunsResolve(target, ref, [key], [{ kind, nesting: level }]);
  return { lossy };
}

/** Changes list items' kind (bullet/check/number); each run takes a list via L1–L3 (usually splitting it off its list). */
export function listKindSet(
  /** Tab being edited. */
  target: EditTarget,
  /** List item keys. */
  keys: readonly string[],
  /** New kind. */
  kind: ListKind,
): ListChangeResult {
  let lossy = false;
  for (const key of keys) {
    const { paragraph } = listItemRequire(target.tab, key);
    if (!target.tab.lists[paragraph.bullet.listId]?.preset) lossy = true;
  }
  for (const run of runsGroup(target.tab, keys)) {
    const intents = run.keys.map((key) => ({
      kind,
      nesting: listItemRequire(target.tab, key).paragraph.bullet.nestingLevel,
    }));
    listRunsResolve(target, run.ref, run.keys, intents);
  }
  return { lossy };
}

/** Sets a list created this run to a preset (the API can't edit an existing list's definition). */
export function listPresetSet(
  /** Tab being edited. */
  target: EditTarget,
  /** List id. */
  listId: string,
  /** New preset. */
  preset: BulletPreset,
): void {
  const def = target.tab.lists[listId];
  if (!def) throw new CoreError("internal", `no list ${listId}`);
  if (!def.isNew) throw new CoreError("unrealizableList", "an existing list's preset can't change in place");
  def.nestingLevels = structuredClone([...(listPresetTable()[preset] ?? [])]) as JsonObject[];
  def.preset = preset;
}

/** A paragraph known to be a list item. */
type ListItem = ParagraphBlock & { bullet: NonNullable<ParagraphBlock["bullet"]> };

/** The block as a list item, when it is one. */
function paragraphListItem(block: Block | undefined): ListItem | undefined {
  return block?.kind === "paragraph" && block.bullet ? (block as ListItem) : undefined;
}

/** A list item's kind at its own level. */
function itemKind(tab: TabModel, item: ListItem): ListKind {
  const def = tab.lists[item.bullet.listId];
  return def ? listKind(def, item.bullet.nestingLevel) : "bullet";
}

/** Adds a new list definition from a preset and returns its id. */
function listCreate(target: EditTarget, preset: BulletPreset): string {
  const listId = `new:list:${target.ctx.keys.next("n")}`;
  const def: ListDef = {
    isNew: true,
    nestingLevels: structuredClone([...(listPresetTable()[preset] ?? [])]) as JsonObject[],
    preset,
  };
  target.tab.lists[listId] = def;
  return listId;
}

/** Sets one paragraph's bullet, bullet text style, and explicit indents for `listId` at `nesting`. */
function membershipSet(
  target: EditTarget,
  blocks: readonly Block[],
  paragraph: ParagraphBlock,
  listId: string,
  nesting: number,
): void {
  const def = target.tab.lists[listId];
  const level = (def?.nestingLevels[nesting] ?? {}) as JsonObject;
  paragraph.bullet = { listId, nestingLevel: nesting };
  if (level.textStyle) paragraph.bullet.textStyle = styleCanonical(level.textStyle) as JsonObject;
  const neighbor = blocks.find(
    (b) =>
      b !== paragraph &&
      b.kind === "paragraph" &&
      b.bullet?.listId === listId &&
      b.bullet.nestingLevel === nesting &&
      b.style.indentStart !== undefined,
  ) as ParagraphBlock | undefined;
  const style: JsonObject = { ...paragraph.style };
  if (neighbor) {
    style.indentStart = neighbor.style.indentStart;
    if (neighbor.style.indentFirstLine === undefined) delete style.indentFirstLine;
    else style.indentFirstLine = neighbor.style.indentFirstLine;
  } else if (def) {
    const indent = listLevelIndent(def, nesting);
    style.indentStart = { magnitude: indent.indentStart, unit: "PT" };
    style.indentFirstLine = { magnitude: indent.indentFirstLine, unit: "PT" };
  }
  paragraph.style = style;
  paragraph.stamp = target.ctx.stamp;
}

/** Refuses paragraphs that can't become list items. */
function bulletableAssert(paragraph: ParagraphBlock): void {
  if (headingStyleIs(paragraph.style.namedStyleType as string | undefined)) {
    throw new CoreError("headingBullet", "headings can't be list items; lists are NORMAL_TEXT paragraphs");
  }
  if (paragraph.inlines.length === 0) {
    throw new CoreError("listItemEmpty", "an empty list item can swallow the next heading; give it visible text");
  }
  const first = paragraph.inlines[0];
  const text = first.kind === "text" ? first.text : "";
  if (text.startsWith("\t")) {
    throw new CoreError("fakeBulletPrefix", "leading tabs would be read as nesting; set nesting instead");
  }
  if (FAKE_BULLET_PREFIX.test(text)) {
    throw new CoreError(
      "fakeBulletPrefix",
      "text starts with a typed bullet or number; make it a real list item instead",
    );
  }
}

/** Groups keys into runs of consecutive paragraphs within one container, in container order. */
function runsGroup(tab: TabModel, keys: readonly string[]): Array<{ keys: string[]; ref: ContainerRef }> {
  const located = keys
    .map((key) => {
      const found = blockFind(tab, key);
      if (!found) throw new CoreError("internal", `no block with key ${key}`);
      return { container: "kind" in found.container ? "body" : found.container.cellKey, found, key };
    })
    .sort((a, b) => (a.container === b.container ? a.found.index - b.found.index : a.container < b.container ? -1 : 1));
  const runs: Array<{ keys: string[]; lastIndex: number; name: string; ref: ContainerRef }> = [];
  for (const item of located) {
    const run = runs.at(-1);
    if (run && run.name === item.container && run.lastIndex + 1 === item.found.index) {
      run.keys.push(item.key);
      run.lastIndex = item.found.index;
    } else {
      runs.push({ keys: [item.key], lastIndex: item.found.index, name: item.container, ref: item.found.container });
    }
  }
  return runs.map(({ keys: runKeys, ref }) => ({ keys: runKeys, ref }));
}

/** The paragraph with `key`, or a `CoreError`. */
function paragraphRequire(tab: TabModel, key: string): ParagraphBlock {
  const found = blockFind(tab, key);
  if (found?.block.kind !== "paragraph") throw new CoreError("internal", `no paragraph with key ${key}`);
  return found.block;
}

/** The list item with `key` and its container, or a `CoreError`. */
function listItemRequire(tab: TabModel, key: string): { paragraph: ListItem; ref: ContainerRef } {
  const found = blockFind(tab, key);
  const item = paragraphListItem(found?.block);
  if (!found || !item) throw new CoreError("internal", `no list item with key ${key}`);
  return { paragraph: item, ref: found.container };
}
