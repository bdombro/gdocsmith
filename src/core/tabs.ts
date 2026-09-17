/* Docs tabs: flatten the childTabs tree, overlay documentTab onto legacy fields. */

import type { DocTab, GoogleDoc } from "./types.ts";

/** Document id reference. */
export type DocRef = {
  documentId: string;
  tabId?: string;
};

/** One tab in UI order (DFS). */
export type FlatTab = {
  tabId: string;
  title: string;
};

/** Flat tab roster with zero-based index for mutation responses. */
export type ListedTab = {
  /** Zero-based tab index in sidebar order. */
  index: number;
  /** Docs tab id (e.g. t.0). */
  tabId: string;
  /** Tab title. */
  title: string;
};

/** Nested outline of tabs (matches the Docs sidebar). */
export type TabOutline = {
  children?: TabOutline[];
  tabId: string;
  title: string;
};

export const URL_NOT_ACCEPTED_MSG = `Pass the document ID, not the full URL.

Google Docs URL structure:
  https://docs.google.com/document/d/<documentId>/edit?tab=<tabId>
                                    ^^^^^^^^^^^^        ^^^^^^
                                    Document ID         --tab <tabId>

Example:
  doc query 1aMO6FtA-XVE6QtDEDGYgbd4NAg1mAT0LJKsjQvazouE --tab t.5up1ytauvsxg`;

export const TAB_REQUIRED_MSG = "This Doc has multiple tabs. Specify --tab <id|title>.";

export const APPLY_TAB_REQUIRED_MSG =
  "This Doc has multiple tabs. Each tabs[] entry must include tabId from query or tab list.";

/** Finds a tab in a DocTab tree by ID or unique title. */
export function tabInDocFind(data: GoogleDoc, hint: string): { tabId: string; title: string } {
  const flat = flattenTabs(data.tabs);
  return pickTab(flat, hint);
}

/** Finds a tab in a DocTab tree by ID or unique title (alias for tabInDocFind). */
export const findTabInDoc = tabInDocFind;

/** Extracts and validates document ID from input, rejecting full URLs. */
export function refParse(input: string): DocRef {
  const trimmed = input.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.includes("/document/d/") ||
    trimmed.includes("?tab=") ||
    trimmed.includes("#tab=")
  ) {
    throw new Error(URL_NOT_ACCEPTED_MSG);
  }
  return { documentId: trimmed };
}

/** Extracts and validates document ID from input (alias for refParse). */
export const parseRef = refParse;

/** Flattened tabs in UI order, including nested children. */
export function tabsFlatten(tabs: DocTab[] | undefined): FlatTab[] {
  const out: FlatTab[] = [];
  walkTabs(tabs, (tab) => {
    const tabId = tab.tabProperties?.tabId;
    if (!tabId) return;
    out.push({ tabId, title: tab.tabProperties?.title ?? "" });
  });
  return out;
}

/** Flattened tabs in UI order (alias for tabsFlatten). */
export const flattenTabs = tabsFlatten;

/** Flattened tabs with zero-based index in UI order. */
export function tabsListed(tabs: DocTab[] | undefined): ListedTab[] {
  return flattenTabs(tabs).map((t, index) => ({
    index,
    tabId: t.tabId,
    title: t.title,
  }));
}

/** Flattened tabs with zero-based index in UI order (alias for tabsListed). */
export const listedTabs = tabsListed;

/** Nested tab tree for tab hierarchy. */
export function tabTree(tabs: DocTab[] | undefined, _documentId?: string): TabOutline[] {
  return (tabs ?? []).map((tab) => tabToOutline(tab)).filter((t): t is TabOutline => t != null);
}

/**
 * Picks a tab. Sole tab is implicit. Several tabs need a hint (id or unique title).
 */
export function tabResolve(data: GoogleDoc, hint?: string): { tabId?: string; title?: string } {
  const flat = flattenTabs(data.tabs);
  if (!flat.length) {
    if (hint) {
      throw new Error(`This Doc has no tabs; cannot use tab ${hint}.`);
    }
    return {};
  }
  if (hint) return pickTab(flat, hint);
  if (flat.length === 1) {
    return { tabId: flat[0]?.tabId, title: flat[0]?.title };
  }
  throw tabRequiredError(tabTree(data.tabs));
}

/** Picks a tab from document data (alias for tabResolve). */
export const resolveTab = tabResolve;

