/* Document-level reconcile: every tab's content, tab lifecycle, and document style turned into a plan, plus the emulator self-check that proves the plan before anything is sent (G3 D15, M11). */

import type { GoogleDoc } from "~/core/types.ts";
import { requestsEmulate } from "../emulator/emulate.ts";
import blankTab from "../model/blankTab.json";
import { type CompareResult, docModelsCompare } from "../model/equivalence.ts";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { JsonObject, RawDocumentTab } from "../model/rawJson.ts";
import { styleEqual } from "../model/styleValues.ts";
import type { DocModel, IdentityTransfer, Range, TabModel } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import { containerReconcile } from "./container.ts";
import {
  type ListRebuild,
  type PendingLink,
  type ReconcileContext,
  type RequestOrigin,
  reconcileContextCreate,
} from "./context.ts";
import { bulletsReconcile } from "./lists.ts";

/** A tab the create phase must add before its content can be sent. */
export interface TabToAdd {
  /** Position among its siblings in the final document. */ index: number;
  /** Parent tab id (real, or provisional when the parent is also new). */ parentTabId?: string;
  /** Provisional tab id the plan's content requests use until the create phase binds a real one. */ tabId: string;
  /** Title. */ title: string;
}

/** Everything the flush and guard need for one document. */
export interface DocPlan {
  /** Content-phase requests, in send order (tab ids may be provisional for new tabs). */ contentRequests: JsonObject[];
  /** Original-coordinate ranges deleted, per tab. */ deletedRanges: Array<{ range: Range; tabId: string }>;
  /** Document id. */ docId: string;
  /** Heading identities that moved between keys. */ identityTransfers: IdentityTransfer[];
  /** Existing list runs rebuilt with new list ids. */ listRebuilds: Array<ListRebuild & { tabId: string }>;
  /** One origin per content request. */ origins: RequestOrigin[];
  /** Links to headings created this run, filled in after content lands. */ pendingLinks: PendingLink[];
  /** Keys of suggestion-bearing blocks the plan changes. */ protectedTouches: string[];
  /** Request counts, for reports. */ summary: { contentRequests: number; tabOps: number; tabsToAdd: number };
  /** Tabs-phase requests (deletes, then renames/moves in final order). */ tabOps: JsonObject[];
  /** Tabs the create phase adds. */ tabsToAdd: TabToAdd[];
}

/** Inputs to a document's reconcile. */
export interface DocReconcileInput {
  /** The document as the program left it. */ final: DocModel;
  /** The document as loaded (a new document's is the blank one). */ original: DocModel;
  /** The JSON `original` was parsed from. */ originalJson: GoogleDoc;
}

/**
 * Plans one document: for each final tab, its body content (existing tabs against their original,
 * new tabs against the blank template), bullets, leading section style, and document style; then the
 * tab lifecycle (new tabs to add; deleted tabs; renames and moves).
 */
export function docReconcile(
  /** Original and final models. */
  input: DocReconcileInput,
): DocPlan {
  const { final, original } = input;
  const originalTabs = new Map(original.tabs.map((t) => [t.tabId, t]));
  const plan: DocPlan = {
    contentRequests: [],
    deletedRanges: [],
    docId: final.docId,
    identityTransfers: [],
    listRebuilds: [],
    origins: [],
    pendingLinks: [],
    protectedTouches: [],
    summary: { contentRequests: 0, tabOps: 0, tabsToAdd: 0 },
    tabOps: [],
    tabsToAdd: [],
  };
  const blankOriginal = (tab: TabModel) => blankTabModel(tab.tabId);
  for (const tab of final.tabs) {
    const before = originalTabs.get(tab.tabId);
    if (!before) {
      plan.tabsToAdd.push({
        index: siblingIndex(final, tab),
        parentTabId: tab.parentTabId,
        tabId: tab.tabId,
        title: tab.title,
      });
    }
    const ctx = reconcileContextCreate(tab.tabId);
    tabReconcile(before ?? blankOriginal(tab), tab, ctx);
    plan.contentRequests.push(...ctx.requests);
    plan.origins.push(...ctx.origins);
    plan.deletedRanges.push(...ctx.deletedRanges.map((range) => ({ range, tabId: tab.tabId })));
    plan.identityTransfers.push(...ctx.identityTransfers);
    plan.listRebuilds.push(...ctx.listRebuilds.map((r) => ({ ...r, tabId: tab.tabId })));
    plan.pendingLinks.push(...ctx.pendingLinks);
    plan.protectedTouches.push(...ctx.protectedTouches);
  }
  plan.tabOps = tabOpsPlan(original, final);
  plan.summary = {
    contentRequests: plan.contentRequests.length,
    tabOps: plan.tabOps.length,
    tabsToAdd: plan.tabsToAdd.length,
  };
  return plan;
}

