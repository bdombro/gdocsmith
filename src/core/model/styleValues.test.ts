/* Tests for style value helpers: canonicalization, equality, color/dimension conversion, monospace detection. */

import { describe, expect, test } from "bun:test";
import {
  colorHexFromOptional,
  colorOptionalFromHex,
  dimensionFromPt,
  dimensionPt,
  monospaceFontIs,
  styleEqual,
  styleFieldsChanged,
} from "./styleValues.ts";

describe("styleValues", () => {
  test("Dimension without magnitude equals 0", () => {
    expect(dimensionPt(undefined)).toBe(0);
    expect(dimensionPt({ unit: "PT" })).toBe(0);
    expect(dimensionPt({ magnitude: 12, unit: "PT" })).toBe(12);
    expect(dimensionFromPt(12)).toEqual({ magnitude: 12, unit: "PT" });
  });

  test("rgbColor missing channels equals black", () => {
    expect(colorHexFromOptional({ color: { rgbColor: {} } })).toBe("#000000");
    expect(colorHexFromOptional({ color: {} })).toBe("#000000");
    expect(colorHexFromOptional(undefined)).toBeUndefined();
    expect(colorHexFromOptional({})).toBeUndefined();
    expect(colorOptionalFromHex("#1155CC")).toEqual({
      color: { rgbColor: { blue: 0xcc / 255, green: 0x55 / 255, red: 0x11 / 255 } },
    });
  });

  test("styleEqual ignores key order", () => {
    expect(styleEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(styleEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(styleEqual({ fontSize: { magnitude: 12, unit: "PT" } }, { fontSize: { unit: "PT", magnitude: 12 } })).toBe(
      true,
    );
    expect(styleEqual({ fontSize: { magnitude: 12 } }, { fontSize: {} })).toBe(false);
  });

  test("styleFieldsChanged reports added, removed, and changed fields", () => {
    const a = { bold: true, foregroundColor: { color: { rgbColor: { red: 1 } } } };
    const b = { bold: true, italic: true, foregroundColor: { color: { rgbColor: { red: 0.5 } } } };
    expect(styleFieldsChanged(a, b, ["bold", "italic", "foregroundColor"]).sort()).toEqual([
      "foregroundColor",
      "italic",
    ]);
    expect(styleFieldsChanged(a, b, ["bold"])).toEqual([]);
  });

  test("monospaceFontIs accepts Courier New and Roboto Mono, rejects Arial", () => {
    expect(monospaceFontIs("Courier New")).toBe(true);
    expect(monospaceFontIs("Roboto Mono")).toBe(true);
    expect(monospaceFontIs("Arial")).toBe(false);
    expect(monospaceFontIs(undefined)).toBe(false);
  });
});
