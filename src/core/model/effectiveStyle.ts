/* Computes effective (inherited-then-overridden) text/paragraph style and heading level (see G3 D8). */

import type { JsonObject } from "./rawJson.ts";
import { styleCanonical } from "./styleValues.ts";
import type { ParagraphBlock, TabModel } from "./types.ts";

const HEADING_LEVELS: Readonly<Record<string, number>> = {
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
  SUBTITLE: 1,
  TITLE: 0,
};

/** A tab's named-style definition (paragraph and text style) for one named style type, or `{}` fields when unset. */
export interface NamedTextStyle {
  /** Named style's paragraph-level style. */ paragraphStyle: JsonObject;
  /** Named style's run-level style. */ textStyle: JsonObject;
}

/** Looks up a tab's named-style definition for a given named style type (e.g. `"HEADING_1"`); `{}` fields when the tab defines no such entry. */
export function namedTextStyle(
  /** Tab whose `namedStyles` to read. */
  tab: TabModel,
  /** Named style type to look up. */
  type: string,
): NamedTextStyle {
  const styles =
    (
      tab.namedStyles as {
        styles?: Array<{ namedStyleType?: string; paragraphStyle?: JsonObject; textStyle?: JsonObject }>;
      }
    ).styles ?? [];
  const entry = styles.find((s) => s.namedStyleType === type);
  return { paragraphStyle: entry?.paragraphStyle ?? {}, textStyle: entry?.textStyle ?? {} };
}

/**
 * Computes a run's effective text style: the tab's `NORMAL_TEXT` text style, overridden by the
 * paragraph's named style's text style (when not `NORMAL_TEXT`), overridden by the run's own
 * explicit style (see G3 D8).
 */
export function textStyleEffective(
  /** Tab the paragraph belongs to. */
  tab: TabModel,
  /** Paragraph the run belongs to. */
  paragraph: ParagraphBlock,
  /** Run (or bullet) whose explicit style to layer on top. */
  run: { style?: JsonObject },
): JsonObject {
  const namedType = (paragraph.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
  const base = namedTextStyle(tab, "NORMAL_TEXT").textStyle;
  const named = namedType === "NORMAL_TEXT" ? {} : namedTextStyle(tab, namedType).textStyle;
  return styleCanonical({ ...base, ...named, ...(run.style ?? {}) }) as JsonObject;
}

/**
 * Computes a paragraph's effective paragraph style: the tab's `NORMAL_TEXT` paragraph style,
 * overridden by its own named style's paragraph style (when not `NORMAL_TEXT`), overridden by its
 * explicit style (see G3 D8).
 */
export function paragraphStyleEffective(
  /** Tab the paragraph belongs to. */
  tab: TabModel,
  /** Paragraph to compute. */
  paragraph: ParagraphBlock,
): JsonObject {
  const namedType = (paragraph.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
  const base = namedTextStyle(tab, "NORMAL_TEXT").paragraphStyle;
  const named = namedType === "NORMAL_TEXT" ? {} : namedTextStyle(tab, namedType).paragraphStyle;
  return styleCanonical({ ...base, ...named, ...paragraph.style }) as JsonObject;
}

/** Outline level for a named style type: `TITLE` 0, `SUBTITLE`/`HEADING_1` 1, ..., `HEADING_6` 6; `undefined` for `NORMAL_TEXT` or an unrecognized type. */
export function headingLevel(
  /** Named style type, or `undefined`. */
  namedStyleType: string | undefined,
): number | undefined {
  return namedStyleType ? HEADING_LEVELS[namedStyleType] : undefined;
}

/** True when a named style type is a heading (`TITLE`, `SUBTITLE`, or `HEADING_1`-`HEADING_6`). */
export function headingStyleIs(
  /** Named style type, or `undefined`. */
  namedStyleType: string | undefined,
): boolean {
  return headingLevel(namedStyleType) !== undefined;
}
