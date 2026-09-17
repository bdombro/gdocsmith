/* Workflow step: query — find nodes and serialize them into dumped aliases. */

import { exportDocumentToMarkdown } from "~/core/dom/export.ts";
import { liveDump, nodeSummarize, pageSetupExtract, TAPE_ECHO_CAP } from "~/core/dom/ops.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { headingLevel, isHeading, neighborhoodFrom, tableCellsAsNodes } from "~/core/dom/query.ts";
import { fontColorsMatch } from "~/core/dom/style.ts";
import type { DocNode, NodeKind } from "~/core/dom/types.ts";
import type { Gdoc } from "~/core/gdoc.ts";
import { flattenTabs, resolveTab } from "~/core/tabs.ts";
import type { QueryOutputFormat } from "~/core/workflowTypes.ts";
import { simulatedNodesOf } from "./simulated.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Query-only fields on a run step that {@link queryStep} must honor. */
export const QUERY_STEP_FIELDS = [
  "as",
  "cols",
  "contains",
  "doc",
  "fontColors",
  "full",
  "headingLevels",
  "nestingLevels",
  "nodeKinds",
  "nodeUnder",
  "output",
  "rows",
  "sameList",
  "stylesOnly",
  "tab",
  "unsafeOnly",
] as const;

/** Queries nodes under optional heading scope and optional text filter. */
export const queryStep: WorkflowStepHandler = async (runtime, stepIndex, step) => {
  const as = step.as;
  if (!as) throw new Error(`steps[${stepIndex}] query requires "as: <alias>"`);

  const output = queryOutputRead(step.output, stepIndex);
  const full = Boolean(step.full);
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const hasTabs = Boolean(targetDoc.gdoc.data.tabs?.length);
  const isMultiTab = (targetDoc.gdoc.data.tabs?.length ?? 0) > 1;

  let liveTab: { tabId?: string; title?: string } = { tabId: undefined, title: targetDoc.title };
  if (tabHint && hasTabs) {
    liveTab = resolveTab(targetDoc.gdoc.data, tabHint);
  } else if (!tabHint && targetDoc.gdoc.data.tabs?.length === 1) {
    liveTab = resolveTab(targetDoc.gdoc.data);
  }

  const targetTabId = hasTabs ? (liveTab.tabId ?? tabHint) : undefined;
  const simulated = isMultiTab && !targetTabId ? undefined : simulatedNodesOf(targetDoc.gdoc, targetTabId);
  const underTarget = step.nodeUnder;
  const filtered =
    Boolean(underTarget) ||
    Boolean(step.contains) ||
    Boolean(step.stylesOnly) ||
    Boolean(step.unsafeOnly) ||
    Boolean(step.cols?.length) ||
    Boolean(step.fontColors?.length) ||
    Boolean(step.headingLevels?.length) ||
    Boolean(step.nestingLevels?.length) ||
    Boolean(step.nodeKinds?.length) ||
    Boolean(step.rows?.length) ||
    Boolean(step.sameList);
  const wholeDocument = !tabHint && !filtered && (output === "markdown" || output === "outline");

  const tabInputs = wholeDocument
    ? documentTabsParse(targetDoc.gdoc, targetDoc.title)
    : [singleTabParse(targetDoc, tabHint, simulated, targetDoc.title)];

  for (const tab of tabInputs) {
    tab.nodes = queryNodesFilter(tab.nodes, step, runtime.aliasResolve);
  }

  const nodes = tabInputs.flatMap((t) => t.nodes);
  if (filtered && nodes.length === 0) {
    throw new Error(`steps[${stepIndex}] query: no nodes matched`);
  }

  runtime.queryAliases.add(as);

  const payload = queryPayloadBuild({
    alias: as,
    documentId: targetDoc.docId,
    full,
    nodes,
    output,
    pageSetup: pageSetupExtract(targetDoc.gdoc.data.documentStyle),
    tabInputs,
    unfiltered: !filtered,
  });
  runtime.dumpStore.set(as, payload);
  runtime.dumped[as] = payload;
  runtime.stepsExecuted++;
};

/** Allowed `output:` values for `kind: query`. */
const QUERY_OUTPUTS = new Set<QueryOutputFormat>(["markdown", "nodes", "outline"]);

/** Parses a single open document tab (or simulated tape) into export input. */
function singleTabParse(
  targetDoc: { gdoc: Gdoc; title: string },
  tabHint: string | undefined,
  simulated: DocNode[] | undefined,
  title: string,
): { nodes: DocNode[]; tabId?: string; tabTitle?: string } {
  const liveTab = targetDoc.gdoc.data.tabs?.length
    ? resolveTab(targetDoc.gdoc.data, tabHint)
    : { tabId: undefined, title: targetDoc.title };
  const targetTabId = targetDoc.gdoc.data.tabs?.length ? (liveTab.tabId ?? tabHint) : undefined;
  const gdoc = targetTabId ? targetDoc.gdoc.withTab(targetTabId) : targetDoc.gdoc;
  if (simulated) {
    return { nodes: simulated, tabId: targetTabId ?? "t.0", tabTitle: liveTab.title || title };
  }
  const parsed = parseDocument(gdoc);
  return { nodes: parsed.nodes, tabId: targetTabId, tabTitle: liveTab.title || parsed.title || title };
}

/** Parses every tab on a live document for whole-doc markdown export. */
function documentTabsParse(gdoc: Gdoc, title: string): Array<{ nodes: DocNode[]; tabId?: string; tabTitle?: string }> {
  const tabs = flattenTabs(gdoc.data.tabs);
  const roster = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  return roster.map((t) => {
    const sim = simulatedNodesOf(gdoc, t.tabId);
    if (sim) {
      return { nodes: sim, tabId: t.tabId, tabTitle: t.title || title };
    }
    const parsed = parseDocument(t.tabId ? gdoc.withTab(t.tabId) : gdoc);
    return { nodes: parsed.nodes, tabId: t.tabId, tabTitle: t.title || parsed.title };
  });
}