/**
 * Emulates the plan on the original JSON (tab adds, content, tab ops) and compares the result with
 * the final model, allowing for identity transfers, rebuilt lists, minted tab ids, and pending links
 * (which only the links phase sets). A failed self-check is fatal (D15).
 */
export function docPlanSelfCheck(
  /** The plan. */
  plan: DocPlan,
  /** What it was planned from. */
  input: DocReconcileInput,
): CompareResult {
  const adds = plan.tabsToAdd.map(
    (t) => RequestBuilder.documentTabAdd(t.title, { index: t.index, parentTabId: t.parentTabId }) as JsonObject,
  );
  let json = input.originalJson;
  const tabIdMap = new Map<string, string>();
  for (const [i, add] of adds.entries()) {
    const parent = plan.tabsToAdd[i].parentTabId;
    const resolved = parent && tabIdMap.has(parent) ? withParent(add, tabIdMap.get(parent) as string) : add;
    const { json: next, replies } = requestsEmulate(json, [resolved]);
    const minted = ((replies[0].addDocumentTab as JsonObject).tabProperties as JsonObject).tabId as string;
    tabIdMap.set(plan.tabsToAdd[i].tabId, minted);
    json = next;
  }
  const content = plan.contentRequests.map((req) => tabIdsRewrite(req, tabIdMap));
  json = requestsEmulate(json, [...content, ...plan.tabOps.map((req) => tabIdsRewrite(req, tabIdMap))]).json;
  const actual = docModelParse(json, { docId: plan.docId, keys: new KeyAllocator() });
  return docModelsCompare(pendingLinksStrip(input.final), actual, {
    identityTransfers: plan.identityTransfers,
    listsRebuilt: new Set(plan.listRebuilds.map((r) => r.listId)),
    tabIdMap,
  });
}

/** Reconciles one tab: body content, bullets, leading section style, document style. */
function tabReconcile(o: TabModel, f: TabModel, ctx: ReconcileContext): void {
  containerReconcile(o.blocks, f.blocks, ctx);
  bulletsReconcile(f, ctx);
  const sectionFields = changedFields(o.leadingSectionStyle, f.leadingSectionStyle);
  if (sectionFields.length) {
    // Restyling the first section switches a pageless document to pages (F26); the model must say so too.
    ctx.requests.push(
      RequestBuilder.sectionStyleUpdate(
        0,
        1,
        pick(f.leadingSectionStyle, sectionFields),
        sectionFields,
        ctx.tabId,
      ) as JsonObject,
    );
    ctx.origins.push({});
  }
  const documentFields = changedFields(o.documentStyle, f.documentStyle);
  if (documentFields.length) {
    ctx.requests.push(
      RequestBuilder.updateDocumentStyle({
        documentStyle: pick(f.documentStyle, documentFields),
        fields: documentFields.join(","),
        tabId: ctx.tabId,
      }) as JsonObject,
    );
    ctx.origins.push({});
  }
}

