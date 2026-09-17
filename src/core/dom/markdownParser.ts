/* Markdown AST parser — translates CommonMark / GFM markdown into Google Docs DOM ElementSpec array. */

import { marked, type Token, type Tokens } from "marked";
import { type CustomTextStyle, InlineMarkup } from "~/core/inline.ts";
import {
  type BulletPreset,
  type CreateParagraphProps,
  createCodeBlock,
  createElement,
  type ElementSpec,
  type TableSpec,
} from "./element.ts";
import { markdownSymbolicLinksResolve } from "./linkResolver.ts";
import type { NamedStyle } from "./types.ts";

/**
 * A chunk of elements that can be executed as an atomic apply.
 */
export type MarkdownChunk = { kind: "elements"; specs: ElementSpec[] } | { kind: "table"; spec: TableSpec };

/**
 * Options for markdown AST parsing.
 */
export type MarkdownParseOptions = {
  /** Custom `::styleName[text]::` directive definitions from `markdownStyles`. */
  customStyles?: Record<string, CustomTextStyle>;
  /** If true, the first level-1 heading (# Title) is mapped to TITLE instead of HEADING_1. */
  h1IsTitle?: boolean;
  /** Resolver function to transform symbolic links (e.g. tab:Tab#Heading) into Docs URLs. */
  linkResolver?: (href: string) => string;
};

/**
 * Chunks elements into contiguous non-table runs and individual tables.
 */
export function chunkMarkdownElements(
  /** Array of element specifications to chunk. */
  specs: ElementSpec[],
): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  let currentElements: ElementSpec[] = [];

  for (const spec of specs) {
    if (spec.kind === "table") {
      if (currentElements.length > 0) {
        chunks.push({ kind: "elements", specs: currentElements });
        currentElements = [];
      }
      chunks.push({ kind: "table", spec });
    } else {
      currentElements.push(spec);
    }
  }

  if (currentElements.length > 0) {
    chunks.push({ kind: "elements", specs: currentElements });
  }

  return chunks;
}

/**
 * Alias for chunkMarkdownElements.
 */
export const markdownElementsChunk = chunkMarkdownElements;

/**
 * Normalizes relaxed style keys (color, size, background, etc.) into CustomTextStyle.
 */
export function customStyleNormalize(
  /** Raw style dictionary. */
  raw: Record<string, unknown>,
): CustomTextStyle {
  const style: CustomTextStyle = {};
  if (raw.bold === true) style.bold = true;
  if (raw.italic === true) style.italic = true;
  if (raw.underline === true) style.underline = true;
  if (raw.strikethrough === true || raw.strike === true) style.strikethrough = true;

  if (typeof raw.style === "string") {
    const parts = raw.style.toLowerCase().split(/[,\s]+/);
    for (const p of parts) {
      if (p === "bold") style.bold = true;
      if (p === "italic") style.italic = true;
      if (p === "underline") style.underline = true;
      if (p === "strike" || p === "strikethrough") style.strikethrough = true;
    }
  }

  const fg = raw.foregroundColor ?? raw.color;
  if (typeof fg === "string") style.foregroundColor = fg;

  const bg = raw.backgroundColor ?? raw.background ?? raw.highlight;
  if (typeof bg === "string") style.backgroundColor = bg;

  const sz = raw.fontSize ?? raw.size;
  if (typeof sz === "number") {
    style.fontSize = sz;
  } else if (typeof sz === "string") {
    const n = parseFloat(sz);
    if (!Number.isNaN(n)) style.fontSize = n;
  }

  const ff = raw.fontFamily ?? raw.font;
  if (typeof ff === "string") style.fontFamily = ff;

  return style;
}

/**
 * Alias for customStyleNormalize.
 */
export const normalizeCustomStyle = customStyleNormalize;

/**
 * Parses a `markdownStyles` map (`{ alert: { color: "#f00" } }`) into CustomTextStyle entries.
 */
