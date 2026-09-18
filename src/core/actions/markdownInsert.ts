/* Workflow step: markdownInsert — insert markdown at an anchor. */

import { readFileSync } from "node:fs";
import { DomWriter, findNodeAt } from "~/core/dom/index.ts";
import { createSymbolicLinkResolver } from "~/core/dom/linkResolver.ts";
import { markdownStylesParse, parseMarkdownToElements } from "~/core/dom/markdownParser.ts";
import { assignScopedIds, parseDocument } from "~/core/dom/parse.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { markdownInsertExecute } from "~/core/markdown.ts";
import { findTab, resolveTab } from "~/core/tabs.ts";
import type { ApplyHighlightHeadingJson } from "~/core/workflowTypes.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Inserts markdown content at an anchor on an open document. */
export const markdownInsertStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);

  let markdown = step.markdown ?? step.text;
  if (!markdown && step.file) {
    markdown = step.file === "-" ? readFileSync(0, "utf8") : readFileSync(step.file, "utf8");
  }
  if (!markdown) {
    throw new Error(`steps[${stepIndex}] markdownInsert requires markdown:, text:, or file:`);
  }

  const rawAnchor = step.nodeAt ?? step.nodeAfter ?? step.nodeBefore;
  const anchorId = runtime.aliasResolve(rawAnchor);
  const position = step.nodeBefore != null ? "beforebegin" : "afterend";
  const h1IsTitle = Boolean(step.h1IsTitle);
  const customStyles = markdownStylesParse(step.markdownStyles ?? null);

  const liveTab = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };

  if (!runtime.dryRun) {
    await pendingWritersFlush(runtime, targetDoc.alias);
    await markdownInsertExecute({
      anchorId,
      client: runtime.client,
      customStyles,
      doc: targetDoc.gdoc.data,
      documentId: targetDoc.docId,
      force: runtime.force,
      h1IsTitle,
      linkResolver: createSymbolicLinkResolver({ currentTabId: liveTab.tabId, doc: targetDoc.gdoc.data }),
      markdown,
      position,
      tabHint,
    });
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
    const simulatedNodes = simulatedNodesOf(targetDoc.gdoc, liveTab.tabId);
    const parsed = simulatedNodes
      ? { nodes: simulatedNodes, segments: [], title: targetDoc.title }
      : parseDocument(gdoc);
    const simTabs = (targetDoc.gdoc as import("./types.ts").SimulatedGdoc).simulatedTabs;
    const writer = new DomWriter(parsed.nodes, {
      doc: targetDoc.gdoc.data,
      force: runtime.force,
      lists: gdoc.data.lists,
      simulatedTabs: simTabs,
      tabId: liveTab.tabId,
    });

    const elements = parseMarkdownToElements(markdown, {
      customStyles,
      h1IsTitle,
      linkResolver: writer.linkResolver,
    });
    if (elements.length > 0) {
      const startAnchor = anchorId ? findNodeAt(parsed.nodes, anchorId) : parsed.nodes[parsed.nodes.length - 1];
      if (startAnchor) {
        let anchorNode = startAnchor;
        for (const el of elements) {
          const created = writer.insertAdjacentElement(anchorNode, position, el);
          if (position === "afterend") anchorNode = created;
        }
      }
    }
    const existingSim = targetDoc.gdoc as import("./types.ts").SimulatedGdoc;
    const simNodes = existingSim.simulatedNodes;

    targetDoc.gdoc = new Gdoc(
      {
        ...targetDoc.gdoc.data,
      },
      targetDoc.docId,
    );
    if (simNodes) (targetDoc.gdoc as import("./types.ts").SimulatedGdoc).simulatedNodes = simNodes;
    if (simTabs) (targetDoc.gdoc as import("./types.ts").SimulatedGdoc).simulatedTabs = simTabs;

    assignScopedIds(writer.nodes);
    simulatedNodesSet(targetDoc.gdoc, writer.nodes, liveTab.tabId);

    // Sync simulated nodes back into targetDoc.gdoc.data tab/body so parseDocument sees them
    if (liveTab.tabId && targetDoc.gdoc.data.tabs?.length) {
      const tab = findTab(targetDoc.gdoc.data.tabs, liveTab.tabId);
      if (tab) {
        if (!tab.documentTab) tab.documentTab = {};
        const elements = writer.nodes.map((n, i) => ({
          endIndex: (i + 1) * 2,
          paragraph: {
            elements: [{ textRun: { content: `${n.text ?? ""}\n` } }],
            paragraphStyle: { namedStyleType: n.namedStyleType ?? "NORMAL_TEXT" },
          },
          startIndex: i * 2,
        }));
        tab.documentTab.body = { content: elements };
      }
    }
  }

  const resolvedTab = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };
  const targetTabId = resolvedTab.tabId ?? "t.0";
  const simulated = simulatedNodesOf(targetDoc.gdoc, resolvedTab.tabId);
  const afterParsed = simulated
    ? { nodes: simulated }
    : parseDocument(resolvedTab.tabId ? targetDoc.gdoc.withTab(resolvedTab.tabId) : targetDoc.gdoc);
  const headings: ApplyHighlightHeadingJson[] = afterParsed.nodes
    .filter(
      (n: DocNode) =>
        n.kind === "paragraph" && (n.namedStyleType?.startsWith("HEADING_") || n.namedStyleType === "TITLE"),
    )
    .map((h: DocNode) => ({ id: h.headingId ?? String(h.tapeIndex), text: h.text ?? "" }));

  if (headings.length > 0) {
    let docHighlight = runtime.createdHighlights.get(targetDoc.alias);
    if (!docHighlight) {
      docHighlight = { as: targetDoc.alias, id: targetDoc.docId, tabs: [], title: targetDoc.title };
      runtime.createdHighlights.set(targetDoc.alias, docHighlight);
    }
    docHighlight.tabs = docHighlight.tabs ?? [];
    let tabHighlight = docHighlight.tabs.find((t) => t.id === targetTabId);
    if (!tabHighlight) {
      tabHighlight = { id: targetTabId };
      docHighlight.tabs.push(tabHighlight);
    }
    tabHighlight.headings = headings;
  }

  runtime.stepsExecuted++;
};
