/* Handlers for structure steps: doc, tab, page, share (G4 D5, M4). */

import type { PageSetupPatch, PermissionInput, TabPosition } from "~/core/engine/types.ts";
import { CoreError } from "~/core/model/errors.ts";
import { docRefResolve, rangeRefResolve, type StepContext, StepError, stepErrorCreate, tabResolve } from "./context.ts";
import type { StepDoc, StepPage, StepShare, StepTab } from "./types.ts";

/** Outcome of applying one step. */
export interface StepOutcome {
  /** IDs and kinds of newly created elements. */
  created?: Array<{ id: string; kind: string; text: string }>;
  /** Structured output payload (e.g. queries, share list). */
  data?: unknown;
  /** Count of text replacements made. */
  replaced?: number;
}

/** Executes a `doc` step: open, create, copy, rename, trash, or delete a doc. */
export async function docStepApply(ctx: StepContext, step: StepDoc): Promise<StepOutcome> {
  try {
    switch (step.action) {
      case "open": {
        const doc = await ctx.session.docOpen(step.doc as string, {
          alias: step.as,
          forceFetch: step.fresh,
        });
        if (step.as) ctx.aliases.set(step.as, doc);
        return {};
      }
      case "create": {
        const doc = await ctx.session.docCreate({
          alias: step.as as string,
          title: step.title as string,
        });
        ctx.aliases.set(step.as as string, doc);
        return {
          created: [{ id: doc.docId, kind: "doc", text: step.title as string }],
        };
      }
      case "copy": {
        const source = await docRefResolve(ctx, step.doc as string);
        const doc = await ctx.session.docCreate({
          alias: step.as as string,
          from: source,
          title: step.title as string,
        });
        ctx.aliases.set(step.as as string, doc);
        return {
          created: [{ id: doc.docId, kind: "doc", text: step.title as string }],
        };
      }
      case "rename": {
        const doc = await docRefResolve(ctx, step.doc as string);
        const res = doc.rename(step.title as string);
        if (!res.changed) {
          throw stepErrorCreate(
            ctx,
            "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
          );
        }
        return {};
      }
      case "trash": {
        const doc = await docRefResolve(ctx, step.doc as string);
        const res = doc.lifecycle("trash");
        if (!res.changed) {
          throw stepErrorCreate(
            ctx,
            "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
          );
        }
        return {};
      }
      case "delete": {
        const doc = await docRefResolve(ctx, step.doc as string);
        const res = doc.lifecycle("delete");
        if (!res.changed) {
          throw stepErrorCreate(
            ctx,
            "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
          );
        }
        return {};
      }
    }
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes a `tab` step: create, rename, move, or delete a tab. */
export async function tabStepApply(ctx: StepContext, step: StepTab): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);

    switch (step.action) {
      case "create": {
        let position: TabPosition | undefined;
        if (step.after !== undefined) position = { afterTab: step.after };
        else if (step.before !== undefined) position = { beforeTab: step.before };

        const newTab = doc.tabCreate({
          position,
          title: step.title as string,
        });

        if (step.from) {
          const srcDoc = await docRefResolve(ctx, step.from.doc ?? step.doc);
          const srcAnchor = step.from.section
            ? { section: step.from.section }
            : step.from.node
              ? { node: step.from.node }
              : { body: true as const };
          const srcTab = tabResolve(ctx, srcDoc, step.from.tab, srcAnchor);
          const srcRange = rangeRefResolve(ctx, srcTab, srcAnchor, Boolean(step.from.bodyOnly));
          try {
            await newTab.copyFrom({ range: srcRange, tab: srcTab }, { kind: "append" }, { force: step.force });
          } catch (err) {
            if (err instanceof CoreError && err.code === "unrecreatableCopy") {
              throw stepErrorCreate(ctx, `Refused: ${err.message} (force: true to proceed)`);
            }
            throw err;
          }
        }

        return {
          created: [{ id: newTab.tabId, kind: "tab", text: step.title as string }],
        };
      }
      case "rename": {
        const tab = tabResolve(ctx, doc, step.tab);
        const res = tab.rename(step.title as string);
        if (!res.changed) {
          throw stepErrorCreate(
            ctx,
            "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
          );
        }
        return {};
      }
      case "move": {
        const tab = tabResolve(ctx, doc, step.tab);
        const position: TabPosition =
          step.after !== undefined ? { afterTab: step.after } : { beforeTab: step.before as string };
        const res = tab.move(position);
        if (!res.changed) {
          throw stepErrorCreate(
            ctx,
            "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
          );
        }
        return {};
      }
      case "delete": {
        const tab = tabResolve(ctx, doc, step.tab);
        const allTabs = doc.tabs();
        if ((tab.tabId === "t.0" || allTabs[0]?.tabId === tab.tabId) && !step.force) {
          throw stepErrorCreate(ctx, `Refused: deleting root tab "${tab.tabId}" requires force: true`);
        }
        const res = tab.delete();
        if (!res.changed) {
          throw stepErrorCreate(
            ctx,
            "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
          );
        }
        return {};
      }
    }
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes a `page` step: page setup across all tabs or one tab. */
export async function pageStepApply(ctx: StepContext, step: StepPage): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);

    const patch: PageSetupPatch = {};
    if (step.pageless !== undefined) patch.pageless = step.pageless;
    if (step.orientation !== undefined) patch.orientation = step.orientation;
    if (step.size !== undefined) patch.size = step.size;
    if (step.width !== undefined) patch.widthPt = step.width;
    if (step.height !== undefined) patch.heightPt = step.height;
    if (step.margins !== undefined) {
      patch.margins = {
        bottom: step.margins.bottom,
        left: step.margins.left,
        right: step.margins.right,
        top: step.margins.top,
      };
    }

    const tabsToApply =
      step.tab !== undefined ? [tabResolve(ctx, doc, step.tab)] : doc.tabs().map((t) => doc.tab(t.tabId));

    let anyChanged = false;
    for (const tab of tabsToApply) {
      const res = tab.pageSetupSet(patch);
      anyChanged = anyChanged || res.changed;
    }

    if (!anyChanged) {
      throw stepErrorCreate(
        ctx,
        "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
      );
    }

    return {};
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes a `share` step: add, list, or remove Drive permissions. */
export async function shareStepApply(ctx: StepContext, step: StepShare): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);

    switch (step.action) {
      case "add": {
        if (!step.scope) {
          throw stepErrorCreate(ctx, 'action "add" needs scope');
        }
        if (!step.role) {
          throw stepErrorCreate(ctx, 'action "add" needs role');
        }
        const perm: PermissionInput = {
          domain: step.domain,
          emailAddress: step.email,
          role: step.role,
          type: step.scope,
        };
        doc.permissionAdd(perm);
        return {};
      }
      case "list": {
        const perms = await doc.permissionList();
        return {
          data: {
            permissions: perms.map((p) => ({
              domain: p.domain,
              email: (p as { emailAddress?: string }).emailAddress,
              id: p.id,
              role: p.role,
              scope: p.type,
            })),
          },
        };
      }
      case "remove": {
        doc.permissionRemove({
          email: step.email,
          permissionId: step.permissionId,
        });
        return {};
      }
    }
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}
