/* Unit tests for converting parsed chips/images into native inline specials. */

import { describe, expect, test } from "bun:test";
import { inlineClonePlan, paragraphInlineClone, tableCellInlineClone, unclonableFromNode } from "./inlineSpecials.ts";
import type { DocNode, TableCell } from "./types.ts";

describe("inlineClonePlan", () => {
  test("recreates person chips with email and leaves surrounding text", () => {
    const plan = inlineClonePlan("Lead: ", [
      {
        email: "brian@example.com",
        end: 1,
        kind: "person",
        start: 0,
        textOffset: 6,
        title: "Brian",
        uri: "mailto:brian@example.com",
      },
    ]);
    expect(plan.unclonable).toEqual([]);
    expect(plan.specials).toEqual([{ email: "brian@example.com", kind: "person", offset: 6 }]);
    expect(plan.text).toBe("Lead: ");
  });

  test("recreates date chips with timestamp", () => {
    const plan = inlineClonePlan("", [
      {
        dateFormat: "MMMM d, yyyy",
        end: 1,
        kind: "date",
        start: 0,
        textOffset: 0,
        timestamp: "2026-09-17T00:00:00.000Z",
        title: "Sep 17, 2026",
        uri: "",
      },
    ]);
    expect(plan.unclonable).toEqual([]);
    expect(plan.specials).toEqual([
      {
        dateFormat: "MMMM d, yyyy",
        displayText: "Sep 17, 2026",
        kind: "date",
        offset: 0,
        timestamp: "2026-09-17T00:00:00.000Z",
      },
    ]);
  });

  test("strips richLink titles from text then inserts at the gap", () => {
    const plan = inlineClonePlan("See IPP here", [
      {
        end: 10,
        kind: "richLink",
        start: 4,
        textOffset: 4,
        title: "IPP",
        uri: "https://docs.google.com/document/d/abc",
      },
    ]);
    expect(plan.unclonable).toEqual([]);
    expect(plan.text).toBe("See  here");
    expect(plan.specials).toEqual([
      { kind: "richLink", offset: 4, title: "IPP", uri: "https://docs.google.com/document/d/abc" },
    ]);
  });

  test("recreates public https images and fails closed on Drive-only images", () => {
    const publicPlan = inlineClonePlan("Logo", undefined, [
      { end: 1, objectId: "img", sourceUri: "https://example.com/logo.png", start: 0, textOffset: 4, widthPt: 80 },
    ]);
    expect(publicPlan.unclonable).toEqual([]);
    expect(publicPlan.specials).toEqual([
      { kind: "inlineImage", offset: 4, uri: "https://example.com/logo.png", widthPt: 80 },
    ]);

    const drivePlan = inlineClonePlan("Logo", undefined, [{ end: 1, objectId: "img", start: 0, textOffset: 4 }]);
    expect(drivePlan.specials).toEqual([]);
    expect(drivePlan.unclonable.some((m) => m.includes("no public source URI"))).toBe(true);
  });

  test("handles date chips without uri and person chips with email only", () => {
    const datePlan = inlineClonePlan("Due ", [
      {
        dateFormat: "MMMM d, yyyy",
        end: 1,
        kind: "date",
        start: 0,
        textOffset: 4,
        timestamp: "2026-09-17T00:00:00.000Z",
        title: "Sep 17, 2026",
        uri: "",
      },
    ]);
    expect(datePlan.unclonable).toEqual([]);
    expect(datePlan.specials).toHaveLength(1);

    const personPlan = inlineClonePlan("Owner: ", [
      {
        email: "owner@example.com",
        end: 1,
        kind: "person",
        start: 0,
        textOffset: 7,
        title: "Owner",
        uri: "",
      },
    ]);
    expect(personPlan.unclonable).toEqual([]);
    expect(personPlan.specials).toEqual([{ email: "owner@example.com", kind: "person", offset: 7 }]);
  });

  test("fails closed on chips that cannot be recreated", () => {
    expect(
      inlineClonePlan("x", [{ end: 1, kind: "person", start: 0, title: "Anon", uri: "" }]).unclonable[0],
    ).toContain("has no email");
    expect(inlineClonePlan("x", [{ end: 1, kind: "date", start: 0, title: "Soon", uri: "" }]).unclonable[0]).toContain(
      "has no timestamp",
    );
    expect(inlineClonePlan("x", [{ end: 1, start: 0, title: "Status", uri: "dropdown://x" }]).unclonable[0]).toContain(
      "unsupported smart chip",
    );
  });
});

describe("tableCellInlineClone", () => {
  test("joins cell paragraphs and shifts special offsets across newlines", () => {
    const cell: TableCell = {
      end: 20,
      paragraphs: [
        {
          chips: [
            { email: "a@x.com", end: 1, kind: "person", start: 0, textOffset: 2, title: "A", uri: "mailto:a@x.com" },
          ],
          end: 10,
          start: 0,
          text: "A: ",
        },
        {
          chips: [
            {
              end: 12,
              kind: "richLink",
              start: 10,
              textOffset: 0,
              title: "Doc",
              uri: "https://docs.google.com/document/d/x",
            },
          ],
          end: 20,
          start: 10,
          text: "Doc",
        },
      ],
      start: 0,
      text: "A: ",
    };
    const plan = tableCellInlineClone(cell);
    expect(plan.text).toBe("A: \n");
    expect(plan.specials).toEqual([
      { email: "a@x.com", kind: "person", offset: 2 },
      { kind: "richLink", offset: 4, title: "Doc", uri: "https://docs.google.com/document/d/x" },
    ]);
  });
});

describe("unclonableFromNode", () => {
  test("returns leftovers from body paragraphs and table cells", () => {
    const para: DocNode = {
      end: 8,
      footnoteIds: ["fn1"],
      hasEquation: true,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "x",
    };
    expect(unclonableFromNode(para).some((m) => m.includes("math equation"))).toBe(true);
    expect(unclonableFromNode(para).some((m) => m.includes("footnote"))).toBe(true);

    const table: DocNode = {
      end: 40,
      tapeIndex: 3,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            {
              end: 20,
              hasEquation: true,
              images: [{ end: 12, objectId: "img", start: 11 }],
              paragraphs: [
                {
                  end: 20,
                  hasEquation: true,
                  images: [{ end: 12, objectId: "img", start: 11 }],
                  start: 11,
                  text: "",
                },
              ],
              start: 11,
              text: "",
            },
          ],
        ],
      },
    };
    const msgs = unclonableFromNode(table);
    expect(msgs.some((m) => m.includes("math equation"))).toBe(true);
    expect(msgs.some((m) => m.includes("no public source URI"))).toBe(true);
  });

  test("does not flag recreatable person chips", () => {
    const node: DocNode = {
      chips: [{ email: "a@x.com", end: 2, kind: "person", start: 1, textOffset: 0, title: "A", uri: "mailto:a@x.com" }],
      end: 8,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "",
    };
    expect(unclonableFromNode(node)).toEqual([]);
    expect(paragraphInlineClone(node).specials).toHaveLength(1);
  });
});