export function markdownStylesParse(
  /** Named directive styles, or null. */
  styles: Record<string, unknown> | null,
): Record<string, CustomTextStyle> {
  const out: Record<string, CustomTextStyle> = {};
  if (!styles || typeof styles !== "object") {
    return out;
  }
  for (const [name, val] of Object.entries(styles)) {
    if (val && typeof val === "object") {
      out[name] = customStyleNormalize(val as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Normalizes list item indentation so that sub-lists are properly nested according to CommonMark rules.
 */
export function listIndentationNormalize(
  /** Markdown text string to normalize. */
  md: string,
): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;

  type ListFrame = { indent: number; minChildIndent: number; shift: number };
  let listStack: ListFrame[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      listStack = [];
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (trimmed === "") {
      result.push(line);
      continue;
    }

    const bqMatch = /^((?:>[ \t]*)+)(.*)$/.exec(line);
    const quotePrefix = bqMatch ? bqMatch[1]! : "";
    const lineContent = bqMatch ? bqMatch[2]! : line;

    const match = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/.exec(lineContent);
    if (!match) {
      const leadingSpaces = (/^[ \t]*/.exec(lineContent)?.[0] ?? "").replace(/\t/g, "    ").length;
      if (listStack.length > 0 && leadingSpaces > listStack[0]?.indent) {
        const top = listStack[listStack.length - 1]!;
        result.push(quotePrefix + " ".repeat(top.shift) + lineContent);
        continue;
      }
      listStack = [];
      result.push(line);
      continue;
    }

    const [, indentStr, marker, spaceStr, text] = match;
    const rawIndent = indentStr?.replace(/\t/g, "    ").length;
    const isOrdered = /^\d+[.)]$/.test(marker!);
    const markerLen = (marker?.length ?? 0) + (spaceStr?.length ?? 0);

    while (listStack.length > 0 && (listStack[listStack.length - 1]?.indent ?? 0) >= (rawIndent ?? 0)) {
      listStack.pop();
    }

    let currentShift = 0;
    if (listStack.length > 0) {
      const parent = listStack[listStack.length - 1]!;
      currentShift = parent.shift;
      const effectiveIndent = (rawIndent ?? 0) + currentShift;

      if (effectiveIndent < parent.minChildIndent) {
        const extraShift = parent.minChildIndent - effectiveIndent;
        currentShift += extraShift;
      }
    }

    const newIndent = (rawIndent ?? 0) + currentShift;
    const minChild = newIndent + Math.max(markerLen, isOrdered ? 4 : 2);

    listStack.push({
      indent: rawIndent ?? 0,
      minChildIndent: minChild,
      shift: currentShift,
    });

    result.push(quotePrefix + " ".repeat(newIndent) + marker + spaceStr + text);
  }

  return result.join("\n");
}

/**
 * Alias for listIndentationNormalize.
 */
export const normalizeListIndentation = listIndentationNormalize;

/**
 * Parses markdown text into detached Google Docs ElementSpec objects.
 */
export function markdownToElementsParse(
  /** Markdown text string to parse. */
  markdown: string,
  /** Parser configuration options. */
  options: MarkdownParseOptions = {},
): ElementSpec[] {
  const resolvedMarkdown = options.linkResolver
    ? markdownSymbolicLinksResolve(markdown, options.linkResolver)
    : markdown;
  const effectiveStyles = options.customStyles ?? {};
  const normalizedContent = listIndentationNormalize(resolvedMarkdown);
  const tokens = marked.lexer(normalizedContent);
  const elements: ElementSpec[] = [];
  let seenFirstH1 = false;

  function walkTokens(tokenList: Token[], context: { blockquoteDepth?: number } = {}): void {
    const bqDepth = context.blockquoteDepth ?? 0;

    for (const token of tokenList) {
      switch (token.type) {
        case "heading": {
          let namedStyleType: NamedStyle;
          if (token.depth === 1 && options.h1IsTitle && !seenFirstH1) {
            namedStyleType = "TITLE";
            seenFirstH1 = true;
          } else {
            const depth = Math.min(Math.max(token.depth, 1), 6);
            namedStyleType = `HEADING_${depth}` as NamedStyle;
            if (token.depth === 1) seenFirstH1 = true;
          }
          elements.push(
            createElement("paragraph", {
              namedStyleType,
              text: token.text,
            }),
          );
          break;
        }

        case "paragraph": {
          const props: CreateParagraphProps = {
            namedStyleType: "NORMAL_TEXT",
            text: token.text,
          };
          if (Object.keys(effectiveStyles).length > 0) {
            const parsed = InlineMarkup.parse(token.text, effectiveStyles);
            if (parsed.runs.length > 0) {
              props.runs = parsed.runs;
            }
          }
          if (bqDepth > 0) {
            props.style = { indentStart: bqDepth * 18 };
          }
          elements.push(createElement("paragraph", props));
          break;
        }

        case "list": {
          parseListToken(token as Tokens.List, 0, bqDepth);
          break;
        }

        case "code": {
          const codeSpecs = createCodeBlock({
            language: token.lang || undefined,
            text: token.text,
          });
          if (bqDepth > 0) {
            for (const s of codeSpecs) {
              s.style = { ...s.style, indentStart: bqDepth * 18 };
            }
          }
          elements.push(...codeSpecs);
          break;
        }

        case "table": {
          const tableToken = token as Tokens.Table;
          const rows: string[][] = [
            tableToken.header.map((c) => c.text),
            ...tableToken.rows.map((row) => row.map((c) => c.text)),
          ];
          elements.push(createElement("table", { rows }));
          break;
        }

        case "blockquote": {
          const bq = token as Tokens.Blockquote;
          walkTokens(bq.tokens ?? [], {
            ...context,
            blockquoteDepth: bqDepth + 1,
          });
          break;
        }

        case "hr": {
          elements.push(createElement("pageBreak"));
          break;
        }

        case "space": {
          break;
        }

        default: {
          if ("tokens" in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
            walkTokens((token as { tokens: Token[] }).tokens, context);
          }
          break;
        }
      }
    }
  }

  function parseListToken(list: Tokens.List, nestingLevel: number, blockquoteDepth = 0): void {
    const isOrdered = Boolean(list.ordered);
    for (const item of list.items) {
      let preset: BulletPreset;
      if (item.task) {
        preset = "BULLET_CHECKBOX";
      } else if (isOrdered) {
        preset = "NUMBERED_DECIMAL_NESTED";
      } else {
        preset = "BULLET_DISC_CIRCLE_SQUARE";
      }

      const indentStart =
        (blockquoteDepth > 0 ? blockquoteDepth * 18 : 0) + (nestingLevel > 0 ? (nestingLevel + 1) * 36 : 0);

      let firstTextPushed = false;
      const nestedLists: Tokens.List[] = [];

      for (const t of item.tokens) {
        if (t.type === "list") {
          nestedLists.push(t as Tokens.List);
        } else if (t.type === "checkbox") {
        } else if (t.type === "text" || t.type === "paragraph") {
          const text = (t as Tokens.Text | Tokens.Paragraph).text;
          const props: CreateParagraphProps = {
            bullet: {
              nestingLevel,
              preset,
            },
            namedStyleType: "NORMAL_TEXT",
            text,
            ...(indentStart > 0 ? { indentStart } : {}),
          };
          if (Object.keys(effectiveStyles).length > 0) {
            const parsed = InlineMarkup.parse(text, effectiveStyles);
            if (parsed.runs.length > 0) {
              props.runs = parsed.runs;
            }
          }
          elements.push(createElement("paragraph", props));
          firstTextPushed = true;
        }
      }

      if (!firstTextPushed && item.text) {
        const props: CreateParagraphProps = {
          bullet: {
            nestingLevel,
            preset,
          },
          namedStyleType: "NORMAL_TEXT",
          text: item.text,
          ...(indentStart > 0 ? { indentStart } : {}),
        };
        if (Object.keys(effectiveStyles).length > 0) {
          const parsed = InlineMarkup.parse(item.text, effectiveStyles);
          if (parsed.runs.length > 0) {
            props.runs = parsed.runs;
          }
        }
        elements.push(createElement("paragraph", props));
      }

      for (const sub of nestedLists) {
        parseListToken(sub, nestingLevel + 1, blockquoteDepth);
      }
    }
  }

  InlineMarkup.withStyles(effectiveStyles, () => {
    InlineMarkup.withLinkResolver(options.linkResolver, () => {
      walkTokens(tokens);
    });
  });

  return elements;
}

/**
 * Alias for markdownToElementsParse.
 */
export const parseMarkdownToElements = markdownToElementsParse;
