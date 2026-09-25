/* Tests for document-level reconcile: tab lifecycle, document and first-section style, and the self-check. */

import { describe, expect, test } from "bun:test";
import blankTab from "../model/blankTab.json";
import { paragraphsInsert } from "../model/edit.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import type { DocModel, TabModel } from "../model/types.ts";
import { docPlanSelfCheck, docReconcile } from "./reconcile.ts";

/** A three-tab doc (t.0, t.1 with child t.2) and a mutable copy of its model. */
function setup() {
  const json = docJsonBuild({
    tabs: [
      { blocks: [{ content: ["zero"], kind: "paragraph" }], tabId: "t.0", title: "Zero" },
      { blocks: [{ content: ["one"], kind: "paragraph" }], tabId: "t.1", title: "One" },
      { blocks: [{ content: ["two"], kind: "paragraph" }], parentTabId: "t.1", tabId: "t.2", title: "Two" },
    ],
  });
  // docJsonBuild emits flat tabs; nest t.2 under t.1 the way the API does.
  const raw = json as unknown as { tabs: JsonObject[] };
  const child = raw.tabs.pop() as JsonObject;
  raw.tabs[1].childTabs = [child];
  const keys = new KeyAllocator();
  const original = docModelParse(json, { docId: "d", keys });
  return { final: structuredClone(original), json, keys, original };
}

function check(original: DocModel, final: DocModel, json: ReturnType<typeof docJsonBuild>) {
  const input = { final, original, originalJson: json };
  const plan = docReconcile(input);
  return { check: docPlanSelfCheck(plan, input), plan };
}

/** A new tab from the blank template, with one paragraph written into it. */
function newTab(keys: KeyAllocator, tabId: string, title: string, text: string, parentTabId?: string): TabModel {
  const tab = docModelParse(
    { tabs: [{ documentTab: structuredClone(blankTab), tabProperties: { tabId, title } }] } as never,
    { docId: "d", keys },
  ).tabs[0];
  tab.blocks = [];
  tab.isNew = true;
  tab.parentTabId = parentTabId;
  paragraphsInsert({ ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] }, tab }, { kind: "body" }, 0, [
    { syms: [{ ch: text }] },
  ]);
  return tab;
}

describe("docReconcile", () => {
  test("no changes → an empty plan that self-checks", () => {
    const { final, json, original } = setup();
    const { check: result, plan } = check(original, final, json);
    expect(plan.summary).toEqual({ contentRequests: 0, tabOps: 0, tabsToAdd: 0 });
    expect(result.diffs).toEqual([]);
  });

  test("a new tab (also a nested one) is added in the create phase and its content planned against the blank tab", () => {
    const { final, json, keys, original } = setup();
    final.tabs.splice(1, 0, newTab(keys, "new:tab:1", "Fresh", "hello"));
    final.tabs.push(newTab(keys, "new:tab:2", "Kid", "nested", "t.1"));
    const { check: result, plan } = check(original, final, json);
    expect(plan.tabsToAdd).toEqual([
      { index: 1, parentTabId: undefined, tabId: "new:tab:1", title: "Fresh" },
      { index: 1, parentTabId: "t.1", tabId: "new:tab:2", title: "Kid" },
    ]);
    expect(result.diffs).toEqual([]);
  });

  test("renames, moves, and deletes (a deleted parent takes its children)", () => {
    const { final, json, original } = setup();
    final.tabs = [final.tabs[1], final.tabs[2], final.tabs[0]];
    final.tabs[2].title = "Zero renamed";
    let { check: result, plan } = check(original, final, json);
    expect(plan.tabOps).toEqual([
      { updateDocumentTabProperties: { fields: "index", tabProperties: { index: 0, tabId: "t.1" } } },
      { updateDocumentTabProperties: { fields: "title", tabProperties: { tabId: "t.0", title: "Zero renamed" } } },
    ]);
    expect(result.diffs).toEqual([]);
    const second = setup();
    second.final.tabs = [second.final.tabs[0]];
    ({ check: result, plan } = check(second.original, second.final, second.json));
    expect(plan.tabOps).toEqual([{ deleteTab: { tabId: "t.1" } }]);
    expect(result.diffs).toEqual([]);
  });

  test("document style and the first section's style (which makes a pageless doc paged)", () => {
    const { final, json, original } = setup();
    final.tabs[0].documentStyle = { ...final.tabs[0].documentStyle, marginTop: { magnitude: 30, unit: "PT" } };
    const { check: styled } = check(original, final, json);
    expect(styled.diffs).toEqual([]);
    final.tabs[0].leadingSectionStyle = {
      ...final.tabs[0].leadingSectionStyle,
      marginBottom: { magnitude: 10, unit: "PT" },
    };
    expect(check(original, final, json).check.diffs.join()).toContain("documentStyle");
    final.tabs[0].documentStyle = { ...final.tabs[0].documentStyle, documentFormat: { documentMode: "PAGES" } };
    expect(check(original, final, json).check.diffs).toEqual([]);
  });

  test("the self-check catches a model the plan can't produce", () => {
    const { final, json, original } = setup();
    final.tabs[0].title = "Changed";
    const input = { final, original, originalJson: json };
    const plan = docReconcile(input);
    plan.tabOps = [];
    expect(docPlanSelfCheck(plan, input).diffs).toEqual(['tab "Changed": title expected "Changed", got "Zero"']);
  });
});
