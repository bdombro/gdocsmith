/* Style value helpers shared by the model, reconciler, and lens: canonicalization, equality, color/dimension conversion, monospace detection. */

import type { JsonObject, RawColor, RawDimension, RawOptionalColor } from "./rawJson.ts";

/** Google Docs' default link chrome, applied to every newly created link (see G3 D31). */
export const LINK_CHROME: JsonObject = { foregroundColor: "#1155CC", underline: true };

/** Font used for new code-line runs (see G3 D34). */
export const CODE_FONT = "Courier New";

/**
 * Markdown-facing text style attribute names a directive (`::name[text]::`) can express (G3 D30).
 * Distinct from `TEXT_STYLE_FIELDS`: uses `fontFamily`/`fontWeight` instead of the API's combined
 * `weightedFontFamily`, and omits `link` (links are expressed as markdown links, not directives).
 */
export const DIRECTIVE_ATTRS: readonly string[] = [
  "backgroundColor",
  "baselineOffset",
  "bold",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "foregroundColor",
  "italic",
  "smallCaps",
  "strikethrough",
  "underline",
];

/** Every field of the Docs API `TextStyle` resource (11; the full field mask for a from-scratch `updateTextStyle`). */
export const TEXT_STYLE_FIELDS: readonly string[] = [
  "backgroundColor",
  "baselineOffset",
  "bold",
  "fontSize",
  "foregroundColor",
  "italic",
  "link",
  "smallCaps",
  "strikethrough",
  "underline",
  "weightedFontFamily",
];

/**
 * Every updatable field of the Docs API `ParagraphStyle` resource (20; the full field mask for a
 * from-scratch `updateParagraphStyle`). Excludes `headingId` and `tabStops`, which the API computes
 * or manages itself and rejects in an update mask.
 */
export const PARAGRAPH_STYLE_FIELDS: readonly string[] = [
  "alignment",
  "avoidWidowAndOrphan",
  "borderBetween",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "borderTop",
  "direction",
  "indentEnd",
  "indentFirstLine",
  "indentStart",
  "keepLinesTogether",
  "keepWithNext",
  "lineSpacing",
  "namedStyleType",
  "pageBreakBefore",
  "shading",
  "spaceAbove",
  "spaceBelow",
  "spacingMode",
];

/** Reads a Docs API `Dimension` (`{ magnitude?, unit? }`) into a PT number, defaulting a missing magnitude to 0. */
export function dimensionPt(
  /** Raw dimension, or `undefined` when the field is unset. */
  dim: RawDimension | undefined,
): number {
  return dim?.magnitude ?? 0;
}

/** Builds a Docs API `Dimension` in PT from a plain number. */
export function dimensionFromPt(
  /** Magnitude in points. */
  pt: number,
): RawDimension {
  return { magnitude: pt, unit: "PT" };
}

/** Converts a Docs API `OptionalColor` into `#RRGGBB`, defaulting any missing channel to 0; `undefined` when no color is set at all. */
export function colorHexFromOptional(
  /** Raw optional color, or `undefined`/`{}` when unset. */
  optColor: RawOptionalColor | undefined,
): string | undefined {
  if (!optColor?.color) return undefined;
  return rgbToHex(optColor.color.rgbColor ?? {});
}

/** Builds a Docs API `OptionalColor` from a `#RRGGBB` (or bare `RRGGBB`) hex string. */
export function colorOptionalFromHex(
  /** Hex color string. */
  hex: string,
): RawOptionalColor {
  return { color: { rgbColor: hexToRgb(hex) } };
}

/**
 * Deep-canonicalizes a style-shaped JSON value: object keys sorted, `Dimension` objects get an
 * explicit `magnitude: 0` when absent, and `OptionalColor.color.rgbColor` objects get explicit
 * `0` channels when absent. An empty `OptionalColor` (`{}`, no `color` key — Docs' "explicit
 * transparent/inherit-none" marker) is left untouched, never coerced into a color.
 */
