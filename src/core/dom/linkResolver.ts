/* Symbolic link resolver — transforms markdown tab/heading links into Google Docs deep links. */

import { Gdoc } from "~/core/gdoc.ts";
import { flattenTabs, resolveTab } from "~/core/tabs.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { parseDocument } from "./parse.ts";
import { headingByTitleOrSlugFind, isHeading, nodeAtFind } from "./query.ts";
import type { DocNode } from "./types.ts";

/**
 * Context required to resolve symbolic tab and heading links against a document.
 */
export type SymbolicLinkContext = {
  /** Active tab ID if targeting a specific tab. */
  currentTabId?: string;
  /** Google Doc data containing tabs and headings. */
  doc?: GoogleDoc;
  /** In-memory node tape for heading searches (used in single-tab operations or dry-run). */
  nodes?: DocNode[];
  /** In-memory simulated tabs map (used in dry-run multi-tab documents). */
  simulatedTabs?: Map<string, DocNode[]>;
};

/**
 * Creates a bound symbolic link resolver function for a given document context.
 */
export function symbolicLinkResolverCreate(
  /** Document context for resolving tabs and headings. */
  ctx?: SymbolicLinkContext,
): (href: string) => string {
  return (href: string) => symbolicLinkResolve(href, ctx);
}

/** Creates a bound symbolic link resolver function (alias for symbolicLinkResolverCreate). */
export const createSymbolicLinkResolver = symbolicLinkResolverCreate;

/**
 * Pre-processes markdown text, replacing symbolic tab and heading links with resolved Docs URLs.
 */
