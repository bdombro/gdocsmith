# Made with /thread-memory

## Meta
updated: 2026-09-18 08:20
id: f033fc35-ec3e-4534-8bf7-3da007e01481
thread: adopt thread-memory
scope: AGENTS.md, .agents/memories/**, CHANGELOG.md
topics: thread-memory, agent-memory, glossary, agents-md
counts: 1 decision, 0 rejected, 0 footgun

## 2026-09-18 08:20 decision
Adopt /thread-memory for persistent architectural decisions and glossary
context: Agent threads across features need a consistent way to preserve decisions, rejections, footguns, and domain glossary terms without polluting system instructions or losing historical reasoning.
decision: Adopted Brian's /thread-memory convention with .agents/memories/ in repo root, documented discovery in AGENTS.md under ## Memory, and initialized glossary.md with core gdocsmith domain concepts.
paths: AGENTS.md, .agents/memories/glossary.md, CHANGELOG.md
