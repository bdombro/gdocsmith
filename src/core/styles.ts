/*

Google Docs named style constants.

*/

/** API enum values for paragraph named styles. */
export const PARAGRAPH_STYLES = {
  HEADING_1: "HEADING_1",
  HEADING_2: "HEADING_2",
  HEADING_3: "HEADING_3",
  HEADING_4: "HEADING_4",
  HEADING_5: "HEADING_5",
  HEADING_6: "HEADING_6",
  NORMAL_TEXT: "NORMAL_TEXT",
  SUBTITLE: "SUBTITLE",
  TITLE: "TITLE",
} as const;

/** Union of valid API paragraph style names. */
export type ParagraphStyleName = (typeof PARAGRAPH_STYLES)[keyof typeof PARAGRAPH_STYLES];

/** Docs API bulletPreset values for unordered and ordered lists. */
export const BULLET_PRESETS = {
  ol: "NUMBERED_DECIMAL_NESTED",
  ul: "BULLET_DISC_CIRCLE_SQUARE",
} as const;
