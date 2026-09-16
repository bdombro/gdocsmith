/*

Read-only helpers for extracting text and style facts from API paragraph objects.

*/

import type { DocElement } from "./types.ts";

/** Non-null paragraph subtree from a DocElement. */
export type DocParagraph = NonNullable<DocElement["paragraph"]>;

/** One inline child inside a paragraph (text run, image, page break). */
export type InlineElement = NonNullable<DocParagraph["elements"]>[number];

/** Stateless utilities over Docs API paragraph structures. */
export class Paragraph {
  /** Resolves list depth from bullet.nestingLevel. Omitted means 0 — do not infer from indentStart. */
  static bulletNestingLevel(paragraph: DocParagraph | undefined): number {
    return paragraph?.bullet?.nestingLevel ?? 0;
  }

  /** Returns inline children, or empty when missing. */
  static elements(paragraph: DocParagraph | undefined): InlineElement[] {
    return paragraph?.elements ?? [];
  }

  /** True for Docs paste/code-block glyph runs. */
  static isArtifactRun(element: InlineElement): boolean {
    const content = element.textRun?.content ?? "";
    if (!content) return false;
    return [...content].some((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0xe000 && code <= 0xf8ff;
    });
  }

  /** True when text is empty after stripping private-use paste glyphs. */
  static isGlyphOnlyText(text: string): boolean {
    return !Paragraph.stripArtifacts(text);
  }

  /** Removes private-use paste glyphs (U+E000–U+F8FF) and collapses whitespace. */
  static stripArtifacts(text: string): string {
    const stripped = [...text]
      .filter((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp < 0xe000 || cp > 0xf8ff;
      })
      .join("");
    return stripped.replace(/\s+/g, " ").trim();
  }

  /** Concatenates text runs and smart-chip titles; optionally strips trailing newline. */
  static text(paragraph: DocParagraph | undefined, trimTrailing = false): string {
    const raw = Paragraph.elements(paragraph)
      .map((el) => {
        if (el.textRun?.content) return el.textRun.content;
        const title = el.richLink?.richLinkProperties?.title;
        return title ?? "";
      })
      .join("");
    return trimTrailing ? raw.replace(/\n$/, "") : raw;
  }
}
