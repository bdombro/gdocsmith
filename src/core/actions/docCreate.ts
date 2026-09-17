/* Workflow step: docCreate — create a new Google Doc and bind an alias. */

import { Gdoc } from "~/core/gdoc.ts";
import { gws } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Creates a new document (or virtual doc in dry-run) and opens it in the session. */
export const docCreateStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const title = step.title ?? "Untitled Document";
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] docCreate requires "as: <alias>"`);

  let newDocId = `virtual:${as}`;
  if (!runtime.dryRun) {
    const res = await gws.createDocument(title);
    newDocId = res.documentId;
  }

  const gdoc = new Gdoc(
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
      documentId: newDocId,
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

  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(newDocId, as);
  runtime.aliasMap.set(as, newDocId);
  runtime.dumpStore.set(as, { id: newDocId, title });
  runtime.activeDocAlias = as;

  runtime.initialMarkdownStates.set(`${as}/t.0`, "");

  runtime.createdHighlights.set(as, {
    as,
    id: newDocId,
    tabs: [{ id: "t.0", title: "Main" }],
    title,
  });

  runtime.stepsExecuted++;
};
