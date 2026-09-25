/* Shared state of one tab's reconciliation: the request stream, per-request origins, and everything the guard, verification, and link phases need (G3 M8). */

import type { JsonObject } from "../model/rawJson.ts";
import type { BulletRef, IdentityTransfer, Range } from "../model/types.ts";

/** Which model item and step a request came from (for mapping API errors back to steps). */
export interface RequestOrigin {
  /** Block key. */ key?: string;
  /** Step index. */ stepIndex?: number;
}

/** A link to a heading created this run, left out of the content phase and filled in by the links phase (D31, M19). */
export interface PendingLink {
  /** Target document, when not this one. */ docId?: string;
  /** Model key of the target heading. */ headingKey: string;
  /** UTF-16 length of the linked text. */ length: number;
  /** UTF-16 offset of the linked text within its paragraph. */ offset: number;
  /** Key of the paragraph holding the linked text. */ paragraphKey: string;
  /** Tab of the target heading. */ tabId: string;
}

/** A list run the plan rebuilds (unbullet, re-tab, re-bullet), giving it a new list id (D19). */
export interface ListRebuild {
  /** Paragraph keys in the run. */ keys: string[];
  /** The list id the model keeps using (the real one changes). */ listId: string;
  /** True when the list matches no preset, so the rebuild changes its look (a `listRebuild` finding). */ lossy: boolean;
}

/** One tab's reconciliation state. */
export interface ReconcileContext {
  /** Each final paragraph's list membership after the content pass (before the bullet pass). */ bulletsNow: Map<
    string,
    BulletRef | undefined
  >;
  /** Original-coordinate ranges deleted (for the comment and named-range guards). */ deletedRanges: Range[];
  /** Heading identities that moved between keys. */ identityTransfers: IdentityTransfer[];
  /** Nesting depth inside table cells (cell paragraphs can't take `pageBreakBefore`). */ inCell: number;
  /** One origin per request. */ origins: RequestOrigin[];
  /** List runs rebuilt with a new list id. */ listRebuilds: ListRebuild[];
  /** Links to fill in after content lands. */ pendingLinks: PendingLink[];
  /** Keys of protected (suggestion-bearing) blocks the plan changes. */ protectedTouches: string[];
  /** Requests, in send order. */ requests: JsonObject[];
  /** Tab every request targets. */ tabId: string;
}

/** An empty context for one tab. */
export function reconcileContextCreate(
  /** Tab id. */
  tabId: string,
): ReconcileContext {
  return {
    bulletsNow: new Map(),
    deletedRanges: [],
    identityTransfers: [],
    inCell: 0,
    listRebuilds: [],
    origins: [],
    pendingLinks: [],
    protectedTouches: [],
    requests: [],
    tabId,
  };
}

/** Appends a request and its origin. */
export function requestPush(
  /** Context. */
  ctx: ReconcileContext,
  /** Request. */
  req: object,
  /** Where it came from. */
  origin: RequestOrigin,
): void {
  ctx.requests.push(req as JsonObject);
  ctx.origins.push(origin);
}

/** Runs `fn` with `ctx` marked as inside a table cell. */
export function inCellRun<T>(
  /** Reconciliation state. */
  ctx: ReconcileContext,
  /** Work on a cell's content. */
  fn: () => T,
): T {
  ctx.inCell++;
  try {
    return fn();
  } finally {
    ctx.inCell--;
  }
}
