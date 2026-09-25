/* Reconciles one kept paragraph (original vs final) into minimal requests: a code-point diff of its content, then only the style fields that changed (G3 D16, D18, M8). */

import { diffHunks } from "../diff/myers.ts";
import { CoreError } from "../model/errors.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { PARAGRAPH_STYLE_FIELDS, styleEqual, styleFieldsChanged, TEXT_STYLE_FIELDS } from "../model/styleValues.ts";
import { paragraphSymbols, type Sym, symbolId, symbolsUtf16Length } from "../model/symbols.ts";
import type { ParagraphBlock } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import { type ReconcileContext, type RequestOrigin, requestPush } from "./context.ts";

/** Options for `paragraphReconcile`. */
export interface ParagraphReconcileOptions {
  /** Send the full paragraph-style mask even for unchanged fields (a merge survivor whose state must be rewritten). */ forceFullStyle?: boolean;
  /** Paragraph-style fields a later pass sets (e.g. indents, when the bullet pass changes membership). */ skipFields?: readonly string[];
  /** Leave bullets to the bullet pass. */ skipBullets?: boolean;
}

/**
 * Emits the requests that turn original paragraph `o` (at its original index) into final paragraph `f`
 * (same key): content hunks from the end backwards, then text-style deltas (inserted text gets the full
 * mask with its final style; kept text only its changed fields), then the newline's style, bullet
 * removal, and paragraph-style deltas. Assumes everything after `o` has already been reconciled.
 */
export function paragraphReconcile(
  /** Original paragraph (must have `origin`). */
  o: ParagraphBlock,
  /** Final paragraph. */
  f: ParagraphBlock,
  /** Reconciliation state. */
  ctx: ReconcileContext,
  /** Options. */
  opts: ParagraphReconcileOptions = {},
): void {
  if (!o.origin) throw new CoreError("internal", `paragraph ${o.key} has no original range`);
  const origin: RequestOrigin = { key: f.key, stepIndex: f.stamp?.stepIndex };
  const requestCount = ctx.requests.length;
  const base = o.origin.start;
  const oSyms = paragraphSymbols(o);
  const fSyms = paragraphSymbols(f);
  const hunks = diffHunks(oSyms.map(symbolId), fSyms.map(symbolId));
  for (const h of [...hunks].reverse()) {
    const pos = base + symbolsUtf16Length(oSyms.slice(0, h.aStart));
    if (h.aEnd > h.aStart) {
      const end = pos + symbolsUtf16Length(oSyms.slice(h.aStart, h.aEnd));
      requestPush(ctx, RequestBuilder.contentRangeDelete(pos, end, ctx.tabId), origin);
      ctx.deletedRanges.push({ end: end, start: pos });
    }
    if (h.bEnd > h.bStart) symbolsInsertEmit(pos, fSyms.slice(h.bStart, h.bEnd), ctx, origin);
  }
  const kept = keptOriginals(oSyms, fSyms.length, hunks);
  const newlineAfterText = textStylesEmit(base, fSyms, kept, o.newline.style, f, ctx, origin);
  const newlinePos = base + symbolsUtf16Length(fSyms);
  const newlineFields = styleFieldsChanged(
    newlineAfterText,
    f.newline.style,
    fieldsOf(newlineAfterText, f.newline.style),
  );
  if (newlineFields.length) textStyleRequest(ctx, newlinePos, newlinePos + 1, newlineFields, f.newline.style, origin);
  let styleBefore = o.style;
  if (!opts.skipBullets) {
    if (o.bullet && !f.bullet) {
      requestPush(ctx, RequestBuilder.deleteParagraphBullets(base, newlinePos + 1, undefined, ctx.tabId), origin);
      styleBefore = { ...o.style, indentStart: { magnitude: 0, unit: "PT" } };
      delete styleBefore.indentFirstLine;
    } else if (f.bullet && !bulletsEqual(o, f)) {
      throw new CoreError("internal", "adding or changing bullets belongs to the list reconciler (M10)");
    }
  }
  const fields = (
    opts.forceFullStyle ? [...PARAGRAPH_STYLE_FIELDS] : styleFieldsChanged(styleBefore, f.style, PARAGRAPH_STYLE_FIELDS)
  ).filter((field) => !opts.skipFields?.includes(field));
  if (fields.length) {
    const paragraphStyle = pick(f.style, fields);
    // namedStyleType can't be reset, only set (F10).
    if (fields.includes("namedStyleType")) paragraphStyle.namedStyleType ??= "NORMAL_TEXT";
    requestPush(
      ctx,
      RequestBuilder.paragraphStyleUpdate(base, newlinePos + 1, paragraphStyle, fields, ctx.tabId),
      origin,
    );
  }
  if (o.protected && ctx.requests.length > requestCount) ctx.protectedTouches.push(o.key);
}

