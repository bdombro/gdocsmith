/* Shared test helpers for building minimal in-memory document snapshots. */

import type { GoogleDoc } from "./types.ts";

/**
 * Builds a GoogleDoc fixture with the provided body content elements.
 */
export function docMock(
  /** Array of structural document elements for the mock body. */
  content: NonNullable<GoogleDoc["body"]>["content"],
): GoogleDoc {
  return { body: { content } };
}

/**
 * Alias for docMock.
 */
export const mockDoc = docMock;
