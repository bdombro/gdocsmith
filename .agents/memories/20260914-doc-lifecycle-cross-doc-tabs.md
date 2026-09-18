# Made with /thread-memory

## Meta
updated: 2026-09-14 18:25
id: 4e815b9c-6a1a-4293-8f67-827d057a62e1
thread: doc lifecycle and cross-doc tabs
scope: src/core/**, skills/gdocsmith/**
topics: doc copy, rename, trash, delete, cross-doc clone, cross-doc move, tab extract, lossy replication, error formatting, direct rest api
counts: 7 decision, 0 rejected, 2 footgun, 0 open

## 2026-09-14 00:00 decision
Direct Google Docs & Drive REST API with gws auth (no CLI fallback)
context: wrapping gws CLI for batchUpdate/getDocument/files added subprocess spawn latency, keyring decryption delay (~500ms-1.8s per call), and stdout scraping
decision: call Google Docs v1 and Drive v3 REST APIs directly via fetch(), caching OAuth access tokens refreshed via https://oauth2.googleapis.com/token from gws credentials; no fallback to gws CLI subprocesses on failure — failures surface actionable errors directly
paths: src/core/auth.ts, src/core/gws.ts, src/core/config.ts

## 2026-09-14 00:00 decision
Document lifecycle as workflow steps
context: agents dropped to raw gws drive/docs, then fell into raw batchUpdate/python index math
decision: gdocsmith run is the single front door: docCreate, docOpen, docRename, docTrash, and docDelete workflow steps
paths: src/core/actions/docCreate.ts, src/core/actions/docRename.ts, src/core/actions/docTrash.ts, src/core/actions/docDelete.ts, src/core/gws.ts

## 2026-09-14 00:00 decision
Soft-delete as default for doc delete and trash
context: hard file delete is irreversible if an agent misidentifies an ID
decision: doc trash and doc delete both default to Drive trash (recoverable 30 days); doc delete requires --permanent to purge
paths: src/core/actions/docDelete.ts, src/core/actions/docTrash.ts

## 2026-09-14 00:00 decision
Cross-doc tab clone and move
context: Google Docs web UI has no cross-doc tab duplicate, and REST API has no duplicateTab
decision: tab clone supports --from-doc <id>; tab move supports --to-doc <id>; tab extract creates a new standalone doc from a tab
paths: src/core/actions/tabCreate.ts

## 2026-09-14 00:00 decision
MIME type guardrail for Drive file actions
context: gdocsmith should not accidentally mutate folders, sheets, or non-docs
decision: assertGoogleDocMime checks application/vnd.google-apps.document before copy/rename/trash/delete; --force to bypass
paths: src/core/gws.ts

## 2026-09-14 00:00 decision
Lossy tab replication with placeholders and warnings
context: Docs API has no duplicateTab; images, smart chips, and comments cannot be natively transferred
decision: replace images with visible [Image] text placeholders, flatten chips to text/links, return replication stats & warnings in JSON
paths: src/core/actions/tabCreate.ts, skills/gdocsmith/SKILL.md

## 2026-09-14 00:00 decision
Actionable Google API error formatting
context: raw gws JSON error dumps caused repetitive loops or confusing traces for agents
decision: formatGwsError transforms 403, 404, 401 into clear actionable messages naming the target ID and remedy
paths: src/core/gws.ts

## 2026-09-14 00:00 footgun
Cross-doc move must copy before delete
fails: if destination write fails (quota, permissions, network), deleting source first causes unrecoverable data loss
paths: src/core/actions/tabCreate.ts

## 2026-09-14 00:00 footgun
Deleting the only tab in a document
fails: Google Docs API refuses deleteTab when document has only one tab remaining
paths: src/core/actions/tabCreate.ts
