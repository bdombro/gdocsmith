/* Refuse rules for surgical writes. Blank bullets demote the next heading. */

import { headingStyleIs, type NamedStyle } from "./types.ts";

/**
 * Fields guards need from a node spec or live paragraph.
 */
export type WritableText = {
  /** Bullet configuration or boolean presence flag. */
  bullet?: { nestingLevel?: number } | boolean;
  /** Smart chips present on the node. */
  chips?: unknown[];
  /** Named paragraph style classification. */
  namedStyleType?: NamedStyle;
  /** Plain text content. */
  text?: string;
};

/**
 * Caution on innerText / remove: those ops replace the paragraph and destroy Drive smart chips.
 */
export const CHIP_MUTATE_MSG =
  "Caution: this paragraph has smart chips. innerText and remove destroy them. Query shows chips[].";

/**
 * `1. ` / `1) ` in the text of a numbered list item.
 */
export const DOUBLE_NUMBER_MSG =
  "Numbered prefix on a bullet paragraph would double-number. Put the number in the list preset, not the text.";

/**
 * Blank / dash-only list item — Docs may eat the following heading.
 */
export const EMPTY_BULLET_MSG =
  'Empty or dash-only list item — createParagraphBullets on a blank item demotes the next heading. Use a visible placeholder like "<item>", not "", "-", or "–".';

/**
 * nestingLevel restyle on an existing item — tabs are already stripped.
 */
export const EXISTING_NEST_MSG =
  "Cannot change nestingLevel on an existing paragraph (leading tabs are already stripped). Insert a new item at the desired nestingLevel.";

/**
 * Typed markdown/unicode glyph instead of a real Docs bullet.
 */
export const FAKE_BULLET_MSG =
  "Text starts with a markdown/unicode bullet. Use bullet: { preset } on NORMAL_TEXT, not a typed prefix.";

/**
 * Lists are NORMAL_TEXT paragraphs; headings cannot take bullet.
 */
export const HEADING_BULLET_MSG =
  "Cannot set bullet on TITLE, SUBTITLE, or HEADING_*. Lists are NORMAL_TEXT paragraphs.";

/**
 * True when list-item text is blank or a lone dash.
 */
export function bulletTextIsEmpty(
  /** Text content of list item to test. */
  text: string,
): boolean {
  const t = text.replace(/\n$/, "").trim();
  return !t || DASH_ONLY.test(t);
}

/**
 * Alias for bulletTextIsEmpty.
 */
export const isEmptyBulletText = bulletTextIsEmpty;

/**
 * True when the node has Docs smart chips (richLink, person, date).
 */
export function chipsHave(
  /** Candidate node with optional chips array. */
  node: { chips?: unknown[] } | undefined,
): boolean {
  return Boolean(node?.chips?.length);
}

/**
 * Alias for chipsHave.
 */
export const hasChips = chipsHave;

/**
 * True when text begins with a typed markdown or unicode bullet glyph.
 */
export function fakeBulletPrefixIs(
  /** String to inspect. */
  text: string,
): boolean {
  return FAKE_BULLET_PREFIX.test(text.replace(/\n$/, ""));
}

/**
 * Alias for fakeBulletPrefixIs.
 */
export const isFakeBulletPrefix = fakeBulletPrefixIs;

/**
 * True when text begins with a numbered list prefix like `1. ` or `1) `.
 */
export function numberedPrefixIs(
  /** String to inspect. */
  text: string,
): boolean {
  return NUMBERED_PREFIX.test(text.replace(/\n$/, ""));
}

/**
 * Alias for numberedPrefixIs.
 */
export const isNumberedPrefix = numberedPrefixIs;

/**
 * Refuses fragile list/heading writes. Pass `force` to override.
 * Throws on the first matching rule.
 */
export function writableAssert(
  /** Writable text properties to validate. */
  node: WritableText,
  /** Options including force override. */
  opts: { force?: boolean } = {},
): void {
  if (opts.force) return;

  const text = node.text ?? "";
  const hasBullet = Boolean(node.bullet);

  if (hasBullet && headingStyleIs(node.namedStyleType)) {
    throw new Error(HEADING_BULLET_MSG);
  }

  if (hasBullet && bulletTextIsEmpty(text)) {
    throw new Error(EMPTY_BULLET_MSG);
  }

  if (hasBullet && numberedPrefixIs(text)) {
    throw new Error(DOUBLE_NUMBER_MSG);
  }

  if (hasBullet && fakeBulletPrefixIs(text)) {
    throw new Error(FAKE_BULLET_MSG);
  }

  if (!hasBullet && node.namedStyleType === "NORMAL_TEXT" && fakeBulletPrefixIs(text)) {
    throw new Error(FAKE_BULLET_MSG);
  }
}

/**
 * Alias for writableAssert.
 */
export const assertWritable = writableAssert;

const DASH_ONLY = /^[-–—]$/;
const FAKE_BULLET_PREFIX = /^\s*[-–—*•◦●○■‣·]\s+/;
const NUMBERED_PREFIX = /^\s*\d+[.)]\s+/;