/** Copies the selected tab's documentTab onto legacy body/headers/lists fields. */
export function tabOverlay(data: GoogleDoc, tabId: string): GoogleDoc {
  const dt = tabContent(data, tabId);
  return {
    ...data,
    body: dt.body ?? { content: [] },
    documentStyle: dt.documentStyle ?? data.documentStyle,
    footnotes: dt.footnotes,
    footers: dt.footers,
    headers: dt.headers,
    inlineObjects: dt.inlineObjects,
    lists: dt.lists,
  };
}

/** Copies the selected tab's documentTab onto legacy body fields (alias for tabOverlay). */
export const overlayTab = tabOverlay;

/**
 * Apply targeting: the file owns tabId. URL / --tab must match when both are set.
 * Multi-tab Docs refuse a file with no tabId.
 */
export function applyTabResolve(
  data: GoogleDoc,
  fileTabId?: string,
  hint?: string,
): { tabId?: string; title?: string } {
  const flat = flattenTabs(data.tabs);
  if (fileTabId) {
    const file = resolveTab(data, fileTabId);
    if (hint) {
      const fromHint = resolveTab(data, hint);
      if (fromHint.tabId && file.tabId && fromHint.tabId !== file.tabId) {
        throw new Error(`File tabId ${file.tabId} does not match --tab ${fromHint.tabId}.`);
      }
    }
    return file;
  }
  if (flat.length > 1) {
    throw new Error(`${APPLY_TAB_REQUIRED_MSG}\n${JSON.stringify({ tabs: tabTree(data.tabs) }, null, 2)}`);
  }
  return resolveTab(data, hint);
}

/** Resolves tab targeting for apply command (alias for applyTabResolve). */
export const resolveApplyTab = applyTabResolve;

/** That tab's documentTab (body, headers, lists, …). */
export function tabContent(data: GoogleDoc, tabId: string): NonNullable<DocTab["documentTab"]> {
  const tab = findTab(data.tabs, tabId);
  if (!tab) {
    const known = flattenTabs(data.tabs)
      .map((t) => t.tabId)
      .join(", ");
    throw new Error(`Unknown tab ${tabId}.${known ? ` Known: ${known}` : ""}`);
  }
  return tab.documentTab ?? {};
}

export function tabRequiredError(tabs: TabOutline[]): Error {
  return new Error(`${TAB_REQUIRED_MSG}\n${JSON.stringify({ tabs }, null, 2)}`);
}

/** Finds a tab in a tree by tabId. */
function findTab(tabs: DocTab[] | undefined, tabId: string): DocTab | undefined {
  let hit: DocTab | undefined;
  walkTabs(tabs, (tab) => {
    if (tab.tabProperties?.tabId === tabId) hit = tab;
  });
  return hit;
}

/** Selects a single tab from a flattened list using tabId or unique title hint. */
function pickTab(flat: FlatTab[], hint: string): { tabId: string; title: string } {
  const byId = flat.find((t) => t.tabId === hint);
  if (byId) return byId;
  const needle = hint.trim().toLowerCase();
  const byTitle = flat.filter((t) => t.title.trim().toLowerCase() === needle);
  if (byTitle.length === 1) return byTitle[0]!;
  if (byTitle.length > 1) {
    throw new Error(`Ambiguous tab title "${hint}". Use the tab id from tab list.`);
  }
  const known = flat.map((t) => `${t.tabId} (${t.title || "untitled"})`).join(", ");
  throw new Error(`Unknown tab ${hint}.${known ? ` Known: ${known}` : ""}`);
}

/** Maps a document tab node into a nested TabOutline node. */
function tabToOutline(tab: DocTab): TabOutline | undefined {
  const tabId = tab.tabProperties?.tabId;
  if (!tabId) return undefined;
  const row: TabOutline = {
    tabId,
    title: tab.tabProperties?.title ?? "",
  };
  const children = (tab.childTabs ?? []).map((c) => tabToOutline(c)).filter((t): t is TabOutline => t != null);
  if (children.length) row.children = children;
  return row;
}

/** Recursively traverses all tabs and child tabs in depth-first order. */
function walkTabs(tabs: DocTab[] | undefined, visit: (tab: DocTab) => void): void {
  for (const tab of tabs ?? []) {
    visit(tab);
    walkTabs(tab.childTabs, visit);
  }
}
