import { describe, expect, test } from "bun:test";
import { SqliteDatabase } from "./sqlite.ts";

describe("SqliteDatabase", () => {
  test("creates table and handles set, get, touch, delete, and clear in memory", () => {
    const db = new SqliteDatabase(":memory:");

    expect(db.get("doc1")).toBeUndefined();

    db.set("doc1", "rev-1", JSON.stringify({ title: "Doc 1" }), 1000);
    const snap = db.get("doc1");
    expect(snap).toBeDefined();
    expect(snap?.doc_id).toBe("doc1");
    expect(snap?.revision_id).toBe("rev-1");
    expect(snap?.fetched_at).toBe(1000);
    expect(JSON.parse(snap?.data_json ?? "{}")).toEqual({ title: "Doc 1" });

    // Upsert updates existing entry
    db.set("doc1", "rev-2", JSON.stringify({ title: "Doc 1 Updated" }), 2000);
    const updated = db.get("doc1");
    expect(updated?.revision_id).toBe("rev-2");
    expect(updated?.fetched_at).toBe(2000);

    // Touch updates only fetched_at
    db.touch("doc1", 3000);
    const touched = db.get("doc1");
    expect(touched?.revision_id).toBe("rev-2");
    expect(touched?.fetched_at).toBe(3000);

    // Delete removes doc
    db.delete("doc1");
    expect(db.get("doc1")).toBeUndefined();

    // Clear removes all
    db.set("doc2", "rev-a", "{}", 4000);
    db.set("doc3", "rev-b", "{}", 4000);
    db.clear();
    expect(db.get("doc2")).toBeUndefined();
    expect(db.get("doc3")).toBeUndefined();

    db.close();
  });

  test("prune deletes records older than cutoff", () => {
    const db = new SqliteDatabase(":memory:");
    const now = Date.now();

    db.set("oldDoc", "rev-old", "{}", now - 100_000);
    db.set("newDoc", "rev-new", "{}", now);

    db.prune(50_000); // Purge older than 50s
    expect(db.get("oldDoc")).toBeUndefined();
    expect(db.get("newDoc")).toBeDefined();

    db.close();
  });
});
