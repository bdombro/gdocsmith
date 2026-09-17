/* Workflow step: docCopy — copy a Drive file into a new document alias. */

import { Gdoc } from "~/core/gdoc.ts";
import { gwsDrive } from "~/core/gws.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Copies an existing document into a new id and opens it in the session. */
export const docCopyStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const copyFrom = runtime.aliasResolve(step.copyFrom ?? step.doc);
  if (!copyFrom) throw new Error(`steps[${stepIndex}] docCopy requires copyFrom: <docId>`);
  const title = step.title ?? "Copy of Document";
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] docCopy requires "as: <alias>"`);

  let newDocId = `virtual:${as}`;
  let gdoc: Gdoc;

  if (runtime.dryRun) {
    gdoc = new Gdoc({ documentId: newDocId, title }, newDocId);
  } else {
    const res = await gwsDrive.copyFile(copyFrom, title);
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

  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(newDocId, as);
  runtime.aliasMap.set(as, newDocId);
  runtime.dumpStore.set(as, { id: newDocId, title });
  runtime.activeDocAlias = as;

  runtime.createdHighlights.set(as, {
    as,
    id: newDocId,
    title,
  });

  runtime.stepsExecuted++;
};
