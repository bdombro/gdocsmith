/* Run document body (stdin / one YAML or JSON argument) and JSON stdout. */

import type { ApplyHighlightDocJson, GdocsmithStepInput, PageSetup } from "~/core/workflowTypes.ts";

/**
 * Run / apply input. Pipe YAML or JSON, or pass one document argument.
 */
/** @sg */
export interface GdocsmithDocument {
  /** Document ID (raw id, not a URL). Auto-opens as alias `main` when set. */
  documentId?: string;
  /** Preview resolved targets without writing. */
  dryRun?: boolean;
  /** Skip guards. Only if the user asked. */
  force?: boolean;
  /** Output JSON instead of YAML. */
  json?: boolean;
  /** Document paper size and margins (applied once on live writes). */
  pageSetup?: PageSetup;
  /** Minimal output. */
  quiet?: boolean;
  /** Ordered workflow steps. */
  steps?: GdocsmithStepInput[];
}

/** JSON stdout for `gdocsmith run`. */
/** @sg */
export type GdocsmithJsonOutput = {
  /** Unified git diff of changes (populated on dryRun). */
  diff?: string;
  /** True when `dryRun: true` previewed without writing. */
  dryRun?: boolean;
  /** Values extracted by `kind: query` (with `as:`) and `kind: dump`. */
  dumped?: Record<string, unknown>;
  /** Highlights of newly created docs, tabs, and headings. */
  highlights?: ApplyHighlightDocJson[];
  /** Status confirmation for minimal response. */
  ok?: boolean;
  /** Workflow steps executed. */
  stepsCount?: number;
};
