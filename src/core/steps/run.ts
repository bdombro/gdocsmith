/* Orchestrates run execution: validation, preload, transactions, guards, results (G4 D5–D8, M6). */

import type { DocCache } from "~/core/cache/docCache.ts";
import { docCache } from "~/core/cache/docCache.ts";
import type { GuardFinding } from "~/core/engine/guard.ts";
import {
  type PhaseReport,
  TransactionError,
  type TransactionResult,
  transactionRun,
} from "~/core/engine/transaction.ts";
import type { DocHandle, Session } from "~/core/engine/types.ts";
import { type DocsClient, type DriveApi, gws, gwsDrive } from "~/core/gws.ts";
import {
  editStepApply,
  removeStepApply,
  type StepOutcome,
  styleStepApply,
  tableStepApply,
  writeStepApply,
} from "./content.ts";
import { RAW_DOC_ID, type StepContext } from "./context.ts";
import {
  diffSpill,
  INLINE_DIFF_CHARS_MAX,
  INLINE_RUN_CHARS_MAX,
  INLINE_STEP_CHARS_MAX,
  spillDirCreate,
  spillPrune,
  stepDataSpill,
} from "./output.ts";
import { queryStepApply } from "./query.ts";
import { docStepApply, pageStepApply, shareStepApply, tabStepApply } from "./structure.ts";
import type { GdocsmithRun, GdocsmithStep, StepKind } from "./types.ts";
import { stepsAssertValid } from "./validate.ts";

const ALL_PHASES: Array<PhaseReport["phase"]> = ["create", "content", "tabs", "links", "permissions"];

/** Options passed to run execution. */
export interface RunExecuteOptions {
  /** Snapshot cache for documents. */
  cache?: DocCache;
  /** Google Docs client (defaults to gws). */
  client?: DocsClient;
  /** Google Drive client (defaults to gwsDrive). */
  drive?: DriveApi;
  /** Global force waiver. */
  force?: boolean;
}

/** Structured unified diff returned in run result. */
export interface RunDiff {
  /** Saved diff path when too large. */
  file?: string;
  /** Per-tab summary lines. */
  tabs: Array<{ added: number; doc: string; removed: number; tab: string }>;
  /** Full unified diff text when within size cap. */
  text?: string;
}

/** Document touched or created in a run. */
export interface RunDoc {
  /** Document alias if bound during run. */
  alias?: string;
  /** True when created this run. */
  created?: boolean;
  /** Real document ID or provisional new:<alias>. */
  id: string;
  /** Document tabs. */
  tabs: Array<{ id: string; title: string }>;
  /** Document title. */
  title: string;
  /** Web URL for document (omitted for provisional IDs). */
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
  /** Structured output data (query/share). */
  data?: unknown;
  /** Paths of written or spilled files. */
  files?: string[];
  /** Step kind. */
  kind: StepKind;
  /** Outline returned alongside markdown queries or saveTo. */
  outline?: unknown;
  /** Number of replacements made (edit). */
  replaced?: number;
}

/** Full result of a run execution. */
export interface GdocsmithRunResult {
  /** Unified diff across all modified tabs. */
  diff: RunDiff;
  /** Documents touched or created. */
  docs: RunDoc[];
  /** True if dry run. */
  dryRun: boolean;
  /** Success status. */
  ok: true;
  /** Phased execution breakdown. */
  phases: RunPhase[];
  /** Per-step execution results. */
  steps: RunStepResult[];
  /** Warnings generated during run. */
  warnings: string[];
}

/**
 * Executes a full gdocsmith run document through the v2 transactional pipeline:
 * 1. Static cross-field validation (loads no documents on failure).
 * 2. Pruning of temporary spill directories older than 24h.
 * 3. Preloading of raw document IDs.
 * 4. In-memory execution and transaction planning.
 * 5. Guard evaluation and refusal formatting.
 * 6. Phased flush with revision conflict replay.
 * 7. Structured result construction and payload spilling.
 */
