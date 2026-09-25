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
 * Fixes any structural violation by inserting a brand-new empty `NORMAL_TEXT` paragraph (stamped with
 * `stamp`) wherever one is required; a valid sequence is returned unchanged (by value):
 * V1 the container ends with a paragraph; V2 every table/TOC/section break follows a paragraph;
 * S1 every *new* table/section break follows a *new* paragraph without a page break (the API inserts
 * structure at a paragraph start and splits off an empty paragraph the new one fills); P2 every *new*
 * page-break paragraph is followed by a paragraph (the API can't end a run of inserts with one).
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
    const prev = out.at(-1);
    const structure = block.kind === "table" || block.kind === "toc" || block.kind === "sectionBreak";
    const needsNewBefore = structure && block.kind !== "toc" && block.key.startsWith("n");
    const prevOk = needsNewBefore
      ? prev?.kind === "paragraph" && prev.key.startsWith("n") && !pageBreakParagraphIs(prev)
      : prev?.kind === "paragraph" && !(structure && pageBreakParagraphIs(prev) && prev.key.startsWith("n"));
    if (structure && !prevOk) out.push(paragraphEmptyCreate(keys, undefined, stamp));
    out.push(block);
  }
  const last = out.at(-1);
  if (last?.kind !== "paragraph" || (pageBreakParagraphIs(last) && last.key.startsWith("n"))) {
    out.push(paragraphEmptyCreate(keys, undefined, stamp));
  }
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

/** True for a paragraph holding only a page break. */
function pageBreakParagraphIs(block: Block): boolean {
  return (
    block.kind === "paragraph" &&
    block.inlines.length === 1 &&
    block.inlines[0].kind === "atom" &&
    block.inlines[0].type === "pageBreak"
  );
}
