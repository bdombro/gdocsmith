/* Map a workflow step input to an explicit tape mutation (no whole-step spread). */

import type { CloneNodeRef } from "~/core/dom/clone.ts";
import { TAPE_MUTATION_KEYS, type TapeMutation, type TapeMutationKey } from "~/core/dom/ops.ts";
import type { GdocsmithStepInput } from "~/core/workflowTypes.ts";
import { stepKindRead } from "./stepKind.ts";

/** TapeMutation keys that hold heading-scoped ids (or aliases) to resolve. */
const ANCHOR_KEYS = new Set<TapeMutationKey>(["after", "at", "before"]);

/** Resolves alias-bound anchors on a workflow step into a {@link TapeMutation}. */
export function domOpFromStep(
  step: GdocsmithStepInput,
  aliasResolve: (val?: string) => string | undefined,
): TapeMutation {
  const mutation: TapeMutation = {};

  for (const key of TAPE_MUTATION_KEYS) {
    const raw = step[key];
    if (raw === undefined) continue;
    if (ANCHOR_KEYS.has(key) && typeof raw === "string") {
      const resolved = aliasResolve(raw);
      if (resolved !== undefined) mutation[key] = resolved as never;
      continue;
    }
    if (key === "cloneNode") {
      mutation.cloneNode = cloneRefResolve(raw, aliasResolve);
      continue;
    }
    if (key === "cloneNodes" && Array.isArray(raw)) {
      mutation.cloneNodes = raw.map((item) => cloneRefResolve(item, aliasResolve));
      continue;
    }
    if (key === "insertAdjacentElement" && raw && typeof raw === "object") {
      mutation.insertAdjacentElement = insertAdjacentResolve(
        raw as NonNullable<TapeMutation["insertAdjacentElement"]>,
        aliasResolve,
      );
      continue;
    }
    (mutation as Record<string, unknown>)[key] = raw;
  }

  if (mutation.at === undefined) {
    const under = aliasResolve(step.under);
    if (under !== undefined) mutation.at = under;
  }
  if (step.markdown !== undefined && mutation.insertMarkdown === undefined) {
    mutation.insertMarkdown = step.markdown;
  }

  const kind = stepKindRead(step);
  if (kind === "replace" || step.find != null) {
    mutation.replace = step.replace ?? step.text;
  } else if (step.replace !== undefined && mutation.replace === undefined) {
    mutation.replace = step.replace;
  }

  return mutation;
}

/** Resolves alias strings inside a clone node ref. */
function cloneRefResolve(
  raw: unknown,
  aliasResolve: (val?: string) => string | undefined,
): NonNullable<TapeMutation["cloneNode"]> {
  if (raw && typeof raw === "object") {
    const ref = raw as CloneNodeRef;
    const fromDoc = typeof ref.fromDoc === "string" ? (aliasResolve(ref.fromDoc) ?? ref.fromDoc) : ref.fromDoc;
    const fromNode =
      typeof ref.fromNode === "string" ? (aliasResolve(String(ref.fromNode)) ?? ref.fromNode) : ref.fromNode;
    const fromTab = typeof ref.fromTab === "string" ? (aliasResolve(ref.fromTab) ?? ref.fromTab) : ref.fromTab;
    const nodeId = typeof ref.nodeId === "string" ? (aliasResolve(String(ref.nodeId)) ?? ref.nodeId) : ref.nodeId;
    return { ...ref, ...(fromDoc !== undefined ? { fromDoc } : {}), fromNode, fromTab, nodeId };
  }
  if (typeof raw === "string") return aliasResolve(raw) ?? raw;
  return raw as NonNullable<TapeMutation["cloneNode"]>;
}

/** Resolves aliases nested under insertAdjacentElement clone refs. */
function insertAdjacentResolve(
  adj: NonNullable<TapeMutation["insertAdjacentElement"]>,
  aliasResolve: (val?: string) => string | undefined,
): NonNullable<TapeMutation["insertAdjacentElement"]> {
  const out: NonNullable<TapeMutation["insertAdjacentElement"]> = { ...adj };
  if (adj.cloneNode !== undefined) out.cloneNode = cloneRefResolve(adj.cloneNode, aliasResolve);
  if (Array.isArray(adj.cloneNodes)) {
    out.cloneNodes = adj.cloneNodes.map((item) => cloneRefResolve(item, aliasResolve));
  }
  return out;
}
