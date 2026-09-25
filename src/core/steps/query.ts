/* Handlers for query step and saveTo support (G4 D5, D8, M5). */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NodeInfo } from "~/core/lens/query.ts";
import { CoreError } from "~/core/model/errors.ts";
import type { StepOutcome } from "./content.ts";
import { docRefResolve, rangeRefResolve, type StepContext, StepError, stepErrorCreate, tabResolve } from "./context.ts";
import { tabSlug } from "./output.ts";
import type { StepQuery } from "./types.ts";

/** Executes a `query` step: outputs outline, markdown, or nodes; writes to saveTo if set. */
export async function queryStepApply(ctx: StepContext, step: StepQuery): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);
    const tabsToQuery =
      step.tab !== undefined ? [tabResolve(ctx, doc, step.tab, step.at)] : doc.tabs().map((t) => doc.tab(t.tabId));

    const outputKind = step.output ?? "outline";

    if (outputKind === "nodes") {
      const allNodes: NodeInfo[] = [];
      for (const tab of tabsToQuery) {
        const range = step.at ? rangeRefResolve(ctx, tab, step.at) : undefined;
        const nodes = tab.nodes({ includeCells: true, range });
        allNodes.push(...nodes);
      }

      let filtered = allNodes;
      if (step.where) {
        const w = step.where;
        if (w.contains !== undefined) {
          const substr = w.contains.toLowerCase();
          filtered = filtered.filter((n) => n.text.toLowerCase().includes(substr));
        }
        if (w.kinds !== undefined && w.kinds.length > 0) {
          const set = new Set(w.kinds);
          filtered = filtered.filter((n) => set.has(n.kind));
        }
        if (w.headingLevels !== undefined && w.headingLevels.length > 0) {
          const set = new Set(w.headingLevels);
          filtered = filtered.filter((n) => n.level !== undefined && set.has(n.level));
        }
        if (w.fragile) {
          filtered = filtered.filter((n) => n.flags.includes("unrecreatable"));
        }
        if (w.fontColors !== undefined && w.fontColors.length > 0) {
          const colors = new Set(w.fontColors.map((c) => c.toUpperCase()));
          filtered = filtered.filter((n) => n.fontColors?.some((c) => colors.has(c.toUpperCase())));
        }
      }

      const data = { nodes: filtered };
      if (step.saveTo) {
        mkdirSync(step.saveTo, { recursive: true });
        const filePath = join(step.saveTo, "nodes.json");
        writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return { data, files: [filePath] };
      }
      return { data };
    }

    if (outputKind === "markdown") {
      const tabs = tabsToQuery.map((t) => {
        const title = doc.tabs().find((ti) => ti.tabId === t.tabId)?.title ?? t.tabId;
        const range = step.at ? rangeRefResolve(ctx, t, step.at) : undefined;
        const exported = t.markdown({
          range,
          skipFrontmatter: step.skipFrontmatter,
        });
        return {
          markdown: exported.markdown,
          tabId: t.tabId,
          title,
        };
      });

      const data = { tabs };
      const outline = {
        tabs: tabsToQuery.map((t) => ({
          headings: t.outline().map((h) => ({ id: h.anchor, level: h.level, text: h.text })),
          tabId: t.tabId,
          title: doc.tabs().find((ti) => ti.tabId === t.tabId)?.title ?? t.tabId,
        })),
      };

      if (step.saveTo) {
        mkdirSync(step.saveTo, { recursive: true });
        const files: string[] = [];
        const seenSlugs = new Map<string, number>();
        for (const t of tabs) {
          let slug = tabSlug(t.title, t.tabId);
          const count = seenSlugs.get(slug) ?? 0;
          seenSlugs.set(slug, count + 1);
          if (count > 0) slug = `${slug}-${t.tabId}`;
          const filePath = join(step.saveTo, `${slug}.md`);
          writeFileSync(filePath, t.markdown, "utf8");
          files.push(filePath);
        }
        return { data, files, outline };
      }

      return { data, outline };
    }

    // Default: output "outline"
    const tabs = tabsToQuery.map((t) => ({
      headings: t.outline().map((h) => ({ id: h.anchor, level: h.level, text: h.text })),
      tabId: t.tabId,
      title: doc.tabs().find((ti) => ti.tabId === t.tabId)?.title ?? t.tabId,
    }));
    const data = { tabs };

    if (step.saveTo) {
      mkdirSync(step.saveTo, { recursive: true });
      const filePath = join(step.saveTo, "outline.json");
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      return { data, files: [filePath] };
    }

    return { data };
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}
