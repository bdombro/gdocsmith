/* Workflow step: open — load a document and bind an alias. */

import { pageSetupExtract } from "~/core/dom/ops.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { DriveRevisions } from "~/core/revisions.ts";
import { flattenTabs } from "~/core/tabs.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Opens a document by id and registers it in the runtime session. */
export const openStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const rawDocId = step.doc;
  if (!rawDocId) throw new Error(`steps[${stepIndex}] ${step.kind ?? "docOpen"} requires doc: <docId>`);
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] ${step.kind ?? "docOpen"} requires "as: <alias>"`);

  const docId = Gdoc.parseId(runtime.aliasResolve(rawDocId)!);
  let gdoc: Gdoc;
  let title = "Document";
  let pinnedRevisionId: string | undefined;

  if (runtime.dryRun) {
    const preloaded = runtime.preloadedDocs?.get(docId);
    if (preloaded) {
      gdoc = preloaded;
      title = gdoc.data.title || title;
    } else {
      try {
        gdoc = await Gdoc.load(docId, runtime.client);
        title = gdoc.data.title || title;
      } catch {
        gdoc = new Gdoc(
          {
            body: {
              content: [
                { endIndex: 1, sectionBreak: {}, startIndex: 0 },
                {
                  endIndex: 2,
                  paragraph: { elements: [{ textRun: { content: "\n" } }] },
                  startIndex: 1,
                },
              ],
            },
            documentId: docId,
            revisionId: "dry-run",
            tabs: [
              {
                documentTab: {
                  body: {
                    content: [
                      { endIndex: 1, sectionBreak: {}, startIndex: 0 },
                      {
                        endIndex: 2,
                        paragraph: { elements: [{ textRun: { content: "\n" } }] },
                        startIndex: 1,
                      },
                    ],
                  },
                },
                tabProperties: {
                  tabId: "t.0",
                  title,
                },
              },
            ],
            title,
          },
          docId,
        );
      }
    }
  } else {
    gdoc = runtime.preloadedDocs?.get(docId) ?? (await Gdoc.load(docId, runtime.client));
    title = gdoc.data.title || title;
    const pin = await DriveRevisions.pinHead(docId, runtime.client);
    pinnedRevisionId = pin?.id;
  }

  const openContext = {
    alias: as,
    docId,
    gdoc,
    pinnedRevisionId,
    title,
  };
  const tabs = flattenTabs(gdoc.data.tabs);
  const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  const dumpPayload = {
    alias: as,
    id: docId,
    kind: "doc",
    pageSetup: pageSetupExtract(gdoc.data.documentStyle ?? gdoc.data.tabs?.[0]?.documentTab?.documentStyle),
    tabs: tabsToCheck.map((t) => {
      const tabSetup = pageSetupExtract(
        t.tabId && gdoc.data.tabs?.length ? gdoc.withTab(t.tabId).data.documentStyle : gdoc.data.documentStyle,
      );
      return {
        id: t.tabId,
        kind: "tab",
        ...(tabSetup ? { pageSetup: tabSetup } : {}),
        title: t.title,
      };
    }),
    title,
  };
  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(docId, as);
  runtime.aliasMap.set(as, docId);
  runtime.dumpStore.set(as, dumpPayload);
  if (step.dump) {
    runtime.dumped[as] = dumpPayload;
  }
  runtime.activeDocAlias = as;

  if (runtime.dryRun) {
    for (const t of tabsToCheck) {
      const key = `${as}/${t.tabId}`;
      if (!runtime.initialMarkdownStates.has(key)) {
        const md = await runtime.tabMarkdownCapture(openContext, t.tabId);
        runtime.initialMarkdownStates.set(key, md);
      }
    }
  }
  runtime.stepsExecuted++;
};
