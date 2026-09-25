/* Live Docs API conformance (G3 M5): runs each scenario on a scratch doc and checks the emulator reproduces it; GDOCSMITH_RECORD=1 rewrites the committed fixtures. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ConformanceFixture, conformanceCompare, fixtureCompact } from "~/core/emulator/conformance.ts";
import { gws, gwsDrive } from "~/core/gws.ts";
import type { JsonObject } from "~/core/model/rawJson.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { SCENARIOS } from "./conformanceScenarios.ts";

/** Where recorded fixtures go (replayed offline by `src/core/emulator/conformance.test.ts`). */
const FIXTURE_DIR = join(import.meta.dir, "..", "..", "src", "core", "emulator", "__fixtures__", "conformance");

/** Rewrite fixtures instead of only checking conformance. */
const RECORD = process.env.GDOCSMITH_RECORD === "1";

/** Per-scenario timeout: a few API calls plus rate-limit backoff. */
const SCENARIO_TIMEOUT_MS = 180_000;

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
    for (const step of scenario.setup ?? []) {
      const doc = await retry(() => gws.getDocument(documentId), TRANSIENT);
      const requests = step(doc);
      if (requests.length) await retry(() => gws.batchUpdate(documentId, requests), RATE_LIMITED);
    }
    const before = await retry(() => gws.getDocument(documentId), TRANSIENT);
    const requests = scenario.test(before) as JsonObject[];
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
  } finally {
    await retry(() => gwsDrive.deleteFile(documentId), TRANSIENT);
  }
}

describe("live Docs API conformance", () => {
  if (RECORD) mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const scenario of SCENARIOS) {
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
