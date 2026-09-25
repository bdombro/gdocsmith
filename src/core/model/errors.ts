/* The core's typed error (G3 core API `CoreError`); defined here so model primitives can raise it before the engine exists. */

import type { JsonObject } from "./rawJson.ts";

/** Why a core operation refused or failed. */
export type CoreErrorCode =
  | "ambiguousTableAlignment"
  | "anchorAmbiguous"
  | "anchorNotFound"
  | "atomMove"
  | "concurrentEdits"
  | "fakeBulletPrefix"
  | "headingBullet"
  | "internal"
  | "invalidAtom"
  | "invalidPlacement"
  | "linkTargetNotFound"
  | "listItemEmpty"
  | "mergeNonEmpty"
  | "readOnlyTable"
  | "staleBase"
  | "tabNotFound"
  | "tabRequired"
  | "tabTitleTaken"
  | "tokenLabelChanged"
  | "unrealizableList"
  | "unrecreatableCopy"
  | "unrecreatableMove"
  | "unsupportedSyntax";

/** A resolution, validation, or invariant failure raised by the core; its message carries no step prefix. */
export class CoreError extends Error {
  /** Machine-readable reason. */ code: CoreErrorCode;
  /** Extra structured context (e.g. candidates for an ambiguous anchor). */ details?: JsonObject;

  constructor(
    /** Machine-readable reason. */
    code: CoreErrorCode,
    /** Human-readable message. */
    message: string,
    /** Extra structured context. */
    details?: JsonObject,
  ) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.details = details;
  }
}
