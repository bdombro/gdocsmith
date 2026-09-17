/* Workflow step: tabAdd — add a tab to a multi-tab document. */

import { Gdoc } from "~/core/gdoc.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { flattenTabs, resolveRelativeTabIndex } from "~/core/tabs.ts";
import { tabCopyStep } from "./tabCopy.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Adds a document tab and optionally binds a tab alias. */
export const tabAddStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  if (step.copyFromTab) {
    await tabCopyStep(runtime, stepIndex, step);
    return;
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const title = step.title;
  if (!title) throw new Error(`steps[${stepIndex}] tabAdd requires title: <string>`);
  const as = step.as;

  const existingFlat = flattenTabs(targetDoc.gdoc.data.tabs);
  if (existingFlat.some((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
    throw new Error(`Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`);
  }

  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: step.afterTab,
    beforeTab: step.beforeTab,
    index: step.index,
  });

  let newTabId = `virtual:tab_${as ?? targetDoc.alias}_${runtime.stepsExecuted}`;
  if (!runtime.dryRun) {
    const req = RequestBuilder.addDocumentTab(title, { index: targetIndex });
    const resStr = await runtime.client.batchUpdate(targetDoc.docId, [req]);
    const res = JSON.parse(resStr || "{}");
    newTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId ?? newTabId;
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    const existingTabs = targetDoc.gdoc.data.tabs?.length
      ? targetDoc.gdoc.data.tabs
      : [
          {
            documentTab: { body: targetDoc.gdoc.data.body },
            tabProperties: { index: 0, tabId: "t.0", title: "Main" },
          },
        ];
    const newDocTab = {
      documentTab: {
        body: {
          content: [
            { endIndex: 1, sectionBreak: {}, startIndex: 0 },
            {
              endIndex: 2,
              paragraph: { elements: [{ textRun: { content: "\n" } }] },
              startIndex: 1,
            },
          ],
        },
      },
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
  }

  const key = `${targetDoc.alias}/${newTabId}`;
  if (!runtime.initialMarkdownStates.has(key)) {
    runtime.initialMarkdownStates.set(key, "");
  }

  if (as) {
    runtime.aliasMap.set(as, newTabId);
    const dumpPayload = {
      alias: as,
      id: newTabId,
      kind: "tab",
      title,
    };
    runtime.dumpStore.set(as, dumpPayload);
    if (step.dump) {
      runtime.dumped[as] = dumpPayload;
    }
  } else if (step.dump) {
    runtime.dumped[newTabId] = {
      id: newTabId,
      kind: "tab",
      title,
    };
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
