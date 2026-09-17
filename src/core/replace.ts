/* Core find-and-replace execution. */

import {
  type AppliedOpPlan,
  applyDom,
  applyOps,
  cellId,
  type DomOp,
  DomWriter,
  findNodeAt,
  missingNodeIdMsg,
  neighborhoodFrom,
  parseWriteAt,
} from "./dom/index.ts";
import { type ParsedDocument, parseDocument } from "./dom/parse.ts";
import type { DocNode } from "./dom/types.ts";
import { Gdoc } from "./gdoc.ts";
import { type GwsClient, gws } from "./gws.ts";
import { RequestBuilder } from "./requests.ts";
import { DriveRevisions } from "./revisions.ts";
import { flattenTabs, resolveTab } from "./tabs.ts";

/** One find-and-replace pair. */
export type ReplacementPair = {
  find: string;
  replace: string;
};

/** Options for batch find-and-replace. */
export type BatchReplaceOptions = {
  /** If true, apply across all tabs in a multi-tab document. */
  allTabs?: boolean;
  client?: GwsClient;
  dryRun?: boolean;
  force?: boolean;
  /** Case-sensitive match. Defaults to true. */
  matchCase?: boolean;
  /** List of find-and-replace pairs to execute in order. */
  replacements: ReplacementPair[];
  /** Tab ID or unique title hint. */
  tabHint?: string;
};

/** Result for a single replacement pair. */
export type ReplacementResult = {
  find: string;
  occurrences: number;
  replace: string;
  snippets?: string[];
};

/** Summary of batch replace execution. */
export type BatchReplaceSummary = {
  allTabs?: boolean;
  documentId: string;
  dryRun: boolean;
  matchCase: boolean;
  occurrencesChanged: number;
  replacements: ReplacementResult[];
  tabId?: string;
  tabTitle?: string;
  touchedNodeIds?: Array<number | string>;
};

/** One match result for regex replacement reporting. */
export type RegexReplacementMatch = {
  after: string;
  at: number | string;
  before: string;
  occurrences: number;
};

/** Options for regex-based and scoped find-and-replace. */
export type RegexReplaceOptions = {
  /** If true, apply across all tabs in a multi-tab document. */
  allTabs?: boolean;
  /** Anchor node ID from query: heading-scoped id (e.g. h.arch.9a1b) or cell id (h.arch.table.0.1.3c8f). */
  at?: number | string;
  client?: GwsClient;
  dryRun?: boolean;
  force?: boolean;
  /** Case-insensitive match. Defaults to false. */
  ignoreCase?: boolean;
  /** Target only the single anchor node specified in `at`, without walking following siblings. */
  nodeOnly?: boolean;
  /** Regex pattern (string or RegExp). */
  regex: string | RegExp;
  /** Replacement text string. Supports capture group references ($1, $2, etc.). */
  replace: string;
  /** Tab ID or unique title hint. */
  tabHint?: string;
};

/** Summary of regex replace execution. */
export type RegexReplaceSummary = {
  allTabs?: boolean;
  at?: number | string;
  documentId: string;
  dryRun: boolean;
  matches: RegexReplacementMatch[];
  occurrencesChanged: number;
  pattern: string;
  replace: string;
  tabId?: string;
  tabTitle?: string;
  touchedNodeIds?: Array<number | string>;
};

export const MULTI_TAB_REPLACE_REQUIRED_MSG =
  "This Doc has multiple tabs. Specify --tab <id|title> to target a single tab, or --all-tabs to replace across the entire document.";

/** Constructs a global RegExp with appropriate flags. */
export function globalRegexCreate(pattern: string | RegExp, ignoreCase = false): RegExp {
  if (pattern instanceof RegExp) {
    let flags = pattern.flags;
    if (!flags.includes("g")) flags += "g";
    if (ignoreCase && !flags.includes("i")) flags += "i";
    return new RegExp(pattern.source, flags);
  }
  const str = String(pattern);
  const match = /^\/(.*)\/([a-z]*)$/.exec(str);
  if (match) {
    const rawPattern = match[1]!;
    let flags = match[2]!;
    if (!flags.includes("g")) flags += "g";
    if (ignoreCase && !flags.includes("i")) flags += "i";
    return new RegExp(rawPattern, flags);
  }
  const flags = ignoreCase ? "gi" : "g";
  return new RegExp(str, flags);
}

/** Constructs a global RegExp with appropriate flags (alias for globalRegexCreate). */
export const createGlobalRegex = globalRegexCreate;

