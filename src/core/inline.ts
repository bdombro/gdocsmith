/*

Parses and serializes lightweight inline markup in patch text fields.

*/

import { Marked, type Token } from "marked";
import { isMonospaceFont } from "./dom/style.ts";

/** Plain text plus style runs with UTF-16 offsets. */
export type ParsedInline = {
  runs: TextRun[];
  text: string;
};

/** A styled substring within parsed plain text. */
export type TextRun = {
  backgroundColor?: string;
  bold?: boolean;
  code?: boolean;
  end: number;
  fontFamily?: string;
  fontSize?: number;
  foregroundColor?: string;
  italic?: boolean;
  link?: string;
  start: number;
  strikethrough?: boolean;
  underline?: boolean;
};

/** Input specification for an inline styled run. */
export type InlineRunInput = {
  backgroundColor?: string;
  bold?: boolean;
  code?: boolean;
  end?: number;
  fontFamily?: string;
  fontSize?: number;
  foregroundColor?: string;
  italic?: boolean;
  link?: string;
  start?: number;
  strikethrough?: boolean;
  text?: string;
  underline?: boolean;
};

/** Normalized custom style specification for directive-based formatting. */
export type CustomTextStyle = {
  backgroundColor?: string;
  bold?: boolean;
  fontFamily?: string;
  fontSize?: number;
  foregroundColor?: string;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
};

/** Minimal Docs API inline element shape for serialization input. */
type InlineElement = {
  richLink?: {
    richLinkProperties?: { title?: string; uri?: string };
    textStyle?: Record<string, unknown>;
  };
  textRun?: { content?: string; textStyle?: Record<string, unknown> };
};

/** Active inline style state during recursive AST traversal. */
type ActiveStyle = CustomTextStyle & {
  code?: boolean;
  link?: string;
};

function hasActiveStyle(style: ActiveStyle): boolean {
  return Boolean(
    style.backgroundColor ||
      style.bold ||
      style.code ||
      style.fontFamily ||
      style.fontSize ||
      style.foregroundColor ||
      style.italic ||
      style.link ||
      style.strikethrough ||
      style.underline,
  );
}

