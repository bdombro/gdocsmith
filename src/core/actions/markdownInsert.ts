/* Workflow step: markdownInsert — insert markdown or YAML DOM at an anchor. */

import { readFileSync } from "node:fs";
import { DomWriter, findNodeAt } from "~/core/dom/index.ts";
import { markdownStylesParse, parseMarkdownToElements } from "~/core/dom/markdownParser.ts";
import { assignScopedIds, parseDocument } from "~/core/dom/parse.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { markdownInsertExecute, yamlInsertExecute } from "~/core/markdown.ts";
import { resolveTab } from "~/core/tabs.ts";
import type { ApplyHighlightHeadingJson } from "~/core/workflowTypes.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Inserts markdown or YAML DOM content at an anchor on an open document. */
export const markdownInsertStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);

  let markdown = step.text ?? step.markdown;
  if (!markdown && step.file) {
    markdown = step.file === "-" ? readFileSync(0, "utf8") : readFileSync(step.file, "utf8");
  }
  if (!markdown) {
    throw new Error(`steps[${stepIndex}] markdownInsert requires text: or file:`);
  }

  const anchorId = runtime.aliasResolve(step.at ?? step.after ?? step.before);
  const position = step.before != null ? "beforebegin" : "afterend";
  const h1IsTitle = Boolean(step.h1IsTitle);
  const customStyles = markdownStylesParse(step.markdownStyles ?? null);

  if (!runtime.dryRun) {
    const isYaml = markdown.trimStart().startsWith("nodes:") || markdown.trimStart().startsWith("- kind:");

    if (isYaml) {
      await yamlInsertExecute({
        anchorId,
        client: runtime.client,
        documentId: targetDoc.docId,
        force: runtime.force,
        position,
        tabHint,
        yaml: markdown,
      });
    } else {
      await markdownInsertExecute({
        anchorId,
        client: runtime.client,
        customStyles,
        documentId: targetDoc.docId,
        force: runtime.force,
        h1IsTitle,
        markdown,
        position,
        tabHint,
      });
    }
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    const liveTab = targetDoc.gdoc.data.tabs?.length
      ? resolveTab(targetDoc.gdoc.data, tabHint)
      : { tabId: undefined, title: targetDoc.title };
    const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
    const parsed = parseDocument(gdoc);
    const writer = new DomWriter(parsed.nodes, {
      force: runtime.force,
      lists: gdoc.data.lists,
      tabId: liveTab.tabId,
    });

    const elements = parseMarkdownToElements(markdown, { customStyles, h1IsTitle });
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
    targetDoc.gdoc = new Gdoc(
      {
        ...gdoc.data,
        body: { content: [] },
      },
      targetDoc.docId,
    );
    assignScopedIds(writer.nodes);
    simulatedNodesSet(targetDoc.gdoc, writer.nodes);
  }

  const targetTabId = tabHint ?? "t.0";
  const simulated = simulatedNodesOf(targetDoc.gdoc);
  const afterParsed = simulated
    ? { nodes: simulated }
    : parseDocument(tabHint ? targetDoc.gdoc.withTab(tabHint) : targetDoc.gdoc);
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
