/*

Agent-facing constructors for detached node specs. Not yet in the document.
Kinds are Docs structural names — no p/q/ul/ol aliases.

*/

import type { InlineRunInput } from "../inline.ts";
import { assertWritable } from "./guards.ts";
import type { StylePatch } from "./style.ts";
import type { NamedStyle, ParagraphAlignment } from "./types.ts";

/**
 * Docs createParagraphBullets BulletGlyphPreset values.
 * Glyph text / start-at-N are not in the API — pick a preset.
 */
export const BULLET_GLYPH_PRESETS = [
  "BULLET_DISC_CIRCLE_SQUARE",
  "BULLET_DIAMONDX_ARROW3D_SQUARE",
  "BULLET_CHECKBOX",
  "BULLET_ARROW_DIAMOND_DISC",
  "BULLET_STAR_CIRCLE_SQUARE",
  "BULLET_ARROW3D_CIRCLE_SQUARE",
  "BULLET_LEFTTRIANGLE_DIAMOND_DISC",
  "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE",
  "BULLET_DIAMOND_CIRCLE_SQUARE",
  "NUMBERED_DECIMAL_ALPHA_ROMAN",
  "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS",
  "NUMBERED_DECIMAL_NESTED",
  "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
  "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL",
  "NUMBERED_ZERODECIMAL_ALPHA_ROMAN",
] as const;

/** Docs createParagraphBullets presets. */
export type BulletPreset = (typeof BULLET_GLYPH_PRESETS)[number];

const PRESET_SET = new Set<string>(BULLET_GLYPH_PRESETS);

/** Parses a Docs BulletGlyphPreset, or undefined. */
export function asBulletPreset(value: string): BulletPreset | undefined {
  return PRESET_SET.has(value) ? (value as BulletPreset) : undefined;
}

/** Agent-supplied bullet on a NORMAL_TEXT paragraph. */
export type BulletProps =
  | {
      nestingLevel?: number;
      preset?: BulletPreset;
    }
  | boolean;

/** indentStart escape hatch, in PT. */
export type IndentStart = { magnitude: number; unit: "PT" };

/** Props for createElement("paragraph", …). namedStyleType is required. */
export type CreateParagraphProps = {
  alignment?: ParagraphAlignment;
  bullet?: BulletProps;
  indentStart?: number | IndentStart;
  namedStyleType: NamedStyle;
  runs?: InlineRunInput[];
  style?: StylePatch;
  text: string;
  warnings?: string[];
};

/** Props for createElement("table", …). */
export type CreateTableProps = {
  rows: string[][];
  warnings?: string[];
};

/** Detached paragraph spec returned by createElement. */
export type ParagraphSpec = {
  alignment?: ParagraphAlignment;
  bullet?: { nestingLevel: number; preset: BulletPreset };
  indentStart?: IndentStart;
  kind: "paragraph";
  namedStyleType: NamedStyle;
  runs?: InlineRunInput[];
  style?: StylePatch;
  text: string;
  warnings?: string[];
};

/** Detached table spec returned by createElement. */
export type TableSpec = {
  kind: "table";
  table: { rows: string[][] };
  warnings?: string[];
};

export type PageBreakSpec = { kind: "pageBreak" };

export type SectionBreakSpec = {
  kind: "sectionBreak";
  sectionType?: "CONTINUOUS" | "NEXT_PAGE";
};

export type PersonChipSpec = {
  email: string;
  kind: "person";
};

export type RichLinkChipSpec = {
  kind: "richLink";
  mimeType?: string;
  title?: string;
  uri: string;
};

export type DateChipSpec = {
  dateFormat?: string;
  displayText?: string;
  kind: "date";
  timestamp?: string;
};

export type FootnoteSpec = {
  kind: "footnote";
  text?: string;
};

export type InlineImageSpec = {
  heightPt?: number;
  kind: "inlineImage";
  uri: string;
  widthPt?: number;
};

/** Props for createElement("codeBlock", …). */
export type CreateCodeBlockProps = {
  alignment?: ParagraphAlignment;
  language?: string;
  style?: StylePatch;
  text: string;
};

/** Detached node spec — not on the tape until insertAdjacentElement. */
export type ElementSpec =
  | ParagraphSpec
  | TableSpec
  | PageBreakSpec
  | SectionBreakSpec
  | PersonChipSpec
  | RichLinkChipSpec
  | DateChipSpec
  | FootnoteSpec
  | InlineImageSpec;

/** Sibling insert positions (HTML insertAdjacentElement names). */
export type SiblingPosition = "afterend" | "beforebegin";

/** All HTML positions; afterbegin/beforeend are refused. */
export type InsertPosition = SiblingPosition | "afterbegin" | "beforeend";

const KIND_ALIASES = new Set(["ol", "p", "q", "ul"]);

const UNSUPPORTED_KINDS: Record<string, string> = {
  bookmark: "Bookmarks cannot be inserted via REST API (read-only in Docs API).",
  columnBreak:
    "columnBreak cannot be inserted via REST API (Google Docs has no InsertColumnBreakRequest). Use sectionBreak with columnCount instead.",
  drawing: "Google Drawings cannot be created via REST API.",
  equation: "Math equations cannot be inserted via REST API (read-only in Docs API).",
  horizontalRule:
    "Horizontal rules cannot be inserted via REST API (Docs API has no insert request). Use paragraph bottom border instead.",
  hr: "Horizontal rules cannot be inserted via REST API (Docs API has no insert request). Use paragraph bottom border instead.",
  math: "Math equations cannot be inserted via REST API (read-only in Docs API).",
  tableOfContents: "Table of Contents cannot be created or updated via REST API.",
  toc: "Table of Contents cannot be created or updated via REST API.",
};

/** Builds a detached paragraph spec. */
export function createElement(
  kind: "paragraph",
  props: CreateParagraphProps,
  opts?: { force?: boolean },
): ParagraphSpec;
/** Builds a detached codeBlock paragraph spec (NORMAL_TEXT + Courier New 10pt). */
export function createElement(
  kind: "codeBlock",
  props: CreateCodeBlockProps,
  opts?: { force?: boolean },
): ParagraphSpec;
/** Builds a detached table spec. */
export function createElement(kind: "table", props: CreateTableProps, opts?: { force?: boolean }): TableSpec;
export function createElement(
  kind: "pageBreak",
  props?: Record<string, never>,
  opts?: { force?: boolean },
): PageBreakSpec;
export function createElement(
  kind: "sectionBreak",
  props?: { sectionType?: "CONTINUOUS" | "NEXT_PAGE" },
  opts?: { force?: boolean },
): SectionBreakSpec;
export function createElement(kind: "person", props: { email: string }, opts?: { force?: boolean }): PersonChipSpec;
export function createElement(
  kind: "richLink",
  props: { mimeType?: string; title?: string; uri: string },
  opts?: { force?: boolean },
): RichLinkChipSpec;
export function createElement(
  kind: "date",
  props?: { dateFormat?: string; displayText?: string; timestamp?: string },
  opts?: { force?: boolean },
): DateChipSpec;
export function createElement(kind: "footnote", props?: { text?: string }, opts?: { force?: boolean }): FootnoteSpec;
export function createElement(
  kind: "inlineImage",
  props: { heightPt?: number; uri: string; widthPt?: number },
  opts?: { force?: boolean },
): InlineImageSpec;
export function createElement(kind: string, props: unknown = {}, opts?: { force?: boolean }): ElementSpec {
  const pRecord = (props && typeof props === "object" ? props : {}) as Record<string, unknown>;
  if (UNSUPPORTED_KINDS[kind]) {
    throw new Error(`Cannot create "${kind}": ${UNSUPPORTED_KINDS[kind]}`);
  }
  if (KIND_ALIASES.has(kind)) {
    throw new Error(
      `Unknown kind "${kind}". Use createElement("paragraph", { namedStyleType, text }), "codeBlock", or "table". No p/q/ul/ol aliases.`,
    );
  }
  if (kind === "pageBreak") {
    return { kind: "pageBreak" };
  }
  if (kind === "sectionBreak") {
    const sp = pRecord as { sectionType?: "CONTINUOUS" | "NEXT_PAGE" };
    return { kind: "sectionBreak", sectionType: sp.sectionType ?? "NEXT_PAGE" };
  }
  if (kind === "person") {
    const pp = pRecord as { email: string };
    if (!pp.email) throw new Error('person chip requires "email"');
    return { email: pp.email, kind: "person" };
  }
  if (kind === "richLink") {
    const rp = pRecord as { mimeType?: string; title?: string; uri: string };
    if (!rp.uri) throw new Error('richLink requires "uri"');
    return {
      kind: "richLink",
      ...(rp.mimeType ? { mimeType: rp.mimeType } : {}),
      ...(rp.title ? { title: rp.title } : {}),
      uri: rp.uri,
    };
  }
  if (kind === "date") {
    const dp = pRecord as { dateFormat?: string; displayText?: string; timestamp?: string };
    return {
      kind: "date",
      ...(dp.dateFormat ? { dateFormat: dp.dateFormat } : {}),
      ...(dp.displayText ? { displayText: dp.displayText } : {}),
      ...(dp.timestamp ? { timestamp: dp.timestamp } : {}),
    };
  }
  if (kind === "footnote") {
    const fp = pRecord as { text?: string };
    return {
      kind: "footnote",
      ...(fp.text ? { text: fp.text } : {}),
    };
  }
  if (kind === "inlineImage") {
    const ip = pRecord as { heightPt?: number; uri: string; widthPt?: number };
    if (!ip.uri) throw new Error('inlineImage requires "uri"');
    return {
      kind: "inlineImage",
      ...(ip.heightPt != null ? { heightPt: ip.heightPt } : {}),
      uri: ip.uri,
      ...(ip.widthPt != null ? { widthPt: ip.widthPt } : {}),
    };
  }
  if (kind === "codeBlock") {
    const cp = props as CreateCodeBlockProps;
    const baseStyle: StylePatch = {
      fontFamily: "Courier New",
      fontSize: 10,
      lineSpacing: 100,
      ...(cp.style ?? {}),
    };
    const spec: ParagraphSpec = {
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: baseStyle,
      text: stripTrailingNewline(cp.text ?? ""),
    };
    if (cp.alignment) spec.alignment = cp.alignment;
    return spec;
  }
  if (kind === "table") {
    const tp = props as CreateTableProps;
    const rows = tp.rows;
    if (!rows?.length) throw new Error("table requires at least one row");
    const spec: TableSpec = {
      kind: "table",
      table: { rows: rows.map((row) => row.map(String)) },
    };
    if (tp.warnings?.length) spec.warnings = tp.warnings;
    return spec;
  }
  if (kind !== "paragraph") {
    throw new Error(`Unknown kind "${kind}". Use "paragraph", "codeBlock", "table", or "pageBreak".`);
  }

  const p = props as CreateParagraphProps;
  if (!p.namedStyleType) {
    throw new Error("paragraph requires namedStyleType (NORMAL_TEXT, HEADING_*, TITLE, SUBTITLE)");
  }

  const spec: ParagraphSpec = {
    kind: "paragraph",
    namedStyleType: p.namedStyleType,
    text: stripTrailingNewline(p.text ?? ""),
  };
  if (p.runs?.length) spec.runs = p.runs;
  if (p.alignment) spec.alignment = p.alignment;
  if (p.warnings?.length) spec.warnings = p.warnings;
  if (p.style && Object.keys(p.style).length) spec.style = p.style;
  if (p.bullet) {
    const bulletObj = typeof p.bullet === "boolean" ? {} : p.bullet;
    const preset = asBulletPreset(bulletObj.preset ?? "BULLET_DISC_CIRCLE_SQUARE");
    if (!preset) {
      throw new Error(
        `Unknown bullet preset "${bulletObj.preset}". Use a Docs BulletGlyphPreset (NUMBERED_* / BULLET_*).`,
      );
    }
    spec.bullet = {
      nestingLevel: bulletObj.nestingLevel ?? 0,
      preset,
    };
  }
  const indent = normalizeIndent(p.indentStart) ?? normalizeIndent(p.style?.indentStart);
  if (indent) spec.indentStart = indent;

  assertWritable(spec, opts);
  return spec;
}

