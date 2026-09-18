# Made with /thread-memory

## Meta
updated: 2026-08-17 16:10
id: 95215a83-5e3e-41f4-91c4-b4276fd942c2
thread: surgical docs API foundation
scope: src/core/**, skills/gdocsmith/**, docs/**
topics: in-place apply, copied at, drift lock, cell ids, images, style
counts: 14 decision, 1 rejected, 3 footgun, 0 open

## 2026-08-14 00:00 decision
Surgical in-place API
context: raw offsets and AST/outline/patch were error-prone
decision: query JSON is the apply file; fill ops; apply once; discard; no retry; not markdown create/append (gws-docs-write)
paths: skills/gdocsmith/SKILL.md, docs/runbook-diagram.md, src/core/dom/ops.ts, src/core/dom/apply.ts

## 2026-08-14 00:00 decision
User URL or id wins
context: agents swapped Docs for README links, Drive hits, or older clones
decision: the id/URL in the user message is the Doc; confirm with outline on that id before writes
paths: skills/gdocsmith/SKILL.md, docs/runbook-diagram.md

## 2026-08-14 00:00 decision
Scope — only change what was asked
context: restyles bumped metadata and touched unrelated files
decision: edit only what the user asked; skill copy stays generic (no project-specific examples in agent rules)
paths: docs/style.md

## 2026-08-14 00:00 decision
Writes use copied at only
context: write-side select/title/text invented targets
decision: every op needs at from this query; refuse cell/para/segmentId on ops; query never prints API start; ids are 1…n per tape
paths: src/core/dom/ops.ts, docs/mechanics.md

## 2026-08-14 00:00 decision
Namespaced cell ids
context: cells are not body siblings; cell+para fields were inventable
decision: --full prints id "18.0.1" and "18.0.1.1"; writes use at on those strings; both are valid targets
paths: src/core/dom/ops.ts, src/core/dom/parse.ts, docs/mechanics.md

## 2026-08-14 00:00 decision
Drift lock and Drive pin
context: stale snapshots corrupt live Docs
decision: apply refuses revision mismatch; requiredRevisionId on batchUpdate; no retry; pin is undo only; --force only when user asked
paths: docs/guards.md, src/core/dom/apply.ts, src/core/dom/apply.ts

## 2026-08-14 00:00 decision
Native style on same ops
context: invented write fields vs Google namedStyleType
decision: style hex #RRGGBB; alignment folds into style; innerText+style allowed; insert/remove exclusive; BULLET_CHECKBOX; pageBreak element
paths: src/core/dom/style.ts, src/core/requests.ts, src/core/dom/ops.ts

## 2026-08-14 00:00 decision
Columns report count only
context: Format→Columns is sectionBreak.columnCount, not a table
decision: outline/query report columnCount; no invented newspaper layout in JSON
paths: src/core/dom/parse.ts, docs/mechanics.md

## 2026-08-14 00:00 decision
Images on tape; insert gated
context: agents treated images as siblings or move-by-kix
decision: inline in paragraph/cell; innerText keeps; remove deletes; no move-by-id; new insert needs Script API or Docs UI; images.md humans-only
paths: docs/images.md, skills/gdocsmith/SKILL.md

## 2026-08-14 00:00 decision
Agent vs human docs
context: agents read generated CLI dumps and permission essays
decision: agents SKILL→runbook→style; mechanics when unclear; not cli.md or images.md; print what will change before live edit
paths: README.md, skills/gdocsmith/SKILL.md

## 2026-08-14 00:00 decision
markup on --full when differs from text
context: linked headings looked different in outline vs live
decision: compact query uses plain text; --full adds markup when different; writes still use copied at
paths: src/core/dom/parse.ts, src/core/dom/ops.ts

## 2026-08-14 00:00 decision
Dry-run duplicate-neighbor warning
context: inserts duplicated text already next door
decision: plan warns when neighbor plain text matches insert; query neighbors first; do not block same-file afterend chaining
paths: src/core/dom/ops.ts, docs/runbook-diagram.md

## 2026-08-14 00:00 decision
innerText before snippet inserts across passes
context: one batch mixed innerText and inserts; sibling selectors used pre-insert tape
decision: innerText apply first, re-query, then inserts — or chain afterend only off nodes created in same file
paths: docs/runbook-diagram.md

## 2026-08-14 00:00 decision
Lies vs compact dumps
context: shortcuts misrepresented Docs structure
decision: undo first-para-only cells and parsed string[][] lies; keep compact/--full and truncated heading echo; accurate list-as-sibling-paragraphs model
paths: src/core/dom/parse.ts, src/core/dom/ops.ts

## 2026-08-14 00:00 rejected
Write-side select title text cell para segmentId
rejected: inventable multi-field targeting
instead: single copied at (including "18.0.1")

## 2026-08-14 00:00 footgun
Stale revisionId
fails: silent write to wrong paragraphs if apply not refused
paths: docs/guards.md

## 2026-08-14 00:00 footgun
Linked heading outline text
fails: outline label ≠ query text/markup; wrong neighbor match
paths: src/core/dom/parse.ts, src/core/dom/export.ts

## 2026-08-14 00:00 footgun
innerText and inserts one batch without re-query
fails: sibling selectors resolve on old tape
paths: docs/runbook-diagram.md
