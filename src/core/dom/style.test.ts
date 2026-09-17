/* Tests for typography and monospace font family recognition. */

import { describe, expect, test } from "bun:test";
import { isMonospaceFont } from "./style.ts";

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
