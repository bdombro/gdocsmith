/* Step execution context and reference resolution (G4 D5, M3). */

import type { DocHandle, Placement, RangeRef, Session, TabHandle } from "~/core/engine/types.ts";
import { CoreError } from "~/core/model/errors.ts";
import type { Anchor, GdocsmithStep, StepKind } from "./types.ts";

export const RAW_DOC_ID = /^[A-Za-z0-9_-]{25,}$/;
export const DOC_ALIAS = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

/** Runtime context for step execution. */
export interface StepContext {
  /** Map of bound aliases to doc handles. */
  aliases: Map<string, DocHandle>;
  /** True when re-running after create phase or revision conflict. */
  isRetry?: boolean;
  /** The core engine transaction session. */
  session: Session;
  /** Index of current step in steps array. */
  stepIndex: number;
  /** Full list of steps in this run. */
  steps: GdocsmithStep[];
}

/** Error thrown for step-level failures with step index and kind context. */
export class StepError extends Error {
  readonly kind: StepKind;
  readonly stepIndex: number;

  constructor(stepIndex: number, kind: StepKind, message: string) {
    super(`steps[${stepIndex}] ${kind}: ${message}`);
    this.name = "StepError";
    this.stepIndex = stepIndex;
    this.kind = kind;
  }
}

/** Creates a StepError with the step index and kind from context. */
export function stepErrorCreate(ctx: StepContext, message: string): StepError {
  const kind = ctx.steps[ctx.stepIndex]?.kind ?? "step";
  return new StepError(ctx.stepIndex, kind, message);
}

/** Resolves a document reference (raw ID or alias) to a DocHandle. */
export async function docRefResolve(ctx: StepContext, ref: string, opts: { fresh?: boolean } = {}): Promise<DocHandle> {
  if (ctx.aliases.has(ref)) {
    return ctx.aliases.get(ref)!;
  }
  if (RAW_DOC_ID.test(ref)) {
    return ctx.session.docOpen(ref, { forceFetch: ctx.isRetry || opts.fresh });
  }
  throw stepErrorCreate(
    ctx,
    `unknown doc alias "${ref}": bind it with as on an earlier doc step, or pass a raw document ID`,
  );
}

/** Resolves which tab a step acts on, defaulting to the only tab or resolving via anchor when omitted. */
export function tabResolve(ctx: StepContext, doc: DocHandle, tabRef?: string, anchor?: Anchor): TabHandle {
  if (tabRef !== undefined) {
    try {
      return doc.tab(tabRef);
    } catch (err) {
      if (err instanceof CoreError) {
        throw stepErrorCreate(ctx, err.message);
      }
      throw err;
    }
  }

  const allTabs = doc.tabs();
  if (allTabs.length === 1) {
    return doc.tab();
  }

  if (!anchor || anchor.body) {
    throw stepErrorCreate(ctx, `doc has multiple tabs (${allTabs.map((t) => `"${t.title}"`).join(", ")}); specify tab`);
  }

  const matches: TabHandle[] = [];
  for (const t of allTabs) {
    const handle = doc.tab(t.tabId);
    if (anchorMatchesTab(handle, anchor)) {
      matches.push(handle);
    }
  }

  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw stepErrorCreate(ctx, `anchor not found in any tab (${allTabs.map((t) => `"${t.title}"`).join(", ")})`);
  }
  throw stepErrorCreate(
    ctx,
    `anchor found in multiple tabs (${matches.map((m) => `"${m.tabId}"`).join(", ")}); specify tab`,
  );
}

/** Checks whether an anchor appears in a given tab. */
function anchorMatchesTab(tab: TabHandle, anchor: Anchor): boolean {
  if (anchor.section !== undefined) {
    const target = anchor.section.trim().toLowerCase();
    return tab.outline().some((h) => h.text.trim().toLowerCase() === target || h.anchor === anchor.section);
  }
  if (anchor.node !== undefined) {
    const target = anchor.node;
    return tab
      .nodes({ includeCells: target.includes("/") })
      .some((n) => n.anchor === target || n.cells?.some((c) => c.anchor === target));
  }
  if (anchor.text !== undefined) {
    const target = anchor.text;
    return tab.nodes().some((n) => n.text.includes(target));
  }
  return false;
}

