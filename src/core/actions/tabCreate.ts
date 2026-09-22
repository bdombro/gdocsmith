/* Workflow step: tabCreate — add a new tab or copy an existing tab. */

import { docCache } from "~/core/cache/docCache.ts";
import { elementSpecFromNode } from "~/core/dom/clone.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { elementsInsertExecute } from "~/core/markdown.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveRelativeTabIndex, resolveTab } from "~/core/tabs.ts";
import type { DocTab } from "~/core/types.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import { detectLossyTabElements, lossyTabCopyError } from "./tabLossyScan.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Adds a new document tab or copies an existing tab with its content. */
export const tabCreateStep: WorkflowStepHandler = async (
  /** Script runtime context. */
  runtime,
  /** Zero-based index of this step in the workflow. */
  stepIndex,
  /** Workflow step input. */
  step,
) => {
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] tabCreate requires "as: <alias>"`);
  const title = step.title;
  if (!title) throw new Error(`steps[${stepIndex}] tabCreate requires title: <string>`);

  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const existingFlat = flattenTabs(targetDoc.gdoc.data.tabs);
  if (existingFlat.some((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
    throw new Error(`Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`);
  }

  const afterTabHint = step.afterTab ? runtime.aliasResolve(step.afterTab) : undefined;
  const beforeTabHint = step.beforeTab ? runtime.aliasResolve(step.beforeTab) : undefined;
  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: afterTabHint,
    beforeTab: beforeTabHint,
    index: step.index,
  });

  const fromTabHint = step.fromTab ? runtime.aliasResolve(step.fromTab) : undefined;
  let newTabId = `virtual:tab_${as}_${runtime.stepsExecuted}`;

  if (fromTabHint) {
    const sourceDocRef = step.fromDoc ? runtime.aliasResolve(step.fromDoc) : undefined;
    const sourceDoc = sourceDocRef ? runtime.openDocResolve(sourceDocRef) : targetDoc;
    const resolvedSourceTab = sourceDoc.gdoc.data.tabs?.length
      ? resolveTab(sourceDoc.gdoc.data, fromTabHint)
      : { tabId: "t.0", title: sourceDoc.title };
    const sourceTabId = resolvedSourceTab.tabId;
    if (!sourceTabId) {
      throw new Error(`steps[${stepIndex}] tabCreate could not resolve source tab "${fromTabHint}"`);
    }

    const force = runtime.force || Boolean(step.force);
    const sourceSimulated = simulatedNodesOf(sourceDoc.gdoc, sourceTabId);
    const parsedSource = sourceSimulated
      ? { nodes: sourceSimulated }
      : parseDocument(sourceDoc.gdoc.withTab(sourceTabId));
    const lossyScan = detectLossyTabElements(parsedSource.nodes);

    if (lossyScan.details.length > 0 && !force) {
      throw new Error(lossyTabCopyError(stepIndex, resolvedSourceTab.title ?? fromTabHint, lossyScan));
    }

    const copyWarnings: string[] = [...lossyScan.details];

    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      const existingTabs = targetDoc.gdoc.data.tabs?.length
        ? targetDoc.gdoc.data.tabs
        : [
            {
              documentTab: { body: targetDoc.gdoc.data.body },
              tabProperties: { index: 0, tabId: "t.0", title: "Main" },
            },
          ];

      const sourceDocTab = sourceDoc.gdoc.data.tabs?.length ? findTab(sourceDoc.gdoc.data.tabs, sourceTabId) : null;
      const sourceBody = sourceDocTab?.documentTab?.body ?? targetDoc.gdoc.data.body;

      const newDocTab: DocTab = {
        documentTab: {
          body: structuredClone(sourceBody),
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

      simulatedNodesSet(targetDoc.gdoc, structuredClone(sourceSimulated ?? parsedSource.nodes), newTabId);
    } else {
      const req = RequestBuilder.addDocumentTab(title, { index: targetIndex });
      const resStr = await runtime.client.batchUpdate(targetDoc.docId, [req]);
      const res = JSON.parse(resStr || "{}");
      const createdTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
      if (!createdTabId) {
        throw new Error(`steps[${stepIndex}] tabCreate: addDocumentTab reply did not include created tabId`);
      }
      newTabId = createdTabId;
      docCache.invalidate(targetDoc.docId);
      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });

      const specs = parsedSource.nodes
        .filter((n) => n.kind !== "sectionBreak")
        .map((n) => {
          const spec = elementSpecFromNode(n);
          if ("warnings" in spec && Array.isArray(spec.warnings)) {
            copyWarnings.push(...spec.warnings);
          }
          return spec;
        });

      if (specs.length > 0) {
        await elementsInsertExecute({
          client: runtime.client,
          documentId: targetDoc.docId,
          elements: specs,
          force,
          tabHint: newTabId,
        });
      }

      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    }

    if (runtime.dryRun) {
      const key = `${targetDoc.alias}/${newTabId}`;
      if (!runtime.initialMarkdownStates.has(key)) {
        runtime.initialMarkdownStates.set(key, "");
      }
    }

    runtime.aliasMap.set(as, newTabId);
    const dumpPayload: { alias?: string; id: string; kind: string; title: string; warnings?: string[] } = {
      alias: as,
      id: newTabId,
      kind: "tab",
      title,
      ...(copyWarnings.length > 0 ? { warnings: Array.from(new Set(copyWarnings)) } : {}),
    };
    runtime.dumpStore.set(as, dumpPayload);
    if (step.dump) {
      runtime.dumped[as] = dumpPayload;
    }
  } else {
    // Blank tab creation
    if (!runtime.dryRun) {
      const req = RequestBuilder.addDocumentTab(title, { index: targetIndex });
      const resStr = await runtime.client.batchUpdate(targetDoc.docId, [req]);
      const res = JSON.parse(resStr || "{}");
      const createdTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
      if (!createdTabId) {
        throw new Error(`steps[${stepIndex}] tabCreate: addDocumentTab reply did not include created tabId`);
      }
      newTabId = createdTabId;
      docCache.invalidate(targetDoc.docId);
      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
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

    if (runtime.dryRun) {
      const key = `${targetDoc.alias}/${newTabId}`;
      if (!runtime.initialMarkdownStates.has(key)) {
        runtime.initialMarkdownStates.set(key, "");
      }
    }

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
