/* Differential tests for paragraph reconcile: edit the model, reconcile, emulate the requests, and compare with the edited model. */

import { describe, expect, test } from "bun:test";
import { requestsEmulate } from "../emulator/emulate.ts";
import { type EditTarget, paragraphSplice, paragraphStyleUpdate, textStyleUpdate } from "../model/edit.ts";
import { docModelsCompare } from "../model/equivalence.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { type BlockSpec, docJsonBuild } from "../model/testDocs.ts";
import type { ParagraphBlock } from "../model/types.ts";
import { reconcileContextCreate } from "./context.ts";
import { paragraphReconcile } from "./paragraph.ts";

/** Edits a synthetic doc with `mutate`, reconciles every paragraph (end first), emulates, and compares. */
function roundTrip(blocks: BlockSpec[], mutate: (target: EditTarget, keys: string[]) => void) {
  const json = docJsonBuild({ tabs: [{ blocks }] });
  const keys = new KeyAllocator();
  const original = docModelParse(json, { docId: "d", keys });
  const final = structuredClone(original);
  const target: EditTarget = {
    ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] },
    tab: final.tabs[0],
  };
  mutate(
    target,
    final.tabs[0].blocks.map((b) => b.key),
  );
  const ctx = reconcileContextCreate("t.0");
  const originals = original.tabs[0].blocks.filter((b): b is ParagraphBlock => b.kind === "paragraph");
  for (const o of [...originals].reverse()) {
    const f = final.tabs[0].blocks.find((b) => b.key === o.key) as ParagraphBlock;
    paragraphReconcile(o, f, ctx);
  }
  const emulated = requestsEmulate(json, ctx.requests).json;
  const { diffs } = docModelsCompare(final, docModelParse(emulated, { docId: "d", keys: new KeyAllocator() }));
  return { ctx, diffs, requests: ctx.requests };
}

/** Request kinds, in order. */
const kinds = (requests: JsonObject[]) => requests.map((r) => Object.keys(r)[0]);

