/* Workflow step: open — load a document and bind an alias. */

import { Gdoc } from "~/core/gdoc.ts";
import { DriveRevisions } from "~/core/revisions.ts";
import { flattenTabs } from "~/core/tabs.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Opens a document by id and registers it in the runtime session. */
export const openStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const rawDocId = step.doc;
  if (!rawDocId) throw new Error(`steps[${stepIndex}] open requires doc: <docId>`);
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] open requires "as: <alias>"`);

  const docId = Gdoc.parseId(runtime.aliasResolve(rawDocId)!);
  let gdoc: Gdoc;
  let title = "Document";
  let pinnedRevisionId: string | undefined;

  if (runtime.dryRun) {
    gdoc = new Gdoc({ documentId: docId, revisionId: "dry-run", title }, docId);
  } else {
    gdoc = await Gdoc.load(docId, runtime.client);
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
  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(docId, as);
  runtime.aliasMap.set(as, docId);
  runtime.dumpStore.set(as, { id: docId, title });
  runtime.activeDocAlias = as;

  const tabs = flattenTabs(gdoc.data.tabs);
  const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  for (const t of tabsToCheck) {
    const key = `${as}/${t.tabId}`;
    if (!runtime.initialMarkdownStates.has(key)) {
      const md = await runtime.tabMarkdownCapture(openContext, t.tabId);
      runtime.initialMarkdownStates.set(key, md);
    }
  }
  runtime.stepsExecuted++;
};
