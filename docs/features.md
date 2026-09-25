# Features And Limits

## Supported

| Area | Capability |
| --- | --- |
| Documents | Open, create, copy, rename, trash, and delete. |
| Tabs | Create, rename, move, delete, and seed from copied content. |
| Content | Markdown append, insertion, diff replacement, and cross-document copy. |
| Text | Visible-text find/replace with match counts. |
| Styling | Text and paragraph properties, including conditional run matching. |
| Tables | Rows, columns, merges, widths, header rows, and cell styling. |
| Sharing | Add, list, and remove Drive permissions. |
| Page layout | Pageless mode, paper size, orientation, dimensions, and margins. |
| Links | URLs plus native tab and heading links. |
| Files | Markdown export and write-back through absolute workspace paths. |

## Preserved But Not Created

Headers, footnotes, equations, drawings, charts, TOCs, bookmarks, column breaks,
positioned objects, checkbox state, and Drive-hosted image content are preserved
when untouched. The engine refuses edits that would need to recreate them.

## Safety Model

The tool plans in memory, reconciles minimal requests, emulates them, and checks
for comment, suggestion, named-range, link, identity, and unrecreatable-content
risk before live sending. A step-level `force` can waive a finding only for that
step.

## Deliberate Constraints

- no character offsets in the user-facing contract
- no compatibility aliases for removed input fields
- no run-wide force switch
- no claim that Google sends are globally atomic
- no implicit document or tab selection when ambiguity remains