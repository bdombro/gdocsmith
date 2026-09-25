/* Live Docs API conformance (G3 M5): batches tab-local scenarios onto shared scratch documents while preserving isolated fixture recording. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ConformanceFixture, conformanceCompare, fixtureCompact } from "~/core/emulator/conformance.ts";
import { requestsEmulate } from "~/core/emulator/emulate.ts";
import { gws, gwsDrive } from "~/core/gws.ts";
import type { JsonObject } from "~/core/model/rawJson.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { SCENARIOS } from "./conformanceScenarios.ts";

/** One raw Docs API request. */
type Req = Record<string, unknown>;

/** One scenario definition. */
type Scenario = (typeof SCENARIOS)[number];

/** A tab-local scenario plus the requests generated from its live pre-test state. */
interface ScenarioPlan {
  /** Exclusive end of this scenario's replies in the shared batch. */
  replyEnd?: number;
  /** Offset of this scenario's requests in the shared batch. */
  replyStart?: number;
  /** Scenario definition. */
  scenario: Scenario;
  /** Test requests, scoped to `tabId`. */
  testRequests: JsonObject[];
  /** Dedicated tab for this scenario. */
  tabId: string;
}

/** Where recorded fixtures go (replayed offline by `src/core/emulator/conformance.test.ts`). */
const FIXTURE_DIR = join(import.meta.dir, "..", "..", "src", "core", "emulator", "__fixtures__", "conformance");

/** Rewrite fixtures instead of only checking conformance. */
const RECORD = process.env.GDOCSMITH_RECORD === "1";

/** Only these scenario ids (comma-separated), e.g. to record new ones. */
const ONLY = process.env.GDOCSMITH_ONLY?.split(",");

/** All tab-local scenarios fit below Google Docs' 100-tab and 1,000-request batch limits. */
const BATCH_SIZE = 96;

/** Opt out while diagnosing a live failure; recording is always isolated to preserve fixtures. */
const BATCHED = !RECORD && process.env.GDOCSMITH_CONFORMANCE_ISOLATED !== "1";

/** These scenarios change document-level or tab-tree state and must start from an isolated document. */
const ISOLATED_IDS = new Set(["C27a", "C27b", "C27c", "C27d", "C28"]);

/** These test batches intentionally fail and therefore cannot share a batch with successful scenarios. */
const REJECTED_IDS = new Set(["C08", "C10d", "C11a", "C24c", "C24d", "C34", "P5"]);

/** Per-scenario timeout: a few API calls plus rate-limit backoff. */
const SCENARIO_TIMEOUT_MS = 180_000;

/** One pooled batch should finish well below this, including documented rate-limit backoff. */
const BATCH_TIMEOUT_MS = 600_000;

/** Errors worth retrying on reads and doc creation. */
const TRANSIENT =
  /429|RATE_LIMIT|Quota exceeded|rateLimitExceeded|\(5\d\d\)|socket|ECONNRESET|fetch failed|timed out|Timeout/i;

/** Only rate-limit rejections are safe to retry for writes (the batch was not applied). */
const RATE_LIMITED = /429|RATE_LIMIT|Quota exceeded|rateLimitExceeded/i;

/** Runs `fn`, retrying up to 5 times with growing delays while its error matches `retryable`. */
async function retry<T>(fn: () => Promise<T>, retryable: RegExp): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 5 || !retryable.test(err instanceof Error ? err.message : String(err))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)));
    }
  }
}

/** Runs one scenario on a fresh scratch doc (always deleted afterwards) and returns what the API did. */
async function scenarioRecord(scenario: (typeof SCENARIOS)[number]): Promise<ConformanceFixture> {
  const created = await retry(() => gws.createDocument(`[CONFORMANCE] ${scenario.id} ${Date.now()}`), TRANSIENT);
  const documentId = created.documentId;
  try {
    return await scenarioRecordInTab(documentId, "t.0", scenario, false);
  } finally {
    await scratchDelete(documentId);
  }
}