/** Escapes special regex characters in a literal string. */
export function regExpEscape(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escapes special regex characters in a literal string (alias for regExpEscape). */
export const escapeRegExp = regExpEscape;

/** Tests whether a string matches a RegExp pattern without mutating sticky indices. */
function hasRegexMatch(str: string, regex: RegExp): boolean {
  const clone = new RegExp(regex.source, regex.flags);
  return clone.test(str);
}

/**
 * Executes batch find-and-replace using Google Docs native replaceAllText.
 */
export async function batchReplaceExecute(
  documentId: string,
  options: BatchReplaceOptions,
): Promise<BatchReplaceSummary> {
  const client = options.client ?? gws;
  const matchCase = options.matchCase ?? true;
  const replacements = options.replacements;

  if (!replacements || replacements.length === 0) {
    throw new Error("No replacements provided.");
  }

  for (const r of replacements) {
    if (!r.find) {
      throw new Error("Find string cannot be empty.");
    }
  }

  const freshDoc = await Gdoc.load(documentId, client);
  const flatTabs = flattenTabs(freshDoc.data.tabs);

  let tabId: string | undefined;
  let tabTitle: string | undefined;
  const allTabs = Boolean(options.allTabs);

  if (allTabs) {
    tabId = undefined;
  } else if (options.tabHint) {
    const resolved = resolveTab(freshDoc.data, options.tabHint);
    tabId = resolved.tabId;
    tabTitle = resolved.title;
  } else {
    if (flatTabs.length > 1) {
      throw new Error(MULTI_TAB_REPLACE_REQUIRED_MSG);
    }
    if (flatTabs.length === 1) {
      tabId = flatTabs[0]?.tabId;
      tabTitle = flatTabs[0]?.title;
    }
  }

  // Dry run: inspect document text to count matches and collect snippets
  if (options.dryRun) {
    const texts = collectTargetTexts(freshDoc, { allTabs, flatTabs, tabId });
    const results: ReplacementResult[] = replacements.map((pair) => {
      const { count, snippets } = countAndSampleMatches(texts, pair.find, matchCase);
      return {
        find: pair.find,
        occurrences: count,
        replace: pair.replace,
        ...(snippets.length > 0 ? { snippets } : {}),
      };
    });

    const totalOccurrences = results.reduce((acc, r) => acc + r.occurrences, 0);
    const touchedNodeIds = collectTouchedNodeIds(freshDoc, {
      allTabs,
      finds: replacements.map((r) => r.find),
      flatTabs,
      matchCase,
      tabId,
    });

    return {
      allTabs: allTabs ? true : undefined,
      documentId,
      dryRun: true,
      matchCase,
      occurrencesChanged: totalOccurrences,
      replacements: results,
      tabId,
      tabTitle,
      ...(touchedNodeIds.length ? { touchedNodeIds } : {}),
    };
  }

  // Live apply: pin head revision for undo safety
  await DriveRevisions.pinHead(documentId, client);

  const tabIds = tabId ? [tabId] : undefined;
  const requests = replacements.map((pair) =>
    RequestBuilder.replaceAllText(pair.find, pair.replace, {
      matchCase,
      tabIds,
    }),
  );

  const resText = await client.batchUpdate(documentId, requests);

  let parsedRes: {
    replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }>;
  } = {};
  try {
    parsedRes = JSON.parse(resText);
  } catch {
    // Non-JSON response handled gracefully
  }

  const replies = parsedRes.replies ?? [];
  const results: ReplacementResult[] = replacements.map((pair, idx) => {
    const occurrences = replies[idx]?.replaceAllText?.occurrencesChanged ?? 0;
    return {
      find: pair.find,
      occurrences,
      replace: pair.replace,
    };
  });

  const totalChanged = results.reduce((acc, r) => acc + r.occurrences, 0);
  const touchedNodeIds = collectTouchedNodeIds(freshDoc, {
    allTabs,
    finds: replacements.map((r) => r.find),
    flatTabs,
    matchCase,
    tabId,
  });

  return {
    allTabs: allTabs ? true : undefined,
    documentId,
    dryRun: false,
    matchCase,
    occurrencesChanged: totalChanged,
    replacements: results,
    tabId,
    tabTitle,
    ...(touchedNodeIds.length ? { touchedNodeIds } : {}),
  };
}

/** Executes batch find-and-replace using Google Docs native replaceAllText (alias for batchReplaceExecute). */
export const executeBatchReplace = batchReplaceExecute;

