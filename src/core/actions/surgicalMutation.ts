/* Apply one tape mutation against an open document (live or dry-run). */

import { cloneNodeOpsResolve } from "~/core/dom/clone.ts";
import { applyDom, DomWriter, dangerousClearExecute, type TapeMutation, tapeMutationsApply } from "~/core/dom/index.ts";
import { assignScopedIds, parseDocument } from "~/core/dom/parse.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { resolveTab } from "~/core/tabs.ts";
import type { GdocsmithStepInput } from "~/core/workflowTypes.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import type { ApplyScriptRuntime } from "./types.ts";

/** Applies a tape mutation against the resolved open document tab. */
export async function surgicalMutationExecute(
  runtime: ApplyScriptRuntime,
  step: GdocsmithStepInput,
  mutation: TapeMutation,
): Promise<void> {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const liveTab = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };
  const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
  const simulated = simulatedNodesOf(targetDoc.gdoc);
  const parsed = simulated ? { nodes: simulated, segments: [], title: targetDoc.title } : parseDocument(gdoc);

  const writer = new DomWriter(parsed.nodes, { force: runtime.force, lists: gdoc.data.lists, tabId: liveTab.tabId });

  if (step.dangerousClear) {
    dangerousClearExecute(writer);
  }

  const op = mutationFoldClones(mutation);
  if (mutationHasCloneRefs(op)) {
    await cloneNodeOpsResolve([op], {
      defaultDoc: targetDoc.gdoc,
      defaultDocumentId: targetDoc.docId,
      defaultTabId: liveTab.tabId,
    });
  }

  const force = runtime.force || Boolean(op.force);
  const plan = mutationHasWrite(op) ? tapeMutationsApply(writer, [op], 0, { force }) : undefined;

  if (!runtime.dryRun) {
    await applyDom(targetDoc.docId, writer, {
      client: runtime.client,
      doc: gdoc.data,
      dryRun: false,
      force,
      plan,
    });
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client);
  } else {
    assignScopedIds(writer.nodes);
    simulatedNodesSet(targetDoc.gdoc, writer.nodes);
  }

  runtime.stepsExecuted++;
}

/** True when a mutation still has a write besides alias metadata. */
function mutationHasWrite(mutation: TapeMutation): boolean {
  return Object.entries(mutation).some(([key, val]) => key !== "as" && val !== undefined);
}

/** True when insertAdjacentElement still has unresolved clone refs. */
function mutationHasCloneRefs(mutation: TapeMutation): boolean {
  const adj = mutation.insertAdjacentElement;
  if (!adj) return mutation.cloneNode != null || (Array.isArray(mutation.cloneNodes) && mutation.cloneNodes.length > 0);
  return adj.cloneNode != null || (Array.isArray(adj.cloneNodes) && adj.cloneNodes.length > 0);
}

/**
 * Folds top-level element/clone fields into insertAdjacentElement so clone
 * resolution can run before {@link tapeMutationsApply}.
 */
function mutationFoldClones(mutation: TapeMutation): TapeMutation {
  const op: TapeMutation = { ...mutation };
  if (op.element != null || op.elements != null || op.cloneNode != null || op.cloneNodes != null) {
    if (op.insertAdjacentElement != null) {
      return op;
    }
    op.insertAdjacentElement = {
      cloneNode: op.cloneNode,
      cloneNodes: op.cloneNodes,
      element: op.element,
      elements: op.elements,
    };
    delete op.cloneNode;
    delete op.cloneNodes;
    delete op.element;
    delete op.elements;
  }
  return op;
}
