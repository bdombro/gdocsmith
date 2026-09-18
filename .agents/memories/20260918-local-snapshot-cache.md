# Made with /thread-memory

## Meta
updated: 2026-09-18 09:07
id: 9ac56689-8e2b-467a-ba0c-f1aad0b13464
thread: local document snapshot cache and revision safety
scope: src/core/cache/**, src/core/gws.ts, src/core/fetchWithRetry.ts, src/core/dom/applyBatch.ts, src/core/applyScript.ts, src/core/actions/**, src/core/replace.ts
topics: DocCache, SQLite, fetchWithRetry, requiredRevisionId, mutation replay, cache invalidation, preflight preload, table fill replay
counts: 8 decision, 1 rejected, 2 footgun

## 2026-09-18 00:00 decision
Two-tier DocCache at ~/.cache/gdocsmith
context: repeated getDocument calls in multi-step runs added latency and quota pressure
decision: memory plus SQLite at ~/.cache/gdocsmith/db.sqlite with TTL1 stale-while-revalidate about 10s and TTL2 hard freshness about 5m plus in-flight promise deduplication
paths: src/core/cache/docCache.ts, src/core/gws.ts, src/core/config.ts

## 2026-09-18 00:00 decision
Dual-runtime SQLite without native addons
context: MCP bundle targets Node while dev uses Bun
decision: SqliteDatabase bridges bun:sqlite and node:sqlite for the same cache schema
paths: src/core/cache/sqlite.ts

## 2026-09-18 00:00 decision
fetchWithRetry for Google API calls
context: transient 429 and 5xx caused flaky agent runs
decision: shared fetchWithRetry with exponential backoff on network errors, rate limits, and server errors
paths: src/core/fetchWithRetry.ts, src/core/gws.ts

## 2026-09-18 00:00 decision
requiredRevisionId on batchUpdate writes
context: stale document snapshots corrupt character indexes on concurrent edits
decision: batchUpdate uses writeControl.requiredRevisionId; pendingWritersFlush replays staged mutations after refresh on conflict up to about two minutes
paths: src/core/dom/applyBatch.ts, src/core/applyScript.ts, src/core/gws.ts

## 2026-09-18 09:07 decision
Docs revisionIdGet for lightweight freshness checks
context: Drive headRevisionId is undefined for Google Docs; full getDocument just to compare revision was expensive
decision: DocsClient.revisionIdGet uses documents.get fields=revisionId; DocCache TTL validation calls that instead of Drive headRevisionIdGet
paths: src/core/gws.ts, src/core/cache/docCache.ts

## 2026-09-18 00:00 rejected
Unbounded in-memory document cache only
rejected: MCP restarts and long sessions still re-download large docs
instead: SQLite-backed cache with TTL tiers and revision checks

## 2026-09-18 00:00 footgun
Applying batchUpdate without revision lock after cache hit
fails: writes land on wrong paragraph boundaries when another client edited the doc
paths: src/core/dom/applyBatch.ts, src/core/cache/docCache.ts

## 2026-09-18 08:57 decision
Cache invalidation on lifecycle mutations and replacements
context: mutations via Drive lifecycle actions (docDelete, docTrash, docRename) and native batch/regex replace modify remote documents without going through DomWriter
decision: explicitly call docCache.invalidate(docId) immediately upon successful mutation response to prevent stale cache hits on subsequent reads
paths: src/core/actions/docDelete.ts, src/core/actions/docRename.ts, src/core/actions/docTrash.ts, src/core/replace.ts

## 2026-09-18 08:57 decision
Eager preflight preloads existing docs and ignores step aliases
context: parallel preloading in applyScriptExecute accelerates multi-doc scripts, but naive ID parsing treated declared step aliases in docCreate.fromDoc as document IDs and failed upfront
decision: preload docs in parallel for both dryRun and live executions; filter out declared step aliases before resolving IDs; in dryRun, skip missing documents without throwing
paths: src/core/applyScript.ts, src/core/actions/open.ts, src/core/dom/clone.ts

## 2026-09-18 08:57 decision
Memoize workspace domain lookup on DriveClient
context: userDomainGet queries Drive /about?fields=user which was called repeatedly across docPermission operations
decision: memoize the parsed domain on the DriveClient instance (cachedUserDomain) after first successful fetch
paths: src/core/gws.ts

## 2026-09-18 08:57 footgun
Automated replay of failed secondary table fills
fails: table insertion is two-phase (insert table request, then cell content fill request); treating revision mismatch in cell fill as a transient conflict triggers pendingWritersFlush replay, which creates duplicate tables on the document
paths: src/core/dom/applyBatch.ts
