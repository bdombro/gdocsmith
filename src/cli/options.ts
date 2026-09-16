/*

Shared ArgsBarg option specs.

*/

import { type CliOption, CliOptionKind } from "argsbarg";

export const DRY_RUN_OPTION = {
  name: "dry-run",
  description: "Preview resolved targets without writing to the Doc.",
  kind: CliOptionKind.Presence,
} satisfies CliOption;

export const QUIET_OPTION = {
  name: "quiet",
  description: "Minimal output.",
  kind: CliOptionKind.Presence,
} satisfies CliOption;

export const FORCE_OPTION = {
  name: "force",
  description: "Skip guards. Only if the user asked.",
  kind: CliOptionKind.Presence,
} satisfies CliOption;

export const JSON_OPTION = {
  name: "json",
  description: "Output JSON instead of YAML.",
  kind: CliOptionKind.Presence,
} satisfies CliOption;

export const IMAGE_STORE_OPTION = {
  name: "image-store",
  description: "Image upload backend: auto (Apps Script+Drive) or drive only.",
  kind: CliOptionKind.Enum,
  choices: ["auto", "drive"],
} satisfies CliOption;

export const DOCUMENT_POSITIONAL = {
  name: "document",
  description: "Document ID (extract from URL between /document/d/ and /edit).",
  kind: CliOptionKind.String,
} as const;

export const DOCUMENTS_POSITIONAL = {
  name: "documents",
  description: "One or more Document IDs (extract from URL between /document/d/ and /edit).",
  kind: CliOptionKind.String,
  variadic: true,
} as const;

export const TAB_OPTION = {
  name: "tab",
  description: "Tab ID or unique title (extract from URL ?tab=<tabId> or run 'tab list').",
  kind: CliOptionKind.String,
} satisfies CliOption;

export const APPLY_FLAGS = [DRY_RUN_OPTION, QUIET_OPTION, FORCE_OPTION, JSON_OPTION];