/** True when a node is fragile (chips, equations, HR, TOC). */
function nodeIsUnsafe(node: DocNode): boolean {
  return (
    Boolean(node.hasEquation) ||
    Boolean(node.chips?.length) ||
    Boolean(node.hasHorizontalRule) ||
    node.kind === "tableOfContents"
  );
}

/** Serializes matched nodes for `dumped`. */
function queryPayloadBuild(opts: {
  alias: string;
  documentId: string;
  full: boolean;
  nodes: DocNode[];
  output: QueryOutputFormat;
  pageSetup?: ReturnType<typeof pageSetupExtract>;
  tabInputs: Array<{ nodes: DocNode[]; tabId?: string; tabTitle?: string }>;
  unfiltered: boolean;
}): unknown {
  if (opts.output === "markdown") {
    const exp = exportDocumentToMarkdown(opts.tabInputs, { documentId: opts.documentId, includeStyles: false });
    return {
      alias: opts.alias,
      id: opts.documentId,
      kind: "markdown",
      markdown: exp.markdown,
    };
  }
  if (opts.output === "outline") {
    const tabsOutline = opts.tabInputs.map((tab) => {
      const headings = tab.nodes
        .filter((n) => isHeading(n))
        .map((h) => ({
          headingId: h.headingId,
          id: h.scopedId ?? h.tapeIndex,
          level: headingLevel(h),
          link: h.headingId
            ? tab.tabId
              ? `?tab=${tab.tabId}#heading=${h.headingId}`
              : `#heading=${h.headingId}`
            : undefined,
          namedStyleType: h.namedStyleType,
          text: (h.text ?? "").trim(),
        }));
      return {
        headings,
        tabId: tab.tabId,
        tabTitle: tab.tabTitle,
      };
    });

    const allHeadings = tabsOutline.flatMap((t) =>
      t.headings.map((h) => ({
        ...h,
        tabId: t.tabId,
        tabTitle: t.tabTitle,
      })),
    );

    return {
      alias: opts.alias,
      headings: allHeadings,
      id: opts.documentId,
      kind: "outline",
      tabs: tabsOutline,
    };
  }
  if (opts.unfiltered && opts.nodes.length > TAPE_ECHO_CAP && !opts.full) {
    const first = opts.tabInputs[0];
    return liveDump({
      documentId: opts.documentId,
      full: false,
      nodes: opts.nodes,
      pageSetup: opts.pageSetup,
      tabId: first?.tabId,
      tabTitle: first?.tabTitle,
    });
  }
  return opts.nodes.map((n) => nodeSummarize(n, { full: opts.full }));
}

/** Reads and validates `output:` (default `nodes`). */
function queryOutputRead(raw: unknown, stepIndex: number): QueryOutputFormat {
  if (raw == null || raw === "") return "nodes";
  if (typeof raw === "string" && QUERY_OUTPUTS.has(raw as QueryOutputFormat)) {
    return raw as QueryOutputFormat;
  }
  throw new Error(`steps[${stepIndex}] query output must be nodes, markdown, or outline`);
}

/** Applies query filters to a tab tape. */
function queryNodesFilter(
  /** Array of document nodes on the tape. */
  nodes: DocNode[],
  /** Filter criteria specified in the workflow step. */
  step: {
    cols?: number[];
    contains?: string;
    fontColors?: string[];
    headingLevels?: number[];
    nestingLevels?: number[];
    nodeKinds?: NodeKind[];
    nodeUnder?: string;
    rows?: number[];
    sameList?: boolean;
    stylesOnly?: boolean;
    unsafeOnly?: boolean;
  },
  /** Resolver mapping alias handles to document ids or headings. */
  aliasResolve: (val?: string) => string | undefined,
): DocNode[] {
  let out = nodes;
  const underTarget = step.nodeUnder;
  if (underTarget) {
    out = neighborhoodFrom(out, aliasResolve(underTarget) ?? underTarget, { sameList: step.sameList });
  }

  if (step.rows?.length || step.cols?.length) {
    out = out.flatMap((n) => (n.kind === "table" ? tableCellsAsNodes(n) : [n]));
  }

  if (step.nodeKinds?.length) {
    out = out.filter((n) => step.nodeKinds!.includes(n.kind));
  }
  if (step.headingLevels?.length) {
    out = out.filter((n) => isHeading(n) && step.headingLevels!.includes(headingLevel(n)));
  }
  if (step.nestingLevels?.length) {
    out = out.filter((n) => n.bullet != null && step.nestingLevels!.includes(n.bullet.nestingLevel ?? 0));
  }
  if (step.rows?.length) {
    out = out.filter((n) => n.row != null && step.rows!.includes(n.row));
  }
  if (step.cols?.length) {
    out = out.filter((n) => n.col != null && step.cols!.includes(n.col));
  }
  if (step.fontColors?.length) {
    out = out.filter((n) => {
      const colors = n.fontColors ?? (n.style?.foregroundColor ? [n.style.foregroundColor] : []);
      return fontColorsMatch(colors, step.fontColors!);
    });
  }
  if (step.contains) {
    const lower = step.contains.toLowerCase();
    out = out.filter((n) => (n.text ?? "").toLowerCase().includes(lower));
  }
  if (step.stylesOnly) {
    out = out.filter((n) => n.style != null || (n.fontColors?.length ?? 0) > 0);
  }
  if (step.unsafeOnly) {
    out = out.filter((n) => nodeIsUnsafe(n));
  }
  return out;
}
