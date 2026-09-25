# Comments And Suggestions

Comments and suggestions are safety-sensitive because the Google Docs API cannot
re-anchor them after a destructive rewrite.

## Behavior

- The engine loads unresolved Drive comment quotes when a plan deletes text.
- Exact quote matches are checked across tabs; ambiguous duplicates are treated
  conservatively.
- Suggested content is marked protected in the model.
- A step that would remove a linked heading, comment quote, suggestion, or named
  range is refused before live sending unless that step has force.

## Editing Guidance

Use the smallest anchor and prefer an `edit` or a diff-based `write` over a broad
replacement. Unchanged blocks generate no requests, which keeps surrounding
comment and suggestion anchors stable.

If a refusal is intentional, show the user the finding and ask before adding
force. After a partial failure, query the document again before trying another
change.