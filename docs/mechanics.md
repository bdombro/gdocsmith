# Mechanics

`run` accepts an ordered `steps` array. Every step is validated before any
document loads or changes. The ten kinds are `doc`, `edit`, `page`, `query`,
`remove`, `share`, `style`, `tab`, `table`, and `write`.

## Document References

Use a raw Google document ID or a document alias created earlier in the same run.
Aliases do not persist across runs.

| Kind | Purpose |
| --- | --- |
| `doc` | Open, create, copy, rename, trash, or permanently delete a document. |
| `tab` | Create, rename, move, or delete a tab. |
| `share` | Add, list, or remove Drive permissions. |
| `page` | Apply page mode, paper size, margins, orientation, or custom dimensions. |

## Anchors

Set exactly one anchor key.

| Anchor | Scope |
| --- | --- |
| `body` | Whole tab where the step allows it. |
| `section` | A heading and its subtree. |
| `node` | A node or a table cell anchor from a nodes query. |
| `text` | The single node containing a unique literal substring. |

If a document has more than one tab, use `tab` unless an anchor identifies one
tab unambiguously. Ambiguity is an error with candidates, never a guess.

## Content Steps

| Kind | Purpose |
| --- | --- |
| `query` | Return outline, editable markdown, or node metadata. |
| `write` | Append, insert before or after, or diff-replace markdown or copied content. |
| `edit` | Find and replace visible text; `expectCount` protects broad replacements. |
| `remove` | Remove a node, section, or whole body. |
| `style` | Apply or clear run and paragraph properties. |
| `table` | Change table rows, columns, merge state, widths, or cell style. |

`write` accepts exactly one of `markdown`, `markdownFile`, or `from`, and one
placement: `append`, `after`, `before`, or `replace`.

## Query Results

- `outline` returns headings per tab with IDs, levels, and text.
- `markdown` returns an editable lens view with frontmatter by default.
- `nodes` returns anchors, text, styles, flags, table shapes, and cell anchors.

Use `where` only with `nodes`. Filters are conjunctive: every specified filter
must match.

## Results

The result contains:

- `diff`: unified change text or a spill-file path plus per-tab counts.
- `docs`: aliases, IDs, titles, tabs, and URLs where available.
- `phases`: request counts and whether a phase was sent.
- `steps[i]`: each step's data, created items, replacement count, outline, or
  file paths.
- `warnings`: non-blocking safety findings.

## Large Output

Large step results spill to a temporary run directory. Set `saveTo` on a query
to write markdown or JSON into an absolute directory you control. Diffs over the
inline cap are saved as `diff.patch`.

## Sending

All steps run on model copies first. Live sends use revision locks and phases.
When a phase fails, the error lists what landed and what was not sent. Read the
document again before retrying.

## API Limits

Google Docs cannot recreate every object. The engine preserves unsupported
content by leaving unchanged blocks untouched and refuses destructive edits that
would lose it without explicit step-level force.