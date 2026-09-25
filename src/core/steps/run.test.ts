/* Tests for run execution pipeline (G4 D5–D8, M6). */

import { describe, expect, test } from "bun:test";
import { DocCache } from "~/core/cache/docCache.ts";
import { SqliteDatabase } from "~/core/cache/sqlite.ts";
import { FakeGoogle } from "~/core/emulator/fakeGoogle.ts";
import blankTab from "~/core/model/blankTab.json";
import { docJsonBuild, type TabSpec } from "~/core/model/testDocs.ts";
import { RequestBuilder } from "~/core/requests.ts";
import { runExecute } from "./run.ts";
import type { GdocsmithRun } from "./types.ts";

function fakeGoogle(docs: Record<string, TabSpec[]>): FakeGoogle {
  const g = new FakeGoogle();
  for (const [id, tabs] of Object.entries(docs)) {
    const json = docJsonBuild({ tabs, title: id }) as unknown as {
      tabs: Array<{ documentTab: Record<string, unknown> }>;
    };
    for (const t of json.tabs) {
      t.documentTab.namedStyles = structuredClone(blankTab.namedStyles);
    }
    g.seedDocument(id, json as never);
  }
  return g;
}

const memCache = () => new DocCache({ db: new SqliteDatabase(":memory:") });

const para = (text: string) => ({ content: [text], kind: "paragraph" as const });
const heading = (text: string, id: string, level = "HEADING_1") => ({
  content: [text],
  headingId: id,
  kind: "paragraph" as const,
  style: { namedStyleType: level },
});

