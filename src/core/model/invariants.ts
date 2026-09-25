/* Structural invariants the reconciler must preserve when editing blocks (see G3 D10): every container ends with a paragraph (V1); every table/TOC/section-break is directly preceded by one (V2); a cell holds only paragraphs (V3, enforced statically by CellModel's type). */

import type { KeyAllocator } from "./keys.ts";
import type { JsonObject } from "./rawJson.ts";
import type { Block, EditStamp, ParagraphBlock } from "./types.ts";

/**
 * Validates V1/V2 over a sequence of sibling blocks (a tab body or a table cell), returning one
 * human-readable message per violation (empty when the sequence is valid).
 */
export function containerValidate(
  /** Blocks to validate, in order. */
  blocks: readonly Block[],
  /** Whether this container is a table cell (only affects wording). */
  opts: { inCell: boolean },
): string[] {
  const problems: string[] = [];
  const last = blocks.at(-1);
  if (last?.kind !== "paragraph") {
    problems.push(
      opts.inCell ? "cell does not end with a paragraph (V1)" : "container does not end with a paragraph (V1)",
    );
  }
  blocks.forEach((block, i) => {
    if (block.kind === "table" || block.kind === "toc" || block.kind === "sectionBreak") {
      const prev = blocks[i - 1];
      if (prev?.kind !== "paragraph") {
        problems.push(`block ${i} (${block.kind}) is not directly preceded by a paragraph (V2)`);
      }
    }
  });
  return problems;
}

/**
 * Fixes any V1/V2 violation by inserting a brand-new empty `NORMAL_TEXT` paragraph (stamped with
 * `stamp`) wherever one is required; a valid sequence is returned unchanged (by value).
 */
export function containerNormalize(
  /** Blocks to normalize, in order. */
  blocks: readonly Block[],
  /** Key allocator for any inserted paragraph. */
  keys: KeyAllocator,
  /** Edit stamp for any inserted paragraph. */
  stamp: EditStamp,
): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (
      (block.kind === "table" || block.kind === "toc" || block.kind === "sectionBreak") &&
      out.at(-1)?.kind !== "paragraph"
    ) {
      out.push(paragraphEmptyCreate(keys, undefined, stamp));
    }
    out.push(block);
  }
  if (out.at(-1)?.kind !== "paragraph") out.push(paragraphEmptyCreate(keys, undefined, stamp));
  return out;
}

/** Creates a brand-new empty paragraph (no bullet, no inline content). */
export function paragraphEmptyCreate(
  /** Key allocator. */
  keys: KeyAllocator,
  /** Explicit paragraph style (defaults to `{}`, i.e. `NORMAL_TEXT`). */
  style?: JsonObject,
  /** Edit stamp recording which step created it. */
  stamp?: EditStamp,
): ParagraphBlock {
  return {
    inlines: [],
    key: keys.next("n"),
    kind: "paragraph",
    newline: { style: {} },
    protected: false,
    stamp,
    style: style ?? {},
  };
}

/** True for an "invisible" paragraph: empty, `NORMAL_TEXT` (or unset), and not a list item (see G3 D25). */
export function blockInvisibleIs(
  /** Block to check. */
  block: Block,
): boolean {
  if (block.kind !== "paragraph") return false;
  if (block.bullet) return false;
  if (block.inlines.length > 0) return false;
  const namedStyleType = block.style.namedStyleType as string | undefined;
  return namedStyleType === undefined || namedStyleType === "NORMAL_TEXT";
}
