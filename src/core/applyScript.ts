/* Run workflow script steps with alias bindings, dry-run diffs, and surgical DOM apply. */

import type { GdocsmithDocument } from "~/commands/run/types.ts";
import type { ApplyHighlightDocJson, GdocsmithStepInputInternal, StepTabCreate } from "~/core/workflowTypes.ts";
import { pendingWritersFlush } from "./actions/flush.ts";
import { type ApplyScriptRuntime, type OpenDocContext, stepRun } from "./actions/index.ts";
import { simulatedNodesOf } from "./actions/simulated.ts";
import { exportDocumentToMarkdown } from "./dom/export.ts";
import { applyDom, DomWriter, formatUnifiedDiff } from "./dom/index.ts";
import { parseDocument } from "./dom/parse.ts";
import { Gdoc } from "./gdoc.ts";
import { type GwsClient, gws } from "./gws.ts";
import { flattenTabs } from "./tabs.ts";

/** Result of executing a multi-step apply script. */
export type ScriptExecutionResult = {
  diff?: string;
  dumped: Record<string, unknown>;
  highlights: ApplyHighlightDocJson[];
  ok: boolean;
  stepsCount: number;
};

/** Executes a sequence of run script operations across one or more Google Docs. */
export async function applyScriptExecute(
  doc: GdocsmithDocument,
  opts: { client?: GwsClient; force?: boolean } = {},
): Promise<ScriptExecutionResult> {
  const dryRun = Boolean(doc.dryRun);
  const force = Boolean(doc.force || opts.force);
  const client = opts.client ?? gws;

  const steps = workflowStepsOptimize(doc.steps ?? []);
  const openDocs = new Map<string, OpenDocContext>();
  const docIdToAlias = new Map<string, string>();
  const aliasMap = new Map<string, string>();
  const dumpStore = new Map<string, unknown>();
  const dumped: Record<string, unknown> = {};
  const initialMarkdownStates = new Map<string, string>();
  const createdHighlights = new Map<string, ApplyHighlightDocJson>();
  const queryAliases = new Set<string>();

  function aliasResolve(val?: string): string | undefined {
    if (val == null) return undefined;
    const str = String(val);
    if (queryAliases.has(str)) {
      throw new Error(
        `Alias "${str}" is a query result. Mutations must target an explicit scopedId from the query output.`,
      );
    }
    if (aliasMap.has(str)) return aliasMap.get(str)!;
    return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
      if (queryAliases.has(key)) {
        throw new Error(
          `Alias "${key}" is a query result. Mutations must target an explicit scopedId from the query output.`,
        );
      }
      return aliasMap.get(key) ?? key;
    });
  }

  function openDocResolve(rawDocRef?: string): OpenDocContext {
    if (rawDocRef == null || String(rawDocRef).trim() === "") {
      throw new Error("Specify doc: <alias> (open it first with kind: docOpen or docCreate)");
    }
    const str = String(rawDocRef).trim();
    const openDoc = openDocs.get(str);
    if (openDoc) return openDoc;

    const boundAlias = docIdToAlias.get(str) ?? Array.from(openDocs.values()).find((d) => d.docId === str)?.alias;
    if (boundAlias && openDocs.has(boundAlias)) {
      return openDocs.get(boundAlias)!;
    }
    if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) {
      throw new Error(
        `Document ID "${str}" cannot be used directly in doc: on action steps. Open it first with { kind: "docOpen", doc: "${str}", as: "<alias>" }, then pass doc: "<alias>".`,
      );
    }
    throw new Error(`Document "${str}" is not open or was closed`);
  }

  async function tabMarkdownCapture(ctx: OpenDocContext, tabId: string): Promise<string> {
    const currentGdoc = tabId && ctx.gdoc.data.tabs?.length ? ctx.gdoc.withTab(tabId) : ctx.gdoc;
    const parsed = parseDocument(currentGdoc);
    const exp = exportDocumentToMarkdown([{ nodes: parsed.nodes, tabId, tabTitle: parsed.title }]);
    return exp.markdown;
  }

  const preloadedDocs = new Map<string, Gdoc>();

  if (!dryRun) {
    const rawIdsToLoad = new Set<string>();
    for (const step of steps) {
      if (step.kind === "docOpen" && step.doc) {
        const id = Gdoc.idParse(step.doc.trim());
        if (!id.startsWith("virtual:")) rawIdsToLoad.add(id);
      } else if (step.kind === "docCreate" && step.fromDoc) {
        const id = Gdoc.idParse(step.fromDoc.trim());
        if (!id.startsWith("virtual:")) rawIdsToLoad.add(id);
      }
    }
    if (rawIdsToLoad.size > 0) {
      await Promise.all(
        Array.from(rawIdsToLoad).map(async (docId) => {
          const loaded = await Gdoc.load(docId, client);
          preloadedDocs.set(docId, loaded);
        }),
      );
    }
  }

  const runtime: ApplyScriptRuntime = {
    activeDocAlias: undefined,
    aliasMap,
    aliasResolve,
    client,
    createdHighlights,
    docIdToAlias,
    dumpStore,
    dumped,
    dryRun,
    force,
    initialMarkdownStates,
    openDocResolve,
    openDocs,
    pageSetup: doc.pageSetup,
    preloadedDocs,
    queryAliases,
    stepsExecuted: 0,
    tabMarkdownCapture,
  };

  for (let i = 0; i < steps.length; i++) {
    await stepRun(runtime, i, steps[i]!);
  }

  await pendingWritersFlush(runtime);

  if (!dryRun && doc.pageSetup) {
    const ctx =
      (runtime.activeDocAlias ? openDocs.get(runtime.activeDocAlias) : undefined) ?? openDocs.values().next().value;
    if (ctx && !ctx.docId.startsWith("virtual:")) {
      const parsed = parseDocument(ctx.gdoc);
      const writer = new DomWriter(parsed.nodes, { lists: ctx.gdoc.data.lists });
      await applyDom(ctx.docId, writer, {
        client,
        doc: ctx.gdoc.data,
        pageSetup: doc.pageSetup,
      });
      ctx.gdoc = await Gdoc.load(ctx.docId, client);
    }
  }

  let fullDiff = "";
  if (dryRun) {
    const diffHunks: string[] = [];
    for (const [key, initialMd] of initialMarkdownStates.entries()) {
      const [alias, tabId] = key.split("/");
      const docCtx = openDocs.get(alias!);
      if (!docCtx) continue;

      let currentMd = "";
      const simulated = simulatedNodesOf(docCtx.gdoc, tabId!);
      if (simulated) {
        const exp = exportDocumentToMarkdown([{ nodes: simulated, tabId, tabTitle: docCtx.title }]);
        currentMd = exp.markdown;
      } else {
        currentMd = await tabMarkdownCapture(docCtx, tabId!);
      }

      const diff = formatUnifiedDiff(initialMd, currentMd, {
        contextLines: 3,
        newPath: `b/${alias}/${tabId}`,
        oldPath: initialMd ? `a/${alias}/${tabId}` : "/dev/null",
      });
      if (diff) {
        diffHunks.push(diff);
      }
    }
    fullDiff = diffHunks.join("\n\n");
  }

  for (const [alias, ctx] of openDocs.entries()) {
    const dumpedDoc = dumped[alias] as
      | { kind?: string; tabs?: Array<{ id?: string; kind: string; title?: string }> }
      | undefined;
    if (dumpedDoc && dumpedDoc.kind === "doc") {
      const tabs = flattenTabs(ctx.gdoc.data.tabs);
      const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title: ctx.title }];
      dumpedDoc.tabs = tabsToCheck.map((t) => ({
        id: t.tabId,
        kind: "tab",
        title: t.title,
      }));
    }
  }

  const highlights = Array.from(createdHighlights.values());

  return {
    diff: dryRun ? fullDiff : fullDiff || undefined,
    dumped,
    highlights,
    ok: true,
    stepsCount: runtime.stepsExecuted,
  };
}