/**
 * Emits inserts for `syms` at `pos` in reverse, so they end up in order: text segments as
 * `insertText`, new chips and images as their insert requests. Kept atoms can't be inserted (the
 * API can't move content) and page breaks belong to the container reconciler.
 */
export function symbolsInsertEmit(
  /** Index to insert at. */
  pos: number,
  /** Symbols, in final order. */
  syms: readonly Sym[],
  /** Reconciliation state. */
  ctx: ReconcileContext,
  /** Request origin. */
  origin: RequestOrigin,
): void {
  const pieces: Array<string | Sym> = [];
  for (const sym of syms) {
    const last = pieces.at(-1);
    if (sym.kind === "char" && typeof last === "string") pieces[pieces.length - 1] = last + sym.ch;
    else pieces.push(sym.kind === "char" ? sym.ch : sym);
  }
  for (const piece of pieces.reverse()) {
    if (typeof piece === "string") {
      requestPush(ctx, RequestBuilder.insertTextAt(pos, piece, ctx.tabId), origin);
      continue;
    }
    const create = piece.kind === "atom" ? piece.atom.create : undefined;
    if (!create)
      throw new CoreError("atomMove", "an existing atom can't be inserted elsewhere (the API can't move content)");
    const loc = { index: pos, tabId: ctx.tabId };
    if (create.type === "person")
      requestPush(ctx, RequestBuilder.insertPerson({ ...loc, email: create.email }), origin);
    else if (create.type === "date") {
      requestPush(
        ctx,
        RequestBuilder.insertDate({ ...loc, dateFormat: create.dateFormat, timestamp: create.timestamp }),
        origin,
      );
    } else if (create.type === "richLink")
      requestPush(ctx, RequestBuilder.insertRichLink({ ...loc, uri: create.uri }), origin);
    else if (create.type === "image") {
      requestPush(
        ctx,
        RequestBuilder.insertInlineImage({
          ...loc,
          heightPt: create.heightPt,
          uri: create.uri,
          widthPt: create.widthPt,
        }),
        origin,
      );
    } else throw new CoreError("internal", "page breaks are inserted by the container reconciler");
  }
}

/**
 * Styles a paragraph that inserts just created at `start` (current coordinates): every run and the
 * newline get the full text-style mask with their final style, and the paragraph the full
 * paragraph-style mask (D18). Pending heading links are recorded.
 */
export function newParagraphStylesEmit(
  /** Index of the paragraph's first character. */
  start: number,
  /** The final paragraph. */
  f: ParagraphBlock,
  /** Reconciliation state. */
  ctx: ReconcileContext,
): void {
  const origin: RequestOrigin = { key: f.key, stepIndex: f.stamp?.stepIndex };
  const fSyms = paragraphSymbols(f);
  textStylesEmit(start, fSyms, new Array(fSyms.length).fill(undefined), {}, f, ctx, origin);
  const newlinePos = start + symbolsUtf16Length(fSyms);
  textStyleRequest(ctx, newlinePos, newlinePos + 1, TEXT_STYLE_FIELDS, f.newline.style, origin);
  const paragraphStyle = pick(f.style, PARAGRAPH_STYLE_FIELDS);
  paragraphStyle.namedStyleType ??= "NORMAL_TEXT";
  requestPush(
    ctx,
    RequestBuilder.paragraphStyleUpdate(start, newlinePos + 1, paragraphStyle, PARAGRAPH_STYLE_FIELDS, ctx.tabId),
    origin,
  );
}

/** For each final symbol, the original symbol it was kept from (`undefined` when inserted). */
function keptOriginals(
  oSyms: readonly Sym[],
  fLength: number,
  hunks: ReturnType<typeof diffHunks>,
): Array<Sym | undefined> {
  const out: Array<Sym | undefined> = new Array(fLength).fill(undefined);
  let ai = 0;
  let bi = 0;
  for (const h of [...hunks, { aEnd: oSyms.length, aStart: oSyms.length, bEnd: fLength, bStart: fLength }]) {
    while (ai < h.aStart) out[bi++] = oSyms[ai++];
    ai = h.aEnd;
    bi = h.bEnd;
  }
  return out;
}

/**
 * Emits text-style requests over the final content at `base`, grouping consecutive symbols that need
 * the same fields and values. Records pending heading links. Returns the newline style the API will
 * hold afterwards, since a range covering all of a paragraph's text also restyles its newline (F10).
 */
