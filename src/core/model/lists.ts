/* List presets, membership-kind classification, and level indentation defaults (see G3 D9). */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawListNestingLevel } from "./rawJson.ts";
import { styleEqual } from "./styleValues.ts";
import type { BulletPreset, DocModel, ListDef } from "./types.ts";

/** Every Docs API `createParagraphBullets` glyph preset (v2's own copy of `BulletPreset`; see G3 M0's `types.ts`). */
export const BULLET_PRESETS: readonly BulletPreset[] = [
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
];

/** Default preset for a brand-new list of a given membership kind (see G3 D9). */
export const LIST_DEFAULT_PRESET: Record<"bullet" | "check" | "number", BulletPreset> = {
  bullet: "BULLET_DISC_CIRCLE_SQUARE",
  check: "BULLET_CHECKBOX",
  number: "NUMBERED_DECIMAL_ALPHA_ROMAN",
};

/** A preset's per-level (0-8) glyph fields (`glyphType`, `glyphSymbol`, `glyphFormat`, `startNumber`); never includes indent or `textStyle`. */
export type PresetLevels = readonly RawListNestingLevel[];

/** Maps a preset name to its recorded level table, from G3 M5's live conformance suite (`listPresets.json`; all 15 presets, levels 0-8). */
export type PresetTable = Partial<Record<BulletPreset, PresetLevels>>;

const GLYPH_FIELDS = ["bulletAlignment", "glyphFormat", "glyphSymbol", "glyphType"] as const;
const PRESET_TABLE_PATH = join(import.meta.dir, "listPresets.json");

let cachedPresetTable: PresetTable | undefined;

/** Loads the recorded preset table (empty `{}` until G3 M5 populates `listPresets.json`). */
export function listPresetTable(): PresetTable {
  if (!cachedPresetTable) {
    const loaded: PresetTable = existsSync(PRESET_TABLE_PATH)
      ? JSON.parse(readFileSync(PRESET_TABLE_PATH, "utf8"))
      : {};
    cachedPresetTable = loaded;
  }
  return cachedPresetTable;
}

/**
 * Recognizes a list's raw `nestingLevels` as one of the standard presets: every level's glyph
 * fields must exactly match the preset's table entry for that level (indent and `textStyle` are
 * ignored). Returns `undefined` when no preset matches or the table has no data for any preset
 * (see G3 D9).
 */
export function listPresetInfer(
  /** Raw per-level definitions to classify. */
  levels: readonly RawListNestingLevel[],
  /** Preset table to match against (defaults to the recorded one; tests can inject a synthetic table). */
  table: PresetTable = listPresetTable(),
): BulletPreset | undefined {
  for (const preset of BULLET_PRESETS) {
    const presetLevels = table[preset];
    if (!presetLevels || levels.length > presetLevels.length) continue;
    if (levels.every((level, i) => glyphFieldsEqual(level, presetLevels[i]))) return preset;
  }
  return undefined;
}

/**
 * Classifies a list's membership kind (checkbox, numbered, or bullet) at a given level. Uses the
 * recognized preset when set; otherwise falls back to the level's own raw `glyphType` (Docs API
 * checkboxes use `GLYPH_TYPE_UNSPECIFIED` with a checkbox `glyphSymbol`; a decimal/alpha/roman
 * `glyphType` means numbered; anything else is a bullet).
 */
export function listKind(
  /** List definition. */
  def: ListDef,
  /** 0-based nesting level. */
  level: number,
): "bullet" | "check" | "number" {
  if (def.preset === "BULLET_CHECKBOX") return "check";
  if (def.preset?.startsWith("NUMBERED_")) return "number";
  if (def.preset) return "bullet";
  const raw = def.nestingLevels[level] as RawListNestingLevel | undefined;
  const glyphSymbol = raw?.glyphSymbol as string | undefined;
  if (glyphSymbol === "☐" || glyphSymbol === "☑") return "check";
  if (typeof raw?.glyphType === "string" && raw.glyphType.length > 0 && raw.glyphType !== "GLYPH_TYPE_UNSPECIFIED")
    return "number";
  return "bullet";
}

/**
 * Default indent (PT) for a nesting level when no explicit neighbor value exists to copy (see G3
 * D19): `indentStart = 36 * (level + 1)`, `indentFirstLine = indentStart - 18`. Confirmed live
 * (G3 M5) across all 15 presets at every level 0-8 — indent is preset-independent. `def` is
 * accepted (not yet used) so a future per-preset override could be plugged in without changing
 * call sites, though none has been found to be necessary.
 */
export function listLevelIndent(
  /** List definition (currently unused; reserved for a future per-preset indent table). */
  _def: ListDef,
  /** 0-based nesting level. */
  level: number,
): { indentFirstLine: number; indentStart: number } {
  const indentStart = 36 * (level + 1);
  return { indentFirstLine: indentStart - 18, indentStart };
}

/**
 * Fills in `preset` on every list definition in a document by matching its raw `nestingLevels`
 * against the recorded preset table. Called once at the end of `docModelParse`.
 */
export function listPresetsApply(
  /** Document to annotate in place. */
  doc: DocModel,
): void {
  const table = listPresetTable();
  for (const tab of doc.tabs) {
    for (const list of Object.values(tab.lists)) list.preset = listPresetInfer(list.nestingLevels, table);
  }
}

/** True when two levels' glyph fields (and `startNumber`) match exactly. */
function glyphFieldsEqual(a: RawListNestingLevel, b: RawListNestingLevel | undefined): boolean {
  if (!b) return false;
  if ((a.startNumber ?? 1) !== (b.startNumber ?? 1)) return false;
  return GLYPH_FIELDS.every((field) => styleEqual(a[field], b[field]));
}