/** Runs a scenario in one tab, adding tab IDs to location-bearing requests when the tab is shared. */
async function scenarioRecordInTab(
  documentId: string,
  tabId: string,
  scenario: (typeof SCENARIOS)[number],
  scoped: boolean,
): Promise<ConformanceFixture> {
  const scenarioDoc = (doc: GoogleDoc) => (scoped ? tabFirst(doc, tabId) : doc);
  const scope = (requests: Req[]) => (scoped ? requestsTabScope(requests, tabId) : (requests as JsonObject[]));

  for (const step of scenario.setup ?? []) {
    const doc = await retry(() => gws.getDocument(documentId), TRANSIENT);
    const requests = scope(step(scenarioDoc(doc)));
    if (requests.length) await retry(() => gws.batchUpdate(documentId, requests), RATE_LIMITED);
  }

  const before = await retry(() => gws.getDocument(documentId), TRANSIENT);
  const requests = scope(scenario.test(scenarioDoc(before)));
  const fx: ConformanceFixture = { after: null, before, id: scenario.id, name: scenario.name, requests };
  try {
    const response = JSON.parse(await retry(() => gws.batchUpdate(documentId, requests), RATE_LIMITED));
    fx.replies = response.replies;
    fx.after = (await retry(() => gws.getDocument(documentId), TRANSIENT)) as GoogleDoc;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\((401|403)\)/.test(message)) throw err;
    fx.error = message.replace(/^Google API error \(\d+\): /, "");
  }
  return fx;
}

/**
 * Runs independent scenarios in dedicated tabs of one scratch document. Setup requests are planned
 * locally against the emulator and sent together; valid test requests share one batch, while expected
 * rejections stay separate so an intentional 400 cannot roll back other scenarios.
 */
async function scenariosBatchRecord(scenarios: readonly (typeof SCENARIOS)[number][]): Promise<string[]> {
  const created = await retry(() => gws.createDocument(`[CONFORMANCE BATCH] ${Date.now()}`), TRANSIENT);
  const documentId = created.documentId;
  try {
    const initial = await retry(() => gws.getDocument(documentId), TRANSIENT);
    const rootTabId = initial.tabs?.[0]?.tabProperties?.tabId;
    if (!rootTabId) throw new Error("new document did not contain a root tab");

    const added = scenarios.slice(1).map((scenario) => ({
      addDocumentTab: { tabProperties: { title: scenario.id } },
    }));
    const addedIds = added.length
      ? (
          JSON.parse(await retry(() => gws.batchUpdate(documentId, added), RATE_LIMITED)) as {
            replies?: Array<{ addDocumentTab?: { tabProperties?: { tabId?: string } } }>;
          }
        ).replies?.map((reply) => reply.addDocumentTab?.tabProperties?.tabId)
      : [];
    if (addedIds?.some((id) => !id) || addedIds?.length !== added.length) {
      throw new Error("addDocumentTab did not return every tab id");
    }

    const tabIds = [rootTabId, ...(addedIds as string[])];
    let prepared = await retry(() => gws.getDocument(documentId), TRANSIENT);
    const setupRequests: JsonObject[] = [];

    for (const [index, scenario] of scenarios.entries()) {
      const tabId = tabIds[index];
      for (const setup of scenario.setup ?? []) {
        const requests = requestsTabScope(setup(tabFirst(prepared, tabId)), tabId);
        setupRequests.push(...requests);
        prepared = requestsEmulate(prepared, requests).json;
      }
    }

    if (setupRequests.length) await retry(() => gws.batchUpdate(documentId, setupRequests), RATE_LIMITED);

    const before = await retry(() => gws.getDocument(documentId), TRANSIENT);
    const plans = scenarios.map(
      (scenario, index): ScenarioPlan => ({
        scenario,
        tabId: tabIds[index],
        testRequests: requestsTabScope(scenario.test(tabFirst(before, tabIds[index])), tabIds[index]),
      }),
    );

    const validRequests: JsonObject[] = [];
    const validPlans = plans.filter((plan) => !REJECTED_IDS.has(plan.scenario.id));
    for (const plan of validPlans) {
      plan.replyStart = validRequests.length;
      validRequests.push(...plan.testRequests);
      plan.replyEnd = validRequests.length;
    }

    let replies: JsonObject[] = [];
    let after = before;
    if (validRequests.length) {
      const response = JSON.parse(await retry(() => gws.batchUpdate(documentId, validRequests), RATE_LIMITED)) as {
        replies?: JsonObject[];
      };
      replies = response.replies ?? [];
      after = await retry(() => gws.getDocument(documentId), TRANSIENT);
    }

    const failures: string[] = [];
    for (const plan of validPlans) {
      const fixture: ConformanceFixture = {
        after: tabFirst(after, plan.tabId),
        before: tabFirst(before, plan.tabId),
        id: plan.scenario.id,
        name: plan.scenario.name,
        replies: replies.slice(plan.replyStart, plan.replyEnd),
        requests: plan.testRequests,
      };
      const diffs = conformanceCompare(fixture);
      if (diffs.length) failures.push(`${plan.scenario.id}: ${diffs.join("; ")}`);
    }

    for (const plan of plans.filter((candidate) => REJECTED_IDS.has(candidate.scenario.id))) {
      const fixture = await rejectedScenarioRecord(documentId, plan, before);
      const diffs = conformanceCompare(fixture);
      if (diffs.length) failures.push(`${plan.scenario.id}: ${diffs.join("; ")}`);
    }
    return failures;
  } finally {
    await scratchDelete(documentId);
  }
}

