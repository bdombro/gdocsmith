# End-To-End Scenarios

These prompts exercise the public experience without naming implementation
fields or step kinds.

1. Read the document outline and identify the headings under a named section.
2. Replace a placeholder paragraph with a short ordered implementation plan
   without disturbing neighboring subsections.
3. Rewrite a decision section while preserving its heading and unrelated tabs.
4. Change one exact word in a specified tab and report the number of changes.
5. Copy one titled section from a source document into a destination section.
6. Add a row to a named capacity table and retain the header styling.
7. Create a new tab after a specified tab and seed it from another tab.
8. Reset a known text color in one section without changing the text itself.
9. Attempt a destructive rewrite around rich content and explain any required
   confirmation instead of forcing it.
10. Make every tab pageless and report the resulting diff.

Each scenario should inspect the returned diff, warnings, files, and per-step
result rather than infer success from tool invocation alone.