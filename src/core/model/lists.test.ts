/* Tests for list preset inference, membership-kind classification, and level indentation. */

import { describe, expect, test } from "bun:test";
import type { PresetTable } from "./lists.ts";
import { listKind, listLevelIndent, listPresetInfer } from "./lists.ts";
import type { ListDef } from "./types.ts";

const SYNTHETIC_TABLE: PresetTable = {
  BULLET_CHECKBOX: [
    { glyphFormat: "%0", glyphSymbol: "☐", glyphType: "GLYPH_TYPE_UNSPECIFIED" },
    { glyphFormat: "%1", glyphSymbol: "☐", glyphType: "GLYPH_TYPE_UNSPECIFIED" },
  ],
  BULLET_DISC_CIRCLE_SQUARE: [
    { glyphFormat: "%0", glyphSymbol: "●", glyphType: "GLYPH_TYPE_UNSPECIFIED" },
    { glyphFormat: "%1", glyphSymbol: "○", glyphType: "GLYPH_TYPE_UNSPECIFIED" },
    { glyphFormat: "%2", glyphSymbol: "■", glyphType: "GLYPH_TYPE_UNSPECIFIED" },
  ],
  NUMBERED_DECIMAL_ALPHA_ROMAN: [
    { glyphFormat: "%0.", glyphType: "DECIMAL" },
    { glyphFormat: "%1.", glyphType: "ALPHA" },
  ],
};

describe("lists", () => {
  test("infers preset from synthetic table", () => {
    expect(
      listPresetInfer(
        [{ glyphFormat: "%0", glyphSymbol: "●", glyphType: "GLYPH_TYPE_UNSPECIFIED", indentFirstLine: {} }],
        SYNTHETIC_TABLE,
      ),
    ).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(listPresetInfer([{ glyphFormat: "%0.", glyphType: "DECIMAL" }], SYNTHETIC_TABLE)).toBe(
      "NUMBERED_DECIMAL_ALPHA_ROMAN",
    );
    expect(listPresetInfer([{ glyphFormat: "%0", glyphSymbol: "☃" }], SYNTHETIC_TABLE)).toBeUndefined();
  });

  test("ignores indents and textStyle when matching a preset", () => {
    const levels = [
      {
        glyphFormat: "%0",
        glyphSymbol: "●",
        glyphType: "GLYPH_TYPE_UNSPECIFIED",
        indentFirstLine: { magnitude: 99 },
        textStyle: { bold: true },
      },
    ];
    expect(listPresetInfer(levels, SYNTHETIC_TABLE)).toBe("BULLET_DISC_CIRCLE_SQUARE");
  });

  test("kind: check, number, bullet", () => {
    const check: ListDef = { isNew: false, nestingLevels: [], preset: "BULLET_CHECKBOX" };
    const number: ListDef = { isNew: false, nestingLevels: [], preset: "NUMBERED_DECIMAL_ALPHA_ROMAN" };
    const bullet: ListDef = { isNew: false, nestingLevels: [], preset: "BULLET_DISC_CIRCLE_SQUARE" };
    expect(listKind(check, 0)).toBe("check");
    expect(listKind(number, 0)).toBe("number");
    expect(listKind(bullet, 0)).toBe("bullet");
  });

  test("kind falls back to raw glyph fields when the preset is unrecognized", () => {
    const unrecognized: ListDef = { isNew: false, nestingLevels: [{ glyphType: "DECIMAL" }] };
    expect(listKind(unrecognized, 0)).toBe("number");
    const plain: ListDef = { isNew: false, nestingLevels: [{ glyphSymbol: "●" }] };
    expect(listKind(plain, 0)).toBe("bullet");
  });

  test("listLevelIndent increases with nesting", () => {
    const def: ListDef = { isNew: false, nestingLevels: [] };
    expect(listLevelIndent(def, 0)).toEqual({ indentFirstLine: 0, indentStart: 18 });
    expect(listLevelIndent(def, 1).indentStart).toBeGreaterThan(listLevelIndent(def, 0).indentStart);
  });
});