function textStylesEmit(
  base: number,
  fSyms: readonly Sym[],
  kept: ReadonlyArray<Sym | undefined>,
  newlineStyle: JsonObject,
  f: ParagraphBlock,
  ctx: ReconcileContext,
  origin: RequestOrigin,
): JsonObject {
  const textLength = symbolsUtf16Length(fSyms);
  let newline = newlineStyle;
  let group: { end: number; fields: string[]; start: number; style: JsonObject } | undefined;
  const flush = () => {
    if (!group) return;
    textStyleRequest(ctx, group.start, group.end, group.fields, group.style, origin);
    if (group.start === base && group.end === base + textLength) {
      const fields = group.fields.filter((field) => field !== "link");
      newline = { ...newline };
      for (const field of fields) {
        if (group.style[field] === undefined) delete newline[field];
        else newline[field] = group.style[field];
      }
    }
    group = undefined;
  };
  let pos = base;
  let pending: { length: number; link: JsonObject; offset: number } | undefined;
  fSyms.forEach((sym, i) => {
    const length = sym.kind === "atom" ? sym.atom.length : sym.ch.length;
    const style = sym.kind === "atom" ? (sym.atom.style ?? {}) : sym.style;
    const link = style.link as JsonObject | undefined;
    const pendingKey = (link?.heading as JsonObject | undefined)?.key;
    if (pending && (pendingKey === undefined || !styleEqual(pending.link, link))) {
      pendingLinkRecord(ctx, f.key, pending);
      pending = undefined;
    }
    if (pendingKey !== undefined) {
      if (pending) pending.length += length;
      else if (link) pending = { length, link, offset: pos - base };
    }
    const before = kept[i];
    const isNewAtom = sym.kind === "atom" && !before;
    let fields: string[] = [];
    if (!isNewAtom) {
      if (!before) fields = [...TEXT_STYLE_FIELDS];
      else {
        const oldStyle = before.kind === "atom" ? (before.atom.style ?? {}) : before.style;
        fields = styleFieldsChanged(oldStyle, style, fieldsOf(oldStyle, style));
      }
    }
    const requestStyle = pendingKey === undefined ? style : withoutLink(style);
    if (
      group &&
      fields.length &&
      group.end === pos &&
      sameFields(group.fields, fields) &&
      styleEqual(pick(group.style, fields), pick(requestStyle, fields))
    ) {
      group.end += length;
    } else {
      flush();
      if (fields.length) group = { end: pos + length, fields, start: pos, style: requestStyle };
    }
    pos += length;
  });
  flush();
  if (pending) pendingLinkRecord(ctx, f.key, pending);
  return newline;
}

/** Pushes one `updateTextStyle`; a mask touching `link` always lists `underline` and `foregroundColor` too, so the API's link chrome never applies unasked (D18). */
function textStyleRequest(
  ctx: ReconcileContext,
  start: number,
  end: number,
  fields: readonly string[],
  style: JsonObject,
  origin: RequestOrigin,
): void {
  const mask = new Set(fields);
  if (mask.has("link")) {
    mask.add("underline");
    mask.add("foregroundColor");
  }
  const sorted = [...mask].sort();
  requestPush(ctx, RequestBuilder.textStyleUpdate(start, end, pick(style, sorted), sorted, ctx.tabId), origin);
}

/** Records one pending link run. */
function pendingLinkRecord(
  ctx: ReconcileContext,
  paragraphKey: string,
  run: { length: number; link: JsonObject; offset: number },
): void {
  const heading = run.link.heading as { docId?: string; key: string; tabId: string };
  ctx.pendingLinks.push({
    docId: heading.docId,
    headingKey: heading.key,
    length: run.length,
    offset: run.offset,
    paragraphKey,
    tabId: heading.tabId,
  });
}

/** Every field either style sets. */
function fieldsOf(a: JsonObject, b: JsonObject): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

/** The fields of `style` that are set, among `fields`. */
function pick(style: JsonObject, fields: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const field of fields) if (style[field] !== undefined) out[field] = style[field];
  return out;
}

/** A style without its `link`. */
function withoutLink(style: JsonObject): JsonObject {
  const { link: _link, ...rest } = style;
  return rest;
}

/** True when two field lists name the same fields. */
function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, i) => field === b[i]);
}

/** True when two paragraphs have the same list membership. */
function bulletsEqual(a: ParagraphBlock, b: ParagraphBlock): boolean {
  return a.bullet?.listId === b.bullet?.listId && a.bullet?.nestingLevel === b.bullet?.nestingLevel;
}
