/* The lens's marked configuration (GFM, no bare-URL autolinks, token and directive extensions) and an inline signature used to check that styled markdown parses back as intended (G3 D27, D28). */

import { Marked, type Token, type Tokens } from "marked";
import { CoreError } from "../model/errors.ts";

/** The one entity the lens decodes: a tab (tabs are otherwise expanded to spaces inside list items). */
export const TAB_ENTITY = "&#9;";

/** One visible character of parsed inline markdown and the formatting on it. */
export interface SignatureChar {
  /** The character (`￼` for a token). */ ch: string;
  /** Sorted formatting tags (`b`, `i`, `s`, `c`, `l:<href>`, `d:<name>`). */ tag: string;
}

/** A marked instance for lens markdown; directives are refused unless `directivesAllowed`. */
export function lensMarked(
  /** Whether `::name[…]::` directives are allowed (they need frontmatter styles). */
  directivesAllowed: boolean,
): Marked {
  const instance = new Marked({ gfm: true });
  instance.use({
    extensions: [tokenExtension(), directiveExtension(directivesAllowed)],
    tokenizer: { url: () => undefined } as never,
  });
  return instance;
}

/** Where inline markdown will sit, which changes how it lexes (tabs in list items, pipes in cells). */
export type InlineContext = "cell" | "listItem" | "paragraph";

/** The visible characters and formatting of inline markdown, lexed in its real context. */
export function inlineSignature(
  /** Inline markdown. */
  markdown: string,
  /** Where it sits. */
  context: InlineContext = "paragraph",
): SignatureChar[] | undefined {
  const source = context === "listItem" ? `- ${markdown}` : context === "cell" ? `| ${markdown} |\n| --- |` : markdown;
  let tokens: Token[];
  try {
    tokens = lensMarked(true).lexer(source);
  } catch {
    return undefined;
  }
  const blocks = tokens.filter((t) => t.type !== "space");
  if (blocks.length === 0) return [];
  if (blocks.length !== 1) return undefined;
  let inline: readonly Token[] | undefined;
  const [block] = blocks;
  if (context === "paragraph" && block.type === "paragraph") inline = (block as Tokens.Paragraph).tokens;
  if (context === "cell" && block.type === "table") inline = (block as Tokens.Table).header[0]?.tokens;
  if (context === "listItem" && block.type === "list") {
    const items = (block as Tokens.List).items;
    const only = items.length === 1 ? items[0].tokens.filter((t) => t.type !== "checkbox") : [];
    if (only.length === 1 && only[0].type === "text") inline = (only[0] as Tokens.Text).tokens ?? [only[0]];
  }
  if (!inline) return undefined;
  const out: SignatureChar[] = [];
  if (!signatureWalk(inline, [], out)) return undefined;
  return out;
}

/** Appends the characters of inline tokens with `tags`; false when something isn't plain inline content. */
function signatureWalk(tokens: readonly Token[], tags: readonly string[], out: SignatureChar[]): boolean {
  const push = (text: string, extra: readonly string[] = tags) => {
    const tag = [...extra].sort().join(",");
    for (const ch of Array.from(text)) out.push({ ch, tag });
  };
  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "escape": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          if (!signatureWalk(t.tokens, tags, out)) return false;
        } else push(token.type === "text" ? t.text.replaceAll(TAB_ENTITY, "\t").replace(/\n/g, " ") : t.text);
        break;
      }
      case "br":
        push("\u000b");
        break;
      case "codespan":
        push((token as Tokens.Codespan).text, [...tags, "c"]);
        break;
      case "strong":
      case "em":
      case "del":
        if (
          !signatureWalk(
            (token as Tokens.Strong).tokens,
            [...tags, token.type === "strong" ? "b" : token.type === "em" ? "i" : "s"],
            out,
          )
        )
          return false;
        break;
      case "link":
        if (!signatureWalk((token as Tokens.Link).tokens, [...tags, `l:${(token as Tokens.Link).href}`], out))
          return false;
        break;
      case "gdocToken":
        push("￼");
        break;
      case "gdocDirective":
        if (
          !signatureWalk(
            (token as unknown as { tokens: Token[] }).tokens,
            [...tags, `d:${(token as unknown as { name: string }).name}`],
            out,
          )
        )
          return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** `{{kind:ref|label}}` (D29). */
function tokenExtension() {
  return {
    level: "inline" as const,
    name: "gdocToken",
    start: (src: string) => src.indexOf("{{"),
    tokenizer(src: string) {
      const match = /^\{\{([a-z]+)(?::([^|}]*))?(?:\|([^}]*))?\}\}/.exec(src);
      if (!match) return undefined;
      return {
        kind: match[1],
        label: match[3]?.trim() || undefined,
        raw: match[0],
        ref: match[2]?.trim(),
        type: "gdocToken",
      };
    },
  };
}

/** `::name[text]::` with balanced brackets (D30; the scan is ported from v1 `inline.ts`). */
function directiveExtension(allowed: boolean) {
  return {
    level: "inline" as const,
    name: "gdocDirective",
    start: (src: string) => src.indexOf("::"),
    tokenizer(this: { lexer: { inlineTokens(src: string, tokens: Token[]): Token[] } }, src: string) {
      const match = /^::([A-Za-z0-9][A-Za-z0-9_+.-]*)\[/.exec(src);
      if (!match) return undefined;
      let depth = 1;
      for (let i = match[0].length; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] === "[") depth++;
        else if (src[i] === "]" && --depth === 0) {
          if (src.slice(i + 1, i + 3) !== "::") return undefined;
          if (!allowed)
            throw new CoreError("unsupportedSyntax", `style directive "::${match[1]}[…]::" needs frontmatter styles`);
          const text = src.slice(match[0].length, i);
          return {
            name: match[1],
            raw: src.slice(0, i + 3),
            text,
            tokens: this.lexer.inlineTokens(text, []),
            type: "gdocDirective",
          };
        }
      }
      return undefined;
    },
  };
}
