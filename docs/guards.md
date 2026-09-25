# Guards

Guards run after planning and before a live send. They use the same planned model
for dry and live runs.

## Blocking Findings

| Finding | Why it blocks |
| --- | --- |
| Comment | Deleting a comment quote can orphan the comment. |
| Suggestion | Changing protected suggested content can disturb review state. |
| Named range | A deletion overlaps a named range. |
| Heading or tab link | A linked target would be removed or lose identity. |
| Unrecreatable | The operation removes content the Docs API cannot recreate. |
| List rebuild | A custom or risky list must be rebuilt. |
| View mode | The source was not loaded with the required suggestion view. |

## Warnings

Warnings identify partial comment overlap, identity changes, or lossy list
conversion. They remain visible in `warnings` but do not stop a run.

## Force

`force: true` belongs on the particular content, table, tab, style, edit, or
remove step causing the finding. It does not waive unrelated steps. Obtain user
approval before using it.

## Safe Practice

- Narrow the anchor before considering force.
- Prefer character-level text changes to broad replacement.
- Keep unchanged markdown unchanged when writing an export back.
- Query after a partial send failure; do not assume a retry starts from the old
  document state.