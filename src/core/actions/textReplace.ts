/* Workflow step: find/replace text within a targeted node or document-wide. */

import { parseDocument } from "~/core/dom/parse.ts";
import { findNodeAt, neighborhoodFrom } from "~/core/dom/query.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { batchReplaceExecute, regexReplaceExecute } from "~/core/replace.ts";
import { findTab, resolveTab, walkTabs } from "~/core/tabs.ts";
import type { DocElement, GoogleDoc } from "~/core/types.ts";
import { domOpFromStep } from "./domOpFromStep.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { SimulatedGdoc, WorkflowStepHandler } from "./types.ts";

/** Replaces matched text via plain find-and-replace or surgical tape mutation. */
export const textReplaceStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const hasAnchor = step.nodeAt != null || step.nodeAfter != null || step.nodeBefore != null || step.nodeUnder != null;
  const scopedFindAnchor = step.nodeAt ?? step.nodeUnder;

  if (step.find != null && scopedFindAnchor != null) {
    const replaceStr = step.replace ?? step.text ?? "";
    const tabResolution =
      targetDoc.gdoc.data.tabs?.length && tabHint ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
    const targetTabId = tabResolution?.tabId;
    const anchorResolved = runtime.aliasResolve(scopedFindAnchor);
    if (anchorResolved == null) {
      throw new Error(`textReplace could not resolve anchor "${scopedFindAnchor}"`);
    }
    const nodeOnly = step.nodeAt != null;

    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      const gdoc = targetTabId ? targetDoc.gdoc.withTab(targetTabId) : targetDoc.gdoc;
      const simulated = simulatedNodesOf(targetDoc.gdoc, targetTabId);
      const nodes = simulated ?? parseDocument(gdoc).nodes;
      const targetNodes = nodeOnly
        ? (() => {
            const hit = findNodeAt(nodes, anchorResolved);
            return hit ? [hit] : [];
          })()
        : neighborhoodFrom(nodes, anchorResolved);
      if (targetNodes.length === 0) {
        throw new Error(`textReplace anchor "${anchorResolved}" did not match any nodes`);
      }
      const hits = simulatedNodesTextReplace(targetNodes, step.find, replaceStr, step.matchCase ?? true);
      assertReplaced(hits, step, stepIndex);
      if (simulated) {
        simulatedNodesSet(targetDoc.gdoc, nodes, targetTabId);
      }
      runtime.stepsExecuted++;
      return;
    }

    await pendingWritersFlush(runtime, targetDoc.alias);
    const scopedSummary = await regexReplaceExecute(targetDoc.docId, {
      at: anchorResolved,
      client: runtime.client,
      dryRun: false,
      ignoreCase: !(step.matchCase ?? true),
      nodeOnly,
      regex: escapeRegExp(step.find),
      replace: replaceStr,
      tabHint: targetTabId,
    });
    assertReplaced(scopedSummary.occurrencesChanged, step, stepIndex);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    runtime.stepsExecuted++;
    return;
  }

  if (step.find != null && !hasAnchor) {
    if (step.doc) {
      await pendingWritersFlush(runtime, step.doc);
    }
    const replaceStr = step.replace ?? step.text ?? "";
    const tabResolution =
      targetDoc.gdoc.data.tabs?.length && tabHint ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
    const targetTabId = tabResolution?.tabId;

    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      let hits = gdocTextReplace(targetDoc.gdoc.data, step.find, replaceStr, targetTabId, step.matchCase ?? true);
      const simGdoc = targetDoc.gdoc as SimulatedGdoc;
      if (targetTabId) {
        const simulated = simulatedNodesOf(targetDoc.gdoc, targetTabId);
        if (simulated) {
          hits += simulatedNodesTextReplace(simulated, step.find, replaceStr, step.matchCase ?? true);
        }
      } else {
        if (simGdoc.simulatedNodes) {
          hits += simulatedNodesTextReplace(simGdoc.simulatedNodes, step.find, replaceStr, step.matchCase ?? true);
        }
        if (simGdoc.simulatedTabs) {
          for (const tabNodes of simGdoc.simulatedTabs.values()) {
            hits += simulatedNodesTextReplace(tabNodes, step.find, replaceStr, step.matchCase ?? true);
          }
        }
      }
      assertReplaced(hits, step, stepIndex);
      runtime.stepsExecuted++;
      return;
    }

    const summary = await batchReplaceExecute(targetDoc.docId, {
      allTabs: step.allTabs ?? (!targetTabId ? true : undefined),
      client: runtime.client,
      dryRun: false,
      matchCase: step.matchCase ?? true,
      replacements: [{ find: step.find, replace: replaceStr }],
      tabHint: targetTabId,
    });
    assertReplaced(summary.occurrencesChanged, step, stepIndex);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    runtime.stepsExecuted++;
    return;
  }

  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.replace = step.replace ?? step.text;
  await surgicalMutationExecute(runtime, step, mutation, stepIndex);
};

