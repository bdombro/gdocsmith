/* Tests for effective style computation and heading level. */

import { describe, expect, test } from "bun:test";
import { headingLevel, headingStyleIs, paragraphStyleEffective, textStyleEffective } from "./effectiveStyle.ts";
import type { ParagraphBlock, TabModel } from "./types.ts";

function tabWithNamedStyles(): TabModel {
  return {
    blocks: [],
    documentStyle: {},
    footnotes: {},
    headersFooters: {},
    inlineObjects: {},
    isNew: false,
    leadingSectionStyle: {},
    lists: {},
    namedRanges: [],
    namedStyles: {
      styles: [
        {
          namedStyleType: "NORMAL_TEXT",
          paragraphStyle: { alignment: "START" },
          textStyle: { fontSize: { magnitude: 11, unit: "PT" } },
        },
        {
          namedStyleType: "HEADING_1",
          paragraphStyle: { spaceAbove: { magnitude: 20, unit: "PT" } },
          textStyle: { bold: true, fontSize: { magnitude: 20, unit: "PT" } },
        },
      ],
    },
    positionedObjects: {},
    tabId: "t.0",
    title: "Tab",
  };
}

describe("effectiveStyle", () => {
  test("HEADING_1 text style overrides NORMAL_TEXT, run overrides both", () => {
    const tab = tabWithNamedStyles();
    const paragraph: ParagraphBlock = {
      headingId: "h1",
      inlines: [],
      key: "o1",
      kind: "paragraph",
      newline: { style: {} },
      protected: false,
      style: { namedStyleType: "HEADING_1" },
    };
    expect(textStyleEffective(tab, paragraph, { style: {} })).toEqual({
      bold: true,
      fontSize: { magnitude: 20, unit: "PT" },
    });
    expect(textStyleEffective(tab, paragraph, { style: { bold: false } })).toEqual({
      bold: false,
      fontSize: { magnitude: 20, unit: "PT" },
    });
    expect(paragraphStyleEffective(tab, paragraph)).toEqual({
      alignment: "START",
      namedStyleType: "HEADING_1",
      spaceAbove: { magnitude: 20, unit: "PT" },
    });
  });

  test("NORMAL_TEXT paragraph uses only the NORMAL_TEXT named style", () => {
    const tab = tabWithNamedStyles();
    const paragraph: ParagraphBlock = {
      inlines: [],
      key: "o1",
      kind: "paragraph",
      newline: { style: {} },
      protected: false,
      style: {},
    };
    expect(textStyleEffective(tab, paragraph, { style: {} })).toEqual({ fontSize: { magnitude: 11, unit: "PT" } });
  });

  test("headingLevel and headingStyleIs", () => {
    expect(headingLevel("TITLE")).toBe(0);
    expect(headingLevel("SUBTITLE")).toBe(1);
    expect(headingLevel("HEADING_3")).toBe(3);
    expect(headingLevel("NORMAL_TEXT")).toBeUndefined();
    expect(headingLevel(undefined)).toBeUndefined();
    expect(headingStyleIs("HEADING_1")).toBe(true);
    expect(headingStyleIs("NORMAL_TEXT")).toBe(false);
  });
});
