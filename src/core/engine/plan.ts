/* Turns a session's edits into a checked plan: per-document requests (self-checked against the emulator), guard findings, and per-tab diffs — nothing is sent (G3 D15, D37, D39, M18). */

import { unifiedDiffFormat } from "../diff/unified.ts";
import { tabMarkdownExport } from "../lens/export.ts";
import type { CompareResult } from "../model/equivalence.ts";
import { CoreError } from "../model/errors.ts";
import type { DocModel, TabModel } from "../model/types.ts";
import { type DocPlan, type DocReconcileInput, docPlanSelfCheck, docReconcile } from "../reconcile/reconcile.ts";
import { type GuardFinding, guardEvaluate } from "./guard.ts";
import { commentAnchorsMatch } from "./load.ts";
import type { CoreSession, DocIntents } from "./session.ts";

/** One document's part of a plan. */
export interface PlannedDoc {
  /** The emulator self-check (always equal: a failed one throws). */ check: CompareResult;
  /** How to create it (new documents). */ create?: { from?: string; title: string };
  /** Document id (real or provisional). */ docId: string;
  /** What it was planned from. */ input: DocReconcileInput;
  /** Title, lifecycle, and permission changes. */ intents: DocIntents;
  /** True when created this run. */ isNew: boolean;
  /** The requests. */ plan: DocPlan;
}

/** A run's plan. */
export interface Plan {
  /** Every changed tab's diff, concatenated. */ diff: string;
  /** Per-tab unified diffs of the plain markdown, before → after. */ diffs: Array<{
    docId: string;
    tabId: string;
    tabTitle: string;
    text: string;
  }>;
  /** Per-document plans. */ docs: PlannedDoc[];
  /** Guard findings. */ findings: GuardFinding[];
}

/**
 * Plans every document in the session: reconciles it, proves the plan against the emulator (a
 * mismatch is an `internal` error, D15), loads comments only for existing documents whose plan
 * deletes text, evaluates the guard across all of them, and diffs each changed tab.
 */
export async function planBuild(
  /** The session. */
  session: CoreSession,
): Promise<Plan> {
  const docs: PlannedDoc[] = [];
  for (const state of session.docs.values()) {
    const input: DocReconcileInput = { final: state.current, original: state.original, originalJson: state.json };
    const plan = docReconcile(input);
    const check = docPlanSelfCheck(plan, input);
    if (!check.equal) {
      throw new CoreError(
        "internal",
        `the plan for ${state.docId} wouldn't produce the intended document; nothing was sent`,
        { diffs: check.diffs.slice(0, 20) },
      );
    }
    docs.push({
      check,
      create: state.create,
      docId: state.docId,
      input,
      intents: state.intents,
      isNew: state.isNew,
      plan,
    });
  }
  const guardDocs = [];
  for (const doc of docs) {
    const state = session.docs.get(doc.docId);
    if (!state) continue;
    const comments =
      doc.plan.deletedRanges.length && !state.isNew
        ? commentAnchorsMatch(state.original, await session.commentsFor(state))
        : [];
    guardDocs.push({
      comments,
      final: state.current,
      original: state.original,
      plan: doc.plan,
      tombstones: state.tombstones,
    });
  }
  const findings = guardEvaluate({
    docs: guardDocs,
    force: false,
    linkSources: [...session.docs.values()].map((s) => s.original),
    stepForce: (i) => session.stepForce(i),
  });
  const diffs = docs.flatMap((doc) => tabDiffs(doc.input.original, doc.input.final));
  return { diff: diffs.map((d) => d.text).join("\n"), diffs, docs, findings };
}

/** Plain-markdown diffs of every tab that changed (added and deleted tabs included). */
function tabDiffs(original: DocModel, final: DocModel): Plan["diffs"] {
  const plain = (doc: DocModel, tab: TabModel | undefined) =>
    tab
      ? tabMarkdownExport(
          doc,
          tab,
          { containerRef: { kind: "body" }, from: 0, to: tab.blocks.length },
          { skipFrontmatter: true },
        ).markdown
      : "";
  const ids = [...new Set([...original.tabs.map((t) => t.tabId), ...final.tabs.map((t) => t.tabId)])];
  const out: Plan["diffs"] = [];
  for (const tabId of ids) {
    const before = original.tabs.find((t) => t.tabId === tabId);
    const after = final.tabs.find((t) => t.tabId === tabId);
    const title = (after ?? before)?.title ?? tabId;
    const text = unifiedDiffFormat(plain(original, before), plain(final, after), {
      newPath: `b/${final.title}/${title}`,
      oldPath: `a/${original.title}/${before?.title ?? title}`,
    });
    if (text || (before && after && before.title !== after.title))
      out.push({ docId: final.docId, tabId, tabTitle: title, text });
  }
  return out;
}
