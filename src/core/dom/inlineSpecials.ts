/* Convert parsed chips/images into native inline insert specials, or name why they cannot be recreated. */

import type { ParagraphInlineSpecial } from "./element.ts";
import type { CellParagraph, DocNode, InlineChip, InlineImage, TableCell } from "./types.ts";

/** Clone plan for one paragraph or cell paragraph: recreatable specials plus leftovers. */
export type InlineClonePlan = {
  /** Native inserts at offsets in `text`. */
  specials: ParagraphInlineSpecial[];
  /** Paragraph/cell text with recreatable chip titles stripped. */
  text: string;
  /** Human-readable reasons this content cannot be copied losslessly. */
  unclonable: string[];
};

/** Plans a lossless clone of a body paragraph node. */
export function paragraphInlineClone(
  /** Source paragraph node. */
  node: Pick<DocNode, "chips" | "images" | "text">,
): InlineClonePlan {
  return inlineClonePlan(node.text ?? "", node.chips, node.images);
}

/** Plans a lossless clone of a table cell (all cell paragraphs joined by newlines). */
export function tableCellInlineClone(
  /** Source table cell. */
  cell: TableCell,
): InlineClonePlan {
  const paras: CellParagraph[] = cell.paragraphs?.length ? cell.paragraphs : [cell];
  const parts: InlineClonePlan[] = paras.map((p) => {
    const sourceText = p.chips?.length || p.images?.length ? (p.text ?? "") : (p.markup ?? p.text ?? "");
    return inlineClonePlan(sourceText, p.chips, p.images);
  });
  const specials: ParagraphInlineSpecial[] = [];
  const unclonable: string[] = [];
  const texts: string[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    texts.push(part.text);
    for (const special of part.specials) {
      specials.push({ ...special, offset: special.offset + offset });
    }
    unclonable.push(...part.unclonable);
    offset += part.text.length + (i < parts.length - 1 ? 1 : 0);
  }
  return { specials, text: texts.join("\n"), unclonable };
}

/** Collects unclonable reasons from a node, including nested table cells. */
export function unclonableFromNode(
  /** Parsed document node. */
  node: DocNode,
): string[] {
  const loc = node.scopedId ? `node ${node.scopedId}` : `node ${node.tapeIndex}`;
  const out: string[] = [];
  if (node.hasEquation) out.push(`${loc}: contains a math equation`);
  if (node.hasHorizontalRule) out.push(`${loc}: contains a horizontal rule`);
  if (node.footnoteIds?.length) out.push(`${loc}: contains ${node.footnoteIds.length} footnote(s)`);
  if (node.kind === "tableOfContents") out.push(`${loc}: Table of Contents`);
  if (node.kind === "table" && node.table) {
    for (const row of node.table.cells) {
      for (const cell of row) {
        const cellLoc = cell.scopedId ? `cell ${cell.scopedId}` : "table cell";
        const paras: CellParagraph[] = cell.paragraphs?.length ? cell.paragraphs : [cell];
        for (const p of paras) {
          if (p.hasEquation) out.push(`${cellLoc}: contains a math equation`);
          if (p.hasHorizontalRule) out.push(`${cellLoc}: contains a horizontal rule`);
        }
        const plan = tableCellInlineClone(cell);
        out.push(...plan.unclonable.map((msg) => `${cellLoc}: ${msg}`));
      }
    }
    return out;
  }
  const plan = paragraphInlineClone(node);
  out.push(...plan.unclonable.map((msg) => `${loc}: ${msg}`));
  return out;
}