/**
 * Executes regex-based or heading-scoped find-and-replace using the DOM surgical engine.
 */
export async function regexReplaceExecute(
  documentId: string,
  options: RegexReplaceOptions,
): Promise<RegexReplaceSummary> {
  const client = options.client ?? gws;
  const ignoreCase = Boolean(options.ignoreCase);

  if (options.regex == null || options.regex === "") {
    throw new Error("Regex pattern cannot be empty.");
  }
  if (options.replace == null) {
    throw new Error("Replacement string is required.");
  }
  if (options.allTabs && options.at != null) {
    throw new Error("Cannot combine --at with --all-tabs.");
  }

  let re: RegExp;
  try {
    re = createGlobalRegex(options.regex, ignoreCase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regular expression "${options.regex}": ${msg}`);
  }

  const freshDoc = await Gdoc.load(documentId, client);
  const flatTabs = flattenTabs(freshDoc.data.tabs);

  type TabTarget = {
    tabId?: string;
    title?: string;
  };

  const targets: TabTarget[] = [];
  let tabIdSummary: string | undefined;
  let tabTitleSummary: string | undefined;

  if (options.allTabs) {
    if (flatTabs.length === 0) {
      targets.push({});
    } else {
      for (const t of flatTabs) {
        targets.push({ tabId: t.tabId, title: t.title });
      }
    }
  } else if (options.tabHint) {
    const resolved = resolveTab(freshDoc.data, options.tabHint);
    targets.push({ tabId: resolved.tabId, title: resolved.title });
    tabIdSummary = resolved.tabId;
    tabTitleSummary = resolved.title;
  } else {
    if (flatTabs.length > 1) {
      throw new Error(MULTI_TAB_REPLACE_REQUIRED_MSG);
    }
    if (flatTabs.length === 1) {
      targets.push({ tabId: flatTabs[0]?.tabId, title: flatTabs[0]?.title });
      tabIdSummary = flatTabs[0]?.tabId;
      tabTitleSummary = flatTabs[0]?.title;
    } else {
      targets.push({});
    }
  }

  const allMatches: RegexReplacementMatch[] = [];
  const writers: DomWriter[] = [];
  const plans: AppliedOpPlan[] = [];
  let totalOccurrences = 0;

  for (const target of targets) {
    const tabDoc = target.tabId ? freshDoc.withTab(target.tabId) : freshDoc;
    const parsed = parseDocument(tabDoc);
    const tabOps: DomOp[] = [];

    const at = options.at;
    const atDest = at != null ? parseWriteAt(at) : undefined;
    if (atDest?.cell && at != null) {
      const { cell, nodeId, para } = atDest;
      const tableNode = parsed.nodes.find((n) => n.tapeIndex === nodeId);
      if (tableNode?.kind !== "table" || !tableNode.table?.cells) {
        throw new Error(`Table node ${nodeId} not found for cell "${options.at}".`);
      }
      const [r, c] = cell ?? [0, 0];
      const tableRow = tableNode.table.cells[r];
      const tableCell = tableRow ? tableRow[c] : undefined;
      if (!tableCell) {
        throw new Error(`Cell "${options.at}" not found in table ${nodeId}.`);
      }
      const pIdx = para ?? 0;
      const p = tableCell.paragraphs?.[pIdx] ? tableCell.paragraphs[pIdx] : tableCell;
      const markup = p.markup;
      const plain = p.text ?? "";
      const source = markup && hasRegexMatch(markup, re) ? markup : plain;
      if (hasRegexMatch(source, re)) {
        const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
        const count = matches.length;
        re.lastIndex = 0;
        const replaced = source.replace(re, options.replace);
        const emitAt = ("scopedId" in p && p.scopedId) || tableCell.scopedId || at;
        tabOps.push({ at: emitAt, innerText: replaced });
        allMatches.push({
          after: replaced,
          at: emitAt,
          before: source,
          occurrences: count,
        });
        totalOccurrences += count;
      }
    } else {
      let targetNodes: DocNode[];
      if (options.at != null) {
        const hit = findNodeAt(parsed.nodes, options.at);
        if (!hit) {
          throw new Error(missingNodeIdMsg(options.at, parsed.nodes.length));
        }
        if (options.nodeOnly) {
          targetNodes = [hit];
        } else {
          targetNodes = neighborhoodFrom(parsed.nodes, options.at);
        }
      } else {
        targetNodes = parsed.nodes;
      }

      for (const node of targetNodes) {
        if (node.kind === "paragraph") {
          const markup = node.markup;
          const plain = node.text ?? "";
          const source = markup && hasRegexMatch(markup, re) ? markup : plain;
          if (hasRegexMatch(source, re)) {
            const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
            const count = matches.length;
            re.lastIndex = 0;
            const replaced = source.replace(re, options.replace);
            tabOps.push({ at: node.scopedId ?? node.tapeIndex, innerText: replaced });
            allMatches.push({
              after: replaced,
              at: node.scopedId ?? node.tapeIndex,
              before: source,
              occurrences: count,
            });
            totalOccurrences += count;
          }
        } else if (node.kind === "table" && node.table?.cells) {
          for (let r = 0; r < node.table.cells.length; r++) {
            const row = node.table.cells[r]!;
            for (let c = 0; c < row.length; c++) {
              const cell = row[c]!;
              if (cell.paragraphs && cell.paragraphs.length > 0) {
                for (let p = 0; p < cell.paragraphs.length; p++) {
                  const cp = cell.paragraphs[p]!;
                  const targetAt = cp.scopedId ?? cell.scopedId ?? cellId(node.tapeIndex, r, c, p);
                  const markup = cp.markup;
                  const plain = cp.text ?? "";
                  const source = markup && hasRegexMatch(markup, re) ? markup : plain;
                  if (hasRegexMatch(source, re)) {
                    const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
                    const count = matches.length;
                    re.lastIndex = 0;
                    const replaced = source.replace(re, options.replace);
                    tabOps.push({ at: targetAt, innerText: replaced });
                    allMatches.push({
                      after: replaced,
                      at: targetAt,
                      before: source,
                      occurrences: count,
                    });
                    totalOccurrences += count;
                  }
                }
              } else {
                const targetAt = cell.scopedId ?? cellId(node.tapeIndex, r, c, 0);
                const markup = cell.markup;
                const plain = cell.text ?? "";
                const source = markup && hasRegexMatch(markup, re) ? markup : plain;
                if (hasRegexMatch(source, re)) {
                  const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
                  const count = matches.length;
                  re.lastIndex = 0;
                  const replaced = source.replace(re, options.replace);
                  tabOps.push({ at: targetAt, innerText: replaced });
                  allMatches.push({
                    after: replaced,
                    at: targetAt,
                    before: source,
                    occurrences: count,
                  });
                  totalOccurrences += count;
                }
              }
            }
          }
        }
      }
    }

    if (tabOps.length > 0) {
      const writer = new DomWriter(parsed.nodes, {
        force: options.force,
        lists: tabDoc.data.lists,
        tabId: target.tabId,
      });
      const plan = applyOps(writer, tabOps);
      writers.push(writer);
      plans.push(...plan);
    }
  }

  const touchedFromMatches = uniqueMatchIds(allMatches);

  if (options.dryRun || totalOccurrences === 0) {
    return {
      allTabs: options.allTabs ? true : undefined,
      at: options.at,
      documentId,
      dryRun: Boolean(options.dryRun),
      matches: allMatches,
      occurrencesChanged: totalOccurrences,
      pattern: re.source,
      replace: options.replace,
      tabId: tabIdSummary,
      tabTitle: tabTitleSummary,
      ...(touchedFromMatches.length ? { touchedNodeIds: touchedFromMatches } : {}),
    };
  }

  // Pin head revision before mutation
  await DriveRevisions.pinHead(documentId, client);

  await applyDom(documentId, writers, {
    client,
    doc: freshDoc.data,
    force: options.force,
    plan: plans,
  });

  return {
    allTabs: options.allTabs ? true : undefined,
    at: options.at,
    documentId,
    dryRun: false,
    matches: allMatches,
    occurrencesChanged: totalOccurrences,
    pattern: re.source,
    replace: options.replace,
    tabId: tabIdSummary,
    tabTitle: tabTitleSummary,
    ...(touchedFromMatches.length ? { touchedNodeIds: touchedFromMatches } : {}),
  };
}

/** Executes regex-based or heading-scoped find-and-replace using the DOM surgical engine (alias for regexReplaceExecute). */
export const executeRegexReplace = regexReplaceExecute;

/** Collects node ids whose text contains any of the find strings (pre-replace). */
function collectTouchedNodeIds(
  gdoc: Gdoc,
  target: {
    allTabs: boolean;
    finds: string[];
    flatTabs: Array<{ tabId: string }>;
    matchCase: boolean;
    tabId?: string;
  },
): Array<number | string> {
  const ids: Array<number | string> = [];
  const seen = new Set<string>();

  const visit = (parsed: ParsedDocument) => {
    for (const n of parsed.nodes) {
      if (!nodeMatchesFinds(n, target.finds, target.matchCase)) continue;
      const key = String(n.tapeIndex);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(n.tapeIndex);
    }
  };

  if (target.allTabs && target.flatTabs.length > 0) {
    for (const t of target.flatTabs) {
      visit(parseDocument(gdoc.withTab(t.tabId)));
    }
  } else if (target.tabId) {
    visit(parseDocument(gdoc.withTab(target.tabId)));
  } else {
    visit(parseDocument(gdoc));
  }

  return ids;
}

/** Checks whether a node or its table cells contain any of the given search strings. */
function nodeMatchesFinds(node: DocNode, finds: string[], matchCase: boolean): boolean {
  const hay = node.text ?? "";
  const markup = node.markup ?? "";
  for (const find of finds) {
    if (!find) continue;
    if (containsText(hay, find, matchCase) || containsText(markup, find, matchCase)) {
      return true;
    }
    if (node.table?.cells) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (containsText(cell.text ?? "", find, matchCase) || containsText(cell.markup ?? "", find, matchCase)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** Determines whether a haystack string contains a needle substring with case sensitivity option. */
function containsText(hay: string, needle: string, matchCase: boolean): boolean {
  if (!needle) return false;
  if (matchCase) return hay.includes(needle);
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/** Extracts unique node anchor IDs from a list of replacement match records. */
function uniqueMatchIds(matches: RegexReplacementMatch[]): Array<number | string> {
  const ids: Array<number | string> = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const key = String(m.at);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(m.at);
  }
  return ids;
}

/** Collects text arrays from the targeted tab(s) in a Gdoc. */
function collectTargetTexts(
  gdoc: Gdoc,
  target: { allTabs: boolean; flatTabs: Array<{ tabId: string }>; tabId?: string },
): string[] {
  const texts: string[] = [];

  if (target.allTabs && target.flatTabs.length > 0) {
    for (const t of target.flatTabs) {
      const tabDoc = gdoc.withTab(t.tabId);
      const parsed = parseDocument(tabDoc);
      texts.push(...extractDocumentTexts(parsed));
    }
  } else if (target.tabId) {
    const tabDoc = gdoc.withTab(target.tabId);
    const parsed = parseDocument(tabDoc);
    texts.push(...extractDocumentTexts(parsed));
  } else {
    const parsed = parseDocument(gdoc);
    texts.push(...extractDocumentTexts(parsed));
  }

  return texts;
}

/** Extracts all visible text from nodes and segments in a ParsedDocument. */
function extractDocumentTexts(parsed: ParsedDocument): string[] {
  const texts: string[] = [];

  function addNode(n: DocNode) {
    if (n.text) texts.push(n.text);
    if (n.table?.cells) {
      for (const row of n.table.cells) {
        for (const cell of row) {
          if (cell.text) texts.push(cell.text);
          if (cell.paragraphs) {
            for (const p of cell.paragraphs) {
              if (p.text) texts.push(p.text);
            }
          }
        }
      }
    }
  }

  for (const n of parsed.nodes) addNode(n);
  for (const s of parsed.segments) {
    for (const n of s.nodes) addNode(n);
  }

  return texts;
}

/** Counts occurrences and extracts match snippets. */
function countAndSampleMatches(
  texts: string[],
  findText: string,
  matchCase: boolean,
  maxSnippets = 3,
): { count: number; snippets: string[] } {
  if (!findText) return { count: 0, snippets: [] };
  let count = 0;
  const snippets: string[] = [];
  const query = matchCase ? findText : findText.toLowerCase();

  for (const text of texts) {
    const hay = matchCase ? text : text.toLowerCase();
    let idx = hay.indexOf(query, 0);
    while (idx !== -1) {
      count++;
      if (snippets.length < maxSnippets) {
        snippets.push(extractSnippet(text, idx, findText.length));
      }
      idx = hay.indexOf(query, idx + findText.length);
    }
  }
  return { count, snippets };
}

/** Extracts a contextual snippet around a match index. */
function extractSnippet(text: string, matchIdx: number, matchLen: number): string {
  const start = Math.max(0, matchIdx - 25);
  const end = Math.min(text.length, matchIdx + matchLen + 25);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  const rawSnippet = text.slice(start, end).replace(/\r?\n/g, " ");
  return `${prefix}${rawSnippet}${suffix}`;
}
