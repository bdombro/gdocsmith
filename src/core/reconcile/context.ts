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

/** One tab's reconciliation state. */
export interface ReconcileContext {
  /** Original-coordinate ranges deleted (for the comment and named-range guards). */ deletedRanges: Range[];
  /** Heading identities that moved between keys. */ identityTransfers: IdentityTransfer[];
  /** Bullet each inserted paragraph inherits from the paragraph it was split from (D17). */ inherited: Map<
    string,
    BulletRef | undefined
  >;
  /** One origin per request. */ origins: RequestOrigin[];
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
    deletedRanges: [],
    identityTransfers: [],
    inherited: new Map(),
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
