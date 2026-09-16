/*

Unified Flat Script Apply Engine.

Executes sequential operations with alias bindings, cross-doc queries,
and unified git diff generation for preview/dryRun.

Supported operations:
- open: { doc, as }
- close: { as }
- createDoc: { title, as }
- copyDoc: { copyFrom, title, as }
- renameDoc: { doc, title }
- trashDoc: { doc }
- deleteDoc: { doc, permanent }
- addTab: { doc, title, index, as }
- renameTab: { doc, tab, title }
- deleteTab: { doc, tab }
- insertMarkdown: { doc, tab, at/after/before, text/markdown/file, h1IsTitle }
- replaceText: { doc, tab, find, replace, under }
- query: { doc, tab, under, contains, as }
- replace / innerText / remove / element / elements / replaceMarkdown / replaceSection (surgical ops)

*/

import { readFileSync } from "node:fs";
import type {
  ApplyDocument,
  ApplyHighlightDocJson,
  ApplyHighlightHeadingJson,
  ApplyOpInput,
} from "../commands/run/types.ts";
import { exportDocumentToMarkdown } from "./dom/export.ts";
import { applyDom, applyOps, type DocNode, type DomOp, DomWriter, findNodeAt, formatUnifiedDiff } from "./dom/index.ts";
import { parseMarkdownToElements } from "./dom/markdown-parser.ts";
import { assignScopedIds, parseDocument } from "./dom/parse.ts";
import { neighborhoodFrom } from "./dom/query.ts";
import { Gdoc } from "./gdoc.ts";
import { type GwsClient, gws, gwsDrive } from "./gws.ts";
import { executeMarkdownInsert, executeYamlInsert } from "./markdown.ts";
import { RequestBuilder } from "./requests.ts";
import { DriveRevisions } from "./revisions.ts";
import { flattenTabs, resolveTab } from "./tabs.ts";

export type ScriptExecutionResult = {
  diff?: string;
  dumped: Record<string, unknown>;
  highlights: ApplyHighlightDocJson[];
  ok: boolean;
  opsCount: number;
};

type OpenDocContext = {
  alias: string;
  docId: string;
  gdoc: Gdoc;
  isVirtual?: boolean;
  pinnedRevisionId?: string;
  title: string;
};

