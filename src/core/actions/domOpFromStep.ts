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
  const s = step as unknown as Record<string, unknown>;

  for (const key of TAPE_MUTATION_KEYS) {
    if (ANCHOR_KEYS.has(key)) continue;
    const raw = s[key];
    if (raw === undefined) continue;
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
    const rawAt = s.nodeAt ?? s.at;
    if (rawAt !== undefined) {
      const resolved = typeof rawAt === "string" ? aliasResolve(rawAt) : rawAt;
      if (resolved !== undefined) mutation.at = resolved as never;
    }
  }
  if (mutation.after === undefined) {
    const rawAfter = s.nodeAfter ?? s.after;
    if (rawAfter !== undefined) {
      const resolved = typeof rawAfter === "string" ? aliasResolve(rawAfter as string) : rawAfter;
      if (resolved !== undefined) mutation.after = resolved as never;
    }
  }
  if (mutation.before === undefined) {
    const rawBefore = s.nodeBefore ?? s.before;
    if (rawBefore !== undefined) {
      const resolved = typeof rawBefore === "string" ? aliasResolve(rawBefore as string) : rawBefore;
      if (resolved !== undefined) mutation.before = resolved as never;
    }
  }

  if (mutation.at === undefined) {
    const under = aliasResolve(s.nodeUnder as string | undefined);
    if (under !== undefined) mutation.at = under;
  }

  const kind = stepKindRead(step);
  if (mutation.at === undefined && s.find !== undefined && kind !== "textReplace") {
    const resolved = typeof s.find === "string" ? aliasResolve(s.find) : s.find;
    if (resolved !== undefined) mutation.at = resolved as never;
  }
  const replaceMarkdownVal = s.replaceMarkdown;
  const replaceSectionVal = s.replaceSection;
  const insertMarkdownVal = s.insertMarkdown;
  const markdownVal = s.markdown as string | undefined;
  const textVal = s.text as string | undefined;
  const replaceVal = s.replace as string | undefined;
  const innerTextVal = s.innerText as string | undefined;

  if (kind === "replaceMarkdown" || (replaceMarkdownVal && typeof replaceMarkdownVal !== "string")) {
    mutation.replaceMarkdown = typeof replaceMarkdownVal === "string" ? replaceMarkdownVal : (markdownVal ?? textVal);
  } else if (kind === "replaceSection" || (replaceSectionVal && typeof replaceSectionVal !== "string")) {
    mutation.replaceSection = typeof replaceSectionVal === "string" ? replaceSectionVal : (markdownVal ?? textVal);
  } else if (kind === "markdownInsert") {
    mutation.insertMarkdown = typeof insertMarkdownVal === "string" ? insertMarkdownVal : (markdownVal ?? textVal);
  } else if (kind === "replace" || s.find != null) {
    mutation.replace = replaceVal ?? textVal ?? innerTextVal;
  } else if (kind === "innerText") {
    mutation.innerText = innerTextVal ?? textVal;
  } else if (replaceVal !== undefined && mutation.replace === undefined) {
    mutation.replace = replaceVal;
  } else if (markdownVal !== undefined && mutation.insertMarkdown === undefined) {
    mutation.insertMarkdown = markdownVal;
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
