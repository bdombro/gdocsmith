/*

Native Docs paragraph / text / cell / section style patches. Hex in, API rgb out.

*/

import type { CellContentAlignment, ParagraphAlignment, QueryTextStyle } from "./types.ts";

/** Optional style fields on a write op (`style`) or createElement. */
export type StylePatch = {
  alignment?: ParagraphAlignment;
  /** Text highlight (updateTextStyle.backgroundColor). */
  backgroundColor?: string;
  bold?: boolean;
  /** #RRGGBB on all four cell borders. Default width 1pt. Table or cell. */
  borderColor?: string;
  /** Border width in PT. Requires borderColor. */
  borderWidth?: number;
  /** Table cell fill. Table node = every cell; cell id = that cell. */
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
  fontFamily?: string;
  /** Point size. */
  fontSize?: number;
  /** Text color. */
  foregroundColor?: string;
  italic?: boolean;
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
  /** Points. */
  spaceAbove?: number;
  /** Points. */
  spaceBelow?: number;
  strikethrough?: boolean;
  underline?: boolean;
};

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

/** Docs default hanging (glyph at firstLine, text at indentStart). */
export const HANGING_INDENT_PT = 18;

/** Hanging first-line for a list indentStart (stacks at 0). */
export function hangingFirstLine(indentStart: number): number {
  return Math.max(0, indentStart - HANGING_INDENT_PT);
}

/** True when the patch sets paragraph indent. */
export function hasIndent(patch: StylePatch): boolean {
  return patch.indentStart != null || patch.indentFirstLine != null || patch.indentEnd != null;
}

/** Style patch without indent fields (insert applies those after bullets). */
export function omitIndent(patch: StylePatch): StylePatch {
  const next = { ...patch };
  delete next.indentStart;
  delete next.indentFirstLine;
  delete next.indentEnd;
  return next;
}

/** Fields that compile to table/column/cell chrome, not paragraph text. */
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

/** True when the patch sets table chrome (width, borders, padding, …). */
export function hasTableChrome(patch: StylePatch): boolean {
  return TABLE_CHROME_KEYS.some((k) => patch[k] !== undefined);
}

/** True when the object has at least one style field. */
export function hasStyle(patch: StylePatch | undefined): patch is StylePatch {
  if (!patch) return false;
  return STYLE_KEYS.some((k) => patch[k] !== undefined);
}

/** Docs rgbColor 0–1 from `#RRGGBB` or `RRGGBB`. */
export function rgbColor(hex: string): { blue: number; green: number; red: number } {
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

/** `#RRGGBB` from Docs rgbColor, or undefined. */
export function hexColor(rgb?: { blue?: number; green?: number; red?: number }): string | undefined {
  if (!rgb || typeof rgb.red !== "number") return undefined;
  const ch = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(rgb.red ?? 0)}${ch(rgb.green ?? 0)}${ch(rgb.blue ?? 0)}`.toUpperCase();
}

/** True if the font family represents a known monospace/code font. */
export function isMonospaceFont(rawFont?: string): boolean {
  if (!rawFont) return false;
  const font = rawFont.replace(/['"]/g, "").trim().toLowerCase();
  if (MONOSPACE_FONTS.has(font)) return true;
  if (font.includes("mono") || font.includes("code") || font.includes("courier") || font.includes("console")) {
    return true;
  }
  return false;
}

/** OptionalColor wrapper for shading / cell fill / text color. */
export function optionalColor(hex: string): object {
  return { color: { rgbColor: rgbColor(hex) } };
}

/** Magnitude+PT helper. */
export function pt(magnitude: number): { magnitude: number; unit: "PT" } {
  return { magnitude, unit: "PT" };
}

/** Docs NORMAL_TEXT body size — omit from query dumps. */
export const DEFAULT_FONT_SIZE_PT = 11;
const DEFAULT_FOREGROUND = "#000000";

/**
 * Uniform italic / fontSize / foregroundColor from text-run styles.
 * Omits italic false, 11pt, and black so compact query stays quiet on body text.
 */
export function uniformQueryTextStyle(styles: Array<Record<string, unknown> | undefined>): QueryTextStyle | undefined {
  if (!styles.length) return undefined;
  const chromes = styles.map(readRunChrome);
  const out: QueryTextStyle = {};
  if (chromes.every((c) => c.italic)) out.italic = true;
  const sizes = chromes.map((c) => c.fontSize);
  if (sizes.every((s) => s === sizes[0]) && sizes[0] != null && sizes[0] !== DEFAULT_FONT_SIZE_PT) {
    out.fontSize = sizes[0];
  }
  const colors = chromes.map((c) => c.foregroundColor);
  if (colors.every((c) => c === colors[0]) && colors[0] && colors[0].toUpperCase() !== DEFAULT_FOREGROUND) {
    out.foregroundColor = colors[0];
  }
  return Object.keys(out).length ? out : undefined;
}

function readRunChrome(style: Record<string, unknown> | undefined): {
  fontSize?: number;
  foregroundColor?: string;
  italic: boolean;
} {
  const s = style ?? {};
  const font = s.fontSize;
  let fontSize: number | undefined;
  if (font && typeof font === "object" && font !== null && "magnitude" in font) {
    const mag = (font as { magnitude?: unknown }).magnitude;
    if (typeof mag === "number") fontSize = mag;
  }
  const fg = s.foregroundColor;
  let foregroundColor: string | undefined;
  if (fg && typeof fg === "object" && fg !== null) {
    const rgb = (
      fg as {
        color?: { rgbColor?: { blue?: number; green?: number; red?: number } };
      }
    ).color?.rgbColor;
    foregroundColor = hexColor(rgb);
  }
  return {
    italic: s.italic === true,
    ...(fontSize != null ? { fontSize } : {}),
    ...(foregroundColor ? { foregroundColor } : {}),
  };
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
