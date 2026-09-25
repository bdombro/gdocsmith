/* The pre-send guard: what a plan would break that the API can't restore — comments, suggestions, links, named ranges, unrecreatable content (G3 D37, M17). */

import type { JsonObject } from "../model/rawJson.ts";
import type { Block, DocModel, ParagraphBlock, Range, TabModel, Tombstone } from "../model/types.ts";
import type { DocPlan } from "../reconcile/reconcile.ts";
import type { CommentAnchor } from "./load.ts";

/** Kinds of guard findings. */
export type GuardKind =
  | "comment"
  | "commentPartial"
  | "headingLink"
  | "identityLoss"
  | "listLossy"
  | "listRebuild"
  | "namedRange"
  | "suggestion"
  | "tabLink"
  | "unrecreatable"
  | "viewMode";

/** One thing a plan would break. */
export interface GuardFinding {
  /** Key or anchor of what's affected. */ anchor?: string;
  /** Document. */ docId: string;
  /** Kind. */ kind: GuardKind;
  /** What breaks, for people. */ message: string;
  /** `block` findings stop the send unless waived; `warn` never does. */ severity: "block" | "warn";
  /** The step that caused it. */ stepIndex?: number;
  /** Tab. */ tabId?: string;
  /** True when `force` (global or the step's own) waives it. */ waived: boolean;
}

/** One document's plan and what it was planned from. */
export interface GuardDoc {
  /** Comment anchors of the document as loaded. */ comments: readonly CommentAnchor[];
  /** The document as the program left it. */ final: DocModel;
  /** The document as loaded. */ original: DocModel;
  /** Its plan. */ plan: DocPlan;
  /** Blocks and atoms the program deleted. */ tombstones: readonly Tombstone[];
}

/** Guard inputs. */
export interface GuardInput {
  /** Documents with plans. */ docs: readonly GuardDoc[];
  /** Waive every finding. */ force: boolean;
  /** Every loaded document, for inbound links (defaults to the planned documents). */ linkSources?: readonly DocModel[];
  /** Whether a step passed its own `force`. */ stepForce?: (stepIndex: number) => boolean;
}

/** Atom kinds the API can't recreate. */
const UNRECREATABLE_ATOMS: Record<string, string> = {
  autoText: "an auto-text field",
  columnBreak: "a column break",
  equation: "an equation",
  footnoteRef: "a footnote reference (and its footnote)",
  horizontalRule: "a horizontal rule",
};

/** Evaluates every guard rule over every planned document. */
export function guardEvaluate(
  /** Plans, comments, and waivers. */
  input: GuardInput,
): GuardFinding[] {
  const links = inboundLinks(input.linkSources ?? input.docs.map((d) => d.original));
  const findings: GuardFinding[] = [];
  const add = (f: Omit<GuardFinding, "waived">) =>
    findings.push({
      ...f,
      waived:
        f.severity === "block" && (input.force || (f.stepIndex !== undefined && !!input.stepForce?.(f.stepIndex))),
    });
  for (const doc of input.docs) {
    const docId = doc.original.docId;
    const deletions = deletionsWithSteps(doc);
    const finalKeys = keysOf(doc.final);
    // Writing to a document not loaded with suggestions inline would misplace every edit.
    if (
      doc.original.suggestionsViewMode &&
      doc.original.suggestionsViewMode !== "SUGGESTIONS_INLINE" &&
      doc.plan.contentRequests.length
    ) {
      add({
        docId,
        kind: "viewMode",
        message: `the document was loaded in ${doc.original.suggestionsViewMode} mode; edits need SUGGESTIONS_INLINE`,
        severity: "block",
      });
    }
    for (const comment of doc.comments) {
      for (const occurrence of comment.occurrences) {
        for (const d of deletions.filter((x) => x.tabId === occurrence.tabId)) {
          const covers = d.range.start <= occurrence.range.start && d.range.end >= occurrence.range.end;
          const overlaps = d.range.start < occurrence.range.end && d.range.end > occurrence.range.start;
          if (!overlaps) continue;
          add({
            anchor: comment.commentId,
            docId,
            kind: covers ? "comment" : "commentPartial",
            message: covers
              ? `deleting commented text "${snippet(comment.quote)}" orphans its comment${comment.ambiguous ? " (the quote appears more than once; every occurrence counts)" : ""}`
              : `an edit touches part of commented text "${snippet(comment.quote)}"`,
            severity: covers ? "block" : "warn",
            stepIndex: d.stepIndex,
            tabId: occurrence.tabId,
          });
        }
      }
    }
    for (const tab of doc.original.tabs) {
      const finalTab = doc.final.tabs.find((t) => t.tabId === tab.tabId);
      const tombstone = (key: string) => doc.tombstones.find((t) => t.key === key && t.tabId === tab.tabId);
      for (const block of blocksDeep(tab)) {
        const protectedBlock = (block.kind === "paragraph" || block.kind === "table") && block.protected;
        if (protectedBlock && (!finalKeys.has(block.key) || doc.plan.protectedTouches.includes(block.key))) {
          add({
            anchor: block.key,
            docId,
            kind: "suggestion",
            message: "this content has pending suggestions; changing it would disturb them",
            severity: "block",
            stepIndex: tombstone(block.key)?.stamp.stepIndex ?? stampOf(finalTab, block.key),
            tabId: tab.tabId,
          });
        }
        if (block.kind === "paragraph" && block.headingId && links.headings.has(`${docId}\0${block.headingId}`)) {
          headingLinkCheck(add, doc, tab, finalTab, block, tombstone(block.key)?.stamp.stepIndex);
        }
      }
      if (!finalTab && links.tabs.has(`${docId}\0${tab.tabId}`)) {
        add({
          docId,
          kind: "tabLink",
          message: `deleting tab "${tab.title}" breaks links to it`,
          severity: "block",
          tabId: tab.tabId,
        });
      }
      for (const range of tab.namedRanges) {
        for (const r of range.ranges) {
          const d = deletions.find((x) => x.tabId === tab.tabId && x.range.start < r.end && x.range.end > r.start);
          if (d)
            add({
              anchor: range.namedRangeId,
              docId,
              kind: "namedRange",
              message: `a deletion overlaps named range "${range.name}"`,
              severity: "block",
              stepIndex: d.stepIndex,
              tabId: tab.tabId,
            });
        }
      }
      unrecreatableCheck(add, doc, tab);
    }
    for (const rebuild of doc.plan.listRebuilds) {
      if (rebuild.lossy) {
        add({
          anchor: rebuild.keys[0],
          docId,
          kind: "listRebuild",
          message: "changing this list's nesting rebuilds it, and its custom look can't be kept",
          severity: "block",
          tabId: rebuild.tabId,
        });
      }
    }
  }
  return findings;
}