/**
 * Rejects a `find` that matched nothing, the way a mutation that changes nothing is rejected.
 *
 * A find string that never occurs means the caller's model of the document was wrong, so reporting
 * success would hide the mistake behind `ok: true`.
 */
function assertReplaced(
  /** Occurrences actually replaced. */
  count: number,
  /** Workflow step being executed. */
  step: { find?: string },
  /** Index of the step in the script. */
  stepIndex: number,
): void {
  if (count > 0) return;
  throw new Error(
    `steps[${stepIndex}] textReplace: find "${step.find}" matched nothing, so nothing was replaced. ` +
      "find is exact and case-sensitive unless matchCase: false.",
  );
}

/** Escapes special regex characters in a literal string. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** In-memory plain text replacement on a GoogleDoc AST. Returns the number of occurrences replaced. */
function gdocTextReplace(data: GoogleDoc, find: string, replace: string, tabId?: string, matchCase = true): number {
  const flags = matchCase ? "g" : "gi";
  const regex = new RegExp(escapeRegExp(find), flags);
  let count = 0;
  /** Replaces every hit in one string, tallying occurrences. */
  const swap = (value: string): string =>
    value.replace(regex, () => {
      count++;
      return replace;
    });

  function replaceInElements(elements: DocElement[] | undefined): void {
    for (const el of elements ?? []) {
      if (el.paragraph?.elements) {
        for (const pe of el.paragraph.elements) {
          if (pe.textRun?.content) {
            pe.textRun.content = swap(pe.textRun.content);
          }
        }
      }
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells ?? []) {
            replaceInElements(cell.content as DocElement[]);
          }
        }
      }
    }
  }

  if (tabId && data.tabs?.length) {
    const tab = findTab(data.tabs, tabId);
    if (tab?.documentTab?.body?.content) {
      replaceInElements(tab.documentTab.body.content as DocElement[]);
    }
  } else if (data.tabs?.length) {
    walkTabs(data.tabs, (t) => {
      if (t.documentTab?.body?.content) {
        replaceInElements(t.documentTab.body.content as DocElement[]);
      }
    });
  } else if (data.body?.content) {
    replaceInElements(data.body.content as DocElement[]);
  }
  return count;
}

/** In-memory plain text replacement on simulated DocNodes. Returns the number of occurrences replaced. */
function simulatedNodesTextReplace(nodes: DocNode[], find: string, replace: string, matchCase = true): number {
  const flags = matchCase ? "g" : "gi";
  const regex = new RegExp(escapeRegExp(find), flags);
  let count = 0;
  /** Replaces every hit in one string, tallying occurrences. */
  const swap = (value: string): string =>
    value.replace(regex, () => {
      count++;
      return replace;
    });

  for (const node of nodes) {
    if (node.text) {
      node.text = swap(node.text);
    }
    if (node.markup) {
      // Markup carries the same text, so its hits are not counted a second time.
      node.markup = node.markup.replace(regex, replace);
    }
    if (node.table?.cells) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (cell.text) {
            cell.text = swap(cell.text);
          }
          if (cell.paragraphs) {
            for (const p of cell.paragraphs) {
              if (p.text) {
                p.text = swap(p.text);
              }
            }
          }
        }
      }
    }
  }
  return count;
}