/** Tab deletes (children go with their parent), then title and position updates in final order. */
function tabOpsPlan(original: DocModel, final: DocModel): JsonObject[] {
  const ops: JsonObject[] = [];
  const finalIds = new Set(final.tabs.map((t) => t.tabId));
  const deleted = original.tabs.filter((t) => !finalIds.has(t.tabId));
  const deletedIds = new Set(deleted.map((t) => t.tabId));
  for (const tab of deleted) {
    if (!tab.parentTabId || !deletedIds.has(tab.parentTabId))
      ops.push(RequestBuilder.deleteTab(tab.tabId) as JsonObject);
  }
  const originalTabs = new Map(original.tabs.map((t) => [t.tabId, t]));
  // Simulated sibling order after the deletes and the create phase's adds.
  const order = (parent: string | undefined, tabs: readonly TabModel[]) =>
    tabs.filter((t) => t.parentTabId === parent).map((t) => t.tabId);
  const current = new Map<string | undefined, string[]>();
  for (const tab of final.tabs) {
    const parent = tab.parentTabId;
    if (!current.has(parent)) {
      const kept = order(parent, original.tabs).filter((id) => finalIds.has(id));
      const added = order(parent, final.tabs).filter((id) => !originalTabs.has(id));
      const siblings = [...kept];
      for (const id of added) siblings.splice(order(parent, final.tabs).indexOf(id), 0, id);
      current.set(parent, siblings);
    }
  }
  for (const tab of final.tabs) {
    const before = originalTabs.get(tab.tabId);
    if (!before) continue;
    if (before.parentTabId !== tab.parentTabId)
      throw new CoreError("internal", "moving a tab to another parent isn't supported");
    const fields: Array<"index" | "title"> = [];
    const properties: { index?: number; title?: string } = {};
    if (before.title !== tab.title) {
      fields.push("title");
      properties.title = tab.title;
    }
    const siblings = current.get(tab.parentTabId) ?? [];
    const want = order(tab.parentTabId, final.tabs).indexOf(tab.tabId);
    const have = siblings.indexOf(tab.tabId);
    if (have !== want) {
      fields.push("index");
      properties.index = want;
      siblings.splice(have, 1);
      siblings.splice(want, 0, tab.tabId);
    }
    if (fields.length)
      ops.push(RequestBuilder.documentTabPropertiesUpdate(tab.tabId, properties, fields) as JsonObject);
  }
  return ops;
}

/** The blank-tab template as a model, under `tabId`. */
function blankTabModel(tabId: string): TabModel {
  const json = {
    tabs: [{ documentTab: structuredClone(blankTab) as RawDocumentTab, tabProperties: { tabId, title: "" } }],
  };
  const tab = docModelParse(json as unknown as GoogleDoc, { docId: "blank", keys: new KeyAllocator() }).tabs[0];
  return { ...tab, isNew: true };
}

/** A tab's position among its siblings. */
function siblingIndex(doc: DocModel, tab: TabModel): number {
  return doc.tabs.filter((t) => t.parentTabId === tab.parentTabId).indexOf(tab);
}

/** An `addDocumentTab` with its parent replaced. */
function withParent(add: JsonObject, parentTabId: string): JsonObject {
  const props = (add.addDocumentTab as JsonObject).tabProperties as JsonObject;
  return { addDocumentTab: { tabProperties: { ...props, parentTabId } } };
}

/** Replaces provisional tab ids anywhere in a request. */
function tabIdsRewrite(req: JsonObject, map: ReadonlyMap<string, string>): JsonObject {
  if (!map.size) return req;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [
        k,
        (k === "tabId" || k === "parentTabId") && typeof v === "string" ? (map.get(v) ?? v) : walk(v),
      ]),
    );
  };
  return walk(req) as JsonObject;
}

/** A copy of the model without pending (not yet realizable) heading links. */
function pendingLinksStrip(doc: DocModel): DocModel {
  const copy = structuredClone(doc);
  const strip = (style: JsonObject | undefined) => {
    const link = style?.link as JsonObject | undefined;
    if (style && (link?.heading as JsonObject | undefined)?.key !== undefined) delete style.link;
  };
  const paragraphs = (tab: TabModel) =>
    tab.blocks.flatMap((b) =>
      b.kind === "paragraph" ? [b] : b.kind === "table" ? b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks)) : [],
    );
  for (const tab of copy.tabs) {
    for (const p of paragraphs(tab)) for (const inline of p.inlines) strip(inline.style);
  }
  return copy;
}

/** Fields that differ between two styles. */
function changedFields(a: JsonObject, b: JsonObject): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => !styleEqual(a[f], b[f])).sort();
}

/** The fields of `style` that are set, among `fields`. */
function pick(style: JsonObject, fields: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const field of fields) if (style[field] !== undefined) out[field] = style[field];
  return out;
}
