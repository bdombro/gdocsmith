/* Workflow step: sectionCopy — copy a section between documents/tabs server-side. */

import { elementSpecFromNode } from "~/core/dom/clone.ts";
import type { TapeMutation } from "~/core/dom/ops.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { headingByTitleOrSlugFind, isHeading, neighborhoodFrom, nodeAtFind } from "~/core/dom/query.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { resolveTab } from "~/core/tabs.ts";
import { simulatedNodesOf } from "./simulated.ts";
import { surgicalMutationExecute } from "./surgicalMutation.ts";
import type { OpenDocContext, WorkflowStepHandler } from "./types.ts";

/** Copies an entire heading section between documents or tabs server-side. */
export const sectionCopyStep: WorkflowStepHandler = async (
  /** Runtime execution context for the script session. */
  runtime,
  /** Zero-based index of this step in the script. */
  stepIndex,
  /** Workflow step input. */
  step,
) => {
  const fromSection = step.fromSection;
  if (!fromSection) {
    throw new Error(`steps[${stepIndex}] sectionCopy requires fromSection: <headingTitle|slug|headingId>`);
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const sourceDocRef = runtime.aliasResolve(step.fromDoc);
  const sourceDoc = sourceDocRef ? runtime.openDocResolve(sourceDocRef) : targetDoc;

  const sourceTabHint = runtime.aliasResolve(step.fromTab);
  const resolvedSourceTab = sourceDoc.gdoc.data.tabs?.length
    ? resolveTab(sourceDoc.gdoc.data, sourceTabHint)
    : { tabId: undefined, title: sourceDoc.title };
  const sourceTabId = sourceDoc.gdoc.data.tabs?.length ? (resolvedSourceTab.tabId ?? sourceTabHint) : undefined;

  const sourceSim = simulatedNodesOf(sourceDoc.gdoc, sourceTabId);
  const sourceNodes =
    sourceSim ?? parseDocument(sourceTabId ? sourceDoc.gdoc.withTab(sourceTabId) : sourceDoc.gdoc).nodes;

  const hitHeading = headingByTitleOrSlugFind(sourceNodes, fromSection) ?? nodeAtFind(sourceNodes, fromSection);
  if (!hitHeading || !isHeading(hitHeading)) {
    const known = sourceNodes
      .filter((n) => isHeading(n))
      .map((h) => `"${(h.text ?? "").trim()}"`)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `steps[${stepIndex}] sectionCopy: heading "${fromSection}" not found in source doc "${sourceDoc.alias}".${known ? ` Known headings: ${known}` : ""}`,
    );
  }

  let sectionNodes = neighborhoodFrom(sourceNodes, hitHeading.tapeIndex);
  if (step.includeHeading === false) {
    sectionNodes = sectionNodes.slice(1);
    if (sectionNodes.length === 0) {
      throw new Error(`steps[${stepIndex}] sectionCopy: source section "${fromSection}" has no body content to copy`);
    }
  }

  const specs = sectionNodes.filter((n) => n.kind !== "sectionBreak").map((n) => elementSpecFromNode(n));

  const mutation: TapeMutation = {
    force: step.force,
  };
  if (step.nodeAfter != null) {
    mutation.after = runtime.aliasResolve(step.nodeAfter) as never;
    mutation.elements = specs as Array<Record<string, unknown>>;
  } else if (step.nodeBefore != null) {
    mutation.before = runtime.aliasResolve(step.nodeBefore) as never;
    mutation.elements = specs as Array<Record<string, unknown>>;
  } else {
    const targetNodes = targetTabNodes(targetDoc, runtime.aliasResolve(step.tab));
    if (step.nodeAt != null || headingByTitleOrSlugFind(targetNodes, fromSection)) {
      const at = step.nodeAt ?? fromSection;
      mutation.at = runtime.aliasResolve(at) as never;
      mutation.replaceSection = specs as Array<Record<string, unknown>>;
    } else {
      // No same-named section in the target tab: append to the end of the tab instead of failing.
      const contentNodes = targetNodes.filter((n) => n.kind !== "sectionBreak");
      const lastNode = contentNodes[contentNodes.length - 1];
      if (!lastNode) {
        throw new Error(`steps[${stepIndex}] sectionCopy: target tab has no nodes to insert content into`);
      }
      const isEmptyTab = contentNodes.length === 1 && lastNode.kind === "paragraph" && !lastNode.text;
      const anchor = (lastNode.scopedId ?? lastNode.tapeIndex) as never;
      if (isEmptyTab) {
        mutation.before = anchor;
      } else {
        mutation.after = anchor;
      }
      mutation.elements = specs as Array<Record<string, unknown>>;
    }
  }

  await surgicalMutationExecute(runtime, step, mutation, stepIndex);
};

/** Returns the working tape (simulated edits included) for a tab of an open document. */
function targetTabNodes(targetDoc: OpenDocContext, tabHint: string | undefined): DocNode[] {
  const tabId = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint).tabId : undefined;
  return (
    simulatedNodesOf(targetDoc.gdoc, tabId) ??
    parseDocument(tabId ? targetDoc.gdoc.withTab(tabId) : targetDoc.gdoc).nodes
  );
}
