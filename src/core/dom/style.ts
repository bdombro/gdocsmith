/* Native Docs paragraph / text / cell / section style patches. Hex in, API rgb out. */

import type { CellContentAlignment, ParagraphAlignment, QueryTextStyle } from "./types.ts";

/**
 * Optional style fields on a write op (`style`) or createElement.
 */
export type StylePatch = {
  /** Paragraph alignment. */
  alignment?: ParagraphAlignment;
  /** Text highlight background color hex string (updateTextStyle.backgroundColor). */
  backgroundColor?: string;
  /** Bold text flag. */
  bold?: boolean;
  /** #RRGGBB on all four cell borders. Default width 1pt. Table or cell. */
  borderColor?: string;
  /** Border width in PT. Requires borderColor. */
  borderWidth?: number;
  /** Table cell fill color hex string. Table node = every cell; cell id = that cell. */
  cellBackground?: string;
  /** Cell padding in PT (all four sides). Table or cell. */
  cellPadding?: number;
  /** Explicit alias for cell paragraph alignment across a table or cell. */
  cellTextAlignment?: ParagraphAlignment;
  /** Section columns (Format > Columns). Only on sectionBreak. */
  columnCount?: number;
  /** FIXED_WIDTH column(s) in PT (min 5). Table = all columns; cell = that column. */
  columnWidth?: number;
  /** Vertical cell alignment. Table or cell. */
  contentAlignment?: CellContentAlignment;
  /** Font family name. */
  fontFamily?: string;
  /** Font size in points. */
  fontSize?: number;
  /** Text foreground color hex string. */
  foregroundColor?: string;
  /** Right indent in PT (updateParagraphStyle.indentEnd). */
  indentEnd?: number;
  /**
   * Glyph position in PT. Docs hanging lists: glyph here, text at indentStart.
   * On a bullet, omitted with indentStart → indentStart − 18.
   */
  indentFirstLine?: number;
  /**
   * Text indent in PT. Same field on insert and restyle. Flush level-0 list:
   * indentStart 18 + indentFirstLine 0. Not a nest — use nestingLevel.
   */
  indentStart?: number;
  /** Italic text flag. */
  italic?: boolean;
  /** 100 = single, 150 = 1.5, 200 = double. */
  lineSpacing?: number;
  /** Minimum row height in PT. Table = all rows; cell = that row. */
  minRowHeight?: number;
  /** Number of pinned header rows. Table node only. */
  pinnedHeaderRows?: number;
  /** Prevent table row from overflowing across page boundaries. Table or cell/row. */
  preventOverflow?: boolean;
  /** Paragraph fill (updateParagraphStyle.shading). */
  shading?: string;
  /** Space above paragraph in points. */
  spaceAbove?: number;
  /** Space below paragraph in points. */
  spaceBelow?: number;
  /** Strikethrough text flag. */
  strikethrough?: boolean;
  /** Underline text flag. */
  underline?: boolean;
};

/**
 * Docs NORMAL_TEXT body size — omit from query dumps.
 */
export const DEFAULT_FONT_SIZE_PT = 11;

/**
 * Docs default hanging (glyph at firstLine, text at indentStart).
 */
export const HANGING_INDENT_PT = 18;

/**
 * Fields that compile to table/column/cell chrome, not paragraph text.
 */
export const TABLE_CHROME_KEYS: readonly (keyof StylePatch)[] = [
  "borderColor",
  "borderWidth",
  "cellBackground",
  "cellPadding",
  "columnWidth",
  "contentAlignment",
  "minRowHeight",
  "pinnedHeaderRows",
  "preventOverflow",
];

/**
 * Converts Docs rgbColor 0–1 object to `#RRGGBB` hex string, or returns undefined.
 */