/** Resolves a user-facing Anchor into an internal RangeRef. */
export function rangeRefResolve(ctx: StepContext, tab: TabHandle, anchor: Anchor, bodyOnly = false): RangeRef {
  if (anchor.body) {
    return { kind: "tab" };
  }
  if (anchor.section !== undefined) {
    return {
      heading: anchor.section,
      includeHeading: !bodyOnly,
      kind: "section",
    };
  }
  if (anchor.node !== undefined) {
    return anchor.node.includes("/") ? { anchor: anchor.node, kind: "cell" } : { anchor: anchor.node, kind: "node" };
  }
  if (anchor.text !== undefined) {
    const matchingNodes = tab.nodes().filter((n) => n.text.includes(anchor.text as string));
    if (matchingNodes.length === 1) {
      return { anchor: matchingNodes[0].anchor, kind: "node" };
    }
    if (matchingNodes.length === 0) {
      const allWithText = tab.nodes().filter((n) => n.text.trim().length > 0);
      const candidates = allWithText.slice(0, 5).map((c) => `- ${c.anchor}: "${c.text.trim().slice(0, 40)}"`);
      throw stepErrorCreate(ctx, `"${anchor.text}" matched nothing; nearby text:\n${candidates.join("\n")}`);
    }
    const candidates = matchingNodes.slice(0, 5).map((m) => `- ${m.anchor}: "${m.text.trim().slice(0, 40)}"`);
    throw stepErrorCreate(
      ctx,
      `"${anchor.text}" matched ${matchingNodes.length} nodes (expected 1):\n${candidates.join("\n")}`,
    );
  }
  throw stepErrorCreate(ctx, "anchor must set one of body, node, section, text");
}

/** Resolves write step placement into internal Placement. */
export function placementResolve(ctx: StepContext, tab: TabHandle, step: import("./types.ts").StepWrite): Placement {
  if (step.append) {
    return { kind: "append" };
  }
  if (step.replace !== undefined) {
    const range = rangeRefResolve(ctx, tab, step.replace);
    return { kind: "replace", range };
  }
  if (step.after !== undefined) {
    if (step.after.section !== undefined) {
      const sectionRange: RangeRef = {
        heading: step.after.section,
        includeHeading: true,
        kind: "section",
      };
      let nodes: import("~/core/lens/query.ts").NodeInfo[];
      try {
        nodes = tab.nodes({ range: sectionRange });
      } catch (err) {
        if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
        throw err;
      }
      if (nodes.length === 0) {
        throw stepErrorCreate(ctx, `section "${step.after.section}" not found`);
      }
      const last = nodes.at(-1)!;
      return { anchor: last.anchor, kind: "insert", position: "after" };
    }
    if (step.after.node !== undefined) {
      return { anchor: step.after.node, kind: "insert", position: "after" };
    }
    if (step.after.text !== undefined) {
      const range = rangeRefResolve(ctx, tab, step.after);
      return { anchor: (range as { anchor: string }).anchor, kind: "insert", position: "after" };
    }
    throw stepErrorCreate(ctx, "after.body is not allowed here");
  }
  if (step.before !== undefined) {
    if (step.before.section !== undefined) {
      const sectionRange: RangeRef = {
        heading: step.before.section,
        includeHeading: true,
        kind: "section",
      };
      let nodes: import("~/core/lens/query.ts").NodeInfo[];
      try {
        nodes = tab.nodes({ range: sectionRange });
      } catch (err) {
        if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
        throw err;
      }
      if (nodes.length === 0) {
        throw stepErrorCreate(ctx, `section "${step.before.section}" not found`);
      }
      const first = nodes[0]!;
      return { anchor: first.anchor, kind: "insert", position: "before" };
    }
    if (step.before.node !== undefined) {
      return { anchor: step.before.node, kind: "insert", position: "before" };
    }
    if (step.before.text !== undefined) {
      const range = rangeRefResolve(ctx, tab, step.before);
      return { anchor: (range as { anchor: string }).anchor, kind: "insert", position: "before" };
    }
    throw stepErrorCreate(ctx, "before.body is not allowed here");
  }
  throw stepErrorCreate(ctx, "set exactly one of after, before, replace, append");
}
