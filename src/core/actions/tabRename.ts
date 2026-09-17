/* Workflow step: tabRename — rename a document tab. */

import { Gdoc } from "~/core/gdoc.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveTab } from "~/core/tabs.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Renames a tab by id or title hint on an open document. */
export const tabRenameStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  if (step.noop) {
    runtime.stepsExecuted++;
    return;
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint) throw new Error(`steps[${stepIndex}] tabRename requires tab: <id|title>`);
  const title = step.title;
  if (!title) throw new Error(`steps[${stepIndex}] tabRename requires title: <string>`);

  const resolved = resolveTab(targetDoc.gdoc.data, tabHint);
  if (!resolved.tabId) {
    throw new Error(`Cannot rename tab "${tabHint}": resolved tab has no tabId`);
  }

  if (resolved.title === title) {
    // Tab already has the requested title; avoid redundant updateDocumentTabProperties.
    runtime.stepsExecuted++;
    return;
  }

  const existingTabs = flattenTabs(targetDoc.gdoc.data.tabs);
  const otherTabs = existingTabs.filter((t) => t.tabId !== resolved.tabId);
  if (otherTabs.some((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
    throw new Error(`Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`);
  }

  if (!runtime.dryRun) {
    const req = RequestBuilder.renameTab(resolved.tabId, title);
    try {
      await runtime.client.batchUpdate(targetDoc.docId, [req]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const hasRootTab = targetDoc.gdoc.data.tabs?.some((t) => t.tabProperties?.tabId === "t.0");
      if (!hasRootTab && errMsg.includes("500")) {
        throw new Error(
          `Google Docs API failed to rename tab with HTTP 500 Internal error.\n` +
            `This is a known Google Docs API upstream bug when documents lack a root "t.0" tab (common in documents copied from multi-tab templates).\n` +
            `To avoid this, specify the desired final title directly during tab creation:\n` +
            `  { kind: "tabDuplicate", copyFromTab: "${resolved.tabId}", title: "${title}" }\n` +
            `or\n` +
            `  { kind: "tabAdd", title: "${title}" }`,
        );
      }
      throw err;
    }
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    if (targetDoc.gdoc.data.tabs?.length) {
      const tab = findTab(targetDoc.gdoc.data.tabs, resolved.tabId);
      if (tab?.tabProperties) {
        tab.tabProperties.title = title;
      }
    }
  }
  runtime.stepsExecuted++;
};