/** Builds specials and stripped text from chips/images on one paragraph. */
export function inlineClonePlan(
  /** Plain paragraph text (chip titles may be inlined). */
  text: string,
  /** Parsed smart chips. */
  chips?: InlineChip[],
  /** Parsed inline images. */
  images?: InlineImage[],
): InlineClonePlan {
  const unclonable: string[] = [];
  type Item = { dropLen: number; offset: number; special?: ParagraphInlineSpecial };
  const items: Item[] = [];

  for (const chip of chips ?? []) {
    const converted = chipToSpecial(chip, text);
    if ("unclonable" in converted) {
      unclonable.push(converted.unclonable);
      continue;
    }
    items.push(converted);
  }
  for (const image of images ?? []) {
    const converted = imageToSpecial(image, text);
    if ("unclonable" in converted) {
      unclonable.push(converted.unclonable);
      continue;
    }
    items.push(converted);
  }

  items.sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  let outText = "";
  const specials: ParagraphInlineSpecial[] = [];
  for (const item of items) {
    const at = Math.max(0, Math.min(item.offset, text.length));
    if (at < cursor) continue;
    outText += text.slice(cursor, at);
    if (item.special) {
      specials.push({ ...item.special, offset: outText.length });
    }
    cursor = at + item.dropLen;
  }
  outText += text.slice(cursor);
  return { specials, text: outText, unclonable };
}

/** Converts a parsed chip into an insert special, or explains why it cannot be recreated. */
function chipToSpecial(
  /** Parsed chip. */
  chip: InlineChip,
  /** Source paragraph text. */
  text: string,
): ItemOrUnclonable {
  const offset = chip.textOffset ?? 0;
  const kind = chip.kind ?? chipKindInfer(chip);
  if (kind === "person") {
    const email = chip.email ?? emailFromMailto(chip.uri);
    if (!email) {
      return { unclonable: `person chip "${chip.title || chip.uri}" has no email` };
    }
    return { dropLen: 0, offset, special: { email, kind: "person", offset } };
  }
  if (kind === "date") {
    if (!chip.timestamp) {
      return { unclonable: `date chip "${chip.title}" has no timestamp` };
    }
    const special: ParagraphInlineSpecial = {
      kind: "date",
      offset,
      timestamp: chip.timestamp,
    };
    if (chip.dateFormat) special.dateFormat = chip.dateFormat;
    if (chip.title) special.displayText = chip.title;
    return { dropLen: 0, offset, special };
  }
  if (kind === "richLink") {
    if (!chip.uri) {
      return { unclonable: `rich link chip "${chip.title}" has no uri` };
    }
    const title = chip.title;
    const dropLen = title && text.startsWith(title, offset) ? title.length : 0;
    const special: ParagraphInlineSpecial = { kind: "richLink", offset, uri: chip.uri };
    if (chip.mimeType) special.mimeType = chip.mimeType;
    if (title) special.title = title;
    return { dropLen, offset, special };
  }
  return { unclonable: `unsupported smart chip "${chip.title || chip.uri}"` };
}

/** Converts a parsed image into an insert special when a public source URI exists. */
function imageToSpecial(
  /** Parsed inline image. */
  image: InlineImage,
  /** Source paragraph text. */
  text: string,
): ItemOrUnclonable {
  const offset = image.textOffset ?? 0;
  const uri = image.sourceUri ?? "";
  if (!/^https?:\/\//i.test(uri)) {
    return {
      unclonable: "inline image has no public source URI (Drive/internal images cannot be reinserted via REST)",
    };
  }
  const dropLen = text.startsWith("[Image]", offset) ? "[Image]".length : 0;
  const special: ParagraphInlineSpecial = { kind: "inlineImage", offset, uri };
  if (image.heightPt != null) special.heightPt = image.heightPt;
  if (image.widthPt != null) special.widthPt = image.widthPt;
  return { dropLen, offset, special };
}

/** Infers chip kind from URI when parse did not set `kind`. */
function chipKindInfer(
  /** Parsed chip. */
  chip: InlineChip,
): InlineChip["kind"] {
  if (chip.kind) return chip.kind;
  if (chip.email || chip.uri?.startsWith("mailto:")) return "person";
  if (chip.uri && /^https?:\/\//i.test(chip.uri)) return "richLink";
  if (chip.timestamp || chip.dateId) return "date";
  return undefined;
}

/** Reads an email address from a mailto URI. */
function emailFromMailto(
  /** Chip URI. */
  uri?: string,
): string | undefined {
  if (!uri?.toLowerCase().startsWith("mailto:")) return undefined;
  const email = uri.slice("mailto:".length).trim();
  return email || undefined;
}

/** Intermediate clone item or a fail-closed reason. */
type ItemOrUnclonable = { dropLen: number; offset: number; special: ParagraphInlineSpecial } | { unclonable: string };