export function colorHex(
  /** Docs API rgb color object. */
  rgb?: { blue?: number; green?: number; red?: number },
): string | undefined {
  if (!rgb || typeof rgb.red !== "number") return undefined;
  const ch = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(rgb.red ?? 0)}${ch(rgb.green ?? 0)}${ch(rgb.blue ?? 0)}`.toUpperCase();
}

/**
 * Alias for colorHex.
 */
export const hexColor = colorHex;

/**
 * Converts a hex color string into HSL values (h: 0-360, s: 0-1, l: 0-1).
 */
export function colorHsl(
  /** Hex color string (#RRGGBB, #RGB, or RRGGBB). */
  hex: string,
): { h: number; l: number; s: number } {
  let clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { h: 0, l: 0, s: 0 };
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) {
    return { h: 0, l, s: 0 };
  }
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === r) {
    h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / delta + 2) * 60;
  } else {
    h = ((r - g) / delta + 4) * 60;
  }
  return { h, l, s };
}

/**
 * Alias for colorHsl.
 */
export const hslColor = colorHsl;

/**
 * Tests whether a hex color matches a pattern (semantic name, hex code, or "default").
 */
export function colorMatchesPattern(
  /** Hex color string to test. */
  hex: string,
  /** Color pattern to match (e.g. "red", "#ea4335", "default"). */
  pattern: string,
): boolean {
  const normPat = pattern.trim().toLowerCase();
  const normHex = hex.trim().toLowerCase().replace(/^#/, "");
  const formattedHex = `#${normHex}`;

  if (normPat === "default" || normPat === "#000000" || normPat === "000000") {
    return normHex === "000000" || normHex === "";
  }

  const patClean = normPat.replace(/^#/, "");
  if (/^[0-9a-f]{3,6}$/.test(patClean) && (patClean.length === 3 || patClean.length === 6)) {
    const fullPat =
      patClean.length === 3
        ? patClean
            .split("")
            .map((c) => c + c)
            .join("")
        : patClean;
    return normHex === fullPat;
  }

  const { h, l, s } = colorHsl(formattedHex);

  switch (normPat) {
    case "red":
      return (h >= 345 || h <= 15) && s >= 0.25 && l >= 0.15 && l <= 0.85;
    case "orange":
      return h > 15 && h < 40 && s >= 0.25 && l >= 0.15 && l <= 0.85;
    case "yellow":
      return h >= 40 && h <= 70 && s >= 0.25 && l >= 0.2 && l <= 0.85;
    case "green":
      return h > 70 && h <= 165 && s >= 0.2 && l >= 0.15 && l <= 0.85;
    case "blue":
      return h >= 180 && h <= 260 && s >= 0.2 && l >= 0.15 && l <= 0.85;
    case "purple":
      return h > 260 && h < 345 && s >= 0.2 && l >= 0.15 && l <= 0.85;
    case "gray":
    case "grey":
      return s < 0.18 && l >= 0.15 && l <= 0.85;
    default:
      return false;
  }
}

/**
 * Alias for colorMatchesPattern.
 */
export const matchesColorPattern = colorMatchesPattern;

/**
 * Wraps hex color in OptionalColor object for Docs API.
 */
export function colorOptional(
  /** Hex color string. */
  hex: string,
): object {
  return { color: { rgbColor: colorRgb(hex) } };
}

/**
 * Alias for colorOptional.
 */
export const optionalColor = colorOptional;

/**
 * Parses `#RRGGBB` or `RRGGBB` hex string into Docs API rgbColor (0-1).
 */
export function colorRgb(
  /** Hex color string. */
  hex: string,
): { blue: number; green: number; red: number } {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Color must be #RRGGBB, got ${hex}`);
  }
  return {
    blue: parseInt(h.slice(4, 6), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    red: parseInt(h.slice(0, 2), 16) / 255,
  };
}

/**
 * Alias for colorRgb.
 */
export const rgbColor = colorRgb;

/**
 * Calculates hanging first-line indent in PT for a list indentStart.
 */
export function firstLineHanging(
  /** Indent start in points. */
  indentStart: number,
): number {
  return Math.max(0, indentStart - HANGING_INDENT_PT);
}

/**
 * Alias for firstLineHanging.
 */
export const hangingFirstLine = firstLineHanging;

/**
 * Evaluates a list of foreground colors against positive and negative patterns.
 */
export function fontColorsMatch(
  /** Array of hex color strings present on the node or cell. */
  colors: string[],
  /** Array of patterns to match (e.g. ["red"], ["!#000000"], ["!default"]). */
  patterns: string[],
): boolean {
  if (!patterns.length) return true;
  const positive = patterns.filter((p) => !p.startsWith("!"));
  const negative = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1).trim());

  const defaultExclusions = negative.filter((n) => n.toLowerCase() === "default" || n === "#000000" || n === "000000");
  const specificExclusions = negative.filter((n) => n.toLowerCase() !== "default" && n !== "#000000" && n !== "000000");

  if (specificExclusions.length > 0) {
    if (colors.some((c) => specificExclusions.some((pat) => colorMatchesPattern(c, pat)))) {
      return false;
    }
  }

  if (defaultExclusions.length > 0) {
    const hasNonDefault = colors.some((c) => !colorMatchesPattern(c, "default"));
    if (!hasNonDefault) return false;
  }

  if (positive.length > 0) {
    const effectiveColors = colors.length > 0 ? colors : ["#000000"];
    if (!effectiveColors.some((c) => positive.some((pat) => colorMatchesPattern(c, pat)))) {
      return false;
    }
  }

  return true;
}

