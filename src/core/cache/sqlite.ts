/* Dual-runtime SQLite storage backend supporting Bun and Node. */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cacheDbPath } from "~/core/config.ts";

const isBun = typeof (process.versions as unknown as { bun?: string }).bun !== "undefined";
const sqliteModule = isBun ? await import("bun:sqlite") : await import("node:sqlite");

/**
 * Persisted document snapshot record in SQLite.
 */
export interface StoredDocSnapshot {
  /** Serialized raw GoogleDoc JSON string. */
  data_json: string;
  /** Unique Google Doc document identifier. */
  doc_id: string;
  /** Timestamp when document snapshot was fetched, in epoch milliseconds. */
  fetched_at: number;
  /** Head revision ID at the time of fetch. */
  revision_id: string;
}

/**
 * Low-level database interface matching bun:sqlite and node:sqlite instances.
 */
interface SqliteRawDatabase {
  /** Closes database connection. */
  close(): void;
  /** Executes raw SQL statement. */
  exec(sql: string): void;
  /** Prepares SQL statement for execution or queries. */
  prepare(sql: string): {
    /** Executes query and returns single row or undefined. */
    get(...params: unknown[]): unknown;
    /** Executes statement without returning rows. */
    run(...params: unknown[]): unknown;
  };
}

/**
 * Embedded SQLite database wrapper abstracting bun:sqlite and node:sqlite.
 */
export class SqliteDatabase {
  /** Underlying SQLite database instance. */
  private db: SqliteRawDatabase;

  constructor(
    /** Path to SQLite database file, or :memory: for an ephemeral in-memory database. */
    dbPath: string = cacheDbPath(),
  ) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = isBun
      ? new (sqliteModule as unknown as { Database: new (path: string) => SqliteRawDatabase }).Database(dbPath)
      : new (sqliteModule as unknown as { DatabaseSync: new (path: string) => SqliteRawDatabase }).DatabaseSync(dbPath);

    if (dbPath !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL;");
      } catch {
        // In-memory or restricted environments may not support WAL
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS doc_snapshots (
        data_json TEXT NOT NULL,
        doc_id TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        revision_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_doc_snapshots_fetched_at ON doc_snapshots(fetched_at);
    `);
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Deletes all records from the snapshot table.
   */
  clear(): void {
    this.db.exec("DELETE FROM doc_snapshots;");
  }

  /**
   * Deletes a document snapshot by its ID.
   */
  delete(
    /** Google Doc document identifier. */
    docId: string,
  ): void {
    this.db.prepare("DELETE FROM doc_snapshots WHERE doc_id = ?;").run(docId);
  }

  /**
   * Executes arbitrary SQL statements against the database.
   */
  exec(
    /** SQL statement string to execute. */
    sql: string,
  ): void {
    this.db.exec(sql);
  }

  /**
   * Retrieves a document snapshot record by document ID.
   */
  get(
    /** Google Doc document identifier. */
    docId: string,
  ): StoredDocSnapshot | undefined {
    const row = this.db
      .prepare("SELECT data_json, doc_id, fetched_at, revision_id FROM doc_snapshots WHERE doc_id = ?;")
      .get(docId);
    if (!row || typeof row !== "object") return undefined;
    return row as StoredDocSnapshot;
  }

  /**
   * Deletes snapshot records older than the specified duration in milliseconds.
   */
  prune(
    /** Maximum age in milliseconds before record is purged. */
    olderThanMs: number,
  ): void {
    const cutoff = Date.now() - olderThanMs;
    this.db.prepare("DELETE FROM doc_snapshots WHERE fetched_at < ?;").run(cutoff);
  }

  /**
   * Inserts or updates a document snapshot in the database.
   */
  set(
    /** Google Doc document identifier. */
    docId: string,
    /** Head revision ID. */
    revisionId: string,
    /** Serialized raw GoogleDoc JSON. */
    dataJson: string,
    /** Timestamp of fetch in epoch milliseconds. */
    fetchedAt: number = Date.now(),
  ): void {
    this.db
      .prepare(`
        INSERT INTO doc_snapshots (data_json, doc_id, fetched_at, revision_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(doc_id) DO UPDATE SET
          data_json = excluded.data_json,
          fetched_at = excluded.fetched_at,
          revision_id = excluded.revision_id;
      `)
      .run(dataJson, docId, fetchedAt, revisionId);
  }

  /**
   * Updates only the fetched_at timestamp for an existing document snapshot.
   */
  touch(
    /** Google Doc document identifier. */
    docId: string,
    /** Timestamp in epoch milliseconds. */
    fetchedAt: number = Date.now(),
  ): void {
    this.db.prepare("UPDATE doc_snapshots SET fetched_at = ? WHERE doc_id = ?;").run(fetchedAt, docId);
  }
}