export async function runExecute(run: GdocsmithRun, opts: RunExecuteOptions = {}): Promise<GdocsmithRunResult> {
  // 1. Static validation
  stepsAssertValid(run.steps);

  // 2. Prune old spill directories
  spillPrune();

  const client = opts.client ?? gws;
  const drive = opts.drive ?? gwsDrive;
  const cache = opts.cache ?? docCache;
  const dryRun = Boolean(run.dryRun);
  const globalForce = Boolean(opts.force);

  // 3. Preload specs
  const preloadSpecs = docsPreloadSpecs(run.steps);

  let stepOutcomes: StepOutcome[] = [];
  let _capturedSession: Session | undefined;
  let capturedAliases = new Map<string, DocHandle>();
  let attempt = 0;

  // 4. Run through transactionRun
  let txResult: TransactionResult<StepOutcome[]>;
  try {
    txResult = await transactionRun(
      async (session: Session) => {
        const isRetry = attempt > 0;
        attempt++;
        _capturedSession = session;
        capturedAliases = new Map<string, DocHandle>();
        stepOutcomes = [];

        // Preload raw document IDs in parallel (all fresh on retries, D5)
        await Promise.all(
          Array.from(preloadSpecs.entries()).map(([docId, { fresh }]) =>
            session.docOpen(docId, { forceFetch: isRetry || fresh }),
          ),
        );

        const ctx: StepContext = {
          aliases: capturedAliases,
          isRetry,
          session,
          stepIndex: 0,
          steps: run.steps,
        };

        for (let i = 0; i < run.steps.length; i++) {
          const step = run.steps[i];
          ctx.stepIndex = i;
          const stepForce = "force" in step ? Boolean(step.force) : false;
          session.stepBegin(i, { force: stepForce });
          const outcome = await stepApply(ctx, step);
          stepOutcomes.push(outcome);
        }

        return stepOutcomes;
      },
      {
        cache,
        client,
        drive,
        dryRun,
        force: globalForce,
      },
    );
  } catch (err) {
    if (err instanceof TransactionError) {
      throw flushErrorFormat(err);
    }
    throw err;
  }

  // 5. Guard check
  if (txResult.refused) {
    throw guardRefusalFormat(run.steps, txResult.findings);
  }

  // 6 & 7. Build structured result and handle spilling
  return resultBuild(run, txResult, stepOutcomes, capturedAliases);
}

/** Dispatches a single step to its corresponding typed handler. */
async function stepApply(ctx: StepContext, step: GdocsmithStep): Promise<StepOutcome> {
  switch (step.kind) {
    case "doc":
      return docStepApply(ctx, step);
    case "edit":
      return editStepApply(ctx, step);
    case "page":
      return pageStepApply(ctx, step);
    case "query":
      return queryStepApply(ctx, step);
    case "remove":
      return removeStepApply(ctx, step);
    case "share":
      return shareStepApply(ctx, step);
    case "style":
      return styleStepApply(ctx, step);
    case "tab":
      return tabStepApply(ctx, step);
    case "table":
      return tableStepApply(ctx, step);
    case "write":
      return writeStepApply(ctx, step);
  }
}

/** Collects raw document IDs referenced across steps and notes whether fresh fetch is requested. */
function docsPreloadSpecs(steps: GdocsmithStep[]): Map<string, { fresh: boolean }> {
  const map = new Map<string, { fresh: boolean }>();
  for (const step of steps) {
    if (step.kind === "doc" && step.action === "open" && step.doc && RAW_DOC_ID.test(step.doc)) {
      const existing = map.get(step.doc) ?? { fresh: false };
      map.set(step.doc, { fresh: existing.fresh || Boolean(step.fresh) });
    } else if ("doc" in step && step.doc && RAW_DOC_ID.test(step.doc)) {
      const existing = map.get(step.doc) ?? { fresh: false };
      map.set(step.doc, existing);
    }
    if ("from" in step && step.from?.doc && RAW_DOC_ID.test(step.from.doc)) {
      const existing = map.get(step.from.doc) ?? { fresh: false };
      map.set(step.from.doc, existing);
    }
  }
  return map;
}

/** Formats a guard refusal message. */
function guardRefusalFormat(steps: GdocsmithStep[], findings: GuardFinding[]): Error {
  const blocking = findings.filter((f) => f.severity === "block" && !f.waived);
  const byStep = new Map<number, GuardFinding[]>();
  for (const f of blocking) {
    const idx = f.stepIndex ?? 0;
    const list = byStep.get(idx) ?? [];
    list.push(f);
    byStep.set(idx, list);
  }

  let msg = `Refused: ${byStep.size} step(s) would break content that cannot be restored. Nothing was sent.`;
  for (const [idx, stepFindings] of byStep) {
    const kind = steps[idx]?.kind ?? "step";
    msg += `\nsteps[${idx}] ${kind} (force: true to proceed):`;
    for (const f of stepFindings) {
      msg += `\n  • ${f.message}`;
    }
  }
  return new Error(msg);
}

/** Formats a phase failure error. */
function flushErrorFormat(err: TransactionError): Error {
  const phaseIndex = ALL_PHASES.indexOf(err.phase) + 1;
  const phaseTotal = ALL_PHASES.length;
  const landedPhases: string[] = [];
  if (err.partial.created.length > 0) landedPhases.push("create");
  if (err.partial.landed.length > 0) landedPhases.push("content");
  const idx = ALL_PHASES.indexOf(err.phase);
  if (idx > 2 && !landedPhases.includes("tabs")) landedPhases.push("tabs");
  if (idx > 3 && !landedPhases.includes("links")) landedPhases.push("links");

  const landed = landedPhases.length > 0 ? landedPhases.join(", ") : "nothing";
  const notSent = ALL_PHASES.slice(phaseIndex).join(", ") || "none";

  const lines = [
    `Send failed in phase "${err.phase}" (${phaseIndex} of ${phaseTotal}): ${err.cause.message}`,
    `Landed: ${landed}.`,
    `Not sent: ${notSent}.`,
    "Landed changes are live; re-query before retrying.",
  ];
  return new Error(lines.join("\n"));
}

