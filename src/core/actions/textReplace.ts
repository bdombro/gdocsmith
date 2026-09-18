/* Workflow step: find/replace text within a targeted node or document-wide. */

import type { DocNode } from "~/core/dom/types.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { batchReplaceExecute } from "~/core/replace.ts";
import { findTab, resolveTab, walkTabs } from "~/core/tabs.ts";
import type { DocElement, GoogleDoc } from "~/core/types.ts";
import { domOpFromStep } from "./domOpFromStep.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf } from "./simulated.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { SimulatedGdoc, WorkflowStepHandler } from "./types.ts";

/** Replaces matched text via plain find-and-replace or surgical tape mutation. */
export const textReplaceStep: WorkflowStepHandler = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const hasAnchor = step.nodeAt != null || step.nodeAfter != null || step.nodeBefore != null || step.nodeUnder != null;

  if (step.find != null && !hasAnchor) {
    if (step.doc) {
      await pendingWritersFlush(runtime, step.doc);
    }
    const replaceStr = step.replace ?? step.text ?? "";
    const tabResolution =
      targetDoc.gdoc.data.tabs?.length && tabHint ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
    const targetTabId = tabResolution?.tabId;

    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      gdocTextReplace(targetDoc.gdoc.data, step.find, replaceStr, targetTabId, step.matchCase ?? true);
      const simGdoc = targetDoc.gdoc as SimulatedGdoc;
      if (targetTabId) {
        const simulated = simulatedNodesOf(targetDoc.gdoc, targetTabId);
        if (simulated) {
          simulatedNodesTextReplace(simulated, step.find, replaceStr, step.matchCase ?? true);
        }
      } else {
        if (simGdoc.simulatedNodes) {
          simulatedNodesTextReplace(simGdoc.simulatedNodes, step.find, replaceStr, step.matchCase ?? true);
        }
        if (simGdoc.simulatedTabs) {
          for (const tabNodes of simGdoc.simulatedTabs.values()) {
            simulatedNodesTextReplace(tabNodes, step.find, replaceStr, step.matchCase ?? true);
          }
        }
      }
      runtime.stepsExecuted++;
      return;
    }

    await batchReplaceExecute(targetDoc.docId, {
      allTabs: step.allTabs ?? (!targetTabId ? true : undefined),
      client: runtime.client,
      dryRun: false,
      matchCase: step.matchCase ?? true,
      replacements: [{ find: step.find, replace: replaceStr }],
      tabHint: targetTabId,
    });
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    runtime.stepsExecuted++;
    return;
  }

  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.replace = step.replace ?? step.text;
  await surgicalMutationExecute(runtime, step, mutation);
};

/** Escapes special regex characters in a literal string. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** In-memory plain text replacement on a GoogleDoc AST. */
function gdocTextReplace(data: GoogleDoc, find: string, replace: string, tabId?: string, matchCase = true): void {
  const flags = matchCase ? "g" : "gi";
  const regex = new RegExp(escapeRegExp(find), flags);

  function replaceInElements(elements: DocElement[] | undefined): void {
    for (const el of elements ?? []) {
      if (el.paragraph?.elements) {
        for (const pe of el.paragraph.elements) {
          if (pe.textRun?.content) {
            pe.textRun.content = pe.textRun.content.replace(regex, replace);
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
}

/** In-memory plain text replacement on simulated DocNodes. */
function simulatedNodesTextReplace(nodes: DocNode[], find: string, replace: string, matchCase = true): void {
  const flags = matchCase ? "g" : "gi";
  const regex = new RegExp(escapeRegExp(find), flags);
  for (const node of nodes) {
    if (node.text) {
      node.text = node.text.replace(regex, replace);
    }
    if (node.markup) {
      node.markup = node.markup.replace(regex, replace);
    }
    if (node.table?.cells) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (cell.text) {
            cell.text = cell.text.replace(regex, replace);
          }
          if (cell.paragraphs) {
            for (const p of cell.paragraphs) {
              if (p.text) {
                p.text = p.text.replace(regex, replace);
              }
            }
          }
        }
      }
    }
  }
}
