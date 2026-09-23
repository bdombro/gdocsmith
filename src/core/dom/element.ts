/* Agent-facing constructors for detached node specs. Not yet in the document. */

import type { InlineRunInput } from "~/core/inline.ts";
import { assertWritable } from "./guards.ts";
import type { StylePatch } from "./style.ts";
import type { NamedStyle, ParagraphAlignment } from "./types.ts";

/**
 * Docs createParagraphBullets presets.
 */
export type BulletPreset = (typeof BULLET_GLYPH_PRESETS)[number];

/**
 * Agent-supplied bullet on a NORMAL_TEXT paragraph.
 */
export type BulletProps =
  | {
      /** Nesting level index (0-based). */
      nestingLevel?: number;
      /** Bullet glyph preset. */
      preset?: BulletPreset;
    }
  | boolean;

/**
 * Props for createElement("codeBlock", …).
 */
export type CreateCodeBlockProps = {
  /** Paragraph alignment. */
  alignment?: ParagraphAlignment;
  /** Language tag for code block. */
  language?: string;
  /** Custom style overrides. */
  style?: StylePatch;
  /** Code content text. */
  text: string;
};

/**
 * Props for createElement("paragraph", …). namedStyleType is required.
 */
export type CreateParagraphProps = {
  /** Text alignment. */
  alignment?: ParagraphAlignment;
  /** Bullet list settings. */
  bullet?: BulletProps;
  /** Custom indentation in points. */
  indentStart?: number | IndentStart;
  /** Docs named style classification. */
  namedStyleType: NamedStyle;
  /** Styled inline text runs. */
  runs?: InlineRunInput[];
  /** Native chips and images to insert at offsets inside this paragraph. */
  specials?: ParagraphInlineSpecial[];
  /** Custom style patch. */
  style?: StylePatch;
  /** Paragraph plain text content. */
  text: string;
  /** Warnings emitted during parsing or validation. */
  warnings?: string[];
};

/**
 * Props for createElement("table", …).
 */
export type CreateTableProps = {
  /** Per-cell inline specials aligned with `rows`. */
  cellSpecials?: Array<Array<ParagraphInlineSpecial[] | undefined>>;
  /** 2D matrix of cell text strings. */
  rows: string[][];
  /** Warning messages. */
  warnings?: string[];
};

/**
 * Detached date chip spec.
 */
export type DateChipSpec = {
  /** Date format pattern. */
  dateFormat?: string;
  /** Formatted display text. */
  displayText?: string;
  /** Structural kind identifier. */
  kind: "date";
  /** ISO timestamp string. */
  timestamp?: string;
};

/**
 * Detached node spec — not on the tape until insertAdjacentElement.
 */
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

/**
 * Detached footnote spec.
 */
export type FootnoteSpec = {
  /** Structural kind identifier. */
  kind: "footnote";
  /** Footnote text content. */
  text?: string;
};

/**
 * Indent start magnitude in PT.
 */
export type IndentStart = {
  /** Indent distance. */
  magnitude: number;
  /** Measurement unit. */
  unit: "PT";
};

/**
 * Detached inline image spec.
 */
export type InlineImageSpec = {
  /** Display height in points. */
  heightPt?: number;
  /** Structural kind identifier. */
  kind: "inlineImage";
  /** Image source URI. */
  uri: string;
  /** Display width in points. */
  widthPt?: number;
};

/**
 * Sibling and parent insert positions.
 */
export type InsertPosition = SiblingPosition | "afterbegin" | "beforeend";

/**
 * Detached page break spec.
 */
export type PageBreakSpec = {
  /** Structural kind identifier. */
  kind: "pageBreak";
};

/**
 * Native inline chip or image inserted at a character offset inside a paragraph or table cell.
 */
