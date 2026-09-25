/* Runs a program transactionally: apply every step to the models, plan and check, then send in phases with revision locks, re-running on conflicts (G3 D38–D40, M19). */

import type { DocCache } from "~/core/cache/docCache.ts";
import { Gdoc } from "~/core/gdoc.ts";
import type { DocsClient, DriveApi } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { layoutCompute } from "../model/layout.ts";
import type { DocModel, ParagraphBlock } from "../model/types.ts";
import { RequestBuilder } from "../requests.ts";
import {
  batchSend,
  contentSend,
  linkRequests,
  type PhaseReport,
  RevisionConflict,
  TransactionError,
  verify,
} from "./flush.ts";
import type { GuardFinding } from "./guard.ts";
import { type Plan, type PlannedDoc, planBuild } from "./plan.ts";
import { CoreSession, type Ledger, ledgerCreate } from "./session.ts";
import type { Session } from "./types.ts";

export type { PhaseReport } from "./flush.ts";
export { TransactionError } from "./flush.ts";

/** How to run a transaction. */
export interface TransactionOptions {
  /** Snapshot cache (updated after verification). */ cache?: DocCache;
  /** Docs client. */ client: DocsClient;
  /** Drive client. */ drive: DriveApi;
  /** Plan and check only; send nothing. */ dryRun: boolean;
  /** Waive every guard finding. */ force: boolean;
  /** Waits before each re-run after a revision conflict (default 0, 1, 2, 4, 8 s). */ retryDelaysMs?: number[];
}

/** What a transaction did (the same shape dry or live, D39). */
export interface TransactionResult<T> {
  /** Program runs, not counting re-runs after creating documents or tabs. */ attempts: number;
  /** All changed tabs' diffs, concatenated. */ diff: string;
  /** Per-tab diffs. */ diffs: Plan["diffs"];
  /** True for a dry run. */ dryRun: boolean;
  /** Guard findings (a refused run has unwaived blocking ones and sent nothing). */ findings: GuardFinding[];
  /** Provisional → real ids. */ newIds: {
    docs: Record<string, string>;
    headings: Record<string, string>;
    tabs: Record<string, string>;
  };
  /** What the program returned. */ output: T;
  /** Per-phase reports. */ phases: PhaseReport[];
  /** True when blocking findings stopped the send. */ refused: boolean;
  /** Per-document check of what landed (`emulated` when nothing was sent). */ verification: Array<{
    diffs?: string[];
    docId: string;
    status: "emulated" | "match" | "mismatch" | "skipped";
  }>;
}

/** Default waits before re-runs after a revision conflict (D38). */
const RETRY_DELAYS_MS = [0, 1000, 2000, 4000, 8000];

/**
 * Runs `program` against a fresh session, plans, checks, and (unless dry) sends. Creating documents
 * or tabs happens first, then the program re-runs against the real ids. A revision conflict before a
 * document's content lands reloads and re-runs (documents that already landed are pinned); after the
 * retries run out it's `concurrentEdits`. A failure after anything landed is a `TransactionError`
 * saying what landed. The program must be deterministic (D40): a landed document must plan the same
 * final model on every re-run.
 */
export async function transactionRun<T>(
  /** The program: steps applied through the session. */
  program: (s: Session) => Promise<T>,
  /** Clients and options. */
  opts: TransactionOptions,
): Promise<TransactionResult<T>> {
  const ledger = ledgerCreate();
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const phases: PhaseReport[] = [];
  const created: string[] = [];
  const landed: string[] = [];
  let attempts = 0;
  let conflicts = 0;
  for (;;) {
    attempts++;
    const session = new CoreSession({ cache: opts.cache, client: opts.client, drive: opts.drive, ledger });
    const output = await program(session);
    const plan = await planBuild(session);
    determinismCheck(session, ledger);
    const findings = plan.findings.map((f) => (opts.force && f.severity === "block" ? { ...f, waived: true } : f));
    const refused = findings.some((f) => f.severity === "block" && !f.waived);
    const base = { attempts, diff: plan.diff, diffs: plan.diffs, findings, output, refused };
    if (refused || opts.dryRun) {
      return {
        ...base,
        dryRun: opts.dryRun,
        newIds: newIds(ledger, {}),
        phases: dryPhases(plan),
        verification: plan.docs.map((d) => ({ docId: d.docId, status: "emulated" as const })),
      };
    }
    // Create phase: documents and tabs first, then the program re-runs against their real ids.
    const createReport = await createPhase(plan, opts, ledger, created);
    if (createReport) {
      phases.push(createReport);
      attempts--;
      continue;
    }
    // Content phase.
    const content: PhaseReport = { docs: [], phase: "content" };
    const revisions = new Map<string, string | undefined>();
    let conflict = false;
    for (const doc of plan.docs) {
      if (ledger.pinned.has(doc.docId)) continue;
      if (!doc.plan.contentRequests.length) {
        revisions.set(doc.docId, (doc.input.originalJson as unknown as { revisionId?: string }).revisionId);
        continue;
      }
      try {
        const sent = await contentSend(opts.client, doc);
        revisions.set(doc.docId, sent.revisionAfter);
        content.docs.push({
          docId: doc.docId,
          landed: true,
          requestCount: sent.requestCount,
          revisionAfter: sent.revisionAfter,
        });
        landed.push(doc.docId);
        ledger.pinned.set(doc.docId, { final: JSON.stringify(doc.input.final), json: doc.input.originalJson });
      } catch (err) {
        if (err instanceof RevisionConflict) {
          conflict = true;
          break;
        }
        content.docs.push({
          docId: doc.docId,
          error: (err as Error).message,
          landed: false,
          requestCount: doc.plan.contentRequests.length,
        });
        phases.push(content);
        throw new TransactionError(
          "content",
          err as Error,
          { created, landed },
          (err as { stepIndex?: number }).stepIndex,
        );
      }
    }
    if (conflict) {
      if (conflicts >= delays.length)
        throw new CoreError(
          "concurrentEdits",
          "the document keeps changing while this runs; try again when it's quiet",
        );
      await sleep(delays[conflicts++]);
      if (content.docs.length) phases.push(content);
      continue;
    }
    phases.push(content);
    // Tabs, links, permissions & lifecycle.
    const tabIds = (docId: string) => tabIdMap(ledger, docId);
    await phaseRun(phases, "tabs", plan.docs, created, landed, async (doc) => {
      const revision = await batchSend(opts.client, doc.docId, doc.plan.tabOps, revisions.get(doc.docId));
      revisions.set(doc.docId, revision);
      return { requestCount: doc.plan.tabOps.length, revisionAfter: revision };
    });
    const headingIds = new Map<string, string>();
    const withLinks = plan.docs.filter((d) => d.plan.pendingLinks.length);
    if (withLinks.length) {
      const reloaded = new Map<string, DocModel>();
      const finals = new Map(plan.docs.map((d) => [d.docId, d.input.final]));
      for (const doc of plan.docs)
        reloaded.set(
          doc.docId,
          docModelParse(await opts.client.getDocument(doc.docId), { docId: doc.docId, keys: new KeyAllocator() }),
        );
      await phaseRun(phases, "links", withLinks, created, landed, async (doc) => {
        const { headingIds: ids, requests } = linkRequests(doc, reloaded, finals, tabIds);
        for (const [k, v] of ids) headingIds.set(k, v);
        const revision = await batchSend(
          opts.client,
          doc.docId,
          requests,
          (reloaded.get(doc.docId) as unknown as { revisionId?: string }).revisionId ?? revisions.get(doc.docId),
        );
        revisions.set(doc.docId, revision);
        return { requestCount: requests.length, revisionAfter: revision };
      });
    }
    await phaseRun(phases, "permissions", plan.docs, created, landed, async (doc) => {
      const { intents } = doc;
      let count = 0;
      if (intents.title && !doc.isNew) {
        await opts.drive.updateFile(doc.docId, { name: intents.title });
        count++;
      }
      for (const p of intents.permissionsAdd) {
        await opts.drive.createPermission(doc.docId, p);
        count++;
      }
      if (intents.permissionsRemove.length) {
        const current = await opts.drive.listPermissions(doc.docId);
        for (const r of intents.permissionsRemove) {
          const match = current.find(
            (p) => p.id === r.permissionId || (r.email && (p as { emailAddress?: string }).emailAddress === r.email),
          );
          if (match) {
            await opts.drive.deletePermission(doc.docId, match.id);
            count++;
          }
        }
      }
      if (intents.lifecycle === "trash") await opts.drive.updateFile(doc.docId, { trashed: true });
      if (intents.lifecycle === "delete") await opts.drive.deleteFile(doc.docId);
      if (intents.lifecycle) count++;
      return { requestCount: count };
    });
    // Verification (and the cache) after everything landed.
    const verification: TransactionResult<T>["verification"] = [];
    const headingMap = new Map(headingIds);
    for (const doc of plan.docs) {
      if (doc.intents.lifecycle === "delete") continue;
      const sentSomething = doc.plan.contentRequests.length || doc.plan.tabOps.length || doc.plan.pendingLinks.length;
      if (!sentSomething) continue;
      const json = await opts.client.getDocument(doc.docId);
      newHeadingIds(doc, json, tabIds(doc.docId), headingMap);
      verification.push({
        docId: doc.docId,
        ...verify(doc, json, revisions.get(doc.docId), { headingIds, tabIds: tabIds(doc.docId) }),
      });
      opts.cache?.set(doc.docId, new Gdoc(json as GoogleDoc, doc.docId));
    }
    return { ...base, dryRun: false, newIds: newIds(ledger, Object.fromEntries(headingMap)), phases, verification };
  }
}

