/* Docs API field-mask helpers shared by every style-patching request handler (see G3 F10). */

import type { JsonObject } from "../model/rawJson.ts";
import { styleCanonical } from "../model/styleValues.ts";

/** Splits a comma-separated field mask into trimmed, non-empty field names. */
export function parseFields(
  /** Raw `fields` value from a request. */
  fields: unknown,
): string[] {
  return typeof fields === "string"
    ? fields
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
}

/** Applies a field-masked style patch (F10): a listed field absent (or `null`) in `patch` resets to inherited; otherwise it's set (canonicalized). */
export function applyStyleFields(
  /** Style object to mutate in place. */
  target: JsonObject,
  /** Patch payload (only `fields`-listed keys are consulted). */
  patch: JsonObject,
  /** Field names this request's mask lists. */
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined || value === null) delete target[field];
    else target[field] = styleCanonical(value);
  }
}
