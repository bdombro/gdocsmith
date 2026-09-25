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

/** Returns a copy of `base` with a field-masked style patch applied (F10): a listed field absent (or `null`) in `patch` resets to inherited; otherwise it's set (canonicalized). Never mutates `base`, since tape cells share style objects. */
export function applyStyleFields(
  /** Style to start from (not mutated). */
  base: JsonObject,
  /** Patch payload (only `fields`-listed keys are consulted). */
  patch: JsonObject,
  /** Field names this request's mask lists. */
  fields: readonly string[],
): JsonObject {
  const target = { ...base };
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined || value === null) delete target[field];
    else target[field] = styleCanonical(value);
  }
  return target;
}