/**
 * Alias for fontColorsMatch.
 */
export const matchFontColors = fontColorsMatch;

/**
 * True when the patch specifies indentation fields.
 */
export function indentHas(
  /** Style patch to check. */
  patch: StylePatch,
): boolean {
  return patch.indentStart != null || patch.indentFirstLine != null || patch.indentEnd != null;
}

/**
 * Alias for indentHas.
 */
export const hasIndent = indentHas;

/**
 * Creates a shallow copy of patch without indent fields.
 */
export function indentOmit(
  /** Source style patch. */
  patch: StylePatch,
): StylePatch {
  const next = { ...patch };
  delete next.indentStart;
  delete next.indentFirstLine;
  delete next.indentEnd;
  return next;
}

/**
 * Alias for indentOmit.
 */
export const omitIndent = indentOmit;

/**
 * Checks if the font family represents a monospace / code font.
 */
export function monospaceFontIs(
  /** Raw font family name. */
  rawFont?: string,
): boolean {
  if (!rawFont) return false;
  const font = rawFont.replace(/['"]/g, "").trim().toLowerCase();
  if (MONOSPACE_FONTS.has(font)) return true;
  if (font.includes("mono") || font.includes("code") || font.includes("courier") || font.includes("console")) {
    return true;
  }
  return false;
}

/**
 * Alias for monospaceFontIs.
 */
export const isMonospaceFont = monospaceFontIs;

/**
 * Helper to construct a magnitude in PT object.
 */
export function point(
  /** Magnitude number. */
  magnitude: number,
): { magnitude: number; unit: "PT" } {
  return { magnitude, unit: "PT" };
}

/**
 * Alias for point.
 */
export const pt = point;

/**
 * Extracts uniform italic / fontSize / foregroundColor from text-run styles.
 */
export function queryTextStyleUniform(
  /** Array of run text style dictionaries. */
  styles: Array<Record<string, unknown> | undefined>,
): QueryTextStyle | undefined {
  if (!styles.length) return undefined;
  const chromes = styles.map(readRunChrome);
  /** The shared value of a property across every run, or undefined when runs disagree. */
  const uniform = <K extends keyof QueryTextStyle>(key: K): QueryTextStyle[K] | undefined => {
    const values = chromes.map((c) => c[key]);
    return values.every((v) => v === values[0]) ? values[0] : undefined;
  };
  return queryTextStyleNormalize({
    backgroundColor: uniform("backgroundColor"),
    baselineOffset: uniform("baselineOffset"),
    bold: uniform("bold"),
    fontFamily: uniform("fontFamily"),
    fontSize: uniform("fontSize"),
    fontWeight: uniform("fontWeight"),
    foregroundColor: uniform("foregroundColor"),
    italic: uniform("italic"),
    link: uniform("link"),
    smallCaps: uniform("smallCaps"),
    strikethrough: uniform("strikethrough"),
    underline: uniform("underline"),
  });
}

/** Boolean run properties recorded only when true, since false is the document default. */
const QUERY_TEXT_STYLE_FLAGS = ["bold", "italic", "smallCaps", "strikethrough", "underline"] as const;

/**
 * Drops document defaults from candidate run chrome, yielding the `QueryTextStyle` a node carries.
 *
 * The single place these rules live: flags are recorded only when true, and size and foreground
 * color only when they differ from the document default. Both the parser (reading a document) and
 * the writer (mirroring a style patch onto the tape) normalize through here, so a mirrored patch
 * and a re-read of the same document cannot disagree.
 */
export function queryTextStyleNormalize(
  /** Candidate uniform run styling, before defaults are dropped. */
  chrome: QueryTextStyle,
): QueryTextStyle | undefined {
  const out: QueryTextStyle = {};
  for (const flag of QUERY_TEXT_STYLE_FLAGS) {
    if (chrome[flag]) out[flag] = true;
  }
  if (chrome.baselineOffset) out.baselineOffset = chrome.baselineOffset;
  if (chrome.fontFamily) out.fontFamily = chrome.fontFamily;
  if (chrome.fontWeight != null) out.fontWeight = chrome.fontWeight;
  if (chrome.link) out.link = chrome.link;
  if (chrome.backgroundColor) out.backgroundColor = chrome.backgroundColor;
  if (chrome.fontSize != null && chrome.fontSize !== DEFAULT_FONT_SIZE_PT) out.fontSize = chrome.fontSize;
  if (chrome.foregroundColor && chrome.foregroundColor.toUpperCase() !== DEFAULT_FOREGROUND) {
    out.foregroundColor = chrome.foregroundColor;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Alias for queryTextStyleUniform.
 */
export const uniformQueryTextStyle = queryTextStyleUniform;

/**
 * Extracts every run styling property a Docs `textStyle` can carry.
 *
 * Mirrors the Docs `TextStyle` resource one-for-one so a query reports what the document actually
 * says. Defaults are kept here and dropped later by {@link queryTextStyleNormalize}.
 */
export function runChromeRead(
  /** Raw textStyle dictionary from a Docs textRun. */
  style: Record<string, unknown> | undefined,
): QueryTextStyle {
  const s = style ?? {};
  const offset = s.baselineOffset;
  const weighted = s.weightedFontFamily as { fontFamily?: unknown; weight?: unknown } | undefined;
  const fontFamily = typeof weighted?.fontFamily === "string" ? weighted.fontFamily : undefined;
  const fontWeight = typeof weighted?.weight === "number" ? weighted.weight : undefined;
  const link = (s.link as { url?: unknown } | undefined)?.url;
  return {
    ...(s.bold === true ? { bold: true } : {}),
    ...(s.italic === true ? { italic: true } : {}),
    ...(s.smallCaps === true ? { smallCaps: true } : {}),
    ...(s.strikethrough === true ? { strikethrough: true } : {}),
    ...(s.underline === true ? { underline: true } : {}),
    ...(offset === "SUBSCRIPT" || offset === "SUPERSCRIPT" ? { baselineOffset: offset } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontWeight != null ? { fontWeight } : {}),
    ...(typeof link === "string" && link ? { link } : {}),
    ...optionalDimension("fontSize", s.fontSize),
    ...optionalColorHex("backgroundColor", s.backgroundColor),
    ...optionalColorHex("foregroundColor", s.foregroundColor),
  };
}

/** Reads a Docs `Dimension` magnitude into a named field, or nothing when absent. */
function optionalDimension(
  /** Field name to emit. */
  key: "fontSize",
  /** Raw Docs Dimension value. */
  raw: unknown,
): { fontSize?: number } {
  if (!raw || typeof raw !== "object" || !("magnitude" in raw)) return {};
  const mag = (raw as { magnitude?: unknown }).magnitude;
  return typeof mag === "number" ? { [key]: mag } : {};
}

/** Reads a Docs `OptionalColor` into a named hex field, or nothing when absent. */
function optionalColorHex<K extends "backgroundColor" | "foregroundColor">(
  /** Field name to emit. */
  key: K,
  /** Raw Docs OptionalColor value. */
  raw: unknown,
): Partial<Record<K, string>> {
  if (!raw || typeof raw !== "object") return {};
  const rgb = (raw as { color?: { rgbColor?: { blue?: number; green?: number; red?: number } } }).color?.rgbColor;
  const hex = colorHex(rgb);
  return hex ? ({ [key]: hex } as Record<K, string>) : {};
}

/**
 * Alias for runChromeRead.
 */
export const readRunChrome = runChromeRead;

/**
 * True when the object has at least one style field defined.
 */
export function styleHas(
  /** Potential style patch. */
  patch: StylePatch | undefined,
): patch is StylePatch {
  if (!patch) return false;
  return STYLE_KEYS.some((k) => patch[k] !== undefined);
}

/**
 * Alias for styleHas.
 */
export const hasStyle = styleHas;

/**
 * True when the patch sets table chrome (width, borders, padding, etc.).
 */
export function tableChromeHas(
  /** Style patch to check. */
  patch: StylePatch,
): boolean {
  return TABLE_CHROME_KEYS.some((k) => patch[k] !== undefined);
}

/**
 * Alias for tableChromeHas.
 */
export const hasTableChrome = tableChromeHas;

const DEFAULT_FOREGROUND = "#000000";

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

const STYLE_KEYS: readonly (keyof StylePatch)[] = [
  "alignment",
  "backgroundColor",
  "bold",
  "borderColor",
  "borderWidth",
  "cellBackground",
  "cellPadding",
  "cellTextAlignment",
  "columnCount",
  "columnWidth",
  "contentAlignment",
  "fontFamily",
  "fontSize",
  "foregroundColor",
  "italic",
  "indentEnd",
  "indentFirstLine",
  "indentStart",
  "lineSpacing",
  "minRowHeight",
  "pinnedHeaderRows",
  "preventOverflow",
  "shading",
  "spaceAbove",
  "spaceBelow",
  "strikethrough",
  "underline",
];
