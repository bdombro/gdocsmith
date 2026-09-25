/* Transport helpers for selecting a Docs tab from a fetched document. */

import type { DocTab, GoogleDoc } from "./types.ts";

/** Parsed document reference. */
export interface DocRef {
  /** Google Docs document id. */
  documentId: string;
  /** Optional tab id. */
  tabId?: string;
}

/** Extracts a raw document ID and rejects full URLs. */
export function refParse(input: string): DocRef {
  const documentId = input.trim();
  if (
    documentId.startsWith("http://") ||
    documentId.startsWith("https://") ||
    documentId.includes("/document/d/") ||
    documentId.includes("?tab=") ||
    documentId.includes("#tab=")
  ) {
    throw new Error("Pass the document ID, not the full URL.");
  }
  return { documentId };
}

/** Alias for refParse. */
export const parseRef = refParse;

/** Overlays a tab's fields onto a document's legacy body fields for cache consumers. */
export function tabOverlay(data: GoogleDoc, tabId: string): GoogleDoc {
  const documentTab = tabFind(data.tabs, tabId)?.documentTab;
  if (!documentTab) {
    throw new Error(`Unknown tab ${tabId}.`);
  }
  return {
    ...data,
    body: documentTab.body ?? { content: [] },
    documentStyle: documentTab.documentStyle ?? data.documentStyle,
    footnotes: documentTab.footnotes,
    footers: documentTab.footers,
    headers: documentTab.headers,
    inlineObjects: documentTab.inlineObjects,
    lists: documentTab.lists,
  };
}

/** Alias for tabOverlay. */
export const overlayTab = tabOverlay;

/** Finds a tab in a depth-first tab tree. */
function tabFind(tabs: DocTab[] | undefined, tabId: string): DocTab | undefined {
  for (const tab of tabs ?? []) {
    if (tab.tabProperties?.tabId === tabId) return tab;
    const child = tabFind(tab.childTabs, tabId);
    if (child) return child;
  }
  return undefined;
}
