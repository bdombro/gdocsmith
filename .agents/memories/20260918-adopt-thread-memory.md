# Made with /thread-memory

## Meta
updated: 2026-09-18 08:40
id: f033fc35-ec3e-4534-8bf7-3da007e01481
thread: adopt thread-memory
scope: AGENTS.md, .agents/memories/**, CHANGELOG.md
topics: thread-memory, agent-memory, glossary, agents-md
counts: 1 decision, 0 rejected, 0 footgun

## 2026-09-18 08:20 decision
Adopt /thread-memory for persistent architectural decisions and glossary
context: Agent threads across features need a consistent way to preserve decisions, rejections, footguns, and domain glossary terms without polluting system instructions or losing historical reasoning.
decision: Adopted Brian's /thread-memory convention with .agents/memories/ in repo root, documented discovery in AGENTS.md under ## Memory, ported foundational threads from gws-docs-edit, and backfilled 2026-09-16 through 2026-09-18 session decisions from Cursor transcripts.
paths: AGENTS.md, .agents/memories/glossary.md, .agents/memories/20260814-surgical-docs-api.md, .agents/memories/20260817-outline-chrome-tape.md, .agents/memories/20260914-doc-lifecycle-cross-doc-tabs.md, .agents/memories/20260916-discriminated-steps-and-code-quality.md, .agents/memories/20260917-domwriter-batching-and-tabcreate-failclosed.md, .agents/memories/20260918-local-snapshot-cache.md, CHANGELOG.md, scripts/extractTranscriptMemoryHints.ts
