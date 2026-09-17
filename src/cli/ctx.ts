/* CLI context adapters for argsbarg leaf handlers. */

import type { CliContext } from "argsbarg";
import { Gdoc } from "~/core/gdoc.ts";
import type { ImageStoreMode } from "~/core/imageStore.ts";
import {
  flattenTabs,
  type ListedTab,
  listedTabs,
  resolveTab,
  type TabOutline,
  tabRequiredError,
  tabTree,
} from "~/core/tabs.ts";

/** Loaded Doc with the selected tab overlaid onto legacy body/headers/lists. */
export type ResolvedDoc = {
  documentId: string;
  gdoc: Gdoc;
  tabId?: string;
  tabs: TabOutline[];
  tabTitle?: string;
};

/** Throws a CLI usage error with the given message. */
export function usageThrow(msg: string): never {
  throw new Error(msg);
}

/** Throws a CLI usage error (alias for usageThrow). */
export const throwUsage = usageThrow;

/** Resolves image store backend from CLI --image-store option. */
export function imageStoreMode(ctx: CliContext): ImageStoreMode | undefined {
  const raw = ctx.stringOpt("image-store");
  if (!raw) return undefined;
  if (raw === "auto" || raw === "drive") return raw;
  throw new Error(`Invalid --image-store: ${raw}`);
}

/** Document id from the first positional argument. */
export function docIdResolve(ctx: CliContext): string {
  return docRefResolve(ctx).documentId;
}

/** Document id from the first positional argument (alias for docIdResolve). */
export const resolveDocId = docIdResolve;

/** Document id plus optional tab hint from --tab. */
export function docRefResolve(ctx: CliContext): {
  documentId: string;
  tabHint?: string;
} {
  const source = ctx.args[0];
  if (!source) usageThrow("document id required");
  const ref = Gdoc.parseRef(source);
  const flag = ctx.stringOpt("tab");
  if (flag && (flag.startsWith("http://") || flag.startsWith("https://") || flag.includes("/document/d/"))) {
    throw new Error("Pass the tab ID (e.g. 't.0') or tab title to --tab, not a URL.");
  }
  const tabHint = flag ?? undefined;
  return tabHint ? { documentId: ref.documentId, tabHint } : { documentId: ref.documentId };
}

/** Document id plus optional tab hint from --tab (alias for docRefResolve). */
export const resolveDocRef = docRefResolve;

/**
 * Fetch + overlay the selected tab. Multi-tab Docs need a URL tab or `--tab`
 * unless `requireTab` is false (e.g. export or tab commands).
 */
export async function resolvedDocLoad(ctx: CliContext, opts: { requireTab?: boolean } = {}): Promise<ResolvedDoc> {
  const { documentId, tabHint } = docRefResolve(ctx);
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
    tabs,
    tabTitle: resolved.title,
  };
}

/** Fetch + overlay the selected tab (alias for resolvedDocLoad). */
export const loadResolvedDoc = resolvedDocLoad;

/** Resolves all document refs from arguments. */
export function docRefsResolve(ctx: CliContext): Array<{
  documentId: string;
  tabHint?: string;
}> {
  if (ctx.args.length === 0) {
    usageThrow("At least one document ID is required");
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

/** Resolves all document refs from arguments (alias for docRefsResolve). */
export const resolveDocRefs = docRefsResolve;

/** Loads the current tab roster after a mutation. */
export async function listedTabsLoad(documentId: string): Promise<{
  tabId?: string;
  tabs: ListedTab[];
}> {
  const doc = await Gdoc.load(documentId);
  const tabs = listedTabs(doc.data.tabs);
  return { tabId: tabs[0]?.tabId, tabs };
}

/** Loads the current tab roster after a mutation (alias for listedTabsLoad). */
export const loadListedTabs = listedTabsLoad;
