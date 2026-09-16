/*

Refuse rules for surgical writes. Blank bullets demote the next heading.
Agent-facing names are Docs namedStyleType / bullet — not p/ul aliases.

*/

import { isHeadingStyle, type NamedStyle } from "./types.ts";

/** Blank / dash-only list item — Docs may eat the following heading. */
export const EMPTY_BULLET_MSG =
  'Empty or dash-only list item — createParagraphBullets on a blank item demotes the next heading. Use a visible placeholder like "<item>", not "", "-", or "–".';

/** Typed markdown/unicode glyph instead of a real Docs bullet. */
export const FAKE_BULLET_MSG =
  "Text starts with a markdown/unicode bullet. Use bullet: { preset } on NORMAL_TEXT, not a typed prefix.";

/** `1. ` / `1) ` in the text of a numbered list item. */
export const DOUBLE_NUMBER_MSG =
  "Numbered prefix on a bullet paragraph would double-number. Put the number in the list preset, not the text.";

/** Lists are NORMAL_TEXT paragraphs; headings cannot take bullet. */
export const HEADING_BULLET_MSG =
  "Cannot set bullet on TITLE, SUBTITLE, or HEADING_*. Lists are NORMAL_TEXT paragraphs.";

/** nestingLevel restyle on an existing item — tabs are already stripped. */
export const EXISTING_NEST_MSG =
  "Cannot change nestingLevel on an existing paragraph (leading tabs are already stripped). Insert a new item at the desired nestingLevel.";

/** Caution on innerText / remove: those ops replace the paragraph and destroy Drive smart chips. */
export const CHIP_MUTATE_MSG =
  "Caution: this paragraph has smart chips. innerText and remove destroy them. Query shows chips[].";

const DASH_ONLY = /^[-–—]$/;
const FAKE_BULLET_PREFIX = /^\s*[-–—*•◦●○■‣·]\s+/;
const NUMBERED_PREFIX = /^\s*\d+[.)]\s+/;

/** Fields guards need from a node spec or live paragraph. */
export type WritableText = {
  bullet?: { nestingLevel?: number } | boolean;
  chips?: unknown[];
  namedStyleType?: NamedStyle;
  text?: string;
};

/** True when the node has Docs smart chips (richLink). */
export function hasChips(node: { chips?: unknown[] } | undefined): boolean {
  return Boolean(node?.chips?.length);
}

/** True when list-item text is blank or a lone dash. */
export function isEmptyBulletText(text: string): boolean {
  const t = text.replace(/\n$/, "").trim();
  return !t || DASH_ONLY.test(t);
}

/** Typed markdown/unicode bullet prefix (`- item`, `• item`). */
export function isFakeBulletPrefix(text: string): boolean {
  return FAKE_BULLET_PREFIX.test(text.replace(/\n$/, ""));
}

/** `1. ` / `1) ` prefix that would double-number a Docs list. */
export function isNumberedPrefix(text: string): boolean {
  return NUMBERED_PREFIX.test(text.replace(/\n$/, ""));
}

/**
 * Refuses fragile list/heading writes. Pass `force` to override.
 * Throws on the first matching rule.
 */
export function assertWritable(node: WritableText, opts: { force?: boolean } = {}): void {
  if (opts.force) return;

  const text = node.text ?? "";
  const hasBullet = Boolean(node.bullet);

  if (hasBullet && isHeadingStyle(node.namedStyleType)) {
    throw new Error(HEADING_BULLET_MSG);
  }

  if (hasBullet && isEmptyBulletText(text)) {
    throw new Error(EMPTY_BULLET_MSG);
  }

  if (hasBullet && isNumberedPrefix(text)) {
    throw new Error(DOUBLE_NUMBER_MSG);
  }

  if (hasBullet && isFakeBulletPrefix(text)) {
    throw new Error(FAKE_BULLET_MSG);
  }

  if (!hasBullet && node.namedStyleType === "NORMAL_TEXT" && isFakeBulletPrefix(text)) {
    throw new Error(FAKE_BULLET_MSG);
  }
}
