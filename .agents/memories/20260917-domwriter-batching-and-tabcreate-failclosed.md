# Made with /thread-memory

## Meta
updated: 2026-09-18 08:40
id: ebd1bd3a-7d2e-411e-b487-01b14c133f7c
thread: DomWriter batching tabCreate fail-closed permissions plugins
scope: src/core/applyScript.ts, src/core/dom/write.ts, src/core/actions/tabCreate.ts, src/core/actions/**, skills/gdocsmith/SKILL.md, .cursor-plugin/**, .claude-plugin/**
topics: DomWriter flush, tabCreate force, t.0 500, docPermission, plugin manifests, dryRun optional, argsbarg halt
counts: 10 decision, 2 rejected, 3 footgun

## 2026-09-17 00:00 decision
DomWriter accumulates mutations until workflow flush
context: sequential run steps triggered N+1 getDocument and batchUpdate round trips per step
decision: applyScriptExecute stages DomWriter mutations in memory and flushes one batchUpdate per document at script completion via pendingWritersFlush
paths: src/core/applyScript.ts, src/core/dom/write.ts, src/core/actions/flush.ts

## 2026-09-17 00:00 decision
Consolidated docCreate and tabCreate step kinds
context: overlapping docCopy, tabAdd, tabDuplicate, tabCopy steps confused agents
decision: docCreate with optional fromDoc clones documents; tabCreate with optional fromTab clones tabs; require as alias on create steps
paths: src/core/workflowTypes.ts, src/core/actions/docCreate.ts, src/core/actions/tabCreate.ts

## 2026-09-17 00:00 decision
tabCreate fail-closed on uncreatable tab content
context: Docs REST API cannot duplicate Drive-only images, equations, footnotes, unsupported chips, TOC, or horizontal rules natively
decision: tabCreate with fromTab rejects by default with first-line counts and UI Duplicate guidance; force true allows lossy conversion; person, date, richLink chips and public https images copy natively
paths: src/core/actions/tabCreate.ts, src/core/dom/clone.ts, skills/gdocsmith/SKILL.md

## 2026-09-17 00:00 decision
Set final tab titles at tabCreate time
context: Google Docs API returns HTTP 500 on tabRename and tabMove for some template docs lacking root t.0
decision: document in schema and skill that callers should pass final title on tabCreate; tabRename attempts API then surfaces web UI guidance on 500
paths: src/core/actions/tabCreate.ts, src/core/actions/tabRename.ts, src/core/workflowTypes.ts

## 2026-09-17 00:00 decision
Drive permission workflow steps
context: agents dropped to raw Drive API for sharing after doc edits
decision: docPermissionAdd, docPermissionList, and docPermissionRemove step kinds wrap Drive permissions with typed roles and scopes
paths: src/core/actions/docPermissionAdd.ts, src/core/actions/docPermissionList.ts, src/core/actions/docPermissionRemove.ts, src/core/gws.ts

## 2026-09-17 00:00 decision
Cursor and Claude plugin manifests in repo
context: MCP distribution needed local plugin install without manual JSON editing
decision: ship .cursor-plugin/plugin.json, mcp.json, .claude-plugin/plugin.json, .mcp.json, and scripts/mcp.mjs Node bundle; just install-plugin-cursor syncs dev tree
paths: .cursor-plugin/plugin.json, .claude-plugin/plugin.json, scripts/mcp.mjs, justfile

## 2026-09-17 00:00 decision
When to Halt on argsbarg gaps
context: agents patched around framework MCP and headless limitations inside gdocsmith
decision: AGENTS.md When to Halt stops work and reports upstream; fixes belong in bun-argsbarg not compensating shims here
paths: AGENTS.md

## 2026-09-17 00:00 decision
dryRun is diagnostic not mandatory
context: skill text forced dryRun true before every mutation and caused agent loops
decision: execute mutations directly; dryRun true optional for diff preview when troubleshooting; remove mandatory dry-run guidance from skill and MCP docs
paths: skills/gdocsmith/SKILL.md, src/commands/run/command.ts, CHANGELOG.md

## 2026-09-17 00:00 decision
Multi-step run is the primary agent surface
context: agents issued many separate MCP calls and lost alias session state
decision: one gdocsmith run JSON with steps array binds doc aliases for the whole workflow; document canonical recipes in skill
paths: skills/gdocsmith/SKILL.md, src/commands/run/command.ts

## 2026-09-17 00:00 decision
pageSetup workflow step for layout mode
context: agents could not toggle pageless vs paginated layout through run
decision: kind pageSetup with mode PAGES or PAGELESS and optional pageSetup geometry on doc or tab; query dumps detect layout mode
paths: src/core/actions/pageSetup.ts, src/core/dom/style.ts, src/core/workflowTypes.ts

## 2026-09-17 00:00 rejected
Mandatory dryRun before every write
rejected: doubled latency and stuck agents in preview loops
instead: direct execution with optional dryRun for debugging

## 2026-09-17 00:00 rejected
Work around argsbarg MCP handler gaps inside gdocsmith
rejected: duplicated headless paths and drift from framework fixes
instead: halt and fix argsbarg; status handler returns JSON via ctx.respond pattern

## 2026-09-17 00:00 footgun
tabRename on template docs without root t.0
fails: Google HTTP 500 with opaque error; post-hoc rename is unreliable
paths: src/core/actions/tabRename.ts, src/core/actions/tabMove.ts

## 2026-09-17 00:00 footgun
tabCreate fromTab without force on uncreatable leftovers
fails: silent partial copy or confusing API errors without remediation text
paths: src/core/actions/tabCreate.ts

## 2026-09-17 00:00 footgun
Per-step batchUpdate without DomWriter flush
fails: revision races, redundant downloads, and paragraph index drift mid-run
paths: src/core/applyScript.ts, src/core/dom/write.ts
