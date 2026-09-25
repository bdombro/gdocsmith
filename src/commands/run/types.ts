/* Run document body (stdin / one JSON argument) and structured JSON result (G4 D7). */

import type { GdocsmithStep, StepKind } from "~/core/steps/types.ts";

export type { GdocsmithStep, StepKind };

/** Complete run document for gdocsmith. */
/** @sg */
export interface GdocsmithRun {
  /** Check and plan every step; send nothing; same result. */
  dryRun?: boolean;
  /** Steps, applied in order to an in-memory copy before sending. */
  steps: GdocsmithStep[];
}

/** Structured JSON response payload for run. */
/** @sg */
export interface GdocsmithRunResult {
  /** Unified diff across all modified tabs. */
  diff: RunDiff;
  /** Documents touched or created. */
  docs: RunDoc[];
  /** True when dry-run previewed without writing. */
  dryRun: boolean;
  /** Status confirmation. */
  ok: true;
  /** Phased execution breakdown. */
  phases: RunPhase[];
  /** Per-step execution results. */
  steps: RunStepResult[];
  /** Warnings generated during run. */
  warnings: string[];
}

/** Structured unified diff returned in run result. */
export interface RunDiff {
  /** Saved diff path when too large. */
  file?: string;
  /** Summary of changes per tab. */
  tabs: Array<{ added: number; doc: string; removed: number; tab: string }>;
  /** Full unified diff text. */
  text?: string;
}

/** Document touched or created in a run. */
export interface RunDoc {
  /** Document alias if bound during run. */
  alias?: string;
  /** True when created this run. */
  created?: boolean;
  /** Document ID. */
  id: string;
  /** Document tabs. */
  tabs: Array<{ id: string; title: string }>;
  /** Document title. */
  title: string;
  /** Web URL for document. */
  url?: string;
}

/** Phase execution report. */
export interface RunPhase {
  /** Phase name. */
  name: string;
  /** Total requests planned in this phase. */
  requests: number;
  /** True if requests were sent and landed. */
  sent: boolean;
}

/** Result for a single step. */
export interface RunStepResult {
  /** Newly created blocks, tabs, or documents. */
  created?: Array<{ id: string; kind: string; text: string }>;
  /** Structured output data. */
  data?: unknown;
  /** Paths of written or spilled files. */
  files?: string[];
  /** Step kind. */
  kind: StepKind;
  /** Outline returned alongside markdown queries or saveTo. */
  outline?: unknown;
  /** Number of replacements made. */
  replaced?: number;
}
