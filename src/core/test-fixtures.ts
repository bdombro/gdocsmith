/*

Shared test helpers for building minimal in-memory document snapshots.

*/

import type { GoogleDoc } from "./types.ts";

/** Builds a GoogleDoc with only body content — for unit tests without API calls. */
export function mockDoc(content: NonNullable<GoogleDoc["body"]>["content"]): GoogleDoc {
  return { body: { content } };
}
