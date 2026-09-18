import { describe, expect, test } from "bun:test";
import { Gdoc } from "~/core/gdoc.ts";
import { DocCache } from "./docCache.ts";
import { SqliteDatabase } from "./sqlite.ts";

describe("DocCache", () => {
  test("cache miss fetches from client, caches in memory and SQLite", async () => {
    const db = new SqliteDatabase(":memory:");
    const cache = new DocCache({ db });

    let fetchCount = 0;
    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async (docId: string) => {
        fetchCount++;
        return { documentId: docId, revisionId: "rev-1", title: "Doc Title" };
      },
      run: async () => "",
    };

    // First call: cache miss
    const doc1 = await cache.get("d1", mockClient);
    expect(doc1.id).toBe("d1");
    expect(doc1.data.revisionId).toBe("rev-1");
    expect(fetchCount).toBe(1);

    // Second call within TTL1: in-memory cache hit
    const doc2 = await cache.get("d1", mockClient);
    expect(doc2.data.revisionId).toBe("rev-1");
    expect(fetchCount).toBe(1); // not fetched again

    // Verify written to SQLite
    const row = db.get("d1");
    expect(row).toBeDefined();
    expect(row?.revision_id).toBe("rev-1");

    db.close();
  });

  test("loads from SQLite when memory cache is empty", async () => {
    const db = new SqliteDatabase(":memory:");
    db.set("d2", "rev-sql", JSON.stringify({ documentId: "d2", revisionId: "rev-sql" }), Date.now());

    const cache = new DocCache({ db });
    let fetchCount = 0;
    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async () => {
        fetchCount++;
        return {};
      },
      run: async () => "",
    };

    const doc = await cache.get("d2", mockClient);
    expect(doc.id).toBe("d2");
    expect(doc.data.revisionId).toBe("rev-sql");
    expect(fetchCount).toBe(0);

    db.close();
  });

  test("deduplicates concurrent in-flight fetches for the same docId", async () => {
    const db = new SqliteDatabase(":memory:");
    const cache = new DocCache({ db });

    let fetchCount = 0;
    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async (docId: string) => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 10));
        return { documentId: docId, revisionId: "rev-1" };
      },
      run: async () => "",
    };

    const [d1, d2, d3] = await Promise.all([
      cache.get("concurrent-doc", mockClient),
      cache.get("concurrent-doc", mockClient),
      cache.get("concurrent-doc", mockClient),
    ]);

    expect(fetchCount).toBe(1);
    expect(d1.data.revisionId).toBe("rev-1");
    expect(d2.data.revisionId).toBe("rev-1");
    expect(d3.data.revisionId).toBe("rev-1");

    db.close();
  });

  test("between TTL1 and TTL2 triggers background revalidation", async () => {
    const db = new SqliteDatabase(":memory:");
    let revisionIdCalled = 0;
    const headRevResult = "rev-1";

    const cache = new DocCache({
      db,
      ttl1Ms: 10,
      ttl2Ms: 1000,
    });

    let fetchCount = 0;
    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async (docId: string) => {
        fetchCount++;
        return { documentId: docId, revisionId: "rev-1" };
      },
      revisionIdGet: async () => {
        revisionIdCalled++;
        return headRevResult;
      },
      run: async () => "",
    };

    // Initial fetch
    await cache.get("doc-bg", mockClient);
    expect(fetchCount).toBe(1);

    // Wait until past TTL1 (10ms) but before TTL2 (1000ms)
    await new Promise((r) => setTimeout(r, 20));

    // Request doc: returns cached immediately, fires background revalidation
    const cached = await cache.get("doc-bg", mockClient);
    expect(cached.data.revisionId).toBe("rev-1");
    expect(fetchCount).toBe(1); // not blocked

    // Wait for background revalidation task to finish
    await new Promise((r) => setTimeout(r, 20));
    expect(revisionIdCalled).toBe(1);

    db.close();
  });

  test("older than TTL2 hard blocks and updates if cloud revision changed", async () => {
    const db = new SqliteDatabase(":memory:");
    const currentCloudRev = "rev-2"; // changed in cloud!

    const cache = new DocCache({
      db,
      ttl1Ms: 5,
      ttl2Ms: 15, // short TTL2 for testing
    });

    let fetchCount = 0;
    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async (docId: string) => {
        fetchCount++;
        return { documentId: docId, revisionId: fetchCount === 1 ? "rev-1" : "rev-2" };
      },
      revisionIdGet: async () => currentCloudRev,
      run: async () => "",
    };

    // Initial fetch -> rev-1
    const d1 = await cache.get("doc-hard", mockClient);
    expect(d1.data.revisionId).toBe("rev-1");
    expect(fetchCount).toBe(1);

    // Wait past TTL2
    await new Promise((r) => setTimeout(r, 25));

    // Next fetch hard validates: sees cloud revision changed -> fetches fresh doc
    const d2 = await cache.get("doc-hard", mockClient);
    expect(d2.data.revisionId).toBe("rev-2");
    expect(fetchCount).toBe(2);

    db.close();
  });

  test("noCache and forceFetch options", async () => {
    const db = new SqliteDatabase(":memory:");
    const cache = new DocCache({ db });

    let fetchCount = 0;
    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async (docId: string) => {
        fetchCount++;
        return { documentId: docId, revisionId: `rev-${fetchCount}` };
      },
      run: async () => "",
    };

    // noCache does not touch cache
    const d1 = await cache.get("d-opts", mockClient, { noCache: true });
    expect(d1.data.revisionId).toBe("rev-1");
    expect(db.get("d-opts")).toBeUndefined();

    // Normal get saves to cache
    const d2 = await cache.get("d-opts", mockClient);
    expect(d2.data.revisionId).toBe("rev-2");
    expect(db.get("d-opts")).toBeDefined();

    // forceFetch refreshes cache
    const d3 = await cache.get("d-opts", mockClient, { forceFetch: true });
    expect(d3.data.revisionId).toBe("rev-3");

    db.close();
  });

  test("reap evicts stale entries from memory but preserves in SQLite", async () => {
    const db = new SqliteDatabase(":memory:");
    const cache = new DocCache({
      db,
      ttl2Ms: 10,
    });

    const mockClient = {
      batchUpdate: async () => "{}",
      getDocument: async (docId: string) => ({ documentId: docId, revisionId: "rev-reap" }),
      run: async () => "",
    };

    await cache.get("reap-doc", mockClient);
    expect(db.get("reap-doc")).toBeDefined();

    await new Promise((r) => setTimeout(r, 15));
    cache.reap();

    // Still in SQLite
    expect(db.get("reap-doc")).toBeDefined();

    db.close();
  });

  test("set and invalidate methods", () => {
    const db = new SqliteDatabase(":memory:");
    const cache = new DocCache({ db });

    const gdoc = new Gdoc({ documentId: "manual", revisionId: "rev-m" }, "manual");
    cache.set("manual", gdoc);

    expect(db.get("manual")?.revision_id).toBe("rev-m");

    cache.invalidate("manual");
    expect(db.get("manual")).toBeUndefined();

    db.close();
  });
});
