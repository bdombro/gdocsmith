/* Test support: edit a parsed doc with model primitives, reconcile, emulate the requests, and compare with the edited model (G3 M9). */

import type { GoogleDoc } from "~/core/types.ts";
import { requestsEmulate } from "../emulator/emulate.ts";
import type { EditTarget } from "../model/edit.ts";
import { type CompareResult, docModelsCompare } from "../model/equivalence.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { JsonObject } from "../model/rawJson.ts";
import type { DocModel } from "../model/types.ts";
import { containerReconcile } from "./container.ts";
import { type ReconcileContext, reconcileContextCreate } from "./context.ts";

/** What a differential run produced. */
export interface DifferentialResult {
  /** Final model vs emulated result (with the reconciler's identity transfers). */ compare: CompareResult;
  /** Reconciliation state (requests, transfers, pending links, …). */ ctx: ReconcileContext;
  /** The edited model. */ final: DocModel;
  /** The emulated document. */ json: GoogleDoc;
  /** Requests sent. */ requests: JsonObject[];
}

/** Parses `docJson`, applies `mutate` to a clone of its first tab, reconciles the body, emulates, and compares. */
export function differentialRun(
  /** Document to start from. */
  docJson: GoogleDoc,
  /** Edits to make, with the tab's original top-level block keys. */
  mutate: (target: EditTarget, keys: string[]) => void,
): DifferentialResult {
  const keys = new KeyAllocator();
  const original = docModelParse(docJson, { docId: "d", keys });
  const final = structuredClone(original);
  const tab = final.tabs[0];
  mutate(
    { ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab },
    tab.blocks.map((b) => b.key),
  );
  const ctx = reconcileContextCreate(tab.tabId);
  containerReconcile(original.tabs[0].blocks, tab.blocks, ctx);
  const json = requestsEmulate(docJson, ctx.requests).json;
  const actual = docModelParse(json, { docId: "d", keys: new KeyAllocator() });
  const compare = docModelsCompare(final, actual, { identityTransfers: ctx.identityTransfers });
  return { compare, ctx, final, json, requests: ctx.requests };
}
