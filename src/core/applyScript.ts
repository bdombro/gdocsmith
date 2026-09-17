/* Run workflow script steps with alias bindings, dry-run diffs, and surgical DOM apply. */

import type { GdocsmithDocument } from "~/commands/run/types.ts";
import type { ApplyHighlightDocJson } from "~/core/workflowTypes.ts";
import { type ApplyScriptRuntime, type OpenDocContext, stepRun } from "./actions/index.ts";
import { simulatedNodesOf } from "./actions/simulated.ts";
import { exportDocumentToMarkdown } from "./dom/export.ts";
import { applyDom, DomWriter, formatUnifiedDiff } from "./dom/index.ts";
import { parseDocument } from "./dom/parse.ts";
import { Gdoc } from "./gdoc.ts";
import { type GwsClient, gws } from "./gws.ts";
import { DriveRevisions } from "./revisions.ts";

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

  const steps = doc.steps ?? [];
  const openDocs = new Map<string, OpenDocContext>();
  const docIdToAlias = new Map<string, string>();
  const aliasMap = new Map<string, string>();
  const dumpStore = new Map<string, unknown>();
  const dumped: Record<string, unknown> = {};
  const initialMarkdownStates = new Map<string, string>();
  const createdHighlights = new Map<string, ApplyHighlightDocJson>();

  function aliasResolve(val?: string): string | undefined {
    if (val == null) return undefined;
    const str = String(val);
    if (aliasMap.has(str)) return aliasMap.get(str)!;
    return str.replace(/\$\{([^}]+)\}/g, (_, key) => aliasMap.get(key) ?? key);
  }

  function openDocResolve(rawDocRef?: string): OpenDocContext {
    const resolved = aliasResolve(rawDocRef) ?? rawDocRef ?? runtime.activeDocAlias;
    if (!resolved) {
      if (openDocs.size === 1) {
        return openDocs.values().next().value!;
      }
      throw new Error("No active document. Use kind: open or specify doc: <alias>");
    }
    const openDoc = openDocs.get(resolved) ?? Array.from(openDocs.values()).find((d) => d.docId === resolved);
    if (!openDoc) {
      throw new Error(`Document "${resolved}" is not open or was closed`);
    }
    return openDoc;
  }

  async function tabMarkdownCapture(ctx: OpenDocContext, tabId: string): Promise<string> {
    const currentGdoc = tabId ? ctx.gdoc.withTab(tabId) : ctx.gdoc;
    const parsed = parseDocument(currentGdoc);
    const exp = exportDocumentToMarkdown([{ nodes: parsed.nodes, tabId, tabTitle: parsed.title }]);
    return exp.markdown;
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
    stepsExecuted: 0,
    tabMarkdownCapture,
  };

  if (doc.documentId) {
    const docId = Gdoc.parseId(doc.documentId);
    let title = "Document";
    let gdoc: Gdoc;
    if (dryRun) {
      gdoc = new Gdoc({ documentId: docId, revisionId: "dry-run", title }, docId);
    } else {
      gdoc = await Gdoc.load(docId, client);
      title = gdoc.data.title || title;
      const pin = await DriveRevisions.pinHead(docId, client);
      openDocs.set("main", {
        alias: "main",
        docId,
        gdoc,
        pinnedRevisionId: pin?.id,
        title,
      });
    }
    if (!openDocs.has("main")) {
      openDocs.set("main", {
        alias: "main",
        docId,
        gdoc,
        title,
      });
    }
    docIdToAlias.set(docId, "main");
    aliasMap.set("main", docId);
    runtime.activeDocAlias = "main";
  }

  for (let i = 0; i < steps.length; i++) {
    await stepRun(runtime, i, steps[i]!);
  }

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
      const simulated = simulatedNodesOf(docCtx.gdoc);
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

  const highlights = Array.from(createdHighlights.values());

  return {
    diff: fullDiff || undefined,
    dumped,
    highlights,
    ok: true,
    stepsCount: runtime.stepsExecuted,
  };
}