describe("run execution pipeline", () => {
  test("dry and live results have the same keys", async () => {
    const docId = "doc-keys-1234567890123456789012";
    const g = fakeGoogle({
      [docId]: [{ blocks: [heading("Title", "h.t"), para("Hello world")], title: "Main" }],
    });
    const run: GdocsmithRun = {
      steps: [
        {
          append: true,
          doc: docId,
          kind: "write",
          markdown: "Appended line",
        },
      ],
    };

    const dryResult = await runExecute({ ...run, dryRun: true }, { cache: memCache(), client: g, drive: g });
    const liveResult = await runExecute({ ...run, dryRun: false }, { cache: memCache(), client: g, drive: g });

    expect(Object.keys(dryResult).sort()).toEqual(Object.keys(liveResult).sort());
    expect(Object.keys(dryResult.diff).sort()).toEqual(Object.keys(liveResult.diff).sort());
    expect(dryResult.phases.length).toBe(liveResult.phases.length);
    for (let i = 0; i < dryResult.phases.length; i++) {
      expect(Object.keys(dryResult.phases[i]).sort()).toEqual(Object.keys(liveResult.phases[i]).sort());
    }
  });

  test("validation failure loads no document (getDocument count 0)", async () => {
    const docId = "doc-valid-123456789012345678901";
    const g = fakeGoogle({
      [docId]: [{ blocks: [para("Content")], title: "Main" }],
    });
    const invalidRun: GdocsmithRun = {
      steps: [
        {
          action: "create",
          as: "doc1",
          doc: docId, // forbidden on create
          kind: "doc",
          title: "Title",
        },
      ],
    };

    await expect(runExecute(invalidRun, { cache: memCache(), client: g, drive: g })).rejects.toThrow("Invalid steps");
    const getDocCalls = g.callLog.filter((c) => c.method === "getDocument");
    expect(getDocCalls).toHaveLength(0);
  });

  test("raw IDs auto-open and preload once", async () => {
    const docId = "doc-preload-1234567890123456789";
    const g = fakeGoogle({
      [docId]: [{ blocks: [heading("Title", "h.t"), para("Initial line")], title: "Main" }],
    });
    const run: GdocsmithRun = {
      steps: [
        {
          append: true,
          doc: docId,
          kind: "write",
          markdown: "Line 2",
        },
        {
          doc: docId,
          find: "Initial",
          kind: "edit",
          replace: "Replaced",
        },
        {
          doc: docId,
          kind: "query",
          output: "outline",
        },
      ],
    };

    await runExecute(run, { cache: memCache(), client: g, drive: g });
    // Exactly 1 getDocument call during preload (plus 1 reload after flush in live verify)
    const getDocCalls = g.callLog.filter((c) => c.method === "getDocument" && c.args[0] === docId);
    expect(getDocCalls.length).toBeLessThanOrEqual(2);
  });

  test("doc open fresh bypasses the cache", async () => {
    const docId = "doc-fresh-123456789012345678901";
    const g = fakeGoogle({
      [docId]: [{ blocks: [para("Content")], title: "Main" }],
    });
    const cache = memCache();
    // Prime cache with initial read
    await cache.get(docId, g, { forceFetch: false });
    const callsAfterPrime = g.callLog.filter((c) => c.method === "getDocument").length;

    // Normal run (fresh: false) hits cache
    const cachedRun: GdocsmithRun = {
      steps: [{ doc: docId, kind: "query", output: "outline" }],
    };
    await runExecute(cachedRun, { cache, client: g, drive: g });
    const callsAfterCached = g.callLog.filter((c) => c.method === "getDocument").length;
    expect(callsAfterCached).toBe(callsAfterPrime);

    // Run with fresh: true bypasses cache
    const freshRun: GdocsmithRun = {
      steps: [
        { action: "open", doc: docId, fresh: true, kind: "doc" },
        { doc: docId, kind: "query", output: "outline" },
      ],
    };
    await runExecute(freshRun, { cache, client: g, drive: g });
    const callsAfterFresh = g.callLog.filter((c) => c.method === "getDocument").length;
    expect(callsAfterFresh).toBeGreaterThan(callsAfterCached);
  });

  test("all content steps flush in one batchUpdate per doc", async () => {
    const docId = "doc-flush-1234567890123456789";
    const g = fakeGoogle({
      [docId]: [{ blocks: [heading("Title", "h.t"), para("Alpha")], title: "Main" }],
    });
    const run: GdocsmithRun = {
      steps: [
        {
          append: true,
          doc: docId,
          kind: "write",
          markdown: "Beta",
        },
        {
          doc: docId,
          find: "Alpha",
          kind: "edit",
          replace: "Gamma",
        },
        {
          at: { body: true },
          doc: docId,
          kind: "style",
          text: { bold: true },
        },
      ],
    };

    await runExecute(run, { cache: memCache(), client: g, drive: g });
    const batchUpdates = g.callLog.filter((c) => c.method === "batchUpdate" && c.args[0] === docId);
    expect(batchUpdates).toHaveLength(1);
  });

  test("a query between writes sees planned state without flushing", async () => {
    const docId = "doc-query-1234567890123456789";
    const g = fakeGoogle({
      [docId]: [{ blocks: [heading("Title", "h.t"), para("Original")], title: "Main" }],
    });

    const run: GdocsmithRun = {
      steps: [
        {
          doc: docId,
          kind: "write",
          markdown: "Intermediate",
          replace: { text: "Original" },
        },
        {
          doc: docId,
          kind: "query",
          output: "markdown",
        },
        {
          append: true,
          doc: docId,
          kind: "write",
          markdown: "Final line",
        },
      ],
    };

    const res = await runExecute(run, { cache: memCache(), client: g, drive: g });
    const queryData = res.steps[1].data as { tabs: Array<{ markdown: string }> };
    expect(queryData.tabs[0].markdown).toContain("Intermediate");

    // Only one batchUpdate happened in total, during flush
    const batchUpdates = g.callLog.filter((c) => c.method === "batchUpdate");
    expect(batchUpdates).toHaveLength(1);
  });

  test("tab rename/move of a new tab fold into its creation", async () => {
    const docId = "doc-tabfold-123456789012345678";
    const g = fakeGoogle({
      [docId]: [{ blocks: [para("1")], tabId: "t.0", title: "Existing" }],
    });
    const run: GdocsmithRun = {
      steps: [
        {
          action: "create",
          doc: docId,
          kind: "tab",
          title: "Initial Name",
        },
        {
          action: "rename",
          doc: docId,
          kind: "tab",
          tab: "Initial Name",
          title: "Final Name",
        },
      ],
    };

    await runExecute(run, { cache: memCache(), client: g, drive: g });
    const doc = await g.getDocument(docId);
    const addedTab = doc.tabs?.find((t) => t.tabProperties?.title === "Final Name");
    expect(addedTab).toBeDefined();
  });

  test("revision conflict before landing replays on a fresh load", async () => {
    const docId = "doc-conflict-12345678901234567";
    const g = fakeGoogle({
      [docId]: [{ blocks: [heading("Title", "h.t"), para("Line 1")], title: "Main" }],
    });

    let conflictInjected = false;
    g.beforeBatchUpdate = (dId) => {
      if (!conflictInjected && dId === docId) {
        conflictInjected = true;
        // Inject concurrent edit bumping revision
        g.externalEdit(dId, [RequestBuilder.insertTextAt(1, "Concurrent edit\n", "t.0")]);
      }
    };

    const run: GdocsmithRun = {
      steps: [
        {
          append: true,
          doc: docId,
          kind: "write",
          markdown: "New line",
        },
      ],
    };

    const result = await runExecute(run, { cache: memCache(), client: g, drive: g });
    expect(result.ok).toBe(true);
    // Verified it replayed
    expect(conflictInjected).toBe(true);
  });

  test("later-phase failure lists landed phases", async () => {
    const docId = "doc-failphase-1234567890123456";
    const g = fakeGoogle({
      [docId]: [{ blocks: [heading("Title", "h.t"), para("Line 1")], title: "Main" }],
    });

    // Make permissions phase fail
    g.createPermission = () => {
      throw new Error("Simulated permission error");
    };

    const run: GdocsmithRun = {
      steps: [
        {
          append: true,
          doc: docId,
          kind: "write",
          markdown: "New content",
        },
        {
          action: "add",
          doc: docId,
          kind: "share",
          role: "reader",
          scope: "anyone",
        },
      ],
    };

    let error: Error | undefined;
    try {
      await runExecute(run, { cache: memCache(), client: g, drive: g });
    } catch (err) {
      error = err as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain('Send failed in phase "permissions" (5 of 5)');
    expect(error!.message).toContain("Landed: content");
    expect(error!.message).toContain("Landed changes are live; re-query before retrying.");
  });

  test("guard refusal lists findings; force on that step proceeds", async () => {
    const docId = "doc-guard-123456789012345678901";
    const g = fakeGoogle({
      [docId]: [
        {
          blocks: [
            heading("Protected Section", "h.p"),
            {
              content: [{ sugIns: ["sug-1"], text: "Protected line" }],
              kind: "paragraph" as const,
            },
          ],
          title: "Main",
        },
      ],
    });

    // Without force, changing protected content is refused
    const unforcedRun: GdocsmithRun = {
      steps: [
        {
          doc: docId,
          kind: "write",
          markdown: "Replacement text",
          replace: { text: "Protected line" },
        },
      ],
    };

    await expect(runExecute(unforcedRun, { cache: memCache(), client: g, drive: g })).rejects.toThrow(
      /Refused: 1 step\(s\) would break content that cannot be restored/,
    );

    // With force: true on that step, it proceeds
    const forcedRun: GdocsmithRun = {
      steps: [
        {
          doc: docId,
          force: true,
          kind: "write",
          markdown: "Replacement text",
          replace: { text: "Protected line" },
        },
      ],
    };

    const res = await runExecute(forcedRun, { cache: memCache(), client: g, drive: g });
    expect(res.ok).toBe(true);
  });

  test("run-level cap spills the largest payloads", async () => {
    const doc1Id = "doc-spill1-1234567890123456789";
    const doc2Id = "doc-spill2-1234567890123456789";
    const longText1 = "A".repeat(25_000);
    const longText2 = "B".repeat(25_000);

    const g = fakeGoogle({
      [doc1Id]: [{ blocks: [para(longText1)], title: "Doc1" }],
      [doc2Id]: [{ blocks: [para(longText2)], title: "Doc2" }],
    });

    const run: GdocsmithRun = {
      steps: [
        {
          doc: doc1Id,
          kind: "query",
          output: "markdown",
        },
        {
          doc: doc2Id,
          kind: "query",
          output: "markdown",
        },
      ],
    };

    const res = await runExecute(run, { cache: memCache(), client: g, drive: g });
    expect(res.ok).toBe(true);
    // At least one step was spilled to a file
    const hasSpill = res.steps.some((s) => s.files && s.files.length > 0 && s.data === undefined);
    expect(hasSpill).toBe(true);
  });
});
