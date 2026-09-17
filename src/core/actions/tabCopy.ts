/* Workflow step: tabCopy / tabDuplicate — copy an existing tab and its content to a new tab. */

import { exportDocumentToMarkdown } from "~/core/dom/export.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { markdownInsertExecute } from "~/core/markdown.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveRelativeTabIndex, resolveTab } from "~/core/tabs.ts";
import type { DocTab } from "~/core/types.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Duplicates an existing document tab with its content and adds it to a target document. */
export const tabCopyStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const title = step.title;
  if (!title) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabCopy"} requires title: <string>`);
  }

  const existingFlat = flattenTabs(targetDoc.gdoc.data.tabs);
  if (existingFlat.some((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
    throw new Error(`Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`);
  }

  const sourceTabHint = runtime.aliasResolve(step.copyFromTab ?? step.tab);
  if (!sourceTabHint) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabCopy"} requires copyFromTab: <tabId|title>`);
  }

  const sourceDocRef = runtime.aliasResolve(step.copyFromDoc);
  const sourceDoc = sourceDocRef ? runtime.openDocResolve(sourceDocRef) : targetDoc;
  const resolvedSourceTab = sourceDoc.gdoc.data.tabs?.length
    ? resolveTab(sourceDoc.gdoc.data, sourceTabHint)
    : { tabId: "t.0", title: sourceDoc.title };
  const sourceTabId = resolvedSourceTab.tabId;
  if (!sourceTabId) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabCopy"} could not resolve source tab "${sourceTabHint}"`);
  }

  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: step.afterTab,
    beforeTab: step.beforeTab,
    index: step.index,
  });

  const as = step.as;
  let newTabId = `virtual:tab_${as ?? targetDoc.alias}_${runtime.stepsExecuted}`;

  if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
    const existingTabs = targetDoc.gdoc.data.tabs?.length
      ? targetDoc.gdoc.data.tabs
      : [
          {
            documentTab: { body: targetDoc.gdoc.data.body },
            tabProperties: { index: 0, tabId: "t.0", title: "Main" },
          },
        ];

    const sourceTab = findTab(sourceDoc.gdoc.data.tabs, sourceTabId);
    const clonedBody = sourceTab?.documentTab?.body ?? sourceDoc.gdoc.data.body ?? { content: [] };
    const clonedDocTab = sourceTab?.documentTab ?? { body: clonedBody };

    const newDocTab: DocTab = {
      documentTab: structuredClone(clonedDocTab),
      tabProperties: {
        index: targetIndex ?? existingTabs.length,
        tabId: newTabId,
        title,
      },
    };

    const existingSim = targetDoc.gdoc as import("./types.ts").SimulatedGdoc;
    const simNodes = existingSim.simulatedNodes;
    const simTabs = existingSim.simulatedTabs;

    const nextTabs = [...existingTabs];
    if (targetIndex != null && Number.isInteger(targetIndex)) {
      const clampedIdx = Math.max(0, Math.min(targetIndex, nextTabs.length));
      nextTabs.splice(clampedIdx, 0, newDocTab);
    } else {
      nextTabs.push(newDocTab);
    }

    targetDoc.gdoc = new Gdoc(
      {
        ...targetDoc.gdoc.data,
        tabs: nextTabs,
      },
      targetDoc.docId,
    );
    if (simNodes) (targetDoc.gdoc as import("./types.ts").SimulatedGdoc).simulatedNodes = simNodes;
    if (simTabs) (targetDoc.gdoc as import("./types.ts").SimulatedGdoc).simulatedTabs = simTabs;

    const sourceSimulated = simulatedNodesOf(sourceDoc.gdoc, sourceTabId);
    if (sourceSimulated) {
      simulatedNodesSet(targetDoc.gdoc, structuredClone(sourceSimulated), newTabId);
    }
  } else {
    const req = RequestBuilder.addDocumentTab(title, { index: targetIndex });
    const resStr = await runtime.client.batchUpdate(targetDoc.docId, [req]);
    const res = JSON.parse(resStr || "{}");
    const createdTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
    if (!createdTabId) {
      throw new Error(`Failed to create tab "${title}" on document ${targetDoc.docId}`);
    }
    newTabId = createdTabId;

    const parsedSource = parseDocument(sourceDoc.gdoc.withTab(sourceTabId));
    const exp = exportDocumentToMarkdown([
      { nodes: parsedSource.nodes, tabId: sourceTabId, tabTitle: resolvedSourceTab.title },
    ]);

    if (exp.markdown.trim()) {
      await markdownInsertExecute({
        client: runtime.client,
        documentId: targetDoc.docId,
        force: runtime.force,
        markdown: exp.markdown,
        tabHint: newTabId,
      });
    }

    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  }

  const key = `${targetDoc.alias}/${newTabId}`;
  if (!runtime.initialMarkdownStates.has(key)) {
    runtime.initialMarkdownStates.set(key, "");
  }

  if (as) {
    runtime.aliasMap.set(as, newTabId);
  }

  const dumpPayload = {
    alias: as,
    id: newTabId,
    kind: "tab",
    title,
  };
  if (as) {
    runtime.dumpStore.set(as, dumpPayload);
  }
  if (step.dump) {
    runtime.dumped[as ?? newTabId] = dumpPayload;
  }

  let highlight = runtime.createdHighlights.get(targetDoc.alias);
  if (!highlight) {
    highlight = {
      as: targetDoc.alias,
      id: targetDoc.docId,
      tabs: [],
      title: targetDoc.title,
    };
    runtime.createdHighlights.set(targetDoc.alias, highlight);
  }
  if (!highlight.tabs) highlight.tabs = [];
  highlight.tabs.push({
    as,
    id: newTabId,
    title,
  });

  runtime.stepsExecuted++;
};
