/* Read-only views of a tab for queries: its heading outline and per-node summaries (G3 core API `OutlineEntry` / `NodeInfo`, M17). */

import { headingLevel, headingStyleIs, textStyleEffective } from "../model/effectiveStyle.ts";
import { listKind } from "../model/lists.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { colorHexFromOptional } from "../model/styleValues.ts";
import type { Block, ParagraphBlock, TabModel } from "../model/types.ts";
import { anchorsIndex, paragraphText, type RangeRef, rangeResolve } from "./anchors.ts";
import { projectionBuild } from "./project.ts";
import { markdownRender } from "./render.ts";

/** One heading of a tab's outline. */
export interface OutlineEntry {
  /** Its anchor. */ anchor: string;
  /** Level: TITLE 0, SUBTITLE 1, HEADING_n n. */ level: number;
  /** Named style type. */ namedStyleType: string;
  /** Visible text. */ text: string;
}

/** One node (top-level block) as queries report it. */
export interface NodeInfo {
  /** Its anchor. */ anchor: string;
  /** Table cells (with `includeCells`). */ cells?: Array<{ anchor: string; col: number; row: number; text: string }>;
  /** Facts that matter before editing it. */ flags: Array<
    "commented" | "linkedHeading" | "namedRange" | "protected" | "styled" | "unrecreatable"
  >;
  /** Explicit text colors used (#RRGGBB). */ fontColors?: string[];
  /** Kind. */ kind:
    | "codeLine"
    | "empty"
    | "heading"
    | "listItem"
    | "pageBreak"
    | "paragraph"
    | "sectionBreak"
    | "table"
    | "toc";
  /** Heading level. */ level?: number;
  /** List membership. */ list?: { kind: "bullet" | "check" | "number"; listId: string; nesting: number };
  /** Its plain-mode markdown. */ markdown: string;
  /** Named style type (paragraphs). */ namedStyleType?: string;
  /** Explicit paragraph style. */ paragraphStyle: JsonObject;
  /** Anchor of the governing heading (`_` before the first). */ section: string;
  /** Table shape. */ table?: { cols: number; rows: number };
  /** Visible text. */ text: string;
  /** Effective text style when every run shares it, minus the named style's own values. */ textStyle?: JsonObject;
}

/** Facts from outside the tab that flag nodes. */
export interface NodeContext {
  /** Keys of blocks holding commented text. */ commented?: ReadonlySet<string>;
  /** Heading ids other content links to. */ linkedHeadingIds?: ReadonlySet<string>;
  /** Keys of blocks overlapping named ranges. */ namedRangeKeys?: ReadonlySet<string>;
}

/** Atom kinds the API can't recreate once deleted. */
const UNRECREATABLE_ATOMS: ReadonlySet<string> = new Set([
  "autoText",
  "columnBreak",
  "equation",
  "footnoteRef",
  "horizontalRule",
]);

/** The tab's headings, in order. */
export function tabOutline(
  /** Tab. */
  tab: TabModel,
): OutlineEntry[] {
  const anchors = anchorsIndex(tab).byKey;
  return tab.blocks
    .filter(
      (b): b is ParagraphBlock =>
        b.kind === "paragraph" && headingStyleIs(b.style.namedStyleType as string | undefined),
    )
    .map((h) => ({
      anchor: anchors.get(h.key) ?? `new:${h.key}`,
      level: headingLevel(h.style.namedStyleType as string) ?? 0,
      namedStyleType: h.style.namedStyleType as string,
      text: paragraphText(h).trim(),
    }));
}

