/* Tests for typography, color matching, and font recognition. */

import { describe, expect, test } from "bun:test";
import { colorHsl, colorMatchesPattern, fontColorsMatch, isMonospaceFont } from "./style.ts";

describe("colorHsl", () => {
  test("converts standard hex codes to HSL", () => {
    const red = colorHsl("#FF0000");
    expect(red.h).toBe(0);
    expect(red.s).toBe(1);
    expect(red.l).toBe(0.5);

    const green = colorHsl("#00FF00");
    expect(green.h).toBe(120);
    expect(green.s).toBe(1);
    expect(green.l).toBe(0.5);

    const blue = colorHsl("#0000FF");
    expect(blue.h).toBe(240);
    expect(blue.s).toBe(1);
    expect(blue.l).toBe(0.5);

    const black = colorHsl("#000000");
    expect(black.s).toBe(0);
    expect(black.l).toBe(0);
  });
});

describe("colorMatchesPattern", () => {
  test("matches semantic color names against Google Docs palette colors", () => {
    expect(colorMatchesPattern("#EA4335", "red")).toBe(true);
    expect(colorMatchesPattern("#CC0000", "red")).toBe(true);
    expect(colorMatchesPattern("#34A853", "green")).toBe(true);
    expect(colorMatchesPattern("#4285F4", "blue")).toBe(true);
    expect(colorMatchesPattern("#FBBC04", "yellow")).toBe(true);
    expect(colorMatchesPattern("#FA7B17", "orange")).toBe(true);
    expect(colorMatchesPattern("#9334E6", "purple")).toBe(true);
    expect(colorMatchesPattern("#9AA0A6", "gray")).toBe(true);

    expect(colorMatchesPattern("#000000", "red")).toBe(false);
    expect(colorMatchesPattern("#FFFFFF", "blue")).toBe(false);
  });

  test("matches default and exact hex patterns", () => {
    expect(colorMatchesPattern("#000000", "default")).toBe(true);
    expect(colorMatchesPattern("#EA4335", "default")).toBe(false);
    expect(colorMatchesPattern("#EA4335", "#ea4335")).toBe(true);
    expect(colorMatchesPattern("#EA4335", "#34a853")).toBe(false);
  });
});

describe("fontColorsMatch", () => {
  test("evaluates positive and negative color filters", () => {
    expect(fontColorsMatch(["#EA4335"], ["red"])).toBe(true);
    expect(fontColorsMatch(["#000000"], ["red"])).toBe(false);
    expect(fontColorsMatch([], ["red"])).toBe(false);

    // Negative filters (exclusions)
    expect(fontColorsMatch(["#EA4335"], ["!#000000"])).toBe(true);
    expect(fontColorsMatch(["#000000"], ["!#000000"])).toBe(false);
    expect(fontColorsMatch([], ["!#000000"])).toBe(false);
    expect(fontColorsMatch(["#EA4335"], ["!default"])).toBe(true);
    expect(fontColorsMatch(["#000000"], ["!default"])).toBe(false);

    // Mixed text (black + red word)
    expect(fontColorsMatch(["#000000", "#EA4335"], ["red"])).toBe(true);
    expect(fontColorsMatch(["#000000", "#EA4335"], ["!#000000"])).toBe(true);
    expect(fontColorsMatch(["#000000", "#EA4335"], ["!red"])).toBe(false);
  });
});

describe("isMonospaceFont", () => {
  test("recognizes known monospace fonts", () => {
    expect(isMonospaceFont("Courier New")).toBe(true);
    expect(isMonospaceFont("courier new")).toBe(true);
    expect(isMonospaceFont('"Courier New"')).toBe(true);
    expect(isMonospaceFont("Consolas")).toBe(true);
    expect(isMonospaceFont("Roboto Mono")).toBe(true);
    expect(isMonospaceFont("Inconsolata")).toBe(true);
    expect(isMonospaceFont("Source Code Pro")).toBe(true);
    expect(isMonospaceFont("JetBrains Mono")).toBe(true);
    expect(isMonospaceFont("Cascadia Code")).toBe(true);
    expect(isMonospaceFont("SF Mono")).toBe(true);
    expect(isMonospaceFont("monospace")).toBe(true);
  });

  test("rejects proportional fonts", () => {
    expect(isMonospaceFont("Arial")).toBe(false);
    expect(isMonospaceFont("Times New Roman")).toBe(false);
    expect(isMonospaceFont("Calibri")).toBe(false);
    expect(isMonospaceFont("Roboto")).toBe(false);
    expect(isMonospaceFont("Georgia")).toBe(false);
    expect(isMonospaceFont(undefined)).toBe(false);
    expect(isMonospaceFont("")).toBe(false);
  });
});