export type ParagraphInlineSpecial =
  | {
      /** Date format pattern. */
      dateFormat?: string;
      /** Formatted display text. */
      displayText?: string;
      /** Structural kind identifier. */
      kind: "date";
      /** UTF-16 offset in the paragraph/cell text. */
      offset: number;
      /** ISO timestamp. */
      timestamp: string;
    }
  | {
      /** Display height in points. */
      heightPt?: number;
      /** Structural kind identifier. */
      kind: "inlineImage";
      /** UTF-16 offset in the paragraph/cell text. */
      offset: number;
      /** Public HTTPS image URI. */
      uri: string;
      /** Display width in points. */
      widthPt?: number;
    }
  | {
      /** Person email. */
      email: string;
      /** Structural kind identifier. */
      kind: "person";
      /** UTF-16 offset in the paragraph/cell text. */
      offset: number;
    }
  | {
      /** Structural kind identifier. */
      kind: "richLink";
      /** Target MIME type. */
      mimeType?: string;
      /** UTF-16 offset in the paragraph/cell text. */
      offset: number;
      /** Display title. */
      title?: string;
      /** Target URI. */
      uri: string;
    };

/**
 * Detached paragraph spec returned by createElement.
 */
export type ParagraphSpec = {
  /** Paragraph alignment. */
  alignment?: ParagraphAlignment;
  /** Bullet configuration. */
  bullet?: {
    /** Zero-based nesting level. */
    nestingLevel: number;
    /** Bullet glyph preset. */
    preset: BulletPreset;
  };
  /** Start indentation. */
  indentStart?: IndentStart;
  /** Structural kind identifier. */
  kind: "paragraph";
  /** Named style classification. */
  namedStyleType: NamedStyle;
  /** Styled inline text runs. */
  runs?: InlineRunInput[];
  /** Native chips and images to insert at offsets inside this paragraph. */
  specials?: ParagraphInlineSpecial[];
  /** Custom style patch. */
  style?: StylePatch;
  /** Paragraph text content. */
  text: string;
  /** Parsing/validation warnings. */
  warnings?: string[];
};

/**
 * Detached person chip spec.
 */
export type PersonChipSpec = {
  /** Email address of mentioned person. */
  email: string;
  /** Structural kind identifier. */
  kind: "person";
};

/**
 * Detached rich link chip spec.
 */
export type RichLinkChipSpec = {
  /** Structural kind identifier. */
  kind: "richLink";
  /** Target MIME type. */
  mimeType?: string;
  /** Display title. */
  title?: string;
  /** Target link URI. */
  uri: string;
};

/**
 * Detached section break spec.
 */
export type SectionBreakSpec = {
  /** Structural kind identifier. */
  kind: "sectionBreak";
  /** Section break type. */
  sectionType?: "CONTINUOUS" | "NEXT_PAGE";
};

/**
 * Sibling insert positions (HTML insertAdjacentElement names).
 */
export type SiblingPosition = "afterend" | "beforebegin";

/**
 * Detached table spec returned by createElement.
 */
export type TableSpec = {
  /** Structural kind identifier. */
  kind: "table";
  /** Table rows container. */
  table: {
    /** Per-cell inline specials aligned with `rows` (optional). */
    cellSpecials?: Array<Array<ParagraphInlineSpecial[] | undefined>>;
    /** Matrix of string cell contents. */
    rows: string[][];
  };
  /** Parsing/validation warnings. */
  warnings?: string[];
};

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

/**
 * Parses a Docs BulletGlyphPreset string or returns undefined.
 */
export function bulletPresetAs(
  /** Raw preset string to parse. */
  value: string,
): BulletPreset | undefined {
  return PRESET_SET.has(value) ? (value as BulletPreset) : undefined;
}

/**
 * Alias for bulletPresetAs.
 */
export const asBulletPreset = bulletPresetAs;

/**
 * Builds an array of detached paragraph specs for a code block, split line-by-line per docs/style.md.
 */
