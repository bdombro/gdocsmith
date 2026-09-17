# Why these guards exist

For humans. Agents follow [runbook-diagram.md](runbook-diagram.md).

Raw Docs API edits are UTF-16 indexes. Agents treat that like editing XML as text: wrong range, write into a heading, apply a snapshot after the Doc moved. gdocsmith hides indexes and refuses those shapes.

Taste: [style.md](style.md). Selectors / ops: [mechanics.md](mechanics.md).

## Drift (the corruption case)

Apply no longer locks on Google `revisionId` (autosave caused false rejects). Drive `pinHead` before mutation is **undo** via Version history.

| If | Then |
|----|------|
| Missing `documentId` / no open doc | Refuse. Use `kind: open` or `documentId`. |
| Multi-tab write missing `tab` | Set `tab:` on the step (`id` or unique title). |
| `batchUpdate` times out | Not retried. A success + retry would double-apply. `get` still retries. |

`at` is a snapshot id from **this** `kind: query`. After a live run those ids name different nodes. Discard spent ids; query again.

Two agents on the **same** Doc: last write wins; restore the pinned Drive revision if needed.

## Agent mistakes the API catches

| Agent does | gdocsmith does |
|------------|----------------|
| Pass UTF-16 `start` as `at` | `at` is snapshot id only. A leftover offset like `4457` errors (“looks like a leftover startIndex”). Query never prints `start`. |
| Guess the tape / skip query | Loop: `kind: query` + `dump`, then mutate using those ids. |
| Coarse range delete + insert | Surgical steps only: one node, one action. Use `replaceSection` to diff and preserve unchanged nodes. |
| `insertAdjacentElement("afterbegin")` into a heading | Refused. Siblings only (`beforebegin` / `afterend`). `innerText` does not change `namedStyleType`. |
| Assume headings wrap body | Refused. Headings do not wrap body. Use `under:` to query section neighborhoods. |
| Ambiguous query | Throws with matches. Write steps still need `at`. |
| `createElement("ul")` / paste `- item` | Unknown kind / fake-bullet refuse. Real `bullet` + `nestingLevel`; glyph not in the text. |
| Bullet on a heading, empty `"-"`, or `"1. "` with `bullet` | Refused (`assertWritable`). Placeholder: `"<item>"`. |
| `remove` the last paragraph | Refused (Docs trailing newline). `innerText` to clear. |
| Demolish-and-rebuild (delete section & re-insert) | Refused by Anti-Demolition Guard if nodes are identical. Use `replaceSection` for diff-preserving updates, or `replaceMarkdown` / `markdownInsert`. |
| Retry the same file after failure | Indexes moved. Stop. Restore pin if half-written. New query. |
| Inherit bold from a template placeholder | Insert/innerText clear inline styles, then apply markup. |
| Nest a list by setting only `indentStart` | Apply prefixes leading tabs from `nestingLevel`, then `createParagraphBullets`. |
| Restyle indent only on insert | `style.indentStart` / `indentFirstLine` work on existing paragraphs too. Flush L0: 18 / 0. Plan warns hanging and shared `listId`. |
| Type `1.` / a custom “Step 1” prefix | Preset on insert or `{ "at", "bullet": { "preset" } }`. Glyph text and start-at-N are not in the API. |
| Change `nestingLevel` on an existing item | Refused (tabs already stripped). Insert a new item at the desired level. |
| `innerText` a chip paragraph | Allowed. Plan warns — chips are destroyed. Query prints `chips[]`. |
| `insertTable` + `remove` (or other node edits) in one apply | Refused. Live indexes shift by 1; a real table is larger, so later removes hit the new table. |
| `insertTable` `afterend` of a heading | Plan warns. Splits an empty `HEADING_*` that Docs will not delete. Insert after a NORMAL_TEXT sibling. |
| `tableAlignment` / center a table on page | Refused / warned. Docs API has no table page-alignment property; `alignment` styles cell text only. Use fixed `columnWidth`. |
| `createElement("columnBreak" / "horizontalRule" / "equation" / "toc")` | Refused (`assertWritable`). REST API has no insert request for these kinds. |

One Docs `batchUpdate` is atomic. If Google cites `requests[n]`, the error names `ops[i]`. Table insert + cell fill is **two** calls — not one transaction; pin covers restore. Table insert + `remove` of old siblings is refused (not a transaction problem — live indexes are wrong).

## What still can go wrong

- Table fill fails after the table exists → empty table. Restore the pin.
- Insert the table (optional `style` on that table), query, then fill cells or remove neighbors.
- Half-written table → Docs **File → Version history** (Drive pin). Do not keep patching. API cannot roll a native Doc back.
- Walk `nodes` and use `at`. Snapshot ids are spent after apply; judgement is the tape you saw.
- `innerText` keeps inline images in that paragraph; `remove` deletes the paragraph and the image.
- Move / resize / insert a new image needs Script API permission. Those commands fail with a permission message — Docs UI until then.
- Shared `workflow.yaml` path on one machine: last writer wins on disk. `kind: open` / `documentId` is the target Doc.
- `force: true` on the run document skips glyph/empty-bullet guards. Only if the user asked.

Fail closed ≠ the Doc is never wrong. It means we refuse instead of silently writing onto a moved tape. If a write did land and looks half-done: Version history, then query again.