/** Creates new documents and new tabs in existing ones; `undefined` when there's nothing to create. */
async function createPhase(
  plan: Plan,
  opts: TransactionOptions,
  ledger: Ledger,
  created: string[],
): Promise<PhaseReport | undefined> {
  const report: PhaseReport = { docs: [], phase: "create" };
  for (const doc of plan.docs) {
    if (doc.isNew && doc.create) {
      const alias = doc.docId.replace(/^new:/, "");
      try {
        const id = doc.create.from
          ? (await opts.drive.copyFile(doc.create.from, doc.create.title)).id
          : (
              await (opts.client.createDocument?.(doc.create.title) ??
                Promise.reject(new Error("this client can't create documents")))
            ).documentId;
        ledger.docs.set(alias, id);
        created.push(id);
        report.docs.push({ docId: id, landed: true, requestCount: 1 });
      } catch (err) {
        throw new TransactionError("create", err as Error, { created, landed: [] });
      }
    } else if (!doc.isNew && doc.plan.tabsToAdd.length) {
      const ids = ledger.tabs.get(doc.docId) ?? [];
      const real = new Map<string, string>();
      let revision = (doc.input.originalJson as unknown as { revisionId?: string }).revisionId;
      for (const tab of doc.plan.tabsToAdd) {
        const parentTabId = tab.parentTabId ? (real.get(tab.parentTabId) ?? tab.parentTabId) : undefined;
        try {
          const response = JSON.parse(
            await opts.client.batchUpdate(
              doc.docId,
              [RequestBuilder.documentTabAdd(tab.title, { index: tab.index, parentTabId })],
              revision ? { requiredRevisionId: revision } : {},
            ),
          );
          revision = response.writeControl?.requiredRevisionId ?? revision;
          const tabId = response.replies?.[0]?.addDocumentTab?.tabProperties?.tabId as string;
          real.set(tab.tabId, tabId);
          const ordinal = Number(tab.tabId.replace(/^new:tab:/, ""));
          ids[ordinal - 1] = tabId;
        } catch (err) {
          throw new TransactionError("create", err as Error, { created, landed: [] });
        }
      }
      ledger.tabs.set(doc.docId, ids);
      report.docs.push({
        docId: doc.docId,
        landed: true,
        requestCount: doc.plan.tabsToAdd.length,
        revisionAfter: revision,
      });
    }
  }
  return report.docs.length ? report : undefined;
}

/** Runs one phase over documents, recording each; a failure is a `TransactionError` naming what landed. */
async function phaseRun(
  phases: PhaseReport[],
  phase: PhaseReport["phase"],
  docs: readonly PlannedDoc[],
  created: string[],
  landed: string[],
  run: (doc: PlannedDoc) => Promise<{ requestCount: number; revisionAfter?: string }>,
): Promise<void> {
  const report: PhaseReport = { docs: [], phase };
  for (const doc of docs) {
    try {
      const result = await run(doc);
      if (result.requestCount) report.docs.push({ docId: doc.docId, landed: true, ...result });
    } catch (err) {
      report.docs.push({ docId: doc.docId, error: (err as Error).message, landed: false, requestCount: 0 });
      phases.push(report);
      throw new TransactionError(phase, err as Error, { created, landed });
    }
  }
  phases.push(report);
}

