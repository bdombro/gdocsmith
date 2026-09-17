/* Workflow step: tabAdd — add a tab to a multi-tab document. */

import { Gdoc } from "~/core/gdoc.ts";
import { gws } from "~/core/gws.ts";
import { RequestBuilder } from "~/core/requests.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Adds a document tab and optionally binds a tab alias. */
export const tabAddStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const title = step.title;
  if (!title) throw new Error(`steps[${stepIndex}] tabAdd requires title: <string>`);
  const as = step.as;

  let newTabId = `virtual:tab_${as ?? targetDoc.alias}_${runtime.stepsExecuted}`;
  if (!runtime.dryRun) {
    const req = RequestBuilder.addDocumentTab(title, { index: step.index });
    const resStr = await gws.batchUpdate(targetDoc.docId, [req]);
    const res = JSON.parse(resStr || "{}");
    newTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId ?? newTabId;
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    const existingTabs = targetDoc.gdoc.data.tabs ?? [];
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
        index: step.index ?? existingTabs.length,
        tabId: newTabId,
        title,
      },
    };
    targetDoc.gdoc = new Gdoc(
      {
        ...targetDoc.gdoc.data,
        tabs: [...existingTabs, newDocTab],
      },
      targetDoc.docId,
    );
  }

  if (as) {
    runtime.aliasMap.set(as, newTabId);
  }

  runtime.initialMarkdownStates.set(`${targetDoc.alias}/${newTabId}`, "");

  let docHighlight = runtime.createdHighlights.get(targetDoc.alias);
  if (!docHighlight) {
    docHighlight = { as: targetDoc.alias, id: targetDoc.docId, tabs: [], title: targetDoc.title };
    runtime.createdHighlights.set(targetDoc.alias, docHighlight);
  }
  docHighlight.tabs = docHighlight.tabs ?? [];
  docHighlight.tabs.push({ as, id: newTabId, title });

  runtime.stepsExecuted++;
};
