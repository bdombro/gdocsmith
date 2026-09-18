/* Workflow step: pageSetup — configure document geometry, margins, and layout mode (PAGES/PAGELESS). */

import { docCache } from "~/core/cache/docCache.ts";
import { buildDocumentStyleRequest } from "~/core/dom/applyBatch.ts";
import { type PageSetup, pageSetupExtract } from "~/core/dom/ops.ts";
import { Gdoc } from "~/core/gdoc.ts";
import { resolveTab } from "~/core/tabs.ts";
import { pendingWritersFlush } from "./flush.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Updates document geometry, margins, or document layout mode (PAGES/PAGELESS). */
export const pageSetupStep: WorkflowStepHandler = async (
  /** Script runtime context. */
  runtime,
  /** Zero-based index of this step in the workflow. */
  stepIndex,
  /** Workflow step input. */
  step,
) => {
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }

  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const resolvedTab =
    tabHint && targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
  const tabId = resolvedTab?.tabId;

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

  const effectivePageSetup: PageSetup = {
    ...(step.pageSetup ?? {}),
    ...(step.margins ? { margins: step.margins } : {}),
    ...(step.orientation ? { orientation: step.orientation } : {}),
    ...(step.pageHeight != null ? { pageHeight: step.pageHeight } : {}),
    ...(step.pageSize ? { pageSize: step.pageSize } : {}),
    ...(step.pageWidth != null ? { pageWidth: step.pageWidth } : {}),
    ...(mode ? { mode: mode as "PAGES" | "PAGELESS", pageless: mode === "PAGELESS" } : {}),
  };

  const req = buildDocumentStyleRequest(effectivePageSetup, tabId);
  if (!("updateDocumentStyle" in req)) {
    throw new Error(`steps[${stepIndex}] pageSetup requires margins, mode, orientation, pageSize, or pageless`);
  }

  if (!runtime.dryRun) {
    await runtime.client.batchUpdate(targetDoc.docId, [req]);
    docCache.invalidate(targetDoc.docId);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    const updateStyle = (req as { updateDocumentStyle: { documentStyle: Record<string, unknown> } }).updateDocumentStyle
      .documentStyle;

    const targetTab = tabId ? targetDoc.gdoc.data.tabs?.find((t) => t.tabProperties?.tabId === tabId) : undefined;

    let baseStyle: Record<string, unknown>;
    if (targetTab) {
      targetTab.documentTab = targetTab.documentTab ?? {};
      targetTab.documentTab.documentStyle = targetTab.documentTab.documentStyle ?? {};
      baseStyle = targetTab.documentTab.documentStyle as Record<string, unknown>;
    } else {
      targetDoc.gdoc.data.documentStyle = targetDoc.gdoc.data.documentStyle ?? {};
      baseStyle = targetDoc.gdoc.data.documentStyle as Record<string, unknown>;
      if (targetDoc.gdoc.data.tabs?.length) {
        const firstTab = targetDoc.gdoc.data.tabs[0]!;
        firstTab.documentTab = firstTab.documentTab ?? {};
        firstTab.documentTab.documentStyle = targetDoc.gdoc.data.documentStyle;
      }
    }

    if (updateStyle.documentFormat) {
      baseStyle.documentFormat = updateStyle.documentFormat as { documentMode?: "PAGES" | "PAGELESS" };
    }
    if (updateStyle.marginTop) {
      baseStyle.marginTop = updateStyle.marginTop as { magnitude?: number; unit?: string };
    }
    if (updateStyle.marginBottom) {
      baseStyle.marginBottom = updateStyle.marginBottom as { magnitude?: number; unit?: string };
    }
    if (updateStyle.marginLeft) {
      baseStyle.marginLeft = updateStyle.marginLeft as { magnitude?: number; unit?: string };
    }
    if (updateStyle.marginRight) {
      baseStyle.marginRight = updateStyle.marginRight as { magnitude?: number; unit?: string };
    }
    if (updateStyle.pageSize) {
      baseStyle.pageSize = updateStyle.pageSize as {
        height?: { magnitude?: number; unit?: string };
        width?: { magnitude?: number; unit?: string };
      };
    }
  }

  const effectiveDocStyle =
    (tabId ? targetDoc.gdoc.withTab(tabId).data.documentStyle : undefined) ??
    targetDoc.gdoc.data.documentStyle ??
    targetDoc.gdoc.data.tabs?.[0]?.documentTab?.documentStyle;

  const dumpPayload = {
    alias: step.as,
    id: targetDoc.docId,
    kind: "pageSetup",
    pageSetup: pageSetupExtract(effectiveDocStyle),
    ...(tabId ? { tabId } : {}),
  };

  if (step.as) {
    runtime.dumpStore.set(step.as, dumpPayload);
  }
  if (step.dump || step.as) {
    runtime.dumped[step.as ?? targetDoc.alias] = dumpPayload;
  }

  runtime.stepsExecuted++;
};
