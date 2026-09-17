/* Workflow step: docCopy — copy a Drive file into a new document alias. */

import { exportDocumentToMarkdown } from "~/core/dom/export.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { gwsDrive } from "~/core/gws.ts";
import { flattenTabs } from "~/core/tabs.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import type { SimulatedGdoc, WorkflowStepHandler } from "./types.ts";

/** Copies an existing document into a new id and opens it in the session. */
export const docCopyStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const copyFrom = runtime.aliasResolve(step.copyFrom);
  if (!copyFrom) throw new Error(`steps[${stepIndex}] docCopy requires copyFrom: <docId>`);
  const title = step.title ?? "Copy of Document";
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] docCopy requires "as: <alias>"`);

  let newDocId = `virtual:${as}`;
  let gdoc: Gdoc;

  if (runtime.dryRun) {
    const sourceContext =
      runtime.openDocs.get(copyFrom) ?? Array.from(runtime.openDocs.values()).find((d) => d.docId === copyFrom);
    if (sourceContext) {
      gdoc = new Gdoc({ ...structuredClone(sourceContext.gdoc.data), documentId: newDocId, title }, newDocId);
      const sourceSim = sourceContext.gdoc as SimulatedGdoc;
      if (sourceSim.simulatedNodes) {
        simulatedNodesSet(gdoc, structuredClone(sourceSim.simulatedNodes));
      }
      if (sourceSim.simulatedTabs) {
        for (const [tId, nodes] of sourceSim.simulatedTabs.entries()) {
          simulatedNodesSet(gdoc, structuredClone(nodes), tId);
        }
      }
    } else {
      try {
        const loaded = runtime.preloadedDocs?.get(copyFrom) ?? (await Gdoc.load(copyFrom, runtime.client));
        gdoc = new Gdoc({ ...structuredClone(loaded.data), documentId: newDocId, title }, newDocId);
      } catch {
        gdoc = new Gdoc({ documentId: newDocId, title }, newDocId);
      }
    }
  } else {
    const res = await gwsDrive.copyFile(copyFrom, title);
    newDocId = res.id;
    gdoc = await Gdoc.load(newDocId, runtime.client);
  }

  const openContext = {
    alias: as,
    docId: newDocId,
    gdoc,
    isVirtual: runtime.dryRun,
    title,
  };

  const tabs = flattenTabs(gdoc.data.tabs);
  const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  const dumpPayload = {
    alias: as,
    id: newDocId,
    kind: "doc",
    tabs: tabsToCheck.map((t) => ({
      id: t.tabId,
      kind: "tab",
      title: t.title,
    })),
    title,
  };

  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(newDocId, as);
  runtime.aliasMap.set(as, newDocId);
  runtime.dumpStore.set(as, dumpPayload);
  if (step.dump) {
    runtime.dumped[as] = dumpPayload;
  }
  runtime.activeDocAlias = as;

  for (const t of tabsToCheck) {
    const key = `${as}/${t.tabId}`;
    if (!runtime.initialMarkdownStates.has(key)) {
      const simulated = simulatedNodesOf(gdoc, t.tabId);
      if (simulated) {
        const exp = exportDocumentToMarkdown([{ nodes: simulated, tabId: t.tabId, tabTitle: t.title }]);
        runtime.initialMarkdownStates.set(key, exp.markdown);
      } else {
        const md = await runtime.tabMarkdownCapture(openContext, t.tabId);
        runtime.initialMarkdownStates.set(key, md);
      }
    }
  }

  runtime.createdHighlights.set(as, {
    as,
    id: newDocId,
    title,
  });

  runtime.stepsExecuted++;
};
