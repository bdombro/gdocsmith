/* Exports a tab (or a range of it) as lens markdown, with notes on what markdown can't show (G3 M13). */

import { headingStyleIs } from "../model/effectiveStyle.ts";
import type { DocModel, ParagraphBlock, TabModel } from "../model/types.ts";
import { paragraphText, type ResolvedRange } from "./anchors.ts";
import { projectionBuild } from "./project.ts";
import { type LinkRenderContext, markdownRender } from "./render.ts";

/** A markdown export and what it couldn't show. */
export interface MarkdownExport {
  /** The markdown. */ markdown: string;
  /** Human-readable notes on lossy parts. */ notes: string[];
  /** Anchors of blocks with pending suggestions (edits to them are guarded). */ protected: string[];
  /** Anchors of tables markdown can't express (edits to them are refused). */ readOnly: string[];
}

/**
 * Renders `range` of `tab` as markdown. Frontmatter mode (the default) carries doc/tab identity, the
 * revision, and style directives; `skipFrontmatter` gives plain markdown, dropping styles markdown
 * can't show (noted).
 */
export function tabMarkdownExport(
  /** Document the tab belongs to (for identity and cross-tab links). */
  doc: DocModel,
  /** Tab to export. */
  tab: TabModel,
  /** Which blocks. */
  range: ResolvedRange,
  /** Plain mode. */
  opts: { skipFrontmatter?: boolean } = {},
): MarkdownExport {
  const mode = opts.skipFrontmatter ? "plain" : "frontmatter";
  const projection = projectionBuild(tab, range, { mode });
  const markdown = markdownRender(projection, {
    frontmatter: { doc: doc.docId, revision: doc.revisionId, tab: tab.tabId, title: tab.title },
    links: linkContext(doc, tab),
  });
  const notes: string[] = [];
  if (mode === "plain" && projection.blocks.some((b) => b.styled))
    notes.push("styles markdown can't show were left out (plain mode)");
  const readOnly = projection.blocks.filter((b) => b.table?.readOnly).map((b) => b.anchor);
  if (readOnly.length) notes.push(`${readOnly.length} table(s) are read-only: markdown can't express their layout`);
  const protectedKeys = new Set(
    tab.blocks.filter((b) => (b.kind === "paragraph" || b.kind === "table") && b.protected).map((b) => b.key),
  );
  return {
    markdown,
    notes,
    protected: projection.blocks.filter((b) => protectedKeys.has(b.key)).map((b) => b.anchor),
    readOnly,
  };
}

/** Link resolution for one tab of a document. */
function linkContext(doc: DocModel, tab: TabModel): LinkRenderContext {
  const headings = (t: TabModel) =>
    t.blocks.filter(
      (b): b is ParagraphBlock =>
        b.kind === "paragraph" && headingStyleIs(b.style.namedStyleType as string | undefined),
    );
  return {
    headingText(headingId, tabId) {
      const target = tabId && tabId !== tab.tabId ? doc.tabs.find((t) => t.tabId === tabId) : tab;
      if (!target) return undefined;
      const all = headings(target);
      const heading = all.find((h) => h.headingId === headingId);
      if (!heading) return undefined;
      const text = paragraphText(heading).trim();
      const unique = all.filter((h) => paragraphText(h).trim().toLowerCase() === text.toLowerCase()).length === 1;
      return { tabTitle: target === tab ? undefined : target.title, text, unique };
    },
    pendingText(key) {
      for (const t of doc.tabs) {
        const heading = headings(t).find((h) => h.key === key);
        if (heading) return paragraphText(heading).trim();
      }
      return undefined;
    },
    tabTitle: (tabId) => doc.tabs.find((t) => t.tabId === tabId)?.title,
  };
}
