/* Two-tier in-memory and SQLite cache for Google Doc snapshots with dual TTL freshness. */

import { Gdoc } from "~/core/gdoc.ts";
import { type DocsClient, gws } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { SqliteDatabase } from "./sqlite.ts";

/** Default TTL1: 10 seconds before initiating background revalidation. */
export const DEFAULT_TTL1_MS = 10_000;

/** Default TTL2: 5 minutes before blocking on cloud revision verification and memory GC. */
export const DEFAULT_TTL2_MS = 300_000;

/** Thirty days in milliseconds for persistent SQLite record retention. */
const DEFAULT_SQLITE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * In-memory cached document entry with timestamp and active Gdoc instance.
 */
export interface CachedDocEntry {
  /** Timestamp when document snapshot was fetched or revalidated, in epoch milliseconds. */
  fetchedAt: number;
  /** In-memory Gdoc instance wrapping the parsed payload. */
  gdoc: Gdoc;
}

/**
 * Configuration options for document cache operations.
 */
export interface DocCacheOptions {
  /** When true, bypasses read cache and forces a fresh network fetch. */
  forceFetch?: boolean;
  /** When true, skips cache completely (both read and write). */
  noCache?: boolean;
}

/**
 * Two-tier in-memory and SQLite cache for Google Doc snapshots.
 */
export class DocCache {
  /** SQLite database for persistent storage across process runs. */
  private db: SqliteDatabase;
  /** In-flight document fetch promises deduplicating concurrent network calls. */
  private inFlight: Map<string, Promise<Gdoc>> = new Map();
  /** Active in-memory document snapshots mapped by document ID. */
  private memoryCache: Map<string, CachedDocEntry> = new Map();
  /** Stale-while-revalidate TTL in milliseconds. */
  private ttl1Ms: number;
  /** Hard-stale validation and memory GC threshold in milliseconds. */
  private ttl2Ms: number;

  constructor(
    /** Optional configuration overrides for SQLite db, drive client, and TTLs. */
    options: {
      db?: SqliteDatabase;
      ttl1Ms?: number;
      ttl2Ms?: number;
    } = {},
  ) {
    this.db = options.db ?? new SqliteDatabase();
    this.ttl1Ms = options.ttl1Ms ?? DEFAULT_TTL1_MS;
    this.ttl2Ms = options.ttl2Ms ?? DEFAULT_TTL2_MS;

    try {
      this.db.prune(DEFAULT_SQLITE_RETENTION_MS);
    } catch {
      // Ignore initial prune failure
    }
  }

  /**
   * Clears all cached documents from both in-memory and SQLite storage.
   */
  clear(): void {
    this.memoryCache.clear();
    this.inFlight.clear();
    this.db.clear();
  }

  /**
   * Fetches and caches a Google Doc snapshot using dual-tier caching and freshness validation.
   */
  async get(
    /** Google Doc document identifier. */
    docId: string,
    /** Google Docs API client used for fetching documents. Defaults to gws. */
    client: DocsClient = gws,
    /** Cache control options. */
    options?: DocCacheOptions,
  ): Promise<Gdoc> {
    if (options?.noCache) {
      const data = await client.getDocument(docId);
      return new Gdoc(data, docId);
    }

    if (options?.forceFetch) {
      return this.fetchAndStore(docId, client);
    }

    const now = Date.now();
    const memEntry = this.memoryCache.get(docId);

    if (memEntry) {
      const age = now - memEntry.fetchedAt;
      if (age < this.ttl1Ms) {
        return new Gdoc(structuredClone(memEntry.gdoc.data), docId);
      }
      if (age < this.ttl2Ms) {
        this.revalidateInBackground(docId, client, memEntry);
        return new Gdoc(structuredClone(memEntry.gdoc.data), docId);
      }
      return this.hardValidateOrRefresh(docId, client, memEntry);
    }

    const stored = this.db.get(docId);
    if (stored) {
      try {
        const docData = JSON.parse(stored.data_json) as GoogleDoc;
        const gdoc = new Gdoc(docData, docId);
        const entry: CachedDocEntry = {
          fetchedAt: stored.fetched_at,
          gdoc,
        };
        this.memoryCache.set(docId, entry);

        const age = now - entry.fetchedAt;
        if (age < this.ttl1Ms) {
          return new Gdoc(docData, docId);
        }
        if (age < this.ttl2Ms) {
          this.revalidateInBackground(docId, client, entry);
          return new Gdoc(docData, docId);
        }
        return this.hardValidateOrRefresh(docId, client, entry);
      } catch {
        // Fallback to fresh fetch if stored JSON is corrupt
      }
    }

    return this.fetchAndStore(docId, client);
  }

