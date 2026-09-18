/* Run document body (stdin / one JSON argument) and JSON stdout. */

import type { ApplyHighlightDocJson, GdocsmithStepInput, PageSetup } from "~/core/workflowTypes.ts";

/**
 * Run / apply input. Pipe JSON or pass one document argument.
 */
/** @sg */
export interface GdocsmithDocument {
  /** Preview resolved targets without writing. */
  dryRun?: boolean;
  /** Skip guards. Only if the user asked. */
  force?: boolean;
  /** Document paper size, margins, and layout mode (applied once on live writes). */
  pageSetup?: PageSetup;
  /** Minimal output. */
  quiet?: boolean;
  /** Ordered workflow steps. */
  steps?: GdocsmithStepInput[];
}

/** JSON stdout for `gdocsmith run`. */
/** @sg */
export type GdocsmithJsonOutput = {
  /** Unified git diff of changes (populated on dryRun; empty string when 0 changes detected). */
  diff?: string;
  /** True when `dryRun: true` previewed without writing. */
  dryRun?: boolean;
  /** Values extracted by `kind: query` (with `as:`) and `dump: true`. */
  dumped?: Record<string, unknown>;
  /** Highlights of newly created docs, tabs, and headings. */
  highlights?: ApplyHighlightDocJson[];
  /** Status confirmation for minimal response. */
  ok?: boolean;
  /** Workflow steps executed. */
  stepsCount?: number;
};