export function markdownSymbolicLinksResolve(
  /** Raw markdown text. */
  markdown: string,
  /** Link resolver function. */
  resolver?: (href: string) => string,
): string {
  if (!resolver || !markdown) return markdown;

  return markdown.replace(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\r\n]+`)|\[(?<label>[^\]\r\n]+)\]\((?:<(?<angledHref>(?:tab:|[#])[^>\r\n]+)>|(?<rawHref>(?:tab:|[#])[^)\r\n]+))\)/g,
    (match, code, label, angledHref, rawHref) => {
      if (code) return code;
      const targetHref = (angledHref ?? rawHref ?? "").trim();
      if (!targetHref) return match;
      const resolved = resolver(targetHref);
      return `[${label}](${resolved})`;
    },
  );
}

/** Pre-processes markdown text with resolved symbolic links (alias for markdownSymbolicLinksResolve). */
export const resolveMarkdownSymbolicLinks = markdownSymbolicLinksResolve;

/**
 * Resolves a symbolic markdown link URL into an internal Google Docs deep link.
 */
export function symbolicLinkResolve(
  /** Raw href target from markdown link (e.g. "tab:Appendices#Appendix A", "#Decisions", "https://..."). */
  href: string,
  /** Document context containing tabs and headings. */
  ctx?: SymbolicLinkContext,
): string {
  if (!href) return href;

  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("/") ||
    href.startsWith("?tab=") ||
    href.startsWith("#heading=h.")
  ) {
    return href;
  }

  if (href.startsWith("tab:")) {
    const rawTarget = href.slice(4).trim();
    const hashIndex = rawTarget.indexOf("#");
    const tabHint = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget).trim();
    const headingHint = (hashIndex >= 0 ? rawTarget.slice(hashIndex + 1) : "").trim();

    if (!tabHint) {
      throw new Error(`Invalid symbolic link "${href}": tab title or ID is required.`);
    }
    if (!ctx?.doc) {
      return href;
    }

    const resolvedTab = resolveTab(ctx.doc, tabHint);
    const tabId = resolvedTab.tabId;
    if (!tabId) {
      throw new Error(`Cannot resolve symbolic link "${href}": document has no tab matching "${tabHint}".`);
    }

    if (!headingHint) {
      return `?tab=${tabId}`;
    }

    if (headingHint.startsWith("h.") && !headingHint.includes(" ")) {
      return `?tab=${tabId}#heading=${headingHint}`;
    }

    const nodes = tabNodesExtract(ctx, tabId);
    const hit = headingByTitleOrSlugFind(nodes, headingHint) ?? nodeAtFind(nodes, headingHint);
    if (!hit) {
      const known = nodes
        .filter((n) => isHeading(n))
        .map((h) => `"${(h.text ?? "").trim()}"`)
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Cannot resolve symbolic link "${href}": heading "${headingHint}" not found in tab "${resolvedTab.title || tabId}".${known ? ` Known headings: ${known}` : ""}`,
      );
    }

    const headingId = nodeHeadingIdResolve(hit);
    return headingId ? `?tab=${tabId}#heading=${headingId}` : `?tab=${tabId}`;
  }

  if (href.startsWith("#")) {
    const headingHint = href.slice(1).trim();
    if (!headingHint || headingHint.startsWith("heading=h.")) {
      return href;
    }

    if (headingHint.startsWith("h.") && !headingHint.includes(" ")) {
      return ctx?.currentTabId ? `?tab=${ctx.currentTabId}#heading=${headingHint}` : `#heading=${headingHint}`;
    }

    if (ctx?.currentTabId) {
      const activeNodes = tabNodesExtract(ctx, ctx.currentTabId);
      const hit = headingByTitleOrSlugFind(activeNodes, headingHint) ?? nodeAtFind(activeNodes, headingHint);
      if (hit) {
        const headingId = nodeHeadingIdResolve(hit);
        return headingId ? `?tab=${ctx.currentTabId}#heading=${headingId}` : `?tab=${ctx.currentTabId}`;
      }
    } else if (ctx?.nodes?.length) {
      const hit = headingByTitleOrSlugFind(ctx.nodes, headingHint) ?? nodeAtFind(ctx.nodes, headingHint);
      if (hit) {
        const headingId = nodeHeadingIdResolve(hit);
        return headingId ? `#heading=${headingId}` : href;
      }
    }

    if (ctx?.doc?.tabs?.length) {
      for (const tab of flattenTabs(ctx.doc.tabs)) {
        if (tab.tabId === ctx.currentTabId) continue;
        const nodes = tabNodesExtract(ctx, tab.tabId);
        const hit = headingByTitleOrSlugFind(nodes, headingHint) ?? nodeAtFind(nodes, headingHint);
        if (hit) {
          const headingId = nodeHeadingIdResolve(hit);
          return headingId ? `?tab=${tab.tabId}#heading=${headingId}` : `?tab=${tab.tabId}`;
        }
      }
    }

    if (ctx?.nodes?.length || ctx?.doc) {
      const activeList = ctx?.currentTabId ? tabNodesExtract(ctx, ctx.currentTabId) : (ctx?.nodes ?? []);
      const allHeadings = activeList
        .filter((n) => isHeading(n))
        .map((h) => `"${(h.text ?? "").trim()}"`)
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Cannot resolve heading link "${href}": heading "${headingHint}" not found.${allHeadings ? ` Known headings in active tab: ${allHeadings}` : ""}`,
      );
    }
  }

  return href;
}

/** Resolves a symbolic markdown link URL (alias for symbolicLinkResolve). */
export const resolveSymbolicLink = symbolicLinkResolve;

/** Extracts parsed document nodes for a specific tab from context. */
function tabNodesExtract(
  /** Document context. */
  ctx: SymbolicLinkContext,
  /** Tab ID to extract nodes for. */
  tabId: string,
): DocNode[] {
  if (ctx.simulatedTabs?.has(tabId)) {
    return ctx.simulatedTabs.get(tabId)!;
  }
  if (ctx.doc?.tabs?.length) {
    const tabGdoc = new Gdoc(ctx.doc, ctx.doc.documentId ?? "doc").withTab(tabId);
    return parseDocument(tabGdoc).nodes;
  }
  if (ctx.nodes && (!ctx.currentTabId || ctx.currentTabId === tabId)) {
    return ctx.nodes;
  }
  return [];
}

/**
 * Resolves a heading identifier for deep linking, falling back to scoped IDs or tape index when not yet assigned by Google Docs.
 */
function nodeHeadingIdResolve(
  /** Heading document node. */
  node: DocNode,
): string | undefined {
  if (node.headingId) return node.headingId;
  if (node.scopedId) {
    const prefix = node.scopedId.split(".")[0];
    if (prefix && prefix !== "_preamble") return prefix;
  }
  return typeof node.tapeIndex === "number" ? `h.heading_${node.tapeIndex}` : undefined;
}
