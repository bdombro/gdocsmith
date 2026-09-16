/*

CLI adapter — shared context between command leaves and core.

*/

import type { CliContext } from "argsbarg";
import { Gdoc } from "../core/gdoc.ts";
import type { ImageStoreMode } from "../core/image-store.ts";
import {
  flattenTabs,
  type ListedTab,
  listedTabs,
  resolveTab,
  type TabOutline,
  tabRequiredError,
  tabTree,
} from "../core/tabs.ts";

export function throwUsage(msg: string): never {
  throw new Error(msg);
}

export function imageStoreMode(ctx: CliContext): ImageStoreMode | undefined {
  const raw = ctx.stringOpt("image-store");
  if (!raw) return undefined;
  if (raw === "auto" || raw === "drive") return raw;
  throw new Error(`Invalid --image-store: ${raw}`);
}

/** Loaded Doc with the selected tab overlaid onto legacy body/headers/lists. */
export type ResolvedDoc = {
  documentId: string;
  gdoc: Gdoc;
  tabId?: string;
  tabTitle?: string;
  tabs: TabOutline[];
};

/** Document id from the first positional. */
export function resolveDocId(ctx: CliContext): string {
  return resolveDocRef(ctx).documentId;
}

/**
 * Document id plus optional tab hint from --tab.
 */
export function resolveDocRef(ctx: CliContext): {
  documentId: string;
  tabHint?: string;
} {
  const source = ctx.args[0];
  if (!source) throwUsage("document id required");
  const ref = Gdoc.parseRef(source);
  const flag = ctx.stringOpt("tab");
  if (flag && (flag.startsWith("http://") || flag.startsWith("https://") || flag.includes("/document/d/"))) {
    throw new Error("Pass the tab ID (e.g. 't.0') or tab title to --tab, not a URL.");
  }
  const tabHint = flag ?? undefined;
  return tabHint ? { documentId: ref.documentId, tabHint } : { documentId: ref.documentId };
}

/**
 * Fetch + overlay the selected tab. Multi-tab Docs need a URL tab or `--tab`
 * unless `requireTab` is false (e.g. export or tab commands).
 */
export async function loadResolvedDoc(ctx: CliContext, opts: { requireTab?: boolean } = {}): Promise<ResolvedDoc> {
  const { documentId, tabHint } = resolveDocRef(ctx);
  const raw = await Gdoc.load(documentId);
  const tabs = tabTree(raw.data.tabs);
  const flat = flattenTabs(raw.data.tabs);
  const requireTab = opts.requireTab !== false;

  if (flat.length > 1 && !tabHint) {
    if (!requireTab) return { documentId, gdoc: raw, tabs };
    throw tabRequiredError(tabs);
  }

  const resolved = resolveTab(raw.data, tabHint);
  const gdoc = resolved.tabId ? raw.withTab(resolved.tabId) : raw;
  return {
    documentId,
    gdoc,
    tabId: resolved.tabId,
    tabTitle: resolved.title,
    tabs,
  };
}

/**
 * Resolves all document refs from arguments.
 */
export function resolveDocRefs(ctx: CliContext): Array<{
  documentId: string;
  tabHint?: string;
}> {
  if (ctx.args.length === 0) {
    throwUsage("At least one document ID is required");
  }
  const flag = ctx.stringOpt("tab");
  if (flag && (flag.startsWith("http://") || flag.startsWith("https://") || flag.includes("/document/d/"))) {
    throw new Error("Pass the tab ID (e.g. 't.0') or tab title to --tab, not a URL.");
  }
  const tabHint = flag ?? undefined;
  return ctx.args.map((source) => {
    const ref = Gdoc.parseRef(source);
    return tabHint ? { documentId: ref.documentId, tabHint } : { documentId: ref.documentId };
  });
}

/** Loads the current tab roster after a mutation. */
export async function loadListedTabs(documentId: string): Promise<{
  tabId?: string;
  tabs: ListedTab[];
}> {
  const doc = await Gdoc.load(documentId);
  const tabs = listedTabs(doc.data.tabs);
  return { tabId: tabs[0]?.tabId, tabs };
}
