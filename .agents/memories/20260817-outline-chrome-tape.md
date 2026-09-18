# Made with /thread-memory

## Meta
updated: 2026-08-17 16:10
id: d2a5f93a-5924-4f58-94e5-bf07df29971c
thread: outline chrome tape guards
scope: src/core/**, skills/gdocsmith/**, docs/**
topics: outline, query --at, header, footer, tape guard
counts: 3 decision, 5 rejected, 2 footgun, 2 open

## 2026-08-17 00:00 decision
Happy path outline then query --at
context: fuzzy selectors skipped sectionBreak and false-positive tables
decision: outline = map (not apply-ready); query --at = node + following siblings until next same-or-higher heading (includes sectionBreak); CLI refuses :contains
paths: src/core/actions/query.ts, src/core/actions/query.ts, docs/runbook-diagram.md

## 2026-08-17 00:00 decision
Header and footer separate leaves
context: chrome is not body.content; id collision at 1
decision: body query/apply body-only; header query/apply and footer query/apply; files stamp tape + segmentId; outline previews chrome only
paths: src/core/dom/query.ts, src/core/dom/apply.ts, src/program.ts

## 2026-08-17 00:00 decision
Tape-mismatch guard on apply
context: header query JSON looks like body apply file; header at 1 is not body at 1
decision: body apply refuses tape header/footer or segmentId; header/footer apply refuses body files
paths: src/core/dom/apply.ts

## 2026-08-17 00:00 rejected
outline --at for section walk
rejected: duplicate of query --at neighborhood
instead: outline for map; query --at for apply-ready slice

## 2026-08-17 00:00 rejected
HEADING ~ * or :contains to find headings
rejected: skips sectionBreak; spills past section; fuzzy match
instead: outline for ids; query --at; CLI refuses :contains on query

## 2026-08-17 00:00 rejected
Bare selector table or image as happy path
rejected: document-global false positives
instead: outline then query --at from seen ids

## 2026-08-17 00:00 rejected
Mixed header ops in body apply file
rejected: not a supported apply state
instead: header apply / footer apply on that tape's query file

## 2026-08-17 00:00 rejected
TOON for skill memory prose
rejected: long fields don't table well
instead: labeled compact stanzas (this file)

## 2026-08-17 00:00 footgun
Body apply on header query file
fails: writes body node 1 (often TITLE), not the header
paths: src/core/dom/apply.ts

## 2026-08-17 00:00 footgun
Header ids restart at 1 per tape
fails: at 1 on header tape ≠ at 1 on body tape
paths: src/core/dom/query.ts, .agents/memories/

## 2026-08-17 00:00 open
Footnote leaf
open: footnoteIds on body paragraphs only; no footnote query/apply yet

## 2026-08-17 00:00 open
Comments and suggestion mode
open: not in current surgical API