/** Builds the final GdocsmithRunResult, managing diff and step data spilling. */
function resultBuild(
  run: GdocsmithRun,
  txResult: TransactionResult<StepOutcome[]>,
  stepOutcomes: StepOutcome[],
  aliases: Map<string, DocHandle>,
): GdocsmithRunResult {
  let spillDir: string | undefined;

  // Build phases
  const phases: RunPhase[] = ALL_PHASES.map((name) => {
    const report = txResult.phases.find((p) => p.phase === name);
    const requests = report?.docs.reduce((sum, d) => sum + d.requestCount, 0) ?? 0;
    const sent = !txResult.dryRun && (report?.docs.some((d) => d.landed) ?? false);
    return { name, requests, sent };
  });

  // Build diff
  const diffTabs = txResult.diffs.map((d) => {
    const lines = d.text.split("\n");
    const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    return { added, doc: d.docId, removed, tab: d.tabTitle };
  });

  let runDiff: RunDiff;
  if (txResult.diff.length > INLINE_DIFF_CHARS_MAX) {
    if (!spillDir) spillDir = spillDirCreate();
    const filePath = diffSpill(spillDir, txResult.diff);
    runDiff = { file: filePath, tabs: diffTabs };
  } else {
    runDiff = { tabs: diffTabs, text: txResult.diff };
  }

  // Build docs
  const docs: RunDoc[] = [];
  const aliasByDocHandle = new Map<DocHandle, string>();
  for (const [alias, handle] of aliases) aliasByDocHandle.set(handle, alias);

  for (const [, handle] of aliases) {
    const realId = txResult.dryRun ? handle.docId : (txResult.newIds.docs[handle.docId] ?? handle.docId);
    const tabs = handle.tabs().map((t) => ({ id: t.tabId, title: t.title }));
    docs.push({
      alias: handle.alias,
      created: handle.isNew,
      id: realId,
      tabs,
      title: handle.title(),
      url: realId.startsWith("new:") ? undefined : `https://docs.google.com/document/d/${realId}/edit`,
    });
  }

  // Also include docs from diffs that weren't aliased
  for (const d of txResult.diffs) {
    if (!docs.some((doc) => doc.id === d.docId)) {
      docs.push({
        id: d.docId,
        tabs: [{ id: d.tabId, title: d.tabTitle }],
        title: d.tabTitle,
        url: d.docId.startsWith("new:") ? undefined : `https://docs.google.com/document/d/${d.docId}/edit`,
      });
    }
  }

  // Build step results
  const stepResults: RunStepResult[] = stepOutcomes.map((outcome, i) => {
    const step = run.steps[i];
    let created: Array<{ id: string; kind: string; text: string }> | undefined;

    if (outcome.created) {
      created = outcome.created.slice(0, 20).map((c) => {
        let id = c.id;
        if (!txResult.dryRun) {
          if (txResult.newIds.docs[c.id]) id = txResult.newIds.docs[c.id];
          else if (txResult.newIds.headings[c.id]) id = txResult.newIds.headings[c.id];
          else if (txResult.newIds.tabs[c.id]) id = txResult.newIds.tabs[c.id];
        }
        return {
          id,
          kind: c.kind,
          text: c.text.slice(0, 60),
        };
      });
    }

    return {
      created,
      data: outcome.data,
      files: outcome.files,
      kind: step.kind,
      outline: outcome.outline,
      replaced: outcome.replaced,
    };
  });

  // Spill step data over INLINE_STEP_CHARS_MAX
  for (let i = 0; i < stepResults.length; i++) {
    const s = stepResults[i];
    if (s.data) {
      const chars = JSON.stringify(s.data).length;
      if (chars > INLINE_STEP_CHARS_MAX) {
        if (!spillDir) spillDir = spillDirCreate();
        const spilled = stepDataSpill(spillDir, i, s.kind, s.data, s.outline);
        s.files = [...(s.files ?? []), ...spilled.files];
        s.data = spilled.inlineData;
        s.outline = spilled.outline;
      }
    }
  }

  // Check total inline data chars against INLINE_RUN_CHARS_MAX
  const totalInlineChars = () => stepResults.reduce((sum, s) => sum + (s.data ? JSON.stringify(s.data).length : 0), 0);

  while (totalInlineChars() > INLINE_RUN_CHARS_MAX) {
    let largestIdx = -1;
    let largestLen = 0;
    for (let i = 0; i < stepResults.length; i++) {
      const s = stepResults[i];
      if (s.data) {
        const len = JSON.stringify(s.data).length;
        if (len > largestLen) {
          largestLen = len;
          largestIdx = i;
        }
      }
    }
    if (largestIdx < 0) break;
    if (!spillDir) spillDir = spillDirCreate();
    const target = stepResults[largestIdx];
    const spilled = stepDataSpill(spillDir, largestIdx, target.kind, target.data, target.outline);
    target.files = [...(target.files ?? []), ...spilled.files];
    target.data = spilled.inlineData;
    target.outline = spilled.outline;
  }

  const warnings = txResult.findings.filter((f) => f.severity === "warn").map((f) => f.message);

  return {
    diff: runDiff,
    docs,
    dryRun: txResult.dryRun,
    ok: true,
    phases,
    steps: stepResults,
    warnings,
  };
}