  /**
   * Evicts a document snapshot from in-memory and SQLite storage.
   */
  invalidate(
    /** Google Doc document identifier to remove. */
    docId: string,
  ): void {
    this.memoryCache.delete(docId);
    this.inFlight.delete(docId);
    this.db.delete(docId);
  }

  /**
   * Memory garbage collector evicting in-memory entries older than TTL2 while retaining them in SQLite.
   */
  reap(): void {
    const now = Date.now();
    for (const [docId, entry] of this.memoryCache.entries()) {
      if (now - entry.fetchedAt >= this.ttl2Ms) {
        this.memoryCache.delete(docId);
      }
    }
  }

  /**
   * Stores an existing Gdoc instance into in-memory and SQLite caches.
   */
  set(
    /** Google Doc document identifier. */
    docId: string,
    /** In-memory Gdoc snapshot to store. */
    gdoc: Gdoc,
  ): void {
    const now = Date.now();
    const revId = gdoc.data.revisionId ?? "";
    this.db.set(docId, revId, JSON.stringify(gdoc.data), now);
    this.memoryCache.set(docId, {
      fetchedAt: now,
      gdoc: new Gdoc(structuredClone(gdoc.data), docId),
    });
  }

  /**
   * Fetches fresh document from the API with in-flight deduplication and saves it to cache.
   */
  private async fetchAndStore(
    /** Google Doc document identifier. */
    docId: string,
    /** Google Docs API client. */
    client: DocsClient,
  ): Promise<Gdoc> {
    const existingPromise = this.inFlight.get(docId);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = (async () => {
      const data = await client.getDocument(docId);
      const now = Date.now();
      const revId = data.revisionId ?? "";
      this.db.set(docId, revId, JSON.stringify(data), now);
      this.memoryCache.set(docId, {
        fetchedAt: now,
        gdoc: new Gdoc(structuredClone(data), docId),
      });
      return new Gdoc(structuredClone(data), docId);
    })();

    this.inFlight.set(docId, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(docId);
    }
  }

  /**
   * Validates cloud Docs revisionId when doc is older than TTL2, refreshing if revision mismatch or check fails.
   */
  private async hardValidateOrRefresh(
    /** Google Doc document identifier. */
    docId: string,
    /** Google Docs API client. */
    client: DocsClient,
    /** Existing cached document entry. */
    entry: CachedDocEntry,
  ): Promise<Gdoc> {
    try {
      const cloudRev = await cloudRevisionIdGet(docId, client);
      if (cloudRev && cloudRev === entry.gdoc.data.revisionId) {
        const now = Date.now();
        entry.fetchedAt = now;
        this.db.touch(docId, now);
        return new Gdoc(structuredClone(entry.gdoc.data), docId);
      }
    } catch {
      // Fall through to full fetch on check error
    }
    return this.fetchAndStore(docId, client);
  }

  /**
   * Triggers non-blocking background revalidation of a cached document.
   */
  private revalidateInBackground(
    /** Google Doc document identifier. */
    docId: string,
    /** Google Docs API client. */
    client: DocsClient,
    /** Existing cached document entry. */
    entry: CachedDocEntry,
  ): void {
    if (this.inFlight.has(docId)) return;

    const task = (async () => {
      try {
        const cloudRev = await cloudRevisionIdGet(docId, client);
        if (cloudRev && cloudRev === entry.gdoc.data.revisionId) {
          const now = Date.now();
          entry.fetchedAt = now;
          this.db.touch(docId, now);
        } else {
          await this.fetchAndStore(docId, client);
        }
      } catch {
        // Suppress background errors
      }
    })();

    // Background task does not block caller
    task.catch(() => {});
  }
}

/**
 * Resolves the current Docs revision id for cache freshness checks.
 */
async function cloudRevisionIdGet(
  /** Google Doc document identifier. */
  docId: string,
  /** Google Docs API client. */
  client: DocsClient,
): Promise<string | undefined> {
  return client.revisionIdGet?.(docId);
}

/** Global document snapshot cache instance. */
export const docCache = new DocCache();