/**
 * Optimizes workflow script steps before execution.
 *
 * Case A optimization:
 * When an agent performs a multi-step tab creation sequence (e.g. `tabAdd` / `tabDuplicate` followed
 * by `tabMove` or `tabRename` on the newly created tab), this hoists the relative/absolute position
 * and final title directly into the tab creation step. This avoids subsequent calls to
 * `updateDocumentTabProperties`, which triggers an unhandled upstream Google Docs API HTTP 500 error
 * when documents lack a root "t.0" tab (common in documents copied from multi-tab Drive templates).
 */
function workflowStepsOptimize(
  /** Workflow script steps to optimize. */
  steps: GdocsmithStepInputInternal[],
): GdocsmithStepInputInternal[] {
  const createdTabs = new Map<string, StepTabCreate & { noop?: boolean }>();

  for (const step of steps) {
    if (step.kind === "tabCreate" && step.title) {
      const docKey = step.doc?.trim() ?? "";
      createdTabs.set(`${docKey}:${step.title.trim().toLowerCase()}`, step);
      if (step.as) {
        createdTabs.set(`${docKey}:${step.as.trim().toLowerCase()}`, step);
      }
      continue;
    }

    if (step.kind === "tabMove" || step.kind === "tabReorder") {
      const docKey = step.doc?.trim() ?? "";
      const creator = createdTabs.get(`${docKey}:${step.tab.trim().toLowerCase()}`);
      if (creator && creator.afterTab == null && creator.beforeTab == null && creator.index == null) {
        creator.afterTab = step.afterTab;
        creator.beforeTab = step.beforeTab;
        creator.index = step.index;
        step.noop = true;
      }
      continue;
    }

    if (step.kind === "tabRename") {
      const docKey = step.doc?.trim() ?? "";
      const creator = createdTabs.get(`${docKey}:${step.tab.trim().toLowerCase()}`);
      if (creator) {
        const oldTitle = creator.title?.trim();
        const oldTitleLower = oldTitle?.toLowerCase();
        const newTitle = step.title;
        creator.title = newTitle;
        step.noop = true;

        if (oldTitle && oldTitleLower) {
          createdTabs.delete(`${docKey}:${oldTitleLower}`);
          createdTabs.set(`${docKey}:${newTitle.trim().toLowerCase()}`, creator);
          for (const s of steps) {
            if (s === step) break;
            const sTab = (s as { tab?: string }).tab;
            if ((s.doc?.trim() ?? "") === docKey && sTab?.trim().toLowerCase() === oldTitleLower) {
              (s as { tab?: string }).tab = newTitle;
            }
          }
        }
      }
    }
  }

  return steps;
}
