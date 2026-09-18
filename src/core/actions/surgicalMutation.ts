/* Apply one tape mutation against an open document (live or dry-run). */

import { cloneNodeOpsResolve } from "~/core/dom/clone.ts";
import { DomWriter, dangerousClearExecute, type TapeMutation, tapeMutationsApply } from "~/core/dom/index.ts";
import { assignScopedIds, parseDocument } from "~/core/dom/parse.ts";
import { findTab, resolveTab } from "~/core/tabs.ts";
import { pendingWritersFlush } from "./flush.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import type { ApplyScriptRuntime, SimulatedGdoc } from "./types.ts";

/** Document target context required for surgical mutation execution. */
export type SurgicalStepTarget = {
  /** Anchor alias or binding for newly created elements. */
  as?: string;
  /** Clear document or tab before mutations. */
  dangerousClear?: boolean;
  /** Target document ID or alias. */
  doc: string;
  /** Target tab ID or title. */
  tab?: string;
};

/** Applies a tape mutation against the resolved open document tab. */
export async function surgicalMutationExecute(
  /** Workflow runtime session. */
  runtime: ApplyScriptRuntime,
  /** Workflow step input. */
  step: SurgicalStepTarget,
  /** Tape mutation to apply. */
  mutation: TapeMutation,
): Promise<void> {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const liveTab = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };
  const tabKey = liveTab.tabId ?? "default";

  if ("dangerousClear" in step && step.dangerousClear) {
    await pendingWritersFlush(runtime, targetDoc.alias);
  }

  const op = mutationFoldClones(mutation);
  if (mutationHasCloneRefs(op)) {
    await pendingWritersFlush(runtime);
    await cloneNodeOpsResolve([op], {
      client: runtime.client,
      defaultDoc: targetDoc.gdoc,
      defaultDocumentId: targetDoc.docId,
      defaultTabId: liveTab.tabId,
    });
  }

  const isTableInsert = mutationContainsTable(op);

  if (isTableInsert) {
    await pendingWritersFlush(runtime, targetDoc.alias);
  }

  if (!targetDoc.pendingWriters) {
    targetDoc.pendingWriters = new Map();
  }

  let pending = targetDoc.pendingWriters.get(tabKey);
  if (!pending) {
    const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
    const simulated = simulatedNodesOf(targetDoc.gdoc, liveTab.tabId);
    const parsed = simulated ? { nodes: simulated, segments: [], title: targetDoc.title } : parseDocument(gdoc);
    const simTabs = (targetDoc.gdoc as SimulatedGdoc).simulatedTabs;
    const writer = new DomWriter(parsed.nodes, {
      doc: targetDoc.gdoc.data,
      force: runtime.force,
      lists: gdoc.data.lists,
      simulatedTabs: simTabs,
      tabId: liveTab.tabId,
    });

    if ("dangerousClear" in step && step.dangerousClear) {
      dangerousClearExecute(writer);
    }

    pending = {
      afterendTails: new Map(),
      doc: gdoc.data,
      namedAnchors: new Map(),
      plans: [],
      rootAnchors: new Map(),
      steps: [],
      writer,
    };
    targetDoc.pendingWriters.set(tabKey, pending);
  } else if ("dangerousClear" in step && step.dangerousClear) {
    dangerousClearExecute(pending.writer);
  }

  const force = runtime.force || Boolean(op.force);
  if (mutationHasWrite(op)) {
    const plans = tapeMutationsApply(pending.writer, [op], pending.writer.mutations().length, {
      afterendTails: pending.afterendTails,
      force,
      namedAnchors: pending.namedAnchors,
      rootAnchors: pending.rootAnchors,
    });
    if (plans?.length) {
      pending.plans.push(...plans);
    }
  }

  pending.steps.push({ op, step, stepIndex: runtime.stepsExecuted });

  assignScopedIds(pending.writer.nodes);
  simulatedNodesSet(targetDoc.gdoc, pending.writer.nodes, liveTab.tabId);

  if (step.as) {
    const namedNode = pending.namedAnchors.get(step.as);
    if (namedNode?.scopedId) {
      runtime.aliasMap.set(step.as, namedNode.scopedId);
    }
  }

  // Sync working nodes back into targetDoc.gdoc.data tab/body so parseDocument sees them
  if (liveTab.tabId && targetDoc.gdoc.data.tabs?.length) {
    const tab = findTab(targetDoc.gdoc.data.tabs, liveTab.tabId);
    if (tab) {
      if (!tab.documentTab) tab.documentTab = {};
      const elements = pending.writer.nodes.map((n, i) => ({
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

  if (isTableInsert) {
    await pendingWritersFlush(runtime, targetDoc.alias);
  }

  runtime.stepsExecuted++;
}

/** True when a mutation still has a write besides alias metadata. */
function mutationHasWrite(
  /** Tape mutation to check. */
  mutation: TapeMutation,
): boolean {
  return Object.entries(mutation).some(([key, val]) => key !== "as" && val !== undefined);
}

/** True when insertAdjacentElement still has unresolved clone refs. */
function mutationHasCloneRefs(
  /** Tape mutation to check. */
  mutation: TapeMutation,
): boolean {
  const adj = mutation.insertAdjacentElement;
  if (!adj) return mutation.cloneNode != null || (Array.isArray(mutation.cloneNodes) && mutation.cloneNodes.length > 0);
  return adj.cloneNode != null || (Array.isArray(adj.cloneNodes) && adj.cloneNodes.length > 0);
}

/** True when the mutation inserts a table via element or elements specs. */
function mutationContainsTable(
  /** Tape mutation to inspect. */
  mutation: TapeMutation,
): boolean {
  const adj = mutation.insertAdjacentElement;
  if (!adj) return false;
  if ((adj.element as { kind?: string } | undefined)?.kind === "table") return true;
  return Array.isArray(adj.elements) && adj.elements.some((el) => (el as { kind?: string }).kind === "table");
}

/**
 * Folds top-level element/elements fields into insertAdjacentElement so clone
 * resolution can run before tapeMutationsApply.
 */
function mutationFoldClones(
  /** Raw tape mutation. */
  mutation: TapeMutation,
): TapeMutation {
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
