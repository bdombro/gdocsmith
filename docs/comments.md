# Comments

Load when the user asks about comments on this Doc. Not a `run` step: no `comment` field on `steps`.

Threads live on Drive (file-level, not per tab). `kind: query` / `documents.get` omit them. `anchor` is a `kix.*` id that `documents.get` does not expose (its `kix.*` values are list and person ids). Mapping a thread to `at` is a heuristic. Match quotes on the tab you queried.

## List

Same file id as the Doc URL. `fields` is required.

```bash
gws drive comments list --params '{"fileId":"<ID>","fields":"comments(id,content,htmlContent,author,resolved,quotedFileContent,assigneeEmailAddress,mentionedEmailAddresses,replies(id,content,author,action))","pageSize":100}'
```

`--page-all` if truncated. Ignore `photoLink` / `kind`. Use `content`; `htmlContent` is display (`<br>`, mailto, `<b>`).

## Quote

`quotedFileContent.value` is the highlighted text, frozen when the comment was created. `mimeType` is often `text/html`; the value is still plain — no run style.

- One paragraph: usually no newline; may be a substring of `node.text` (`WIP` in `[WIP] …`).
- Several paragraphs: `\n` joins adjacent tape siblings (not Docs' trailing paragraph `\n`).
- Later edits can make the quote disagree with live `node.text`.

`assigneeEmailAddress` and `mentionedEmailAddresses` are read-only (UI @ / assign). Resolve is a reply with `"action": "resolve"`.

## Match

`kind: query` with `contains:` on the quoted text, then `kind: dump`. Compact dumps may echo headings only.

1. Exactly one `node.text === quote` → that `at`.
2. Quote contains `\n`: split; exactly one run of consecutive nodes matching each part → those ids.
3. Exactly one node whose `text` contains `quote` → that `at`.
4. Several hits (repeated labels such as `Goal / Outcome`) → do not take `at` from the quote. Use the comment body plus outline, or leave unmatched. Say when unsure.
5. No hit → unmatched. Do not invent `at`.

Do not map `kix.*` to nodes. Do not pick the first duplicate.

Edit a matched node with `gdocsmith run`. Reply or resolve with the Drive comment `id`, not `at`.

## API cannot

| Want | Why |
|------|-----|
| Create an anchored comment | Drive `comments.create` ignores Docs anchors. The UI shows “Original content deleted”. kix ids cannot be minted. |
| @ or assign | Those fields are read-only. `@user` in `content` does not notify. |
| `run` comment steps | Not a tape step. |

Create, @, and assign in the Google Docs UI.

## Reply / resolve

Existing threads only (`id` from list):

```bash
gws drive replies create --params '{"fileId":"<ID>","commentId":"<COMMENT_ID>","fields":"id,content,action"}' --json '{"content":"<plain text>"}'
gws drive replies create --params '{"fileId":"<ID>","commentId":"<COMMENT_ID>","fields":"id,action"}' --json '{"action":"resolve"}'
```

## Edits

`innerText` / `remove` can orphan a thread (like chips). Query does not warn. List first if comments matter; do not replace that paragraph unless asked.
