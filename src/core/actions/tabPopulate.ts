/* Workflow step: tabPopulate — copy whole-tab content into an existing tab server-side. */

import { docCache } from "~/core/cache/docCache.ts";
import { elementSpecFromNode } from "~/core/dom/clone.ts";
import { applyDom, DomWriter, dangerousClearExecute } from "~/core/dom/index.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { elementsInsertExecute } from "~/core/markdown.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveTab } from "~/core/tabs.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import { detectLossyTabElements, lossyTabCopyError } from "./tabLossyScan.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Populates an existing document tab with whole-tab content from another tab. */
export const tabPopulateStep: WorkflowStepHandler = async (
  /** Script runtime context. */
  runtime,
  /** Zero-based index of this step in the workflow. */
  stepIndex,
  /** Workflow step input. */
  step,
) => {
  const docRef = step.doc;
  if (!docRef) throw new Error(`steps[${stepIndex}] tabPopulate requires doc: <documentId|alias>`);
  const targetTabHint = runtime.aliasResolve(step.tab);
  if (!targetTabHint) throw new Error(`steps[${stepIndex}] tabPopulate requires tab: <id|title>`);
  const fromTabHint = runtime.aliasResolve(step.fromTab);
  if (!fromTabHint) throw new Error(`steps[${stepIndex}] tabPopulate requires fromTab: <id|title>`);

  await pendingWritersFlush(runtime, docRef);

  const targetDoc = runtime.openDocResolve(docRef);
  const resolvedTargetTab = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, targetTabHint)
    : { tabId: "t.0", title: targetDoc.title };
  const targetTabId = resolvedTargetTab.tabId;
  if (!targetTabId) {
    throw new Error(`steps[${stepIndex}] tabPopulate: could not resolve target tab "${targetTabHint}"`);
  }

  const sourceDocRef = step.fromDoc ? runtime.aliasResolve(step.fromDoc) : undefined;
  const sourceDoc = sourceDocRef ? runtime.openDocResolve(sourceDocRef) : targetDoc;
  const resolvedSourceTab = sourceDoc.gdoc.data.tabs?.length
    ? resolveTab(sourceDoc.gdoc.data, fromTabHint)
    : { tabId: "t.0", title: sourceDoc.title };
  const sourceTabId = resolvedSourceTab.tabId;
  if (!sourceTabId) {
    throw new Error(`steps[${stepIndex}] tabPopulate: could not resolve source tab "${fromTabHint}"`);
  }

  const title = step.title?.trim();
  if (title) {
    const existingTabs = flattenTabs(targetDoc.gdoc.data.tabs);
    const otherTabs = existingTabs.filter((t) => t.tabId !== targetTabId);
    if (otherTabs.some((t) => t.title.trim().toLowerCase() === title.toLowerCase())) {
      throw new Error(
        `Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`,
      );
    }
  }

  const force = runtime.force || Boolean(step.force);
  const sourceSimulated = simulatedNodesOf(sourceDoc.gdoc, sourceTabId);
  const parsedSource = sourceSimulated
    ? { nodes: sourceSimulated }
    : parseDocument(sourceDoc.gdoc.withTab(sourceTabId));
  const lossyScan = detectLossyTabElements(parsedSource.nodes);

  if (lossyScan.details.length > 0 && !force) {
    throw new Error(lossyTabCopyError(stepIndex, resolvedSourceTab.title ?? fromTabHint, lossyScan, "tabPopulate"));
  }

  const copyWarnings: string[] = [...lossyScan.details];

  const targetSimulated = simulatedNodesOf(targetDoc.gdoc, targetTabId);
  const parsedTarget = targetSimulated
    ? { nodes: targetSimulated }
    : parseDocument(targetTabId ? targetDoc.gdoc.withTab(targetTabId) : targetDoc.gdoc);

  const targetContentNodes = parsedTarget.nodes.filter((n) => n.kind !== "sectionBreak");
  const isTargetEmpty = tabContentEmptyCheck(targetContentNodes);

  if (!isTargetEmpty && !force) {
    throw new Error(
      `steps[${stepIndex}] tabPopulate: target tab "${resolvedTargetTab.title ?? targetTabHint}" already contains content (${targetContentNodes.length} node(s)). Pass force: true to overwrite.`,
    );
  }

  if (!runtime.dryRun && !targetDoc.docId.startsWith("virtual:")) {
    if (title && title !== resolvedTargetTab.title) {
      const req = RequestBuilder.renameTab(targetTabId, title);
      await runtime.client.batchUpdate(targetDoc.docId, [req]);
      docCache.invalidate(targetDoc.docId);
      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    }

    if (!isTargetEmpty) {
      const gdocTab = targetTabId ? targetDoc.gdoc.withTab(targetTabId) : targetDoc.gdoc;
      const parsedToClear = parseDocument(gdocTab);
      const writer = new DomWriter(parsedToClear.nodes, {
        force: true,
        lists: gdocTab.data.lists,
        tabId: targetTabId,
      });
      dangerousClearExecute(writer);
      await applyDom(targetDoc.docId, writer, {
        client: runtime.client,
        doc: gdocTab.data,
        force: true,
      });
      docCache.invalidate(targetDoc.docId);
      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    }

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
        tabHint: targetTabId,
      });
    }

    docCache.invalidate(targetDoc.docId);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    if (title && targetDoc.gdoc.data.tabs?.length) {
      const tab = findTab(targetDoc.gdoc.data.tabs, targetTabId);
      if (tab?.tabProperties) {
        tab.tabProperties.title = title;
      }
    }

    const sourceDocTab = sourceDoc.gdoc.data.tabs?.length ? findTab(sourceDoc.gdoc.data.tabs, sourceTabId) : null;
    const sourceBody = sourceDocTab?.documentTab?.body ?? targetDoc.gdoc.data.body;

    if (targetDoc.gdoc.data.tabs?.length) {
      const tab = findTab(targetDoc.gdoc.data.tabs, targetTabId);
      if (tab) {
        if (!tab.documentTab) tab.documentTab = {};
        tab.documentTab.body = structuredClone(sourceBody);
      }
    }

    simulatedNodesSet(targetDoc.gdoc, structuredClone(sourceSimulated ?? parsedSource.nodes), targetTabId);
  }

  const finalTitle = title ?? resolvedTargetTab.title ?? "Tab";
  if (step.as) {
    runtime.aliasMap.set(step.as, targetTabId);
  }
  const dumpPayload = {
    alias: step.as,
    id: targetTabId,
    kind: "tab",
    title: finalTitle,
    ...(copyWarnings.length > 0 ? { warnings: Array.from(new Set(copyWarnings)) } : {}),
  };
  if (step.as) {
    runtime.dumpStore.set(step.as, dumpPayload);
  }
  if (step.dump && step.as) {
    runtime.dumped[step.as] = dumpPayload;
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
  const existingHighlightTab = highlight.tabs.find((t) => t.id === targetTabId);
  if (existingHighlightTab) {
    existingHighlightTab.title = finalTitle;
    if (step.as) existingHighlightTab.as = step.as;
  } else {
    highlight.tabs.push({
      as: step.as,
      id: targetTabId,
      title: finalTitle,
    });
  }

  runtime.stepsExecuted++;
};

/** Checks whether a tab contains only empty placeholder paragraphs or no content. */
function tabContentEmptyCheck(
  /** Parsed document nodes of the candidate tab. */
  nodes: DocNode[],
): boolean {
  if (nodes.length === 0) return true;
  if (nodes.length === 1) {
    const n = nodes[0]!;
    return n.kind === "paragraph" && !n.text?.trim() && !n.images?.length && !n.chips?.length && !n.bullet;
  }
  return false;
}
