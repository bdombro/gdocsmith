# Made with /thread-memory

## Meta
updated: 2026-09-18 09:07
id: cb2235fd-5cbb-41d6-9d39-f9e6be17bc29
thread: core engine bug scan and fixes
scope: src/core/cache/**, src/core/gws.ts, src/core/dom/inlineSpecials.ts, src/core/dom/linkResolver.ts, src/core/actions/domOpFromStep.ts, src/core/actions/docCreate.ts, src/core/actions/tabCreate.ts, src/core/actions/tabDelete.ts, src/core/actions/textReplace.ts, src/core/actions/surgicalMutation.ts, CHANGELOG.md
topics: DocCache revisionIdGet, chip cloning, symbolic links, step anchors, tab lifecycle, scoped textReplace, table insert flush
counts: 9 decision, 0 rejected, 1 footgun

## 2026-09-18 09:07 decision
DocCache freshness uses Docs revisionIdGet
context: Drive files.headRevisionId is undefined for application/vnd.google-apps.document so TTL revalidation always refetched full documents
decision: DocsClient.revisionIdGet calls documents.get with fields=revisionId; DocCache hardValidateOrRefresh and revalidateInBackground compare against that value
paths: src/core/gws.ts, src/core/cache/docCache.ts

## 2026-09-18 09:07 decision
Optional InlineChip.uri in clone path
context: chipKindInfer called uri.startsWith on optional uri and threw on date or email-only person chips
decision: infer kind from chip.kind, chip.email, and optional uri; emailFromMailto accepts undefined uri
paths: src/core/dom/inlineSpecials.ts

## 2026-09-18 09:07 decision
Heading deep links from scoped ids
context: nodeHeadingIdResolve used scopedId.split(".")[0] which truncated h.heading_N.checksum to heading=h
decision: scopedIdHeadingExtract strips only the trailing checksum segment via lastIndexOf(".")
paths: src/core/dom/linkResolver.ts

## 2026-09-18 09:07 decision
Workflow anchor shorthand in domOpFromStep
context: ANCHOR_KEYS skipped at, after, before while only nodeAt, nodeAfter, nodeBefore were resolved from the step
decision: resolve mutation anchors from nodeAt ?? at, nodeAfter ?? after, nodeBefore ?? before
paths: src/core/actions/domOpFromStep.ts

## 2026-09-18 09:07 decision
docCreate respects injected Docs client
context: docCreateStep always called singleton gws.createDocument bypassing runtime.client mocks and MCP tests
decision: use runtime.client.createDocument when present else gws.createDocument
paths: src/core/actions/docCreate.ts

## 2026-09-18 09:07 decision
tabCreate blank tab fails closed on missing tabId
context: live blank tab creation fell back to virtual tab ids when addDocumentTab reply omitted tabId
decision: throw when created tabId is missing, matching the fromTab clone path
paths: src/core/actions/tabCreate.ts

## 2026-09-18 09:07 decision
tabDelete guardrail and dry-run state
context: deleting the only tab is invalid at Google; dry-run left deleted tabs in simulated state
decision: reject when one tab remains; in dry-run splice tabs, simulatedTabs, and initialMarkdownStates keys for the deleted tab
paths: src/core/actions/tabDelete.ts

## 2026-09-18 09:07 decision
Scoped textReplace with find plus anchor
context: textReplace with nodeAt or nodeUnder routed to surgical innerText and replaced the whole node ignoring find
decision: when find is set with nodeAt or nodeUnder, use regexReplaceExecute live and neighborhood-scoped substring replace in dry-run
paths: src/core/actions/textReplace.ts, src/core/replace.ts

## 2026-09-18 09:07 decision
Table insert detection in elements array
context: surgicalMutation only flushed for insertAdjacentElement.element kind table, not elements arrays
decision: mutationContainsTable checks both element and elements for table specs before and after flush
paths: src/core/actions/surgicalMutation.ts

## 2026-09-18 09:07 footgun
Drive headRevisionId on Google Docs for cache freshness
fails: always undefined for native Docs mime type so cache SWR treats every entry as stale and re-downloads the full document
paths: src/core/cache/docCache.ts, src/core/gws.ts
