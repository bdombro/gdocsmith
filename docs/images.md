# Images

For people installing or unblocking insert. Agents: existing images are on the tape ([../skills/gdocsmith/SKILL.md](../skills/gdocsmith/SKILL.md), [mechanics.md](mechanics.md)). New insert is blocked until [Unblock insert](#unblock-insert).

## What works today

No extra Google APIs. `kind: query` then mutate as usual.

| You want | Do |
|----------|----|
| Find it | `kind: query` + `dump`; look for `image` on the node. Table cells use ids like `h.arch.table.0.1.3c8f`. |
| Caption / nearby text | `kind: replace` / `innerText` on that paragraph. Table cell: `at: h.arch.table.0.1.3c8f`. Text runs are replaced; the image stays. |
| Center it | `alignment: CENTER` on that paragraph or cell (Docs aligns the paragraph, not the image object). |
| Delete it | `remove: true` with `force: true` on that paragraph (removal permanently deletes the image; the API cannot recreate it). `remove` on a table deletes every cell image in it. |
| Edit around it | `after` / `before` sibling inserts. |

`:empty` is no text **and** no images. A photo with a blank caption is not empty.

## What does not work yet

| You want | Why it fails | Until then |
|----------|----------------|------------|
| Insert a **new** image | Docs `insertInlineImage` needs a public HTTPS URL. Workspace blocks that (`publishOutNotPermitted`). | [Unblock insert](#unblock-insert), or paste in the Google Docs UI. |
| **Move** an image | `inlineObjectId` (`kix.*`) names the object **in that slot**. Delete destroys it. There is no insert-by-id. Relocate is delete + insert (new object, new id). | Same as insert. |
| **Replace** pixels in place | `replaceImage` still needs a URI. | Same as insert. |
| **Resize** | Not a Docs `batchUpdate` request. Apps Script `setWidth` / `setHeight`. | Same Script permission as insert. |

Do not retry a failed bootstrap or insert hoping permission appeared.

## Unblock insert

The default `gws` OAuth project (`gws-cli-corp-001`) does not have the **Apps Script API** enabled. Blob insert lives in `apps-script/Code.gs` (`insertImageFromDrive`). It fails with a permission message until that API is on.

After it is granted:

```bash
gws auth login --services drive,docs,sheets,gmail,calendar,presentations,tasks,script < /dev/null
```

Then smoke-test blob insert on a throwaway Doc. Config lands at `~/.config/gdocsmith/config.json` (`appsScriptId`). There is no separate `script bootstrap` CLI in gdocsmith yet — bootstrap is `src/core/appsScriptImages.ts`.

## Contributor map

| Piece | Where |
|-------|--------|
| Apps Script `insertImageFromDrive` | `apps-script/Code.gs` |
| Bootstrap + `scripts.run` | `src/core/appsScriptImages.ts` |
| Upload routing | `src/core/imageStore.ts`, `src/core/images.ts` |