describe("paragraphReconcile", () => {
  test("unchanged → no requests", () => {
    const { diffs, requests } = roundTrip([{ content: ["hello"], kind: "paragraph" }], () => {});
    expect(requests).toEqual([]);
    expect(diffs).toEqual([]);
  });

  test("a word change is one delete and one insert, restyled with the full mask", () => {
    const { diffs, requests } = roundTrip([{ content: ["the cat sat"], kind: "paragraph" }], (t, k) =>
      paragraphSplice(t, k[0], 4, 3, [{ ch: "dog" }]),
    );
    expect(kinds(requests)).toEqual(["deleteContentRange", "insertText", "updateTextStyle"]);
    expect(requests[0]).toMatchObject({ deleteContentRange: { range: { endIndex: 8, startIndex: 5 } } });
    expect(diffs).toEqual([]);
  });

  test("a bold toggle sends only the changed field", () => {
    const { diffs, requests } = roundTrip(
      [
        { content: ["ab", "cd"], kind: "paragraph" },
        { content: ["z"], kind: "paragraph" },
      ],
      (t, k) => textStyleUpdate(t, k[0], 1, 3, { bold: true }),
    );
    expect(requests).toEqual([
      {
        updateTextStyle: {
          fields: "bold",
          range: { endIndex: 4, startIndex: 2, tabId: "t.0" },
          textStyle: { bold: true },
        },
      },
    ]);
    expect(diffs).toEqual([]);
  });

  test("unsetting a field is a mask entry without a value; the newline follows a whole-text change", () => {
    const { diffs, requests } = roundTrip(
      [{ content: [{ style: { italic: true }, text: "ab" }], kind: "paragraph" }],
      (t, k) => textStyleUpdate(t, k[0], 0, 2, { italic: null }),
    );
    expect(requests[0]).toMatchObject({ updateTextStyle: { fields: "italic", textStyle: {} } });
    expect(diffs).toEqual([]);
  });

  test("a partial restyle leaves the newline alone even when an earlier whole-text request would have changed it", () => {
    const { diffs } = roundTrip([{ content: ["abc"], kind: "paragraph" }], (t, k) => {
      textStyleUpdate(t, k[0], 0, 3, { bold: true });
      textStyleUpdate(t, k[0], 1, 2, { bold: null });
    });
    expect(diffs).toEqual([]);
  });

  test("deleting an atom and inserting a person chip", () => {
    const { diffs, requests } = roundTrip([{ content: ["a", { type: "richLink" }, "b"], kind: "paragraph" }], (t, k) =>
      paragraphSplice(t, k[0], 1, 1, [{ create: { email: "p@x.test", type: "person" } }]),
    );
    expect(kinds(requests)).toEqual(["deleteContentRange", "insertPerson"]);
    expect(diffs).toEqual([]);
  });

  test("a middle paragraph's newline style and paragraph style change in place", () => {
    const { diffs, requests } = roundTrip(
      [
        { content: ["a"], kind: "paragraph" },
        { content: ["b"], kind: "paragraph" },
        { content: ["c"], kind: "paragraph" },
      ],
      (t, k) => {
        const p = t.tab.blocks[1] as ParagraphBlock;
        p.newline = { style: { bold: true } };
        paragraphStyleUpdate(t, k[1], { alignment: "CENTER" });
      },
    );
    expect(kinds(requests)).toEqual(["updateTextStyle", "updateParagraphStyle"]);
    expect(requests[0]).toMatchObject({ updateTextStyle: { range: { endIndex: 5, startIndex: 4 } } });
    expect(diffs).toEqual([]);
  });

  test("the empty last body paragraph restyles directly (no segment-end workaround)", () => {
    const { diffs, requests } = roundTrip(
      [
        { content: ["a"], kind: "paragraph" },
        { content: [], kind: "paragraph" },
      ],
      (t, k) => paragraphStyleUpdate(t, k[1], { namedStyleType: "HEADING_2" }),
    );
    expect(requests).toMatchObject([{ updateParagraphStyle: { range: { endIndex: 4, startIndex: 3 } } }]);
    expect(diffs).toEqual([]);
  });

  test("an emoji edit replaces whole code points", () => {
    const { diffs, requests } = roundTrip([{ content: ["a😀b"], kind: "paragraph" }], (t, k) =>
      paragraphSplice(t, k[0], 1, 1, [{ ch: "😎" }]),
    );
    expect(requests[0]).toMatchObject({ deleteContentRange: { range: { endIndex: 4, startIndex: 2 } } });
    expect(diffs).toEqual([]);
  });

  test("a heading change keeps the text; to a heading the API mints the id", () => {
    const { diffs, requests } = roundTrip([{ content: ["Title"], kind: "paragraph" }], (t, k) =>
      paragraphStyleUpdate(t, k[0], { namedStyleType: "HEADING_1" }),
    );
    expect(kinds(requests)).toEqual(["updateParagraphStyle"]);
    expect(diffs).toEqual([]);
  });

  test("a new link lists underline and foregroundColor so the API adds no chrome", () => {
    const { diffs, requests } = roundTrip(
      [
        { content: ["link me"], kind: "paragraph" },
        { content: ["z"], kind: "paragraph" },
      ],
      (t, k) => textStyleUpdate(t, k[0], 0, 4, { link: { url: "https://x.test" } }),
    );
    expect(requests[0]).toMatchObject({ updateTextStyle: { fields: "foregroundColor,link,underline" } });
    expect(diffs).toEqual([]);
  });

  test("a pending link to a heading created this run is left out and recorded", () => {
    let paragraphKey = "";
    const { ctx, requests } = roundTrip([{ content: ["see here"], kind: "paragraph" }], (t, k) => {
      paragraphKey = k[0];
      textStyleUpdate(t, k[0], 4, 8, { link: { heading: { key: "n9", tabId: "t.0" } } });
    });
    expect(JSON.stringify(requests)).not.toContain("n9");
    expect(ctx.pendingLinks).toEqual([
      { docId: undefined, headingKey: "n9", length: 4, offset: 4, paragraphKey, tabId: "t.0" },
    ]);
  });
});