export function codeBlockCreate(
  /** Code block creation properties. */
  props: CreateCodeBlockProps,
  /** Options including force override. */
  opts?: { force?: boolean },
): ParagraphSpec[] {
  const stripped = trailingNewlineStrip(props.text ?? "");
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

/**
 * Alias for codeBlockCreate.
 */
export const createCodeBlock = codeBlockCreate;

/**
 * Builds a detached element specification for inserting into the document.
 */
export function elementCreate(
  kind: "paragraph",
  props: CreateParagraphProps,
  opts?: { force?: boolean },
): ParagraphSpec;
export function elementCreate(
  kind: "codeBlock",
  props: CreateCodeBlockProps,
  opts?: { force?: boolean },
): ParagraphSpec;
export function elementCreate(kind: "table", props: CreateTableProps, opts?: { force?: boolean }): TableSpec;
export function elementCreate(
  kind: "pageBreak",
  props?: Record<string, never>,
  opts?: { force?: boolean },
): PageBreakSpec;
export function elementCreate(
  kind: "sectionBreak",
  props?: { sectionType?: "CONTINUOUS" | "NEXT_PAGE" },
  opts?: { force?: boolean },
): SectionBreakSpec;
export function elementCreate(kind: "person", props: { email: string }, opts?: { force?: boolean }): PersonChipSpec;
export function elementCreate(
  kind: "richLink",
  props: { mimeType?: string; title?: string; uri: string },
  opts?: { force?: boolean },
): RichLinkChipSpec;
export function elementCreate(
  kind: "date",
  props?: { dateFormat?: string; displayText?: string; timestamp?: string },
  opts?: { force?: boolean },
): DateChipSpec;
export function elementCreate(kind: "footnote", props?: { text?: string }, opts?: { force?: boolean }): FootnoteSpec;
export function elementCreate(
  kind: "inlineImage",
  props: { heightPt?: number; uri: string; widthPt?: number },
  opts?: { force?: boolean },
): InlineImageSpec;
export function elementCreate(
  /** Structural kind of element to construct. */
  kind: string,
  /** Properties corresponding to the element kind. */
  props: unknown = {},
  /** Construction options such as force bypass. */
  opts?: { force?: boolean },
): ElementSpec {
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
      text: trailingNewlineStrip(cp.text ?? ""),
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
    if (tp.cellSpecials?.length) spec.table.cellSpecials = tp.cellSpecials;
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
    text: trailingNewlineStrip(p.text ?? ""),
  };
  if (p.runs?.length) spec.runs = p.runs;
  if (p.specials?.length) spec.specials = p.specials;
  if (p.alignment) spec.alignment = p.alignment;
  if (p.warnings?.length) spec.warnings = p.warnings;
  if (p.style && Object.keys(p.style).length) spec.style = p.style;
  if (p.bullet) {
    const bulletObj = typeof p.bullet === "boolean" ? {} : p.bullet;
    const preset = bulletPresetAs(bulletObj.preset ?? "BULLET_DISC_CIRCLE_SQUARE");
    if (!preset) {
      throw new Error(
        `Unknown bullet preset "${bulletObj.preset}". Use a Docs BulletGlyphPreset (NUMBERED_* / BULLET_*).`,
      );
    }
    spec.bullet = {
      nestingLevel: bulletObj.nestingLevel ?? 0,
      preset,
    };
    // List items otherwise inherit spaceAbove/spaceBelow from whatever paragraph precedes
    // the insertion point, producing large visual gaps between siblings of the same list
    // even though numbering/bullets render correctly. Default to tight spacing; explicit
    // caller overrides in p.style still win.
    spec.style = { spaceAbove: 0, spaceBelow: 0, ...spec.style };
  }
  const indent = indentNormalize(p.indentStart) ?? indentNormalize(p.style?.indentStart);
  if (indent) spec.indentStart = indent;

  assertWritable(spec, opts);
  return spec;
}

/**
 * Alias for elementCreate.
 */
export const createElement = elementCreate;

/**
 * Coerces a PT number or { magnitude, unit } indent into IndentStart.
 */
export function indentNormalize(
  /** Indent specification to normalize. */
  indent?: number | IndentStart,
): IndentStart | undefined {
  if (indent === undefined) return undefined;
  if (typeof indent === "number") return { magnitude: indent, unit: "PT" };
  return { magnitude: indent.magnitude, unit: "PT" };
}

/**
 * Alias for indentNormalize.
 */
export const normalizeIndent = indentNormalize;

/**
 * Paragraph inner text in the tape has no trailing newline.
 */
export function trailingNewlineStrip(
  /** String to strip trailing newline from. */
  text: string,
): string {
  return text.replace(/\n$/, "");
}

/**
 * Alias for trailingNewlineStrip.
 */
export const stripTrailingNewline = trailingNewlineStrip;

const KIND_ALIASES = new Set(["ol", "p", "q", "ul"]);
const PRESET_SET = new Set<string>(BULLET_GLYPH_PRESETS);
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