/** Summaries of the tab's nodes (or a range's), in order. */
export function tabNodes(
  /** Tab. */
  tab: TabModel,
  /** Range and whether to include table cells. */
  opts: { includeCells?: boolean; range?: RangeRef } = {},
  /** Outside facts for flags. */
  context: NodeContext = {},
): NodeInfo[] {
  const range = rangeResolve(tab, opts.range ?? { kind: "tab" });
  const anchors = anchorsIndex(tab).byKey;
  const blocks = tab.blocks.slice(range.from, range.to);
  const projection = projectionBuild(
    tab,
    { containerRef: { kind: "body" }, from: 0, to: tab.blocks.length },
    { mode: "plain" },
  );
  const projected = new Map(projection.blocks.map((b) => [b.key, b]));
  let section = "_";
  for (const block of tab.blocks.slice(0, range.from)) {
    if (block.kind === "paragraph" && headingStyleIs(block.style.namedStyleType as string | undefined))
      section = anchors.get(block.key) ?? section;
  }
  const out: NodeInfo[] = [];
  for (const block of blocks) {
    const anchor = anchors.get(block.key) ?? `new:${block.key}`;
    const isHeading = block.kind === "paragraph" && headingStyleIs(block.style.namedStyleType as string | undefined);
    if (isHeading) section = anchor;
    const proj = projected.get(block.key);
    const markdown = proj ? markdownRender({ ...projection, blocks: [proj] }).trimEnd() : "";
    const info: NodeInfo = {
      anchor,
      flags: [],
      kind: nodeKind(block, proj?.kind),
      markdown,
      paragraphStyle: {},
      section: isHeading ? section : section,
      text: "",
    };
    if (block.kind === "paragraph") {
      info.text = paragraphText(block);
      info.paragraphStyle = { ...block.style };
      info.namedStyleType = (block.style.namedStyleType as string | undefined) ?? "NORMAL_TEXT";
      if (isHeading) info.level = headingLevel(info.namedStyleType);
      if (block.bullet) {
        const def = tab.lists[block.bullet.listId];
        info.list = {
          kind: def ? listKind(def, block.bullet.nestingLevel) : "bullet",
          listId: block.bullet.listId,
          nesting: block.bullet.nestingLevel,
        };
      }
      const colors = [
        ...new Set(
          block.inlines
            .map((i) => colorHexFromOptional(i.style?.foregroundColor as never))
            .filter((c): c is string => !!c),
        ),
      ].sort();
      if (colors.length) info.fontColors = colors;
      const uniform = uniformTextStyle(tab, block);
      if (uniform) info.textStyle = uniform;
      if (proj?.styled) info.flags.push("styled");
      if (block.protected) info.flags.push("protected");
      if (
        block.inlines.some((i) => i.kind === "atom" && UNRECREATABLE_ATOMS.has(i.type)) ||
        block.positionedObjectIds?.length
      )
        info.flags.push("unrecreatable");
      if (isHeading && block.headingId && context.linkedHeadingIds?.has(block.headingId))
        info.flags.push("linkedHeading");
    } else if (block.kind === "table") {
      info.table = { cols: block.columns.length, rows: block.rows.length };
      info.text = block.rows
        .map((r) => r.cells.map((c) => c.blocks.map(paragraphText).join(" ")).join("\t"))
        .join("\n");
      if (block.protected) info.flags.push("protected");
      if (opts.includeCells) {
        info.cells = block.rows.flatMap((row, r) =>
          row.cells.map((cell, c) => ({
            anchor: `${anchor}/${r}.${c}`,
            col: c,
            row: r,
            text: cell.blocks.map(paragraphText).join("\n"),
          })),
        );
      }
    } else if (block.kind === "toc" || block.kind === "sectionBreak") {
      if (!block.key.startsWith("n")) info.flags.push("unrecreatable");
    }
    if (context.commented?.has(block.key)) info.flags.push("commented");
    if (context.namedRangeKeys?.has(block.key)) info.flags.push("namedRange");
    info.flags.sort();
    out.push(info);
  }
  return out;
}

/** A node's query kind. */
function nodeKind(block: Block, projected: string | undefined): NodeInfo["kind"] {
  if (block.kind === "table") return "table";
  if (block.kind === "toc") return "toc";
  if (block.kind === "sectionBreak") return "sectionBreak";
  if (block.inlines.length === 1 && block.inlines[0].kind === "atom" && block.inlines[0].type === "pageBreak")
    return "pageBreak";
  if (headingStyleIs(block.style.namedStyleType as string | undefined)) return "heading";
  if (block.bullet) return "listItem";
  if (projected === "codeLine") return "codeLine";
  if (!block.inlines.length) return "empty";
  return "paragraph";
}

/** The effective style every text run shares, minus the named style's own values (undefined when runs differ). */
function uniformTextStyle(tab: TabModel, p: ParagraphBlock): JsonObject | undefined {
  const runs = p.inlines.filter((i) => i.kind === "text" && i.text.trim());
  if (!runs.length) return undefined;
  const styles = runs.map((r) => JSON.stringify(textStyleEffective(tab, p, r)));
  if (new Set(styles).size !== 1) return undefined;
  const effective = JSON.parse(styles[0]) as JsonObject;
  const named = textStyleEffective(tab, p, {});
  const out: JsonObject = {};
  for (const [field, value] of Object.entries(effective))
    if (JSON.stringify(named[field]) !== JSON.stringify(value)) out[field] = value;
  return Object.keys(out).length ? out : undefined;
}
