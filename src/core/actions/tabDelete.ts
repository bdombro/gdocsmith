/* Workflow step: tabDelete — remove a document tab. */

import { Gdoc } from "~/core/gdoc.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { flattenTabs, resolveTab } from "~/core/tabs.ts";
import { pendingWritersFlush } from "./flush.ts";
import type { SimulatedGdoc, WorkflowStepHandler } from "./types.ts";

/** Deletes a tab by id or title hint on an open document. */
export const tabDeleteStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint) throw new Error(`steps[${stepIndex}] tabDelete requires tab: <id|title>`);

  const resolved = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };
  if (!resolved.tabId) {
    throw new Error(`Cannot delete tab "${tabHint}": resolved tab has no tabId`);
  }

  const flatTabs = flattenTabs(targetDoc.gdoc.data.tabs);
  const tabsRemaining = flatTabs.filter((t) => t.tabId !== resolved.tabId);
  if (tabsRemaining.length === 0) {
    throw new Error(
      `Cannot delete tab "${tabHint}": document "${targetDoc.alias}" only has one tab. Google Docs requires at least one tab.`,
    );
  }

  if (!runtime.dryRun && !targetDoc.docId.startsWith("virtual:")) {
    const req = RequestBuilder.deleteTab(resolved.tabId);
    await runtime.client.batchUpdate(targetDoc.docId, [req]);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    const tabs = targetDoc.gdoc.data.tabs ? [...targetDoc.gdoc.data.tabs] : [];
    const fromIdx = tabs.findIndex((t) => t.tabProperties?.tabId === resolved.tabId);
    if (fromIdx >= 0) {
      tabs.splice(fromIdx, 1);
      targetDoc.gdoc = new Gdoc({ ...targetDoc.gdoc.data, tabs }, targetDoc.docId);
    }
    const sim = targetDoc.gdoc as SimulatedGdoc;
    sim.simulatedTabs?.delete(resolved.tabId);
    for (const key of [...runtime.initialMarkdownStates.keys()]) {
      if (key.startsWith(`${targetDoc.alias}/${resolved.tabId}`)) {
        runtime.initialMarkdownStates.delete(key);
      }
    }
  }

  runtime.stepsExecuted++;
};