/** A dry run's phases: what each would send. */
function dryPhases(plan: Plan): PhaseReport[] {
  const doc = (d: PlannedDoc, count: number) => ({ docId: d.docId, landed: false, requestCount: count });
  return [
    {
      docs: plan.docs
        .filter((d) => d.isNew || d.plan.tabsToAdd.length)
        .map((d) => doc(d, d.isNew ? 1 : d.plan.tabsToAdd.length)),
      phase: "create",
    },
    {
      docs: plan.docs
        .filter((d) => d.plan.contentRequests.length)
        .map((d) => ({ ...doc(d, d.plan.contentRequests.length), requests: d.plan.contentRequests })),
      phase: "content",
    },
    { docs: plan.docs.filter((d) => d.plan.tabOps.length).map((d) => doc(d, d.plan.tabOps.length)), phase: "tabs" },
    {
      docs: plan.docs.filter((d) => d.plan.pendingLinks.length).map((d) => doc(d, d.plan.pendingLinks.length)),
      phase: "links",
    },
    { docs: plan.docs.filter((d) => intentsCount(d)).map((d) => doc(d, intentsCount(d))), phase: "permissions" },
  ];
}

/** Title, permission, and lifecycle changes a document will make. */
function intentsCount(doc: PlannedDoc): number {
  const i = doc.intents;
  return (i.title && !doc.isNew ? 1 : 0) + i.permissionsAdd.length + i.permissionsRemove.length + (i.lifecycle ? 1 : 0);
}

/** Refuses a non-deterministic program: a landed document must plan the same final model on every re-run (D40). */
function determinismCheck(session: CoreSession, ledger: Ledger): void {
  for (const [docId, pinned] of ledger.pinned) {
    const state = session.docs.get(docId);
    if (state && JSON.stringify(state.current) !== pinned.final) {
      throw new CoreError(
        "internal",
        `the program planned different content for ${docId} on a re-run (steps must be deterministic)`,
      );
    }
  }
}

/** A document's provisional → real tab ids, from the ledger. */
function tabIdMap(ledger: Ledger, docId: string): Map<string, string> {
  return new Map((ledger.tabs.get(docId) ?? []).map((id, i) => [`new:tab:${i + 1}`, id]));
}

/** Heading ids the server gave headings created this run (by key), found at their planned positions. */
function newHeadingIds(
  doc: PlannedDoc,
  json: GoogleDoc,
  tabIds: ReadonlyMap<string, string>,
  out: Map<string, string>,
): void {
  const actual = docModelParse(json, { docId: doc.docId, keys: new KeyAllocator() });
  for (const tab of doc.input.final.tabs) {
    const now = actual.tabs.find((t) => t.tabId === (tabIds.get(tab.tabId) ?? tab.tabId));
    if (!now) continue;
    const ranges = layoutCompute(tab).blockRanges;
    for (const block of tab.blocks) {
      if (
        block.kind !== "paragraph" ||
        !block.key.startsWith("n") ||
        !block.style.namedStyleType ||
        block.style.namedStyleType === "NORMAL_TEXT"
      )
        continue;
      const start = ranges.get(block.key)?.start;
      const found = now.blocks.find((b): b is ParagraphBlock => b.kind === "paragraph" && b.origin?.start === start);
      if (found?.headingId) out.set(block.key, found.headingId);
    }
  }
}

/** The result's id map (tabs keyed `<real doc id>/<provisional tab id>`). */
function newIds(ledger: Ledger, headings: Record<string, string>): TransactionResult<unknown>["newIds"] {
  const docs: Record<string, string> = {};
  for (const [alias, id] of ledger.docs) docs[`new:${alias}`] = id;
  const tabs: Record<string, string> = {};
  for (const [docId, ids] of ledger.tabs) {
    ids.forEach((id, i) => {
      tabs[`${docId}/new:tab:${i + 1}`] = id;
    });
  }
  return { docs, headings, tabs };
}

/** Waits `ms` milliseconds (the engine is the only layer allowed to). */
function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
