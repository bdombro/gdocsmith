/* Shared CLI option and positional parameter specifications for argsbarg commands. */

import { type CliOption, CliOptionKind } from "argsbarg";

/** Positional argument for one or more Google Doc identifiers. */
export const DOCUMENTS_POSITIONAL = {
  description: "One or more Document IDs (extract from URL between /document/d/ and /edit).",
  kind: CliOptionKind.String,
  name: "documents",
  variadic: true,
} as const;

/** Positional argument for a single Google Doc identifier. */
export const DOCUMENT_POSITIONAL = {
  description: "Document ID (extract from URL between /document/d/ and /edit).",
  kind: CliOptionKind.String,
  name: "document",
} as const;

/** Flag to preview targets without mutating the document. */
export const DRY_RUN_OPTION = {
  description: "Preview resolved targets without writing to the Doc.",
  kind: CliOptionKind.Presence,
  name: "dry-run",
} satisfies CliOption;

/** Flag to bypass safety guard assertions. */
export const FORCE_OPTION = {
  description: "Skip guards. Only if the user asked.",
  kind: CliOptionKind.Presence,
  name: "force",
} satisfies CliOption;

/** Option specifying the image upload backend. */
export const IMAGE_STORE_OPTION = {
  choices: ["auto", "drive"],
  description: "Image upload backend: auto (Apps Script+Drive) or drive only.",
  kind: CliOptionKind.Enum,
  name: "image-store",
} satisfies CliOption;

/** Flag to output raw JSON instead of YAML. */
export const JSON_OPTION = {
  description: "Output JSON instead of YAML.",
  kind: CliOptionKind.Presence,
  name: "json",
} satisfies CliOption;

/** Flag for minimal output. */
export const QUIET_OPTION = {
  description: "Minimal output.",
  kind: CliOptionKind.Presence,
  name: "quiet",
} satisfies CliOption;

/** Option specifying a target tab identifier or unique title. */
export const TAB_OPTION = {
  description: "Tab ID or unique title (extract from URL ?tab=<tabId> or run 'tab list').",
  kind: CliOptionKind.String,
  name: "tab",
} satisfies CliOption;

/** Standard set of flags for mutation commands. */
export const APPLY_FLAGS = [DRY_RUN_OPTION, QUIET_OPTION, FORCE_OPTION, JSON_OPTION];
