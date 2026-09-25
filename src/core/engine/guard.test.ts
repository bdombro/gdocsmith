/* Tests for the pre-send guard. */

import { describe, expect, test } from "bun:test";
import { blocksDelete, type EditTarget, paragraphSplice, paragraphStyleUpdate } from "../model/edit.ts";
import { nestingSet } from "../model/editLists.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { DocModel } from "../model/types.ts";
import { docReconcile } from "../reconcile/reconcile.ts";
import { guardEvaluate } from "./guard.ts";
import { commentAnchorsMatch } from "./load.ts";

/** Loads blocks, applies `edit` (as step 2), and runs the guard. */
function guard(
  blocks: BlockSpec[],
  edit: (t: EditTarget, keys: string[]) => void,
  opts: { comments?: string[]; force?: boolean; stepForce?: boolean; tweak?: (doc: DocModel) => void } = {},
) {
  const json = docJsonBuild({
    tabs: [
      {
        blocks,
        lists: { "kix.c": { listProperties: { nestingLevels: [{ glyphSymbol: "✱" }, { glyphSymbol: "✱" }] } } },
      },
    ],
  });
  const keys = new KeyAllocator();
  const original = docModelParse(json, { docId: "d", keys });
  opts.tweak?.(original);
  const final = structuredClone(original);
  const target: EditTarget = {
    ctx: { keys, stamp: { force: !!opts.stepForce, stepIndex: 2 }, tombstones: [] },
    tab: final.tabs[0],
  };
  edit(
    target,
    final.tabs[0].blocks.map((b) => b.key),
  );
  const plan = docReconcile({ final, original, originalJson: json });
  const comments = commentAnchorsMatch(
    original,
    (opts.comments ?? []).map((value, i) => ({ id: `c${i}`, quotedFileContent: { value } })),
  );
  return guardEvaluate({
    docs: [{ comments, final, original, plan, tombstones: target.ctx.tombstones }],
    force: !!opts.force,
    stepForce: () => !!opts.stepForce,
  });
}

const p = (text: string): BlockSpec => ({ content: [text], kind: "paragraph" });
const kinds = (findings: ReturnType<typeof guard>) =>
  findings.map((f) => `${f.kind}:${f.severity}${f.waived ? ":waived" : ""}`);

describe("guardEvaluate", () => {
  test("deleting commented text blocks; touching part of it warns; duplicate quotes all count", () => {
    expect(
      kinds(guard([p("keep"), p("gone text"), p("z")], (t, k) => blocksDelete(t, [k[1]]), { comments: ["gone"] })),
    ).toEqual(["comment:block"]);
    expect(
      kinds(guard([p("some words here")], (t, k) => paragraphSplice(t, k[0], 3, 4, []), { comments: ["words"] })),
    ).toEqual(["commentPartial:warn"]);
    const dup = guard([p("x dup"), p("y dup"), p("z")], (t, k) => blocksDelete(t, [k[1]]), { comments: ["dup"] });
    expect(kinds(dup)).toEqual(["comment:block"]);
    expect(dup[0].message).toContain("more than once");
  });

  test("changing or deleting content with pending suggestions blocks", () => {
    const suggested: BlockSpec = { content: [{ sugIns: ["s1"], text: "proposed" }], kind: "paragraph" };
    expect(kinds(guard([p("a"), suggested, p("z")], (t, k) => paragraphSplice(t, k[1], 0, 1, [{ ch: "P" }])))).toEqual([
      "suggestion:block",
    ]);
    expect(kinds(guard([p("a"), suggested, p("z")], (t, k) => blocksDelete(t, [k[1]])))).toEqual(["suggestion:block"]);
  });

  test("inbound-linked headings: deleting, un-heading, or re-identifying blocks; the link sits anywhere loaded", () => {
    const linked: BlockSpec[] = [
      { content: ["Target"], headingId: "h.t", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
      { content: [{ style: { link: { heading: { id: "h.t", tabId: "t.0" } } }, text: "see" }], kind: "paragraph" },
      p("z"),
    ];
    expect(kinds(guard(linked, (t, k) => blocksDelete(t, [k[0]])))).toEqual(["headingLink:block"]);
    expect(kinds(guard(linked, (t, k) => paragraphStyleUpdate(t, k[0], { namedStyleType: "NORMAL_TEXT" })))).toEqual([
      "headingLink:block",
    ]);
    expect(kinds(guard(linked, (t, k) => paragraphStyleUpdate(t, k[0], { namedStyleType: "HEADING_2" })))).toEqual([]);
  });

  test("an identity transfer re-identifies a linked heading", () => {
    const blocks: BlockSpec[] = [
      p("x"),
      { content: [], kind: "paragraph" },
      { content: ["Linked"], headingId: "h.l", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
      { content: [{ style: { link: { heading: { id: "h.l", tabId: "t.0" } } }, text: "ref" }], kind: "paragraph" },
    ];
    // Deleting the last paragraph after an empty one: the empty paragraph takes the deleted one's id.
    const findings = guard(blocks, (t, k) => blocksDelete(t, [k[2], k[3]]));
    expect(kinds(findings)).toContain("headingLink:block");
  });

  test("unrecreatable deletions and lossy list rebuilds block; named ranges block", () => {
    expect(
      kinds(
        guard([p("a"), { content: ["eq ", { type: "equation" }], kind: "paragraph" }, p("z")], (t, k) =>
          blocksDelete(t, [k[1]]),
        ),
      ),
    ).toEqual(["unrecreatable:block"]);
    const custom: BlockSpec[] = [
      { bullet: { listId: "kix.c" }, content: ["a"], kind: "paragraph" },
      { bullet: { listId: "kix.c" }, content: ["b"], kind: "paragraph" },
      p("z"),
    ];
    const rebuilt = guard(custom, (t, k) => {
      nestingSet(t, k[1], 1);
      // Keep the item in its custom list so the run is rebuilt rather than split off.
      const b = t.tab.blocks[1];
      if (b.kind === "paragraph" && b.bullet) b.bullet.listId = "kix.c";
    });
    expect(kinds(rebuilt)).toContain("listRebuild:block");
    const named = guard([p("alpha"), p("beta"), p("z")], (t, k) => blocksDelete(t, [k[1]]), {
      tweak: (doc) =>
        doc.tabs[0].namedRanges.push({ name: "r", namedRangeId: "nr.1", ranges: [{ end: 10, start: 8 }] }),
    });
    expect(kinds(named)).toEqual(["namedRange:block"]);
  });

  test("force waives everything; a step's own force waives what it caused", () => {
    const edit = (t: EditTarget, k: string[]) => blocksDelete(t, [k[1]]);
    expect(kinds(guard([p("a"), p("gone"), p("z")], edit, { comments: ["gone"], force: true }))).toEqual([
      "comment:block:waived",
    ]);
    expect(kinds(guard([p("a"), p("gone"), p("z")], edit, { comments: ["gone"], stepForce: true }))).toEqual([
      "comment:block:waived",
    ]);
    expect(guard([p("a"), p("gone"), p("z")], edit, { comments: ["gone"] })[0].stepIndex).toBe(2);
  });

  test("a document not loaded with suggestions inline can't be written", () => {
    const findings = guard([p("a")], (t, k) => paragraphSplice(t, k[0], 1, 0, [{ ch: "b" }]), {
      tweak: (doc) => (doc.suggestionsViewMode = "PREVIEW_WITHOUT_SUGGESTIONS"),
    });
    expect(kinds(findings)).toEqual(["viewMode:block"]);
  });
});
