/* Shared types for run workflow step handlers. */

import type { Gdoc } from "~/core/gdoc.ts";
import type { GwsClient } from "~/core/gws.ts";
import type { ApplyHighlightDocJson, GdocsmithStepInput, PageSetup } from "~/core/workflowTypes.ts";

export type { WorkflowStepKind } from "~/core/workflowTypes.ts";

/** Context tracked for an active or open document session. */
export type OpenDocContext = {
  alias: string;
  docId: string;
  gdoc: Gdoc;
  isVirtual?: boolean;
  pinnedRevisionId?: string;
  title: string;
};

/** In-memory dry-run node tape attached to a loaded Gdoc. */
export type SimulatedGdoc = Gdoc & {
  simulatedNodes?: import("~/core/dom/types.ts").DocNode[];
};

/** Mutable runtime state shared across workflow step handlers. */
export type ApplyScriptRuntime = {
  activeDocAlias: string | undefined;
  aliasMap: Map<string, string>;
  aliasResolve: (val?: string) => string | undefined;
  client: GwsClient;
  createdHighlights: Map<string, ApplyHighlightDocJson>;
  docIdToAlias: Map<string, string>;
  dumpStore: Map<string, unknown>;
  dumped: Record<string, unknown>;
  dryRun: boolean;
  force: boolean;
  initialMarkdownStates: Map<string, string>;
  openDocResolve: (rawDocRef?: string) => OpenDocContext;
  openDocs: Map<string, OpenDocContext>;
  /** Document-level page geometry from the run document (applied once after steps). */
  pageSetup?: PageSetup;
  stepsExecuted: number;
  tabMarkdownCapture: (ctx: OpenDocContext, tabId: string) => Promise<string>;
};

/** One workflow step handler. */
export type WorkflowStepHandler = (
  runtime: ApplyScriptRuntime,
  stepIndex: number,
  step: GdocsmithStepInput,
) => Promise<void>;