/** Heading-link rules: deleting, un-heading, or re-identifying an inbound-linked heading. */
function headingLinkCheck(
  add: (f: Omit<GuardFinding, "waived">) => void,
  doc: GuardDoc,
  tab: TabModel,
  finalTab: TabModel | undefined,
  heading: ParagraphBlock,
  deletedBy: number | undefined,
): void {
  const docId = doc.original.docId;
  const text = snippet(heading.inlines.map((i) => (i.kind === "text" ? i.text : "")).join(""));
  const now = finalTab ? blockDeep(finalTab, heading.key) : undefined;
  const moved = doc.plan.identityTransfers.find(
    (t) => t.fromKey === heading.key && t.headingId === heading.headingId && t.toKey !== heading.key,
  );
  const base = { anchor: heading.headingId, docId, tabId: tab.tabId };
  if (!now) {
    if (moved)
      add({
        ...base,
        kind: "identityLoss",
        message: `links to heading "${text}" now land on the content that replaced it`,
        severity: "warn",
        stepIndex: deletedBy,
      });
    else
      add({
        ...base,
        kind: "headingLink",
        message: `deleting heading "${text}" breaks links to it`,
        severity: "block",
        stepIndex: deletedBy,
      });
    return;
  }
  const stepIndex = now.kind === "paragraph" ? now.stamp?.stepIndex : undefined;
  const stillHeading =
    now.kind === "paragraph" &&
    typeof now.style.namedStyleType === "string" &&
    now.style.namedStyleType !== "NORMAL_TEXT";
  if (!stillHeading)
    add({
      ...base,
      kind: "headingLink",
      message: `turning heading "${text}" into text breaks links to it`,
      severity: "block",
      stepIndex,
    });
  else if (moved)
    add({
      ...base,
      kind: "headingLink",
      message: `links to heading "${text}" would move to other content`,
      severity: "block",
      stepIndex,
    });
}

/** Deleted content the API can't recreate: special atoms, Drive-only images, TOCs, section breaks, paragraphs anchoring floating objects. */
function unrecreatableCheck(add: (f: Omit<GuardFinding, "waived">) => void, doc: GuardDoc, tab: TabModel): void {
  const docId = doc.original.docId;
  const atoms = new Map<string, { type: string; uri?: string }>();
  const blocks = new Map<string, Block>();
  for (const block of blocksDeep(tab)) {
    blocks.set(block.key, block);
    if (block.kind !== "paragraph") continue;
    for (const inline of block.inlines) {
      if (inline.kind !== "atom") continue;
      let uri: string | undefined;
      if (inline.type === "image") {
        const id = ((inline.raw?.inlineObjectElement as JsonObject | undefined)?.inlineObjectId ?? "") as string;
        const embedded = (tab.inlineObjects[id]?.inlineObjectProperties as JsonObject | undefined)?.embeddedObject as
          | JsonObject
          | undefined;
        uri = embedded?.imageProperties
          ? ((embedded.imageProperties as JsonObject).sourceUri as string | undefined)
          : undefined;
        if (!embedded?.imageProperties) uri = "drawing";
      }
      atoms.set(inline.key, { type: inline.type, uri });
    }
  }
  for (const t of doc.tombstones.filter((x) => x.tabId === tab.tabId)) {
    let what: string | undefined;
    if (t.kind === "atom") {
      const atom = atoms.get(t.key);
      if (!atom) continue;
      what = UNRECREATABLE_ATOMS[atom.type];
      if (atom.type === "image" && !atom.uri?.startsWith("https://"))
        what = atom.uri === "drawing" ? "a drawing or chart" : "a Drive-hosted image";
    } else {
      const block = blocks.get(t.key);
      if (block?.kind === "toc") what = "a table of contents";
      else if (block?.kind === "sectionBreak") what = "a section break";
      else if (block?.kind === "paragraph" && block.positionedObjectIds?.length)
        what = "a paragraph anchoring floating objects";
    }
    if (what)
      add({
        anchor: t.key,
        docId,
        kind: "unrecreatable",
        message: `this deletes ${what}, which the Docs API can't recreate`,
        severity: "block",
        stepIndex: t.stamp.stepIndex,
        tabId: tab.tabId,
      });
  }
}

