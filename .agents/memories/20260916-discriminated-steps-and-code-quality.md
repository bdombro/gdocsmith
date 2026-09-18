# Made with /thread-memory

## Meta
updated: 2026-09-18 08:40
id: 3854fcba-ba78-4d16-a0bb-440f9674d070
thread: discriminated workflow steps and code quality baseline
scope: src/core/workflowTypes.ts, src/core/**, AGENTS.md, CHANGELOG.md, docs/**
topics: stepKind union, legacy removal, AGENTS code quality, query export, nested lists, rename gws-docs-edit
counts: 6 decision, 2 rejected, 1 footgun

## 2026-09-16 00:00 decision
Discriminated union on workflow step kind
context: flat GdocsmithStepInput let optional fields collide across unrelated step kinds and weakened MCP JSON Schema required arrays
decision: GdocsmithStepInput is a discriminated union on kind with per-variant Step* interfaces; content mutations split into explicit step types (markdownInsert, replaceSection, replaceMarkdown, replace, textReplace, sectionCopy, remove, surgical)
paths: src/core/workflowTypes.ts, src/commands/run/command.ts, src/core/actions/domOpFromStep.ts

## 2026-09-16 00:00 decision
Remove legacy step kind aliases at runtime
context: pre-MCP skill used alternate kind strings kept for backwards compat
decision: drop legacy kind mapping in stepKind and related shims; app is unreleased so no backwards compatibility layer
paths: src/core/actions/stepKind.ts

## 2026-09-16 00:00 decision
Align src with AGENTS.md code quality rules
context: large refactor left inconsistent JSDoc, import order, file headers, and naming
decision: enforce single-line file responsibility comments, alphabetical imports, ref-oriented names (docCreate not createDoc), and JSDoc on exported and module-private symbols except tests and generated code
paths: AGENTS.md, src/core/**, scripts/**

## 2026-09-16 00:00 decision
Query dumps include markdown and outline formats
context: agents needed whole-doc or tab markdown export and heading maps without raw batchUpdate
decision: kind query with output markdown, outline, nodes, or headings (headings aliases outline) writes into dumped[as] for downstream steps
paths: src/core/actions/query.ts, src/core/dom/export.ts, src/core/dom/query.ts

## 2026-09-16 00:00 decision
Nested ordered list numbering in markdown export
context: interleaved nested bullets reset ordered list markers to 1. for every item
decision: nodesRenderToMarkdown tracks contiguous ordered list depth so numbering continues correctly across nested runs
paths: src/core/dom/export.ts

## 2026-09-16 00:00 decision
Rename product from gws-docs-edit skill to gdocsmith
context: MCP-first argsbarg app replaced the standalone skill repo layout
decision: user-facing name gdocsmith; repository skill at skills/gdocsmith/SKILL.md; remove stale gws-docs-edit references in docs and packaging
paths: skills/gdocsmith/SKILL.md, README.md, docs/**, CHANGELOG.md

## 2026-09-16 00:00 rejected
Keep flat workflow step interface for simpler JSON authoring
rejected: one object with many optional fields agents could omit or misuse across kinds
instead: discriminated union with strict per-kind required fields in generated MCP schema

## 2026-09-16 00:00 rejected
Retain legacy step kind strings indefinitely
rejected: dual naming confused agents and duplicated handler routing
instead: single canonical WorkflowStepKind enum aligned with MCP inputSchema

## 2026-09-16 00:00 footgun
Using integer tape indexes as write targets
fails: indexes shift after every batchUpdate; agents corrupt unrelated paragraphs
paths: src/core/dom/query.ts, skills/gdocsmith/SKILL.md
