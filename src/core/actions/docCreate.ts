/* Workflow step: docCreate — create a new Google Doc or copy an existing document into a new alias. */

import { docCache } from "~/core/cache/docCache.ts";
import { buildDocumentStyleRequest } from "~/core/dom/applyBatch.ts";
import { elementSpecFromNode } from "~/core/dom/clone.ts";
import { exportDocumentToMarkdown } from "~/core/dom/export.ts";
import { type PageSetup, pageSetupExtract } from "~/core/dom/ops.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { gws, gwsDrive } from "~/core/gws.ts";
import { elementsInsertExecute } from "~/core/markdown.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { findTab, flattenTabs, resolveTab } from "~/core/tabs.ts";
import type { StepDocCreate } from "~/core/workflowTypes.ts";
import { simulatedNodesOf, simulatedNodesSet } from "./simulated.ts";
import { detectLossyTabElements, lossyTabCopyError } from "./tabLossyScan.ts";
import type { ApplyScriptRuntime, SimulatedGdoc, WorkflowStepHandler } from "./types.ts";

/** Creates a new document (or clones from an existing document) and registers it in the session. */
export const docCreateStep: WorkflowStepHandler = async (
  /** Script runtime context. */
  runtime,
  /** Zero-based index of this step in the workflow. */
  stepIndex,
  /** Workflow step input. */
  step,
) => {
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] docCreate requires "as: <alias>"`);
  const title = step.title;
  if (!title) throw new Error(`steps[${stepIndex}] docCreate requires title: <string>`);

  const fromDocRaw = step.fromDoc;
  const fromTabRaw = step.fromTab;
  if (fromTabRaw && !fromDocRaw) {
    throw new Error(`steps[${stepIndex}] docCreate: "fromTab" requires "fromDoc" to be specified.`);
  }

  const mode =
    step.mode ??
    step.pageSetup?.mode ??
    (step.pageless !== undefined
      ? step.pageless
        ? "PAGELESS"
        : "PAGES"
      : step.pageSetup?.pageless !== undefined
        ? step.pageSetup.pageless
          ? "PAGELESS"
          : "PAGES"
        : undefined);

  const effectivePageSetup: PageSetup | undefined =
    step.pageSetup || mode
      ? {
          ...(step.pageSetup ?? {}),
          ...(mode ? { mode: mode as "PAGES" | "PAGELESS", pageless: mode === "PAGELESS" } : {}),
        }
      : undefined;

  if (fromDocRaw && fromTabRaw) {
    await docCreateFromTab({
      as,
      effectivePageSetup,
      fromDocRaw,
      fromTabRaw,
      runtime,
      step: step as StepDocCreate,
      stepIndex,
      title,
    });
    return;
  }

  if (fromDocRaw) {
    const fromDoc = runtime.aliasResolve(fromDocRaw);
    if (!fromDoc) throw new Error(`steps[${stepIndex}] docCreate could not resolve fromDoc: "${fromDocRaw}"`);

    const forceFetch = Boolean(step.forceFetch);
    let newDocId = `virtual:${as}`;
    let gdoc: Gdoc;

    if (runtime.dryRun) {
      const sourceContext =
        runtime.openDocs.get(fromDoc) ?? Array.from(runtime.openDocs.values()).find((d) => d.docId === fromDoc);
      if (sourceContext) {
        gdoc = new Gdoc({ ...structuredClone(sourceContext.gdoc.data), documentId: newDocId, title }, newDocId);
        const sourceSim = sourceContext.gdoc as SimulatedGdoc;
        if (sourceSim.simulatedNodes) {
          simulatedNodesSet(gdoc, structuredClone(sourceSim.simulatedNodes));
        }
        if (sourceSim.simulatedTabs) {
          for (const [tId, nodes] of sourceSim.simulatedTabs.entries()) {
            simulatedNodesSet(gdoc, structuredClone(nodes), tId);
          }
        }
      } else {
        try {
          const preloaded = !forceFetch ? runtime.preloadedDocs?.get(fromDoc) : undefined;
          const loaded =
            preloaded ?? (await Gdoc.load(fromDoc, runtime.client, forceFetch ? { forceFetch: true } : undefined));
          gdoc = new Gdoc({ ...structuredClone(loaded.data), documentId: newDocId, title }, newDocId);
        } catch {
          gdoc = new Gdoc({ documentId: newDocId, title }, newDocId);
        }
      }
    } else {
      const res = await gwsDrive.copyFile(fromDoc, title);
      newDocId = res.id;
      gdoc = await Gdoc.load(newDocId, runtime.client);
    }

    const openContext = {
      alias: as,
      docId: newDocId,
      gdoc,
      isVirtual: runtime.dryRun,
      title,
    };

    const tabs = flattenTabs(gdoc.data.tabs);
    const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
    const dumpPayload = {
      alias: as,
      id: newDocId,
      kind: "doc",
      tabs: tabsToCheck.map((t) => ({ id: t.tabId, kind: "tab", title: t.title })),
      title,
    };

    runtime.openDocs.set(as, openContext);
    runtime.docIdToAlias.set(newDocId, as);
    runtime.aliasMap.set(as, newDocId);
    runtime.dumpStore.set(as, dumpPayload);
    if (step.dump) {
      runtime.dumped[as] = dumpPayload;
    }
    runtime.activeDocAlias = as;

    if (runtime.dryRun) {
      for (const t of tabsToCheck) {
        const parsed = parseDocument(t.tabId && gdoc.data.tabs?.length ? gdoc.withTab(t.tabId) : gdoc);
        const exp = exportDocumentToMarkdown([{ nodes: parsed.nodes, tabId: t.tabId, tabTitle: t.title }]);
        runtime.initialMarkdownStates.set(`${as}/${t.tabId}`, exp.markdown);
      }
    }

    runtime.stepsExecuted++;
    return;
  }

  const initialTabTitle = step.tabTitle?.trim();

  let newDocId = `virtual:${as}`;
  let gdoc: Gdoc;
  if (!runtime.dryRun) {
    const createDoc = runtime.client.createDocument?.bind(runtime.client) ?? gws.createDocument.bind(gws);
    const res = await createDoc(title);
    newDocId = res.documentId;
    const initialBatchReqs: object[] = [];
    if (effectivePageSetup) {
      const styleReq = buildDocumentStyleRequest(effectivePageSetup);
      if ("updateDocumentStyle" in styleReq) {
        initialBatchReqs.push(styleReq);
      }
    }
    if (initialTabTitle && initialTabTitle !== "Tab 1" && initialTabTitle !== "Main") {
      initialBatchReqs.push(RequestBuilder.renameTab("t.0", initialTabTitle));
    }
    if (initialBatchReqs.length > 0) {
      await runtime.client.batchUpdate(newDocId, initialBatchReqs);
    }
    gdoc = await Gdoc.load(newDocId, runtime.client, { forceFetch: true });
  } else {
    const initialBody = {
      content: [
        { endIndex: 1, sectionBreak: {}, startIndex: 0 },
        {
          endIndex: 2,
          paragraph: { elements: [{ textRun: { content: "\n" } }] },
          startIndex: 1,
        },
      ],
    };

    const initialDocumentStyle = effectivePageSetup?.mode
      ? { documentFormat: { documentMode: effectivePageSetup.mode } }
      : undefined;

    const virtualTabTitle = initialTabTitle || "Main";

    gdoc = new Gdoc(
      {
        body: initialBody,
        documentId: newDocId,
        documentStyle: initialDocumentStyle,
        tabs: [
          {
            documentTab: {
              body: initialBody,
              documentStyle: initialDocumentStyle,
            },
            tabProperties: { tabId: "t.0", title: virtualTabTitle },
          },
        ],
        title,
      },
      newDocId,
    );
  }

  const openContext = {
    alias: as,
    docId: newDocId,
    gdoc,
    isVirtual: runtime.dryRun,
    title,
  };

  const tabs = flattenTabs(gdoc.data.tabs);
  const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title: initialTabTitle || "Main" }];
  const pageSetup = pageSetupExtract(gdoc.data.documentStyle ?? gdoc.data.tabs?.[0]?.documentTab?.documentStyle);
  const dumpPayload = {
    alias: as,
    id: newDocId,
    kind: "doc",
    ...(pageSetup ? { pageSetup } : {}),
    tabs: tabsToCheck.map((t) => ({ id: t.tabId, kind: "tab", title: t.title })),
    title,
  };

  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(newDocId, as);
  runtime.aliasMap.set(as, newDocId);
  runtime.dumpStore.set(as, dumpPayload);
  if (step.dump) {
    runtime.dumped[as] = dumpPayload;
  }
  runtime.activeDocAlias = as;

  if (step.tabAs) {
    runtime.aliasMap.set(step.tabAs, "t.0");
    const tabDumpPayload = {
      alias: step.tabAs,
      id: "t.0",
      kind: "tab",
      title: tabsToCheck[0]?.title || initialTabTitle || "Main",
    };
    runtime.dumpStore.set(step.tabAs, tabDumpPayload);
    if (step.dump) {
      runtime.dumped[step.tabAs] = tabDumpPayload;
    }
  }

  let highlight = runtime.createdHighlights.get(as);
  if (!highlight) {
    highlight = {
      as,
      id: newDocId,
      tabs: [],
      title,
    };
    runtime.createdHighlights.set(as, highlight);
  }
  if (!highlight.tabs) highlight.tabs = [];
  highlight.tabs.push({ id: "t.0", title: tabsToCheck[0]?.title || initialTabTitle || "Main" });

  if (runtime.dryRun) {
    runtime.initialMarkdownStates.set(`${as}/t.0`, "");
  }

  runtime.stepsExecuted++;
};

/** Options passed to the module-private docCreateFromTab helper. */
type DocCreateFromTabOptions = {
  /** Target alias for the created document. */
  as: string;
  /** Effective page geometry and layout setup. */
  effectivePageSetup?: PageSetup;
  /** Raw source document reference (alias or document ID). */
  fromDocRaw: string;
  /** Raw source tab hint (tab ID, title, or alias). */
  fromTabRaw: string;
  /** Workflow script runtime context. */
  runtime: ApplyScriptRuntime;
  /** Step input payload. */
  step: StepDocCreate;
  /** Zero-based step index in the workflow. */
  stepIndex: number;
  /** Target document title. */
  title: string;
};

/** Creates a fresh document and populates its initial root tab with content from a source tab. */
async function docCreateFromTab(
  /** Parameters for populating a newly created document's root tab. */
  opts: DocCreateFromTabOptions,
): Promise<void> {
  const fromDoc = opts.runtime.aliasResolve(opts.fromDocRaw);
  if (!fromDoc) throw new Error(`steps[${opts.stepIndex}] docCreate could not resolve fromDoc: "${opts.fromDocRaw}"`);

  const forceFetch = Boolean(opts.step.forceFetch);
  const sourceContext =
    opts.runtime.openDocs.get(fromDoc) ?? Array.from(opts.runtime.openDocs.values()).find((d) => d.docId === fromDoc);
  let sourceGdoc: Gdoc;
  if (sourceContext) {
    sourceGdoc = sourceContext.gdoc;
  } else {
    const preloaded = !forceFetch ? opts.runtime.preloadedDocs?.get(fromDoc) : undefined;
    sourceGdoc =
      preloaded ?? (await Gdoc.load(fromDoc, opts.runtime.client, forceFetch ? { forceFetch: true } : undefined));
  }

  const fromTabHint = opts.runtime.aliasResolve(opts.fromTabRaw);
  const resolvedSourceTab = sourceGdoc.data.tabs?.length
    ? resolveTab(sourceGdoc.data, fromTabHint)
    : { tabId: "t.0", title: sourceGdoc.data.title };
  const sourceTabId = resolvedSourceTab.tabId;
  if (!sourceTabId) {
    throw new Error(
      `steps[${opts.stepIndex}] docCreate could not resolve source tab "${fromTabHint}" in "${opts.fromDocRaw}"`,
    );
  }

  const force = opts.runtime.force || Boolean(opts.step.force);
  const sourceSimulated = simulatedNodesOf(sourceGdoc, sourceTabId);
  const parsedSource = sourceSimulated ? { nodes: sourceSimulated } : parseDocument(sourceGdoc.withTab(sourceTabId));
  const lossyScan = detectLossyTabElements(parsedSource.nodes);

  if (lossyScan.details.length > 0 && !force) {
    throw new Error(
      lossyTabCopyError(opts.stepIndex, resolvedSourceTab.title || fromTabHint || "Tab", lossyScan, "docCreate"),
    );
  }

  const copyWarnings: string[] = [...lossyScan.details];
  const initialTabTitle = opts.step.tabTitle?.trim() || resolvedSourceTab.title || "Main";

  let newDocId = `virtual:${opts.as}`;
  let gdoc: Gdoc;

  if (opts.runtime.dryRun) {
    const sourceDocTab = sourceGdoc.data.tabs?.length ? findTab(sourceGdoc.data.tabs, sourceTabId) : null;
    const sourceBody = sourceDocTab?.documentTab?.body ?? sourceGdoc.data.body;

    const initialDocumentStyle = opts.effectivePageSetup?.mode
      ? { documentFormat: { documentMode: opts.effectivePageSetup.mode } }
      : undefined;

    gdoc = new Gdoc(
      {
        body: structuredClone(sourceBody),
        documentId: newDocId,
        documentStyle: initialDocumentStyle,
        tabs: [
          {
            documentTab: {
              body: structuredClone(sourceBody),
              documentStyle: initialDocumentStyle,
            },
            tabProperties: { tabId: "t.0", title: initialTabTitle },
          },
        ],
        title: opts.title,
      },
      newDocId,
    );

    simulatedNodesSet(gdoc, structuredClone(sourceSimulated ?? parsedSource.nodes), "t.0");
    opts.runtime.initialMarkdownStates.set(`${opts.as}/t.0`, "");
  } else {
    const createDoc = opts.runtime.client.createDocument?.bind(opts.runtime.client) ?? gws.createDocument.bind(gws);
    const res = await createDoc(opts.title);
    newDocId = res.documentId;

    if (opts.effectivePageSetup) {
      const styleReq = buildDocumentStyleRequest(opts.effectivePageSetup);
      if ("updateDocumentStyle" in styleReq) {
        await opts.runtime.client.batchUpdate(newDocId, [styleReq]);
      }
    }

    if (initialTabTitle && initialTabTitle !== "Main") {
      const renameReq = RequestBuilder.renameTab("t.0", initialTabTitle);
      await opts.runtime.client.batchUpdate(newDocId, [renameReq]);
    }

    const specs = parsedSource.nodes
      .filter((n) => n.kind !== "sectionBreak")
      .map((n) => {
        const spec = elementSpecFromNode(n);
        if ("warnings" in spec && Array.isArray(spec.warnings)) {
          copyWarnings.push(...spec.warnings);
        }
        return spec;
      });

    if (specs.length > 0) {
      await elementsInsertExecute({
        client: opts.runtime.client,
        documentId: newDocId,
        elements: specs,
        force,
        tabHint: "t.0",
      });
    }

    docCache.invalidate(newDocId);
    gdoc = await Gdoc.load(newDocId, opts.runtime.client, { forceFetch: true });
  }

  const openContext = {
    alias: opts.as,
    docId: newDocId,
    gdoc,
    isVirtual: opts.runtime.dryRun,
    title: opts.title,
  };

  const pageSetup = pageSetupExtract(gdoc.data.documentStyle ?? gdoc.data.tabs?.[0]?.documentTab?.documentStyle);
  const dumpPayload = {
    alias: opts.as,
    id: newDocId,
    kind: "doc",
    ...(pageSetup ? { pageSetup } : {}),
    tabs: [{ id: "t.0", kind: "tab", title: initialTabTitle }],
    title: opts.title,
  };

  opts.runtime.openDocs.set(opts.as, openContext);
  opts.runtime.docIdToAlias.set(newDocId, opts.as);
  opts.runtime.aliasMap.set(opts.as, newDocId);
  opts.runtime.dumpStore.set(opts.as, dumpPayload);
  if (opts.step.dump) {
    opts.runtime.dumped[opts.as] = dumpPayload;
  }
  opts.runtime.activeDocAlias = opts.as;

  if (opts.step.tabAs) {
    opts.runtime.aliasMap.set(opts.step.tabAs, "t.0");
    const tabDumpPayload = {
      alias: opts.step.tabAs,
      id: "t.0",
      kind: "tab",
      title: initialTabTitle,
      ...(copyWarnings.length > 0 ? { warnings: Array.from(new Set(copyWarnings)) } : {}),
    };
    opts.runtime.dumpStore.set(opts.step.tabAs, tabDumpPayload);
    if (opts.step.dump) {
      opts.runtime.dumped[opts.step.tabAs] = tabDumpPayload;
    }
  }

  let highlight = opts.runtime.createdHighlights.get(opts.as);
  if (!highlight) {
    highlight = {
      as: opts.as,
      id: newDocId,
      tabs: [],
      title: opts.title,
    };
    opts.runtime.createdHighlights.set(opts.as, highlight);
  }
  if (!highlight.tabs) highlight.tabs = [];
  highlight.tabs.push({
    as: opts.step.tabAs,
    id: "t.0",
    title: initialTabTitle,
  });

  opts.runtime.stepsExecuted++;
}
