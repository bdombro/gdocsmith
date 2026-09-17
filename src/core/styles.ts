/* Google Docs named style and list bullet preset constants. */

/**
 * Union of valid API paragraph style names.
 */
export type ParagraphStyleName = (typeof PARAGRAPH_STYLES)[keyof typeof PARAGRAPH_STYLES];

/**
 * Docs API bulletPreset values for unordered and ordered lists.
 */
export const BULLET_PRESETS = {
  /** Ordered nested decimal numbering preset. */
  ol: "NUMBERED_DECIMAL_NESTED",
  /** Unordered disc-circle-square bullet glyph preset. */
  ul: "BULLET_DISC_CIRCLE_SQUARE",
} as const;

/**
 * API enum values for paragraph named styles.
 */
export const PARAGRAPH_STYLES = {
  /** First level heading. */
  HEADING_1: "HEADING_1",
  /** Second level heading. */
  HEADING_2: "HEADING_2",
  /** Third level heading. */
  HEADING_3: "HEADING_3",
  /** Fourth level heading. */
  HEADING_4: "HEADING_4",
  /** Fifth level heading. */
  HEADING_5: "HEADING_5",
  /** Sixth level heading. */
  HEADING_6: "HEADING_6",
  /** Default body paragraph text style. */
  NORMAL_TEXT: "NORMAL_TEXT",
  /** Subtitle styling. */
  SUBTITLE: "SUBTITLE",
  /** Document title styling. */
  TITLE: "TITLE",
} as const;
