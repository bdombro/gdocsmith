/* Workflow step: tabCreate — add a new tab or copy an existing tab. */

import { elementSpecFromNode } from "~/core/dom/clone.ts";
import { unclonableFromNode } from "~/core/dom/inlineSpecials.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { elementsInsertExecute } from "~/core/markdown.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveRelativeTabIndex, resolveTab } from "~/core/tabs.ts";
import type { DocTab } from "~/core/types.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
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

  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: step.afterTab,
    beforeTab: step.beforeTab,
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

/** Counts of REST-uncreatable primitives found while scanning a source tab. */
type LossyTabCounts = {
  /** Display titles of smart chips in scan order. */
  chipTitles: string[];
  /** Number of math equations. */
  equations: number;
  /** Number of footnote references. */
  footnotes: number;
  /** Number of horizontal rules. */
  horizontalRules: number;
  /** Number of inline images. */
  images: number;
  /** Number of Table of Contents nodes. */
  toc: number;
};

/** Per-node issue list plus a one-line summary for MCP first-line truncation. */
type LossyTabScan = {
  /** Human-readable per-node issue lines. */
  details: string[];
  /** Compact count summary safe to put on the error's first line. */
  summary: string;
};

/** Detects elements in source tab nodes that cannot be losslessly recreated by the Google Docs REST API. */
function detectLossyTabElements(
  /** Parsed source document tab nodes. */
  nodes: DocNode[],
): LossyTabScan {
  const counts: LossyTabCounts = {
    chipTitles: [],
    equations: 0,
    footnotes: 0,
    horizontalRules: 0,
    images: 0,
    toc: 0,
  };
  const details: string[] = [];
  for (const node of nodes) {
    const msgs = unclonableFromNode(node);
    details.push(...msgs);
    for (const msg of msgs) {
      const chip = msg.match(/(?:person chip|date chip|rich link chip|unsupported smart chip) "([^"]*)"/);
      if (chip) counts.chipTitles.push(chip[1] || "chip");
      else if (msg.includes("inline image")) counts.images++;
      else if (msg.includes("math equation")) counts.equations++;
      else if (msg.includes("footnote")) counts.footnotes++;
      else if (msg.includes("Table of Contents")) counts.toc++;
      else if (msg.includes("horizontal rule")) counts.horizontalRules++;
    }
  }
  return { details, summary: lossyTabScanSummary(counts, details.length) };
}

/** Builds the fail-closed tabCreate error; first line stays actionable after MCP first-line truncation. */
function lossyTabCopyError(
  /** Zero-based workflow step index. */
  stepIndex: number,
  /** Source tab title shown to the caller. */
  sourceTitle: string,
  /** Scan of uncreatable primitives. */
  scan: LossyTabScan,
): string {
  const issueList = scan.details.map((msg) => `  • ${msg}`).join("\n");
  return (
    `steps[${stepIndex}] tabCreate: cannot copy tab "${sourceTitle}" losslessly (${scan.summary}). Use the Google Docs UI (right-click the tab > Duplicate) or pass force: true for lossy conversion.\n` +
    `${issueList}\n\n` +
    `Google Docs REST API has no native tab duplication endpoint. Person, date, and rich-link chips and public https images are reconstructed; Drive-only images, footnotes, equations, unsupported chips, TOC, and horizontal rules cannot.`
  );
}

/** Formats a compact one-line summary of uncreatable primitives. */
function lossyTabScanSummary(
  /** Accumulated counts from the source-tab scan. */
  counts: LossyTabCounts,
  /** Total unclonable detail lines, used when no category matched. */
  detailCount: number,
): string {
  const parts: string[] = [];
  if (counts.chipTitles.length > 0) {
    const titles = counts.chipTitles.map((t) => `"${t}"`).join(", ");
    parts.push(`${counts.chipTitles.length} smart chip(s): ${titles}`);
  }
  if (counts.images > 0) parts.push(`${counts.images} inline image(s)`);
  if (counts.equations > 0) parts.push(`${counts.equations} math equation(s)`);
  if (counts.footnotes > 0) parts.push(`${counts.footnotes} footnote(s)`);
  if (counts.horizontalRules > 0) parts.push(`${counts.horizontalRules} horizontal rule(s)`);
  if (counts.toc > 0) parts.push(`${counts.toc} table of contents`);
  if (parts.length === 0 && detailCount > 0) parts.push(`${detailCount} uncreatable element(s)`);
  return parts.join("; ");
}
