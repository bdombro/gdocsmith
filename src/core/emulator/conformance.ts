/* Live conformance fixtures (G3 M5): compact storage, id normalization, and live-vs-emulated comparison. */

import type { GoogleDoc } from "~/core/types.ts";
import blankTab from "../model/blankTab.json";
import { docModelsCompare } from "../model/equivalence.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { styleEqual } from "../model/styleValues.ts";
import { requestsEmulate } from "./emulate.ts";

/** One recorded scenario: the document before, the requests sent, and what the API returned. */
export interface ConformanceFixture {
  /** Document after the requests, or `null` when the API rejected them. */ after: GoogleDoc | null;
  /** Document the requests were applied to. */ before: GoogleDoc;
  /** API error text when the batch was rejected. */ error?: string;
  /** Scenario id (file name). */ id: string;
  /** What the scenario checks. */ name: string;
  /** `batchUpdate` replies. */ replies?: JsonObject[];
  /** The batch sent. */ requests: JsonObject[];
}

/** Marker a compact fixture stores in place of a tab's `namedStyles`/`documentStyle` when it equals the blank-tab template. */
const BLANK = "$blank";

/** Tab fields that are usually identical to the blank-tab template. */
const TEMPLATE_FIELDS = ["documentStyle", "namedStyles"] as const;

/** Id-valued fields whose values the server mints; new ones are renamed to `NEW#k` placeholders before comparing. */
const ID_FIELDS: ReadonlySet<string> = new Set([
  "dateId",
  "headingId",
  "inlineObjectId",
  "listId",
  "objectId",
  "parentTabId",
  "personId",
  "richLinkId",
  "tabId",
]);

/** Map-valued fields keyed by server-minted ids. */
const ID_KEYED_FIELDS: ReadonlySet<string> = new Set(["inlineObjects", "lists", "positionedObjects"]);

/** Rich-link properties the server derives from the target (the emulator can't know them). */
const RICH_LINK_DERIVED_FIELDS = ["mimeType", "title"];

/** Shrinks a fixture for committing: template-equal tab styles become a marker, and doc identity is dropped. */
export function fixtureCompact(
  /** Fixture as recorded. */
  fx: ConformanceFixture,
): JsonObject {
  const compactDoc = (doc: GoogleDoc | null): unknown => {
    if (!doc) return null;
    const out = structuredClone(doc) as unknown as JsonObject;
    delete out.documentId;
    delete out.revisionId;
    delete out.title;
    tabsWalk(out, (dt) => {
      for (const field of TEMPLATE_FIELDS) if (styleEqual(dt[field], blankTab[field])) dt[field] = BLANK;
    });
    return out;
  };
  return { ...fx, after: compactDoc(fx.after), before: compactDoc(fx.before) };
}

/** Inverse of `fixtureCompact`. */
export function fixtureExpand(
  /** Compact fixture JSON. */
  json: JsonObject,
): ConformanceFixture {
  const expandDoc = (doc: unknown): GoogleDoc | null => {
    if (!doc) return null;
    const out = structuredClone(doc) as JsonObject;
    out.documentId = "conformance";
    tabsWalk(out, (dt) => {
      for (const field of TEMPLATE_FIELDS) if (dt[field] === BLANK) dt[field] = structuredClone(blankTab[field]);
    });
    return out as unknown as GoogleDoc;
  };
  const fx = json as unknown as ConformanceFixture;
  return { ...fx, after: expandDoc(json.after), before: expandDoc(json.before) as GoogleDoc };
}

/**
 * Replays a fixture through the emulator and lists every difference from what the API did: the
 * resulting documents under the model equivalence contract (after renaming server-minted ids and
 * dropping server-derived fields), the reply shapes, and whether the batch was rejected.
 */
export function conformanceCompare(
  /** Recorded fixture. */
  fx: ConformanceFixture,
): string[] {
  let emulated: { json: GoogleDoc; replies: JsonObject[] };
  try {
    emulated = requestsEmulate(fx.before, fx.requests);
  } catch (err) {
    return fx.after ? [`emulator rejected the batch the API accepted: ${(err as Error).message}`] : [];
  }
  if (!fx.after) return [`emulator accepted the batch the API rejected: ${fx.error ?? "(no error text)"}`];
  const baseline = new Set<string>();
  idsCollect(fx.before, baseline);
  const parse = (doc: GoogleDoc) =>
    docModelParse(serverDerivedStrip(idsNormalize(doc, baseline)), { docId: "conformance", keys: new KeyAllocator() });
  const diffs = docModelsCompare(parse(fx.after), parse(emulated.json)).diffs;
  const liveReplies = JSON.stringify(replyShape(fx.replies ?? []));
  const emulatedReplies = JSON.stringify(replyShape(emulated.replies));
  if (liveReplies !== emulatedReplies) diffs.push(`replies: expected ${liveReplies}, got ${emulatedReplies}`);
  return diffs;
}

/** Calls `visit` on every tab's `documentTab` (child tabs included). */
function tabsWalk(doc: JsonObject, visit: (documentTab: JsonObject) => void): void {
  const walk = (tabs: unknown): void => {
    for (const tab of (tabs as JsonObject[] | undefined) ?? []) {
      if (tab.documentTab) visit(tab.documentTab as JsonObject);
      walk(tab.childTabs);
    }
  };
  walk(doc.tabs);
}

/** Collects every id value (and id-keyed map key) in `node`. */
function idsCollect(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) idsCollect(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && ID_FIELDS.has(key)) out.add(value);
    if (key === "heading" && typeof (value as JsonObject)?.id === "string") out.add((value as JsonObject).id as string);
    if (ID_KEYED_FIELDS.has(key) && value && typeof value === "object") for (const k of Object.keys(value)) out.add(k);
    idsCollect(value, out);
  }
}

/** Renames every id not present in `baseline` to `NEW#k`, numbered by first appearance, so independently minted ids compare equal. */
function idsNormalize(doc: GoogleDoc, baseline: ReadonlySet<string>): GoogleDoc {
  const found = new Set<string>();
  idsCollect(doc, found);
  const map = new Map<string, string>();
  for (const id of found) if (!baseline.has(id)) map.set(id, `NEW#${map.size + 1}`);
  const walk = (node: unknown, parentKey?: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (!node || typeof node !== "object") return node;
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      const outKey = parentKey && ID_KEYED_FIELDS.has(parentKey) ? (map.get(key) ?? key) : key;
      const isId = ID_FIELDS.has(key) || (parentKey === "heading" && key === "id");
      out[outKey] = typeof value === "string" && isId ? (map.get(value) ?? value) : walk(value, key);
    }
    return out;
  };
  return walk(doc) as GoogleDoc;
}

/** Drops fields the server derives from outside the document (rich-link titles and MIME types). */
function serverDerivedStrip(doc: GoogleDoc): GoogleDoc {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as JsonObject;
    if (obj.richLinkProperties && typeof obj.richLinkProperties === "object") {
      for (const field of RICH_LINK_DERIVED_FIELDS) delete (obj.richLinkProperties as JsonObject)[field];
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(doc);
  return doc;
}

/** A reply list with every id value replaced by a placeholder and keys sorted, for shape comparison. */
function replyShape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(replyShape);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, typeof value === "string" && /Id$/.test(key) ? "ID" : replyShape(value)]),
  );
}
