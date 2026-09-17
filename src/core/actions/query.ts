/* Workflow step: query — find nodes and serialize them into dumped aliases. */

import { exportDocumentToMarkdown } from "~/core/dom/export.ts";
import { liveDump, nodeSummarize, pageSetupExtract, TAPE_ECHO_CAP } from "~/core/dom/ops.ts";
import { parseDocument } from "~/core/dom/parse.ts";
import { neighborhoodFrom } from "~/core/dom/query.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { exportDocumentToYaml } from "~/core/dom/yaml.ts";
import type { Gdoc } from "~/core/gdoc.ts";
import { flattenTabs } from "~/core/tabs.ts";
import type { QueryOutputFormat } from "~/core/workflowTypes.ts";
import { simulatedNodesOf } from "./simulated.ts";
import type { WorkflowStepHandler } from "./types.ts";

/** Query-only fields on a run step that {@link queryStep} must honor. */
export const QUERY_STEP_FIELDS = [
  "as",
  "contains",
  "doc",
  "full",
  "output",
  "stylesOnly",
  "tab",
  "under",
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
  const simulated = simulatedNodesOf(targetDoc.gdoc);
  const filtered =
    Boolean(step.under) || Boolean(step.contains) || Boolean(step.stylesOnly) || Boolean(step.unsafeOnly);
  const wholeDocument = !tabHint && !filtered && (output === "markdown" || output === "yaml") && !simulated;

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

  if (nodes.length > 0) {
    runtime.aliasMap.set(as, String(nodes[0]?.scopedId ?? nodes[0]?.tapeIndex));
  }

  const payload = queryPayloadBuild({
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
const QUERY_OUTPUTS = new Set<QueryOutputFormat>(["markdown", "nodes", "yaml"]);

/** Parses a single open document tab (or simulated tape) into export input. */
function singleTabParse(
  targetDoc: { gdoc: Gdoc; title: string },
  tabHint: string | undefined,
  simulated: DocNode[] | undefined,
  title: string,
): { nodes: DocNode[]; tabId?: string; tabTitle?: string } {
  const gdoc = tabHint ? targetDoc.gdoc.withTab(tabHint) : targetDoc.gdoc;
  if (simulated) {
    return { nodes: simulated, tabId: tabHint ?? "t.0", tabTitle: title };
  }
  const parsed = parseDocument(gdoc);
  return { nodes: parsed.nodes, tabId: tabHint, tabTitle: parsed.title || title };
}

/** Parses every tab on a live document for whole-doc markdown/yaml export. */
function documentTabsParse(gdoc: Gdoc, title: string): Array<{ nodes: DocNode[]; tabId?: string; tabTitle?: string }> {
  const tabs = flattenTabs(gdoc.data.tabs);
  const roster = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  return roster.map((t) => {
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
  documentId: string;
  full: boolean;
  nodes: DocNode[];
  output: QueryOutputFormat;
  pageSetup?: ReturnType<typeof pageSetupExtract>;
  tabInputs: Array<{ nodes: DocNode[]; tabId?: string; tabTitle?: string }>;
  unfiltered: boolean;
}): unknown {
  if (opts.output === "markdown") {
    const exp = exportDocumentToMarkdown(opts.tabInputs, { documentId: opts.documentId, includeStyles: true });
    return { audit: exp.audit, markdown: exp.markdown };
  }
  if (opts.output === "yaml") {
    const exp = exportDocumentToYaml(opts.tabInputs, { documentId: opts.documentId, includeStyles: true });
    return { audit: exp.audit, yaml: exp.yaml };
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
  throw new Error(`steps[${stepIndex}] query output must be nodes, markdown, or yaml`);
}

/** Applies `under`, `contains`, `stylesOnly`, and `unsafeOnly` to a tab tape. */
function queryNodesFilter(
  nodes: DocNode[],
  step: {
    contains?: string;
    stylesOnly?: boolean;
    under?: string;
    unsafeOnly?: boolean;
  },
  aliasResolve: (val?: string) => string | undefined,
): DocNode[] {
  let out = nodes;
  if (step.under) {
    out = neighborhoodFrom(out, aliasResolve(step.under) ?? step.under);
  }
  if (step.contains) {
    const lower = step.contains.toLowerCase();
    out = out.filter((n) => (n.text ?? "").toLowerCase().includes(lower));
  }
  if (step.stylesOnly) {
    out = out.filter((n) => n.style != null);
  }
  if (step.unsafeOnly) {
    out = out.filter((n) => nodeIsUnsafe(n));
  }
  return out;
}