/** Heading and tab link targets across documents (`doc\0headingId`, `doc\0tabId`). */
function inboundLinks(docs: readonly DocModel[]): { headings: Set<string>; tabs: Set<string> } {
  const headings = new Set<string>();
  const tabs = new Set<string>();
  const visit = (docId: string, link: JsonObject) => {
    const heading = link.heading as { id?: string; tabId?: string } | undefined;
    if (heading?.id) headings.add(`${docId}\0${heading.id}`);
    if (typeof link.headingId === "string") headings.add(`${docId}\0${link.headingId}`);
    if (typeof link.tabId === "string") tabs.add(`${docId}\0${link.tabId}`);
    const url = /^https:\/\/docs\.google\.com\/document\/d\/([^/?#]+)[^?#]*(?:\?([^#]*))?(?:#(.*))?$/.exec(
      String(link.url ?? ""),
    );
    if (url) {
      const tab = new URLSearchParams(url[2] ?? "").get("tab");
      if (tab) tabs.add(`${url[1]}\0${tab}`);
      if (url[3]?.startsWith("heading=")) headings.add(`${url[1]}\0${url[3].slice("heading=".length)}`);
    }
  };
  const walkRaw = (docId: string, node: unknown) => {
    if (Array.isArray(node)) for (const n of node) walkRaw(docId, n);
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "link" && value && typeof value === "object") visit(docId, value as JsonObject);
        else walkRaw(docId, value);
      }
    }
  };
  for (const doc of docs) {
    for (const tab of doc.tabs) {
      for (const block of blocksDeep(tab)) {
        if (block.kind === "paragraph")
          for (const inline of block.inlines) if (inline.style?.link) visit(doc.docId, inline.style.link as JsonObject);
        if (block.kind === "toc") walkRaw(doc.docId, block.raw);
      }
    }
  }
  return { headings, tabs };
}

/** Each content deletion with the step that caused it: its request's origin, else the tombstone of a deleted block it covers. */
function deletionsWithSteps(doc: GuardDoc): Array<{ range: Range; stepIndex?: number; tabId: string }> {
  const { plan } = doc;
  return plan.deletedRanges.map(({ range, tabId }) => {
    const i = plan.contentRequests.findIndex((req) => {
      const r = (req.deleteContentRange as JsonObject | undefined)?.range as JsonObject | undefined;
      return r && r.startIndex === range.start && r.endIndex === range.end && (r.tabId ?? tabId) === tabId;
    });
    let stepIndex = i >= 0 ? plan.origins[i]?.stepIndex : undefined;
    if (stepIndex === undefined) {
      const tab = doc.original.tabs.find((t) => t.tabId === tabId);
      const covered = tab
        ? blocksDeep(tab).filter((b) => b.origin && b.origin.start < range.end && b.origin.end > range.start)
        : [];
      stepIndex = doc.tombstones.find((t) => t.tabId === tabId && covered.some((b) => b.key === t.key))?.stamp
        .stepIndex;
    }
    return { range, stepIndex, tabId };
  });
}

/** Every block of a tab, table-cell paragraphs included. */
function blocksDeep(tab: TabModel): Block[] {
  return tab.blocks.flatMap((b): Block[] =>
    b.kind === "table" ? [b, ...b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks))] : [b],
  );
}

/** A block of a tab by key (cells included). */
function blockDeep(tab: TabModel, key: string): Block | undefined {
  return blocksDeep(tab).find((b) => b.key === key);
}

/** Every block key of a document. */
function keysOf(doc: DocModel): Set<string> {
  return new Set(doc.tabs.flatMap((t) => blocksDeep(t).map((b) => b.key)));
}

/** The step that last touched a block. */
function stampOf(tab: TabModel | undefined, key: string): number | undefined {
  const block = tab ? blockDeep(tab, key) : undefined;
  return block && (block.kind === "paragraph" || block.kind === "table") ? block.stamp?.stepIndex : undefined;
}

/** A short quote for messages. */
function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 37)}…` : t;
}