function createDirectiveExtension() {
  return {
    name: "directiveStyle",
    level: "inline" as const,
    start(src: string) {
      return src.indexOf("::");
    },
    tokenizer(this: unknown, src: string) {
      if (!src.startsWith("::")) return undefined;
      const matchName = /^::([a-zA-Z0-9_-]+)\[/.exec(src);
      if (!matchName) return undefined;
      const styleName = matchName[1]!;
      let depth = 1;
      let idx = matchName[0].length;
      while (idx < src.length) {
        if (src[idx] === "\\" && idx + 1 < src.length) {
          idx += 2;
          continue;
        }
        if (src[idx] === "[") {
          depth++;
        } else if (src[idx] === "]") {
          depth--;
          if (depth === 0) {
            if (src.slice(idx + 1, idx + 3) === "::") {
              const raw = src.slice(0, idx + 3);
              const content = src.slice(matchName[0].length, idx);
              const lexer = (this as { lexer?: { inlineTokens: (src: string, tokens: unknown[]) => Token[] } })?.lexer;
              return {
                type: "directiveStyle",
                raw,
                styleName,
                text: content,
                // Enables nested markdown formatting like **bold** or [links] inside brackets
                tokens: lexer ? lexer.inlineTokens(content, []) : [],
              };
            }
            return undefined;
          }
        }
        idx++;
      }
      return undefined;
    },
  };
}

const markedInstance = new Marked();
markedInstance.use({ extensions: [createDirectiveExtension()] });

/** Converts between patch markup strings and Docs API text runs. */
export class InlineMarkup {
  static #scopedStyles: Record<string, CustomTextStyle> | undefined;

  /** Runs an action with active custom style definitions scoped (supports both sync and async callbacks). */
  static withStyles<T>(styles: Record<string, CustomTextStyle> | undefined, fn: () => T): T {
    const prev = InlineMarkup.#scopedStyles;
    InlineMarkup.#scopedStyles = styles;
    try {
      const res = fn();
      if (res && typeof (res as Record<string, unknown>).then === "function") {
        return (res as unknown as Promise<unknown>).finally(() => {
          InlineMarkup.#scopedStyles = prev;
        }) as T;
      }
      InlineMarkup.#scopedStyles = prev;
      return res;
    } catch (err) {
      InlineMarkup.#scopedStyles = prev;
      throw err;
    }
  }

  /** Resolves and merges explicit custom runs (by offset or substring match) with parsed runs. */
  static resolveRuns(plainText: string, parsedRuns: TextRun[], customRuns?: InlineRunInput[]): TextRun[] {
    const runs = [...parsedRuns];
    if (!customRuns?.length) return runs;

    for (const cr of customRuns) {
      let start = cr.start;
      let end = cr.end;
      if (cr.text && (start == null || end == null)) {
        const idx = plainText.indexOf(cr.text);
        if (idx !== -1) {
          start = idx;
          end = idx + cr.text.length;
        }
      }
      if (start != null && end != null && end > start) {
        runs.push({
          backgroundColor: cr.backgroundColor,
          bold: cr.bold,
          code: cr.code,
          end,
          fontFamily: cr.fontFamily,
          fontSize: cr.fontSize,
          foregroundColor: cr.foregroundColor,
          italic: cr.italic,
          link: cr.link,
          start,
          strikethrough: cr.strikethrough,
          underline: cr.underline,
        });
      }
    }
    return runs;
  }

  /** Merges adjacent runs that share identical styling. */
  static mergeRuns(runs: TextRun[]): TextRun[] {
    if (!runs.length) return [];
    const sorted = [...runs].sort((a, b) => a.start - b.start);
    const out: TextRun[] = [{ ...sorted[0]! }];
    for (const run of sorted.slice(1)) {
      const prev = out[out.length - 1]!;
      if (
        prev.backgroundColor === run.backgroundColor &&
        prev.bold === run.bold &&
        prev.code === run.code &&
        prev.end === run.start &&
        prev.fontFamily === run.fontFamily &&
        prev.fontSize === run.fontSize &&
        prev.foregroundColor === run.foregroundColor &&
        prev.italic === run.italic &&
        prev.link === run.link &&
        prev.strikethrough === run.strikethrough &&
        prev.underline === run.underline
      ) {
        prev.end = run.end;
      } else {
        out.push({ ...run });
      }
    }
    return out;
  }

  /** Strips markup delimiters and records style runs for API application via marked. */
  static parse(input: string, customStyles?: Record<string, CustomTextStyle>): ParsedInline {
    const styles = customStyles ?? InlineMarkup.#scopedStyles;
    const tokens = markedInstance.Lexer.lexInline(input, markedInstance.defaults);
    let plain = "";
    const runs: TextRun[] = [];

    function emit(text: string, style: ActiveStyle): void {
      if (!text) return;
      const start = plain.length;
      plain += text;
      const end = plain.length;
      if (hasActiveStyle(style)) {
        runs.push({
          ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
          ...(style.bold ? { bold: true } : {}),
          ...(style.code ? { code: true } : {}),
          end,
          ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
          ...(style.fontSize ? { fontSize: style.fontSize } : {}),
          ...(style.foregroundColor ? { foregroundColor: style.foregroundColor } : {}),
          ...(style.italic ? { italic: true } : {}),
          ...(style.link ? { link: style.link } : {}),
          start,
          ...(style.strikethrough ? { strikethrough: true } : {}),
          ...(style.underline ? { underline: true } : {}),
        });
      }
    }

    function walk(tokenList: Token[], currentStyle: ActiveStyle): void {
      for (const token of tokenList) {
        switch (token.type) {
          case "directiveStyle": {
            const directive = token as unknown as {
              styleName: string;
              text: string;
              tokens?: Token[];
            };
            const custom = styles?.[directive.styleName];
            const nextStyle: ActiveStyle = custom ? { ...currentStyle, ...custom } : currentStyle;
            if (directive.tokens && directive.tokens.length > 0) {
              walk(directive.tokens, nextStyle);
            } else {
              emit(directive.text, nextStyle);
            }
            break;
          }
          case "strong": {
            if (token.tokens && token.tokens.length > 0) {
              walk(token.tokens, { ...currentStyle, bold: true });
            } else {
              emit(token.text, { ...currentStyle, bold: true });
            }
            break;
          }
          case "em": {
            if (token.tokens && token.tokens.length > 0) {
              walk(token.tokens, { ...currentStyle, italic: true });
            } else {
              emit(token.text, { ...currentStyle, italic: true });
            }
            break;
          }
          case "codespan": {
            emit(token.text, { ...currentStyle, code: true });
            break;
          }
          case "del": {
            if (token.tokens && token.tokens.length > 0) {
              walk(token.tokens, { ...currentStyle, strikethrough: true });
            } else {
              emit(token.text, { ...currentStyle, strikethrough: true });
            }
            break;
          }
          case "link": {
            if (token.tokens && token.tokens.length > 0) {
              walk(token.tokens, { ...currentStyle, link: token.href });
            } else {
              emit(token.text, { ...currentStyle, link: token.href });
            }
            break;
          }
          case "text": {
            if ("tokens" in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
              walk((token as { tokens: Token[] }).tokens, currentStyle);
            } else {
              emit(token.text, currentStyle);
            }
            break;
          }
          case "escape": {
            emit(token.text, currentStyle);
            break;
          }
          case "html": {
            emit(token.raw, currentStyle);
            break;
          }
          case "br": {
            emit("\n", currentStyle);
            break;
          }
          case "image": {
            emit(token.text, currentStyle);
            break;
          }
          default: {
            if ("tokens" in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
              walk((token as { tokens: Token[] }).tokens, currentStyle);
            } else if ("text" in token && typeof (token as { text?: unknown }).text === "string") {
              emit((token as { text: string }).text, currentStyle);
            } else if ("raw" in token && typeof (token as { raw?: unknown }).raw === "string") {
              emit((token as { raw: string }).raw, currentStyle);
            }
            break;
          }
        }
      }
    }

    walk(tokens, {});
    return { runs: InlineMarkup.mergeRuns(runs), text: plain };
  }

  /** Reconstructs patch markup from Docs API inline elements. */
  static serialize(elements: InlineElement[]): string {
    let out = "";
    for (const el of elements) {
      const chip = el.richLink?.richLinkProperties;
      if (chip && (chip.title || chip.uri)) {
        const title = chip.title ?? "";
        let text = chip.uri ? `[${title}](${chip.uri})` : title;
        const style = el.richLink?.textStyle ?? {};
        if (style.bold === true) text = `**${text}**`;
        else if (style.italic === true) text = `*${text}*`;
        out += text;
        continue;
      }
      const run = el.textRun;
      if (!run?.content) continue;
      const content = run.content.replace(/\n$/, "");
      if (!content) continue;
      const style = run.textStyle ?? {};
      const bold = style.bold === true;
      const font = (style.weightedFontFamily as { fontFamily?: string } | undefined)?.fontFamily;
      const italic = style.italic === true;
      const strikethrough = style.strikethrough === true;
      const link = (style.link as { url?: string } | undefined)?.url;
      const code = isMonospaceFont(font);

      let text = content;
      if (code) {
        text = `\`${text}\``;
      } else if (link) {
        text = `[${content}](${link})`;
        if (bold) text = `**${text}**`;
        else if (italic) text = `*${text}*`;
        if (strikethrough) text = `~~${text}~~`;
      } else {
        if (bold) text = `**${text}**`;
        else if (italic) text = `*${text}*`;
        if (strikethrough) text = `~~${text}~~`;
      }
      out += text;
    }
    return out;
  }
}