/** Runs a scenario expected to fail, keeping other scenarios' successful test batch untouched. */
async function rejectedScenarioRecord(
  documentId: string,
  plan: ScenarioPlan,
  before: GoogleDoc,
): Promise<ConformanceFixture> {
  const fixture: ConformanceFixture = {
    after: null,
    before: tabFirst(before, plan.tabId),
    id: plan.scenario.id,
    name: plan.scenario.name,
    requests: plan.testRequests,
  };
  try {
    const response = JSON.parse(await retry(() => gws.batchUpdate(documentId, plan.testRequests), RATE_LIMITED)) as {
      replies?: JsonObject[];
    };
    fixture.replies = response.replies;
    fixture.after = tabFirst(await retry(() => gws.getDocument(documentId), TRANSIENT), plan.tabId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\((401|403)\)/.test(message)) throw err;
    fixture.error = message.replace(/^Google API error \(\d+\): /, "");
  }
  return fixture;
}

/** Permanently deletes a scratch document after its assertions finish. */
async function scratchDelete(documentId: string): Promise<void> {
  await retry(() => gwsDrive.deleteFile(documentId), TRANSIENT);
}

/** Gives a scenario its dedicated tab as `tabs[0]`, preserving its existing request builders. */
function tabFirst(doc: GoogleDoc, tabId: string): GoogleDoc {
  const tab = doc.tabs?.find((candidate) => candidate.tabProperties?.tabId === tabId);
  if (!tab) throw new Error(`tab ${tabId} disappeared during conformance batch`);
  return { ...doc, tabs: [tab] } as GoogleDoc;
}

/** Adds a tab id to every request location/range while remapping test references to root tab `t.0`. */
function requestsTabScope(requests: Req[], tabId: string): JsonObject[] {
  return requests.map((request) => requestTabScope(request, tabId) as JsonObject);
}

/** Recursively scopes Docs request locations to `tabId`. */
function requestTabScope(value: unknown, tabId: string, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => requestTabScope(item, tabId));
  if (!value || typeof value !== "object") return key === "tabId" && value === "t.0" ? tabId : value;

  const out: JsonObject = {};
  for (const [childKey, child] of Object.entries(value as JsonObject)) {
    out[childKey] = requestTabScope(child, tabId, childKey);
  }
  if (["endOfSegmentLocation", "location", "range", "tableStartLocation"].includes(key ?? "")) {
    out.tabId ??= tabId;
  }
  return out;
}

/** Splits an array into fixed-size groups. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push([...items.slice(index, index + size)]);
  return out;
}

describe("live Docs API conformance", () => {
  if (RECORD) mkdirSync(FIXTURE_DIR, { recursive: true });
  const scenarios = SCENARIOS.filter((scenario) => !ONLY || ONLY.includes(scenario.id));
  const batched = BATCHED ? scenarios.filter((scenario) => !ISOLATED_IDS.has(scenario.id)) : [];
  const isolated = BATCHED ? scenarios.filter((scenario) => ISOLATED_IDS.has(scenario.id)) : scenarios;

  for (const batch of chunks(batched, BATCH_SIZE)) {
    test(
      `batch ${batch[0]?.id}–${batch.at(-1)?.id}: ${batch.length} tab-isolated scenarios`,
      async () => {
        expect(await scenariosBatchRecord(batch)).toEqual([]);
      },
      BATCH_TIMEOUT_MS,
    );
  }

  for (const scenario of isolated) {
    test(
      `${scenario.id}: ${scenario.name}`,
      async () => {
        const fx = await scenarioRecord(scenario);
        if (RECORD) writeFileSync(join(FIXTURE_DIR, `${scenario.id}.json`), `${JSON.stringify(fixtureCompact(fx))}\n`);
        expect(conformanceCompare(fx)).toEqual([]);
      },
      SCENARIO_TIMEOUT_MS,
    );
  }
});
