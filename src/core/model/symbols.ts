/* A paragraph's visible content as a flat symbol sequence (one code point or one atom each) for diffing and splicing (G3 D7). */

import type { JsonObject } from "./rawJson.ts";
import { styleEqual, suggestionIdsEqual } from "./styleValues.ts";
import type { Atom, Inline, ParagraphBlock, TextRun } from "./types.ts";

/** One visible character (a whole code point, so a surrogate pair is one symbol) with its run's style. */
export interface CharSym {
  /** The code point (1 or 2 UTF-16 units). */ ch: string;
  /** Discriminant. */ kind: "char";
  /** Explicit text style. */ style: JsonObject;
  /** Suggested-deletion ids from its run. */ suggestedDeletionIds?: string[];
  /** Suggested-insertion ids from its run. */ suggestedInsertionIds?: string[];
  /** Suggested style changes from its run. */ suggestedTextStyleChanges?: JsonObject;
}

/** One atom (chip, image, break, …). */
export interface AtomSym {
  /** The atom itself. */ atom: Atom;
  /** Discriminant. */ kind: "atom";
}

/** One element of a paragraph's symbol sequence. */
export type Sym = AtomSym | CharSym;

/** A paragraph's inlines as symbols, in order. */
export function paragraphSymbols(
  /** Paragraph to read. */
  paragraph: ParagraphBlock,
): Sym[] {
  const out: Sym[] = [];
  for (const inline of paragraph.inlines) {
    if (inline.kind === "atom") {
      out.push({ atom: inline, kind: "atom" });
      continue;
    }
    for (const ch of Array.from(inline.text)) {
      const sym: CharSym = { ch, kind: "char", style: inline.style };
      if (inline.suggestedDeletionIds) sym.suggestedDeletionIds = inline.suggestedDeletionIds;
      if (inline.suggestedInsertionIds) sym.suggestedInsertionIds = inline.suggestedInsertionIds;
      if (inline.suggestedTextStyleChanges) sym.suggestedTextStyleChanges = inline.suggestedTextStyleChanges;
      out.push(sym);
    }
  }
  return out;
}

/** Replaces a paragraph's inlines with `syms`, merging adjacent characters with equal style and suggestion metadata into canonical runs. */
export function paragraphSymbolsSet(
  /** Paragraph to update in place. */
  paragraph: ParagraphBlock,
  /** New content. */
  syms: readonly Sym[],
): void {
  paragraph.inlines = inlinesFromSymbols(syms);
}

/** Builds canonical inlines (maximal equal-style runs) from symbols. */
export function inlinesFromSymbols(
  /** Symbols in order. */
  syms: readonly Sym[],
): Inline[] {
  const out: Inline[] = [];
  for (const sym of syms) {
    if (sym.kind === "atom") {
      out.push(sym.atom);
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === "text" && charJoinsRun(last, sym)) {
      last.text += sym.ch;
      continue;
    }
    const run: TextRun = { kind: "text", style: sym.style, text: sym.ch };
    if (sym.suggestedDeletionIds) run.suggestedDeletionIds = sym.suggestedDeletionIds;
    if (sym.suggestedInsertionIds) run.suggestedInsertionIds = sym.suggestedInsertionIds;
    if (sym.suggestedTextStyleChanges) run.suggestedTextStyleChanges = sym.suggestedTextStyleChanges;
    out.push(run);
  }
  return out;
}

/** UTF-16 length of a symbol sequence (the index span it occupies in the document). */
export function symbolsUtf16Length(
  /** Symbols to measure. */
  syms: readonly Sym[],
): number {
  let length = 0;
  for (const sym of syms) length += sym.kind === "atom" ? sym.atom.length : sym.ch.length;
  return length;
}

/** Identity used when diffing symbol sequences: the character itself, or `"\0" + key` for an atom. */
export function symbolId(
  /** Symbol to identify. */
  sym: Sym,
): string {
  return sym.kind === "atom" ? `\0${sym.atom.key}` : sym.ch;
}

/** True when a character can extend `run` without changing any run-level property. */
function charJoinsRun(run: TextRun, sym: CharSym): boolean {
  return (
    styleEqual(run.style, sym.style) &&
    suggestionIdsEqual(run.suggestedDeletionIds, sym.suggestedDeletionIds) &&
    suggestionIdsEqual(run.suggestedInsertionIds, sym.suggestedInsertionIds) &&
    styleEqual(run.suggestedTextStyleChanges ?? {}, sym.suggestedTextStyleChanges ?? {})
  );
}