export async function executeApplyScript(
  doc: ApplyDocument,
  opts: { client?: GwsClient; force?: boolean } = {},
): Promise<ScriptExecutionResult> {
  const dryRun = Boolean(doc.dryRun);
  const force = Boolean(doc.force || opts.force);
  const client = opts.client ?? gws;

  const ops = doc.steps ?? doc.ops ?? [];
  const openDocs = new Map<string, OpenDocContext>(); // alias -> OpenDocContext
  const docIdToAlias = new Map<string, string>(); // docId -> alias
  const aliasMap = new Map<string, string>(); // alias -> resolved id (docId, tabId, node id)
  const dumpStore = new Map<string, unknown>();
  const dumped: Record<string, unknown> = {};

  // Track initial and final markdown states per doc/tab for git-style diffs
  const initialMarkdownStates = new Map<string, string>(); // "docAlias/tabId" -> markdown
  const createdHighlights: Map<string, ApplyHighlightDocJson> = new Map();

  let activeDocAlias: string | undefined;

  function resolveAlias(val?: string | number): string | undefined {
    if (val == null) return undefined;
    const str = String(val);
    if (aliasMap.has(str)) return aliasMap.get(str)!;
    // Template string interpolation: ${var}
    return str.replace(/\$\{([^}]+)\}/g, (_, key) => aliasMap.get(key) ?? key);
  }

  function getTargetDoc(rawDocRef?: string): OpenDocContext {
    const resolved = resolveAlias(rawDocRef) ?? rawDocRef ?? activeDocAlias;
    if (!resolved) {
      if (openDocs.size === 1) {
        return openDocs.values().next().value!;
      }
      throw new Error("No active document. Use kind: open or specify doc: <alias>");
    }
    const openDoc = openDocs.get(resolved) ?? Array.from(openDocs.values()).find((d) => d.docId === resolved);
    if (!openDoc) {
      throw new Error(`Document "${resolved}" is not open or was closed`);
    }
    return openDoc;
  }

  // Auto-open initial document if documentId is provided
  if (doc.documentId) {
    const docId = Gdoc.parseId(doc.documentId);
    let title = "Document";
    let gdoc: Gdoc;
    if (dryRun) {
      gdoc = new Gdoc({ documentId: docId, revisionId: "dry-run", title }, docId);
    } else {
      gdoc = await Gdoc.load(docId, client);
      title = gdoc.data.title || title;
      const pin = await DriveRevisions.pinHead(docId, client);
      openDocs.set("main", {
        alias: "main",
        docId,
        gdoc,
        pinnedRevisionId: pin?.id,
        title,
      });
    }
    if (!openDocs.has("main")) {
      openDocs.set("main", {
        alias: "main",
        docId,
        gdoc,
        title,
      });
    }
    docIdToAlias.set(docId, "main");
    aliasMap.set("main", docId);
    activeDocAlias = "main";
  }

  async function captureDocTabState(ctx: OpenDocContext, tabId: string): Promise<string> {
    const currentGdoc = tabId ? ctx.gdoc.withTab(tabId) : ctx.gdoc;
    const parsed = parseDocument(currentGdoc);
    const exp = exportDocumentToMarkdown([{ nodes: parsed.nodes, tabId, tabTitle: parsed.title }]);
    return exp.markdown;
  }

  let opsExecuted = 0;

  for (let i = 0; i < ops.length; i++) {
    const rawOp = ops[i]!;
    const opType = stepKind(rawOp) ?? inferOpType(rawOp);

    switch (opType) {
      case "open": {
        const rawDocId = rawOp.doc ?? rawOp.docId;
        if (!rawDocId) throw new Error(`steps[${i}] open requires doc: <docId>`);
        const as = rawOp.as;
        if (!as) throw new Error(`steps[${i}] open requires "as: <alias>"`);

        const docId = Gdoc.parseId(resolveAlias(rawDocId)!);
        let gdoc: Gdoc;
        let title = "Document";
        let pinnedRevisionId: string | undefined;

        if (dryRun) {
          gdoc = new Gdoc({ documentId: docId, revisionId: "dry-run", title }, docId);
        } else {
          gdoc = await Gdoc.load(docId, client);
          title = gdoc.data.title || title;
          const pin = await DriveRevisions.pinHead(docId, client);
          pinnedRevisionId = pin?.id;
        }

        const openContext: OpenDocContext = {
          alias: as,
          docId,
          gdoc,
          pinnedRevisionId,
          title,
        };
        openDocs.set(as, openContext);
        docIdToAlias.set(docId, as);
        aliasMap.set(as, docId);
        dumpStore.set(as, { id: docId, title });
        activeDocAlias = as;

        // Capture initial states of all tabs for diffing
        const tabs = flattenTabs(gdoc.data.tabs);
        const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
        for (const t of tabsToCheck) {
          const key = `${as}/${t.tabId}`;
          if (!initialMarkdownStates.has(key)) {
            const md = await captureDocTabState(openContext, t.tabId);
            initialMarkdownStates.set(key, md);
          }
        }
        opsExecuted++;
        break;
      }

      case "close": {
        const as = rawOp.as ?? rawOp.doc;
        if (!as) throw new Error(`steps[${i}] close requires "as: <alias>" or "doc: <alias>"`);
        const resolved = resolveAlias(as) ?? as;
        const entry = openDocs.get(resolved) ?? Array.from(openDocs.values()).find((d) => d.docId === resolved);
        if (entry) {
          openDocs.delete(entry.alias);
          docIdToAlias.delete(entry.docId);
          aliasMap.delete(entry.alias);
          if (activeDocAlias === entry.alias) {
            activeDocAlias = openDocs.keys().next().value;
          }
        }
        opsExecuted++;
        break;
      }

      case "createDoc": {
        const title = rawOp.title ?? "Untitled Document";
        const as = rawOp.as;
        if (!as) throw new Error(`steps[${i}] createDoc requires "as: <alias>"`);

        let newDocId = `virtual:${as}`;
        if (!dryRun) {
          const res = await gws.createDocument(title);
          newDocId = res.documentId;
        }

        const gdoc = new Gdoc(
          {
            body: {
              content: [
                { endIndex: 1, sectionBreak: {}, startIndex: 0 },
                {
                  endIndex: 2,
                  paragraph: { elements: [{ textRun: { content: "\n" } }] },
                  startIndex: 1,
                },
              ],
            },
            documentId: newDocId,
            title,
          },
          newDocId,
        );

        const openContext: OpenDocContext = {
          alias: as,
          docId: newDocId,
          gdoc,
          isVirtual: dryRun,
          title,
        };

        openDocs.set(as, openContext);
        docIdToAlias.set(newDocId, as);
        aliasMap.set(as, newDocId);
        dumpStore.set(as, { id: newDocId, title });
        activeDocAlias = as;

        initialMarkdownStates.set(`${as}/t.0`, "");

        createdHighlights.set(as, {
          as,
          id: newDocId,
          tabs: [{ id: "t.0", title: "Main" }],
          title,
        });

        opsExecuted++;
        break;
      }

      case "copyDoc": {
        const copyFrom = resolveAlias(rawOp.copyFrom ?? rawOp.doc);
        if (!copyFrom) throw new Error(`steps[${i}] copyDoc requires copyFrom: <docId>`);
        const title = rawOp.title ?? "Copy of Document";
        const as = rawOp.as;
        if (!as) throw new Error(`steps[${i}] copyDoc requires "as: <alias>"`);

        let newDocId = `virtual:${as}`;
        let gdoc: Gdoc;

        if (dryRun) {
          gdoc = new Gdoc({ documentId: newDocId, title }, newDocId);
        } else {
          const res = await gwsDrive.copyFile(copyFrom, title);
          newDocId = res.id;
          gdoc = await Gdoc.load(newDocId, client);
        }

        const openContext: OpenDocContext = {
          alias: as,
          docId: newDocId,
          gdoc,
          isVirtual: dryRun,
          title,
        };

        openDocs.set(as, openContext);
        docIdToAlias.set(newDocId, as);
        aliasMap.set(as, newDocId);
        dumpStore.set(as, { id: newDocId, title });
        activeDocAlias = as;

        createdHighlights.set(as, {
          as,
          id: newDocId,
          title,
        });

        opsExecuted++;
        break;
      }

      case "renameDoc": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const newTitle = rawOp.title;
        if (!newTitle) throw new Error(`steps[${i}] renameDoc requires title: <string>`);

        if (!dryRun) {
          await gwsDrive.updateFile(targetDoc.docId, { name: newTitle });
        }
        targetDoc.title = newTitle;
        opsExecuted++;
        break;
      }

      case "trashDoc": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        if (!dryRun) {
          await gwsDrive.updateFile(targetDoc.docId, { trashed: true });
        }
        openDocs.delete(targetDoc.alias);
        opsExecuted++;
        break;
      }

      case "deleteDoc": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        if (!dryRun) {
          if (rawOp.permanent) {
            await gwsDrive.deleteFile(targetDoc.docId);
          } else {
            await gwsDrive.updateFile(targetDoc.docId, { trashed: true });
          }
        }
        openDocs.delete(targetDoc.alias);
        opsExecuted++;
        break;
      }

      case "addTab": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const title = rawOp.title;
        if (!title) throw new Error(`steps[${i}] addTab requires title: <string>`);
        const as = rawOp.as;

        let newTabId = `virtual:tab_${as ?? targetDoc.alias}_${opsExecuted}`;
        if (!dryRun) {
          const req = RequestBuilder.addDocumentTab(title, { index: rawOp.index });
          const resStr = await gws.batchUpdate(targetDoc.docId, [req]);
          const res = JSON.parse(resStr || "{}");
          newTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId ?? newTabId;
          targetDoc.gdoc = await Gdoc.load(targetDoc.docId, client);
        } else {
          // Virtual tab in dry run
          const existingTabs = targetDoc.gdoc.data.tabs ?? [];
          const newDocTab = {
            documentTab: {
              body: {
                content: [
                  { endIndex: 1, sectionBreak: {}, startIndex: 0 },
                  {
                    endIndex: 2,
                    paragraph: { elements: [{ textRun: { content: "\n" } }] },
                    startIndex: 1,
                  },
                ],
              },
            },
            tabProperties: {
              index: rawOp.index ?? existingTabs.length,
              tabId: newTabId,
              title,
            },
          };
          targetDoc.gdoc = new Gdoc(
            {
              ...targetDoc.gdoc.data,
              tabs: [...existingTabs, newDocTab],
            },
            targetDoc.docId,
          );
        }

        if (as) {
          aliasMap.set(as, newTabId);
        }

        initialMarkdownStates.set(`${targetDoc.alias}/${newTabId}`, "");

        let docHighlight = createdHighlights.get(targetDoc.alias);
        if (!docHighlight) {
          docHighlight = { as: targetDoc.alias, id: targetDoc.docId, tabs: [], title: targetDoc.title };
          createdHighlights.set(targetDoc.alias, docHighlight);
        }
        docHighlight.tabs = docHighlight.tabs ?? [];
        docHighlight.tabs.push({ as, id: newTabId, title });

        opsExecuted++;
        break;
      }

      case "renameTab": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const tabHint = resolveAlias(rawOp.tab ?? rawOp.tabId);
        if (!tabHint) throw new Error(`steps[${i}] renameTab requires tab: <id|title>`);
        const title = rawOp.title;
        if (!title) throw new Error(`steps[${i}] renameTab requires title: <string>`);

        if (!dryRun) {
          const resolved = resolveTab(targetDoc.gdoc.data, tabHint);
          if (!resolved.tabId) {
            throw new Error(`Cannot rename tab "${tabHint}": resolved tab has no tabId`);
          }
          const req = RequestBuilder.renameTab(resolved.tabId, title);
          await gws.batchUpdate(targetDoc.docId, [req]);
          targetDoc.gdoc = await Gdoc.load(targetDoc.docId, client);
        }
        opsExecuted++;
        break;
      }

      case "deleteTab": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const tabHint = resolveAlias(rawOp.tab ?? rawOp.tabId);
        if (!tabHint) throw new Error(`steps[${i}] deleteTab requires tab: <id|title>`);

        if (!dryRun) {
          const resolved = resolveTab(targetDoc.gdoc.data, tabHint);
          if (!resolved.tabId) {
            throw new Error(`Cannot delete tab "${tabHint}": resolved tab has no tabId`);
          }
          const req = RequestBuilder.deleteTab(resolved.tabId);
          await gws.batchUpdate(targetDoc.docId, [req]);
          targetDoc.gdoc = await Gdoc.load(targetDoc.docId, client);
        }
        opsExecuted++;
        break;
      }

      case "insertMarkdown": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const tabHint = resolveAlias(rawOp.tab ?? rawOp.tabId);

        let markdown = rawOp.text ?? rawOp.markdown;
        if (!markdown && rawOp.file) {
          markdown = rawOp.file === "-" ? readFileSync(0, "utf8") : readFileSync(rawOp.file, "utf8");
        }
        if (!markdown) {
          throw new Error(`steps[${i}] insertMarkdown requires text: or file:`);
        }

        const anchorId = resolveAlias(rawOp.at ?? rawOp.after ?? rawOp.before);
        const position = rawOp.before != null ? "beforebegin" : "afterend";
        const h1IsTitle = Boolean(rawOp.h1IsTitle);

        if (!dryRun) {
          const isYaml = markdown.trimStart().startsWith("nodes:") || markdown.trimStart().startsWith("- kind:");

          if (isYaml) {
            await executeYamlInsert({
              anchorId,
              client,
              documentId: targetDoc.docId,
              force,
              position,
              tabHint,
              yaml: markdown,
            });
          } else {
            await executeMarkdownInsert({
              anchorId,
              client,
              documentId: targetDoc.docId,
              force,
              h1IsTitle,
              markdown,
              position,
              tabHint,
            });
          }
          targetDoc.gdoc = await Gdoc.load(targetDoc.docId, client);
        } else {
          // Dry-run simulation on in-memory Gdoc
          const liveTab = targetDoc.gdoc.data.tabs?.length
            ? resolveTab(targetDoc.gdoc.data, tabHint)
            : { tabId: undefined, title: targetDoc.title };
          const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
          const parsed = parseDocument(gdoc);
          const writer = new DomWriter(parsed.nodes, { force, lists: gdoc.data.lists, tabId: liveTab.tabId });

          const elements = parseMarkdownToElements(markdown, { h1IsTitle });
          if (elements.length > 0) {
            const anchorNode = anchorId ? findNodeAt(parsed.nodes, anchorId) : parsed.nodes[parsed.nodes.length - 1];
            if (anchorNode) {
              for (const el of elements) {
                writer.insertAdjacentElement(anchorNode, position, el);
              }
            }
          }
          // Re-serialize modified nodes into memory for dry run diff
          targetDoc.gdoc = new Gdoc(
            {
              ...gdoc.data,
              body: { content: [] }, // will be read from writer.nodes
            },
            targetDoc.docId,
          );
          // Update in-memory parsed nodes
          assignScopedIds(writer.nodes);
          (targetDoc.gdoc as any)._simulatedNodes = writer.nodes;
        }

        // Track created headings in highlights
        const targetTabId = tabHint ?? "t.0";
        const afterParsed = (targetDoc.gdoc as any)._simulatedNodes
          ? { nodes: (targetDoc.gdoc as any)._simulatedNodes }
          : parseDocument(tabHint ? targetDoc.gdoc.withTab(tabHint) : targetDoc.gdoc);
        const headings: ApplyHighlightHeadingJson[] = afterParsed.nodes
          .filter(
            (n: DocNode) =>
              n.kind === "paragraph" && (n.namedStyleType?.startsWith("HEADING_") || n.namedStyleType === "TITLE"),
          )
          .map((h: DocNode) => ({ id: h.headingId ?? String(h.tapeIndex), text: h.text ?? "" }));

        if (headings.length > 0) {
          let docHighlight = createdHighlights.get(targetDoc.alias);
          if (!docHighlight) {
            docHighlight = { as: targetDoc.alias, id: targetDoc.docId, tabs: [], title: targetDoc.title };
            createdHighlights.set(targetDoc.alias, docHighlight);
          }
          docHighlight.tabs = docHighlight.tabs ?? [];
          let tabHighlight = docHighlight.tabs.find((t) => t.id === targetTabId);
          if (!tabHighlight) {
            tabHighlight = { id: targetTabId };
            docHighlight.tabs.push(tabHighlight);
          }
          tabHighlight.headings = headings;
        }

        opsExecuted++;
        break;
      }

      case "query": {
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const tabHint = resolveAlias(rawOp.tab ?? rawOp.tabId);
        const gdoc = tabHint ? targetDoc.gdoc.withTab(tabHint) : targetDoc.gdoc;
        const parsed = (targetDoc.gdoc as any)._simulatedNodes
          ? { nodes: (targetDoc.gdoc as any)._simulatedNodes, segments: [], title: targetDoc.title }
          : parseDocument(gdoc);

        let nodes = parsed.nodes;
        if (rawOp.under) {
          const underResolved = resolveAlias(rawOp.under);
          nodes = neighborhoodFrom(parsed.nodes, underResolved!);
        }

        if (rawOp.contains) {
          const lower = rawOp.contains.toLowerCase();
          nodes = nodes.filter((n: DocNode) => (n.text ?? "").toLowerCase().includes(lower));
        }

        if (rawOp.as) {
          // Bind the first matched node id or array of ids to the alias
          if (nodes.length > 0) {
            aliasMap.set(rawOp.as, nodes[0]?.scopedId ?? String(nodes[0]?.tapeIndex));
            dumpStore.set(
              rawOp.as,
              nodes.map((n: DocNode) => ({
                id: n.scopedId ?? n.tapeIndex,
                kind: n.kind,
                ...(n.namedStyleType ? { namedStyleType: n.namedStyleType } : {}),
                ...(n.text ? { text: n.text } : {}),
              })),
            );
          }
        }
        opsExecuted++;
        break;
      }

      case "dump": {
        const name = rawOp.as ?? rawOp.target;
        if (!name) throw new Error(`steps[${i}] dump requires "as: <alias>" or "target: <alias>"`);
        if (dumpStore.has(name)) {
          dumped[name] = dumpStore.get(name);
        } else if (aliasMap.has(name)) {
          dumped[name] = aliasMap.get(name);
        } else if (openDocs.has(name)) {
          const ctx = openDocs.get(name)!;
          dumped[name] = { id: ctx.docId, title: ctx.title };
        } else {
          throw new Error(`steps[${i}] dump: alias "${name}" is not bound`);
        }
        opsExecuted++;
        break;
      }

      default: {
        // Surgical node mutation: replace, innerText, remove, replaceMarkdown, replaceSection, etc.
        const targetDoc = getTargetDoc(rawOp.doc ?? rawOp.docId);
        const tabHint = resolveAlias(rawOp.tab ?? rawOp.tabId);
        const liveTab = targetDoc.gdoc.data.tabs?.length
          ? resolveTab(targetDoc.gdoc.data, tabHint)
          : { tabId: undefined, title: targetDoc.title };
        const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
        const parsed = (targetDoc.gdoc as any)._simulatedNodes
          ? { nodes: (targetDoc.gdoc as any)._simulatedNodes, segments: [], title: targetDoc.title }
          : parseDocument(gdoc);

        const writer = new DomWriter(parsed.nodes, { force, lists: gdoc.data.lists, tabId: liveTab.tabId });

        // Normalize raw surgical op
        const surgicalOp: DomOp = {
          ...rawOp,
          after: resolveAlias(rawOp.after),
          at: resolveAlias(rawOp.at ?? rawOp.under),
          before: resolveAlias(rawOp.before),
        };

        if (stepKind(rawOp) === "replace" || rawOp.find != null) {
          // Scoped or text replacement
          surgicalOp.replace = rawOp.replace ?? rawOp.text;
        }

        const plan = applyOps(writer, [surgicalOp], 0, { force });

        if (!dryRun) {
          await applyDom(targetDoc.docId, writer, {
            client,
            doc: gdoc.data,
            dryRun: false,
            force,
            plan,
          });
          targetDoc.gdoc = await Gdoc.load(targetDoc.docId, client);
        } else {
          assignScopedIds(writer.nodes);
          (targetDoc.gdoc as any)._simulatedNodes = writer.nodes;
        }

        opsExecuted++;
        break;
      }
    }
  }

  // Generate unified git-style diffs if dryRun
  let fullDiff = "";
  if (dryRun) {
    const diffHunks: string[] = [];
    for (const [key, initialMd] of initialMarkdownStates.entries()) {
      const [alias, tabId] = key.split("/");
      const docCtx = openDocs.get(alias!);
      if (!docCtx) continue;

      let currentMd = "";
      if ((docCtx.gdoc as any)._simulatedNodes) {
        const exp = exportDocumentToMarkdown([
          { nodes: (docCtx.gdoc as any)._simulatedNodes, tabId, tabTitle: docCtx.title },
        ]);
        currentMd = exp.markdown;
      } else {
        currentMd = await captureDocTabState(docCtx, tabId!);
      }

      const diff = formatUnifiedDiff(initialMd, currentMd, {
        contextLines: 3,
        newPath: `b/${alias}/${tabId}`,
        oldPath: initialMd ? `a/${alias}/${tabId}` : "/dev/null",
      });
      if (diff) {
        diffHunks.push(diff);
      }
    }
    fullDiff = diffHunks.join("\n\n");
  }

  const highlights = Array.from(createdHighlights.values());

  return {
    diff: fullDiff || undefined,
    dumped,
    highlights,
    ok: true,
    opsCount: opsExecuted,
  };
}

function stepKind(op: ApplyOpInput): string | undefined {
  const raw = op.kind ?? op.action ?? op.op ?? op.step;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function inferOpType(op: ApplyOpInput): string {
  const explicit = stepKind(op);
  if (explicit) return explicit;
  if (op.doc && !op.at && !op.after && !op.before && !op.insertMarkdown) return "open";
  if (op.insertMarkdown != null) return "insertMarkdown";
  if (op.find != null || op.replace != null) return "replaceText";
  if (op.replaceSection != null) return "replaceSection";
  if (op.replaceMarkdown != null) return "replaceMarkdown";
  if (op.innerText != null) return "innerText";
  if (op.remove) return "remove";
  return "surgical";
}
