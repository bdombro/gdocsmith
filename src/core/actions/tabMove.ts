/* Workflow step: tabMove / tabReorder — reorder a document tab to a zero-based index. */

import { Gdoc } from "~/core/gdoc.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { flattenTabs, resolveRelativeTabIndex, resolveTab } from "~/core/tabs.ts";
import type { DocTab } from "~/core/types.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Moves/reorders a document tab to a target index. */
export const tabMoveStep: WorkflowStepHandler = async (
  /** Runtime execution context for the script session. */
  runtime,
  /** Zero-based index of this step in the script. */
  stepIndex,
  /** Workflow step input. */
  step,
) => {
  if (step.noop) {
    runtime.stepsExecuted++;
    return;
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabMove"} requires tab: <id|title>`);
  }

  const resolved = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };

  if (!resolved.tabId) {
    throw new Error(`Cannot move tab "${tabHint}": resolved tab has no tabId`);
  }

  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: step.afterTab,
    beforeTab: step.beforeTab,
    index: step.index,
    movingTabId: resolved.tabId,
  });

  if (targetIndex == null || !Number.isInteger(targetIndex) || targetIndex < 0) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabMove"} requires index, afterTab, or beforeTab`);
  }

  const existingFlat = flattenTabs(targetDoc.gdoc.data.tabs);
  const currentIdx = existingFlat.findIndex((t) => t.tabId === resolved.tabId);
  if (currentIdx === targetIndex) {
    // Tab is already at the target index (e.g. positioned at creation time or already there).
    // Avoid redundant updateDocumentTabProperties call which triggers upstream Google 500 bugs on docs without t.0.
    runtime.stepsExecuted++;
    return;
  }

  if (!runtime.dryRun && !targetDoc.docId.startsWith("virtual:")) {
    const req = RequestBuilder.moveTab(resolved.tabId, targetIndex);
    try {
      await runtime.client.batchUpdate(targetDoc.docId, [req]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const hasRootTab = targetDoc.gdoc.data.tabs?.some((t) => t.tabProperties?.tabId === "t.0");
      if (!hasRootTab && errMsg.includes("500")) {
        throw new Error(
          `Google Docs API failed to move tab with HTTP 500 Internal error.\n` +
            `This is a known Google Docs API upstream bug when documents lack a root "t.0" tab (common in documents copied from multi-tab templates).\n` +
            `To position tabs without relying on tabMove, specify index: <n> directly during tab creation:\n` +
            `  { kind: "tabDuplicate", copyFromTab: "${resolved.tabId}", title: "${resolved.title}", index: ${targetIndex} }\n` +
            `or\n` +
            `  { kind: "tabAdd", title: "${resolved.title}", index: ${targetIndex} }`,
        );
      }
      throw err;
    }
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    const tabs: DocTab[] = targetDoc.gdoc.data.tabs ? [...targetDoc.gdoc.data.tabs] : [];
    const fromIdx = tabs.findIndex((t) => t.tabProperties?.tabId === resolved.tabId);
    if (fromIdx >= 0) {
      const [moved] = tabs.splice(fromIdx, 1);
      if (moved) {
        const destIdx = Math.max(0, Math.min(targetIndex, tabs.length));
        tabs.splice(destIdx, 0, moved);
      }
      targetDoc.gdoc = new Gdoc(
        {
          ...targetDoc.gdoc.data,
          tabs,
        },
        targetDoc.docId,
      );
    }
  }

  runtime.stepsExecuted++;
};
