/* Workflow step: tabRename — rename a document tab. */

import { docCache } from "~/core/cache/docCache.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveTab } from "~/core/tabs.ts";
import { pendingWritersFlush } from "./flush.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Renames a tab by id or title hint on an open document. */
export const tabRenameStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  if (step.noop) {
    runtime.stepsExecuted++;
    return;
  }

  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
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
            `This is a known upstream Google Docs API bug when documents lack a root "t.0" tab (common in documents copied from multi-tab templates).\n` +
            `Existing tabs must be renamed in the Google Docs web UI. For newly added tabs, specify the final title directly during creation:\n` +
            `  { kind: "tabCreate", doc: "${targetDoc.alias}", as: "my_tab", fromTab: "${resolved.tabId}", title: "${title}" }\n` +
            `or\n` +
            `  { kind: "tabCreate", doc: "${targetDoc.alias}", as: "my_tab", title: "${title}" }`,
        );
      }
      throw err;
    }
    docCache.invalidate(targetDoc.docId);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
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
