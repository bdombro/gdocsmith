/* Workflow step: docCreate — create a new Google Doc or copy an existing document into a new alias. */

import { buildDocumentStyleRequest } from "~/core/dom/applyBatch.ts";
import { exportDocumentToMarkdown } from "~/core/dom/export.ts";
import type { PageSetup } from "~/core/dom/ops.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { gws, gwsDrive } from "~/core/gws.ts";
import { flattenTabs } from "~/core/tabs.ts";
import { simulatedNodesSet } from "./simulated.ts";
import type { SimulatedGdoc, WorkflowStepHandler } from "./types.ts";

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
  if (fromDocRaw) {
    const fromDoc = runtime.aliasResolve(fromDocRaw);
    if (!fromDoc) throw new Error(`steps[${stepIndex}] docCreate could not resolve fromDoc: "${fromDocRaw}"`);

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
          const loaded = runtime.preloadedDocs?.get(fromDoc) ?? (await Gdoc.load(fromDoc, runtime.client));
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

  let newDocId = `virtual:${as}`;
  if (!runtime.dryRun) {
    const res = await gws.createDocument(title);
    newDocId = res.documentId;
    if (effectivePageSetup) {
      const styleReq = buildDocumentStyleRequest(effectivePageSetup);
      if ("updateDocumentStyle" in styleReq) {
        await runtime.client.batchUpdate(newDocId, [styleReq]);
      }
    }
  }

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

  const gdoc = new Gdoc(
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
          tabProperties: { tabId: "t.0", title: "Main" },
        },
      ],
      title,
    },
    newDocId,
  );

  const openContext = {
    alias: as,
    docId: newDocId,
    gdoc,
    isVirtual: runtime.dryRun,
    title,
  };

  const dumpPayload = {
    alias: as,
    id: newDocId,
    kind: "doc",
    tabs: [{ id: "t.0", kind: "tab", title: "Main" }],
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
    runtime.initialMarkdownStates.set(`${as}/t.0`, "");
  }

  runtime.stepsExecuted++;
};