/** Coerces a PT number or { magnitude, unit } indent. */
export function normalizeIndent(indent?: number | IndentStart): IndentStart | undefined {
  if (indent === undefined) return undefined;
  if (typeof indent === "number") return { magnitude: indent, unit: "PT" };
  return { magnitude: indent.magnitude, unit: "PT" };
}

/** Paragraph inner text in the tape has no trailing newline. */
export function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}

/** Builds an array of detached paragraph specs for a code block, split line-by-line per docs/style.md. */
export function createCodeBlock(props: CreateCodeBlockProps, opts?: { force?: boolean }): ParagraphSpec[] {
  const stripped = stripTrailingNewline(props.text ?? "");
  const lines = stripped.split("\n");
  const count = lines.length;
  return lines.map((line, idx) => {
    const isLast = idx === count - 1;
    const baseStyle: StylePatch = {
      fontFamily: "Courier New",
      fontSize: 10,
      lineSpacing: 100,
      ...(isLast ? {} : { spaceBelow: 0 }),
      ...(props.style ?? {}),
    };
    if (!isLast && props.style?.spaceBelow === undefined) {
      baseStyle.spaceBelow = 0;
    }
    const spec: ParagraphSpec = {
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: baseStyle,
      text: line,
    };
    if (props.alignment) spec.alignment = props.alignment;
    assertWritable(spec, opts);
    return spec;
  });
}