export function styleCanonical(
  /** Style-shaped value to canonicalize (object, array, or primitive). */
  value: unknown,
): unknown {
  if (Array.isArray(value)) return value.map(styleCanonical);
  if (value === null || typeof value !== "object") return value;
  const obj = value as JsonObject;
  if ("rgbColor" in obj) {
    return { rgbColor: rgbCanonical((obj.rgbColor as RawColor | undefined) ?? {}) };
  }
  if ("magnitude" in obj || "unit" in obj) {
    return { magnitude: (obj.magnitude as number | undefined) ?? 0, unit: (obj.unit as string | undefined) ?? "PT" };
  }
  const out: JsonObject = {};
  for (const key of Object.keys(obj).sort()) out[key] = styleCanonical(obj[key]);
  return out;
}

/** Picks a subset of fields from a style object, keeping only ones actually present. */
export function stylePick(
  /** Source style object. */
  style: JsonObject,
  /** Field names to keep. */
  fields: readonly string[],
): JsonObject {
  const out: JsonObject = {};
  for (const field of fields) if (field in style) out[field] = style[field];
  return out;
}

/** True when two style-shaped values are equal after canonicalization (key order and default-filling ignored). */
export function styleEqual(
  /** First value. */
  a: unknown,
  /** Second value. */
  b: unknown,
): boolean {
  return JSON.stringify(styleCanonical(a)) === JSON.stringify(styleCanonical(b));
}

/** Returns the subset of `fields` whose canonicalized value differs (added, removed, or changed) between `a` and `b`. */
export function styleFieldsChanged(
  /** "Before" style object. */
  a: JsonObject,
  /** "After" style object. */
  b: JsonObject,
  /** Field names to compare. */
  fields: readonly string[],
): string[] {
  return fields.filter((field) => !styleEqual(a[field], b[field]));
}

/** True when two suggestion-id arrays name the same set (order-insensitive; both absent/empty counts as equal). */
export function suggestionIdsEqual(
  /** First array, or `undefined`. */
  a: string[] | undefined,
  /** Second array, or `undefined`. */
  b: string[] | undefined,
): boolean {
  const sa = [...(a ?? [])].sort();
  const sb = [...(b ?? [])].sort();
  return sa.length === sb.length && sa.every((id, i) => id === sb[i]);
}

/** True when a font family name is a monospace/code font (matches by known name or a `mono`/`code`/`courier`/`console` substring). */
export function monospaceFontIs(
  /** Raw font family name, or `undefined`. */
  rawFont: string | undefined,
): boolean {
  if (!rawFont) return false;
  const font = rawFont.replace(/['"]/g, "").trim().toLowerCase();
  if (MONOSPACE_FONTS.has(font)) return true;
  return font.includes("mono") || font.includes("code") || font.includes("courier") || font.includes("console");
}

const MONOSPACE_FONTS: ReadonlySet<string> = new Set([
  "consolas",
  "courier",
  "courier new",
  "fira code",
  "inconsolata",
  "menlo",
  "monaco",
  "monospace",
  "pt mono",
  "roboto mono",
  "source code pro",
  "space mono",
  "ubuntu mono",
]);

/** Canonicalizes an rgb channel triple, defaulting any missing channel to 0. */
function rgbCanonical(rgb: RawColor): { blue: number; green: number; red: number } {
  // The API stores channels as float32 (17/255 reads back as 0.06666667), so compare at that precision.
  return { blue: Math.fround(rgb.blue ?? 0), green: Math.fround(rgb.green ?? 0), red: Math.fround(rgb.red ?? 0) };
}

/** Converts an rgb 0-1 channel triple (missing channels default to 0) into `#RRGGBB`. */
function rgbToHex(rgb: RawColor): string {
  const ch = (n: number | undefined) =>
    Math.round(Math.min(1, Math.max(0, n ?? 0)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(rgb.red)}${ch(rgb.green)}${ch(rgb.blue)}`.toUpperCase();
}

/** Parses `#RRGGBB` or `RRGGBB` into an rgb 0-1 channel triple; throws on any other shape. */
function hexToRgb(hex: string): { blue: number; green: number; red: number } {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Color must be #RRGGBB, got ${hex}`);
  return {
    blue: Number.parseInt(h.slice(4, 6), 16) / 255,
    green: Number.parseInt(h.slice(2, 4), 16) / 255,
    red: Number.parseInt(h.slice(0, 2), 16) / 255,
  };
}
