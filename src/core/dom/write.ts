/* Mutation log and DOM-shaped handles. createElement specs are detached until */

import type { InlineRunInput } from "~/core/inline.ts";
import type { GoogleDoc } from "~/core/types.ts";
import {
  createElement,
  type ElementSpec,
  type InsertPosition,
  type ParagraphInlineSpecial,
  stripTrailingNewline,
} from "./element.ts";
import { assertWritable } from "./guards.ts";
import { createSymbolicLinkResolver } from "./linkResolver.ts";
import { hasStyle, hasTableChrome, type StylePatch } from "./style.ts";
import {
  type CellParagraph,
  type DocNode,
  type InlineChip,
  type InlineImage,
  isHeadingStyle,
  type NamedStyle,
  type ParagraphAlignment,
  type TableCell,
} from "./types.ts";

export type { ElementSpec, InsertPosition };

/** One recorded surgical mutation. Compile replays these against original indexes. */
export type DomMutation =
  | {
      anchorId: number;
      newId: number;
      opIndex?: number;
      position: "afterend" | "beforebegin";
      spec: ElementSpec;
      type: "insertAdjacent";
    }
  | {
      cell?: [number, number];
      nodeId: number;
      opIndex?: number;
      para?: number;
      runs?: InlineRunInput[];
      text: string;
      type: "innerText";
    }
  | { namedStyleType: NamedStyle; nodeId: number; opIndex?: number; type: "namedStyleType" }
  | {
      cell?: [number, number];
      nodeId: number;
      opIndex?: number;
      para?: number;
      patch: StylePatch;
      type: "style";
    }
  | { nodeId: number; opIndex?: number; preset: string; type: "bullets" }
  | { nodeId: number; opIndex?: number; type: "remove" }
  | {
      cell: [number, number];
      cells?: string[];
      insertBelow?: boolean;
      nodeId: number;
      opIndex?: number;
      type: "insertTableRow";
    }
  | {
      cell: [number, number];
      nodeId: number;
      opIndex?: number;
      type: "deleteTableRow";
    }
  | {
      cell: [number, number];
      insertRight?: boolean;
      nodeId: number;
      opIndex?: number;
      type: "insertTableColumn";
    }
  | {
      cell: [number, number];
      nodeId: number;
      opIndex?: number;
      type: "deleteTableColumn";
    };

/** Options for a write session. */
export type DomWriterOpts = {
  /** Google Doc data for resolving cross-tab and cross-heading symbolic links. */
  doc?: GoogleDoc;
  force?: boolean;
  /** Custom link resolver function. */
  linkResolver?: (href: string) => string;
  lists?: GoogleDoc["lists"];
  /** Docs segmentId for headers/footers/footnotes. Omit for body. */
  segmentId?: string;
  /** In-memory simulated tabs map. */
  simulatedTabs?: Map<string, DocNode[]>;
  /** Docs tabId. Omit only for legacy fixtures without tabs. */
  tabId?: string;
};

/**
 * Accumulates surgical writes against a sibling tape. Nodes are identified by
 * snapshot `id` (1…n from parse, then max+1 for inserts in this session).
 */
export class DomWriter {
  readonly doc?: GoogleDoc;
  readonly force: boolean;
  readonly linkResolver?: (href: string) => string;
  readonly lists: GoogleDoc["lists"];
  readonly segmentId?: string;
  readonly tabId?: string;

  readonly #mutations: DomMutation[] = [];
  readonly #nodes: DocNode[];
  readonly #original: DocNode[];
  #nextId: number;
  #nextOpIndex?: number;

  constructor(nodes: DocNode[], opts: DomWriterOpts = {}) {
    this.doc = opts.doc;
    this.force = opts.force ?? false;
    this.lists = opts.lists;
    this.segmentId = opts.segmentId;
    this.tabId = opts.tabId;
    this.linkResolver =
      opts.linkResolver ??
      (opts.doc || nodes.length
        ? createSymbolicLinkResolver({
            currentTabId: opts.tabId,
            doc: opts.doc,
            nodes,
            simulatedTabs: opts.simulatedTabs,
          })
        : undefined);
    this.#original = nodes.map(cloneNode);
    this.#nodes = nodes.map(cloneNode);
    this.#nextId = nodes.reduce((m, n) => Math.max(m, n.tapeIndex), 0) + 1;
  }

  /** Snapshot of the tape before mutations. */
  originalNodes(): DocNode[] {
    return this.#original.map(cloneNode);
  }

  /** Working tape (order after inserts/removes; indexes are not live). */
  get nodes(): DocNode[] {
    return this.#nodes;
  }

  /** Recorded mutations in agent order. */
  mutations(): DomMutation[] {
    return [...this.#mutations];
  }

  /** Tags the next recorded mutation(s) with a global ops[] index (multi-tape apply). */
  setNextOpIndex(index: number): void {
    this.#nextOpIndex = index;
  }

  /** Detached spec — same as the free `createElement`. */
  createElement(...args: Parameters<typeof createElement>): ReturnType<typeof createElement> {
    const [kind, props, opts] = args;
    return createElement(kind, props, { force: this.force, ...opts });
  }

  /** Wrap a tape node with innerText / insertAdjacentElement / remove. */
  wrap(node: DocNode): DomHandle {
    const live = this.#find(node.tapeIndex);
    if (!live) throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    return new DomHandle(this, live);
  }

  /**
   * Inserts a detached spec as a sibling of `anchor`.
   * Only `beforebegin` / `afterend`. Returns the new tape node (next tapeIndex).
   */
  insertAdjacentElement(anchor: DocNode, position: InsertPosition, element: ElementSpec): DocNode {
    if (position === "afterbegin" || position === "beforeend") {
      const heading = isHeadingStyle(this.#find(anchor.tapeIndex)?.namedStyleType);
      throw new Error(
        heading
          ? `insertAdjacentElement("${position}") would write inside the heading. Use beforebegin/afterend (siblings).`
          : `insertAdjacentElement("${position}") is not a sibling insert. Use beforebegin/afterend.`,
      );
    }

    const live = this.#find(anchor.tapeIndex);
    if (!live) throw new Error(`Anchor ${anchor.tapeIndex} is not in the tape`);

    if (element.kind === "paragraph") {
      assertWritable(element, { force: this.force });
    }

    const created: DocNode = specToNode(element, this.#nextId++);
    this.#push({
      anchorId: live.tapeIndex,
      newId: created.tapeIndex,
      position,
      spec: element,
      type: "insertAdjacent",
    });

    const i = this.#nodes.findIndex((n) => n.tapeIndex === live.tapeIndex);
    const at = position === "beforebegin" ? i : i + 1;
    this.#nodes.splice(at, 0, created);
    return created;
  }

  /** Replace text inside that paragraph, or one cell paragraph when `cell` is set. */
  setInnerText(
    node: DocNode,
    text: string,
    cell?: [number, number],
    para?: number,
    opts?: { runs?: InlineRunInput[] },
  ): void {
    const live = this.#find(node.tapeIndex);
    if (!live) throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    const next = stripTrailingNewline(text);

    if (cell) {
      const target = requireCellPara(live, cell, para);
      assertWritable({ text: next }, { force: this.force });
      this.#push({
        cell,
        nodeId: live.tapeIndex,
        ...(para ? { para } : {}),
        ...(opts?.runs ? { runs: opts.runs } : {}),
        text: next,
        type: "innerText",
      });
      target.text = next;
      delete target.markup;
      delete (target as Record<string, unknown>).chips;
      delete (target as Record<string, unknown>).fontColors;
      delete (target as Record<string, unknown>).footnoteIds;
      syncCellHead(live, cell);
      return;
    }

    if (live.kind !== "paragraph") {
      throw new Error(
        'innerText is only supported on paragraph nodes (use at: "h.arch.table.0.1.3c8f" from query --full for tables)',
      );
    }

    assertWritable({ bullet: live.bullet, namedStyleType: live.namedStyleType, text: next }, { force: this.force });

    const pending = this.#pendingSpec(live.tapeIndex);
    if (pending?.kind === "paragraph") {
      pending.text = next;
      if (opts?.runs) pending.runs = opts.runs;
      live.text = next;
      delete live.markup;
      delete (live as Record<string, unknown>).chips;
      delete (live as Record<string, unknown>).fontColors;
      delete (live as Record<string, unknown>).footnoteIds;
      return;
    }

    this.#push({
      nodeId: live.tapeIndex,
      ...(opts?.runs ? { runs: opts.runs } : {}),
      text: next,
      type: "innerText",
    });
    live.text = next;
    delete live.markup;
    delete (live as Record<string, unknown>).chips;
    delete (live as Record<string, unknown>).fontColors;
    delete (live as Record<string, unknown>).footnoteIds;
  }

  /** Change namedStyleType on an existing paragraph. Does not change text. */
  setNamedStyleType(node: DocNode, namedStyleType: NamedStyle): void {
    const live = this.#find(node.tapeIndex);
    if (!live) throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    if (live.kind !== "paragraph") {
      throw new Error("namedStyleType is only supported on paragraph nodes");
    }

    const pending = this.#pendingSpec(live.tapeIndex);
    if (pending?.kind === "paragraph") {
      pending.namedStyleType = namedStyleType;
      live.namedStyleType = namedStyleType;
      return;
    }

    this.#push({
      namedStyleType,
      nodeId: live.tapeIndex,
      type: "namedStyleType",
    });
    live.namedStyleType = namedStyleType;
  }

  /** Paragraph, cell, or section style patch. */
  setStyle(node: DocNode, patch: StylePatch, cell?: [number, number], para?: number): void {
    if ((patch as any)?.tableAlignment !== undefined) {
      throw new Error(
        "tableAlignment is not supported: Google Docs tables default to full page width (left-aligned under the hood). Google Docs REST API has no property or request for table page alignment (center/left/right). Use fixed columnWidth to control column sizes (table remains left-aligned), or cellTextAlignment to align cell text.",
      );
    }
    if ((patch as any)?.cellTextAlignment !== undefined && !patch.alignment) {
      patch.alignment = (patch as any).cellTextAlignment;
    }
    if (!hasStyle(patch)) return;
    const live = this.#find(node.tapeIndex);
    if (!live) throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    if (cell) {
      const target = requireCellPara(live, cell, para);
      this.#push({
        cell,
        nodeId: live.tapeIndex,
        ...(para ? { para } : {}),
        patch,
        type: "style",
      });
      applyPatchToPara(target, patch);
      applyPatchToTable(live, patch);
      if (patch.cellBackground) {
        const tableCell = requireCell(live, cell);
        tableCell.backgroundColor = patch.cellBackground;
      }
      syncCellHead(live, cell);
      return;
    }
    if (patch.columnCount != null && live.kind !== "sectionBreak") {
      throw new Error("columnCount is only valid on a sectionBreak node");
    }
    if (live.kind === "table") {
      const disallowed = tableDisallowedKeys(patch);
      if (disallowed.length) {
        if (disallowed.includes("tableAlignment" as any)) {
          throw new Error(
            "tableAlignment is not supported: Google Docs REST API has no property or request for table page alignment (center/left/right). Use fixed columnWidth to control table width, or alignment to align cell text.",
          );
        }
        throw new Error(
          `style on a table node only accepts alignment, cellBackground, columnWidth, borderColor, borderWidth, cellPadding, contentAlignment, minRowHeight (not ${disallowed.join(", ")}). Cell text uses at: "h.arch.table.0.1.3c8f".`,
        );
      }
      this.#push({ nodeId: live.tapeIndex, patch, type: "style" });
      applyPatchToTable(live, patch);
      return;
    }
    if (hasTableChrome(patch)) {
      throw new Error(
        "columnWidth, borders, cellPadding, contentAlignment, minRowHeight, and cellBackground require a table node or cell id",
      );
    }
    if (live.kind !== "paragraph" && live.kind !== "sectionBreak" && patch.columnCount == null) {
      throw new Error(
        'style is only supported on paragraph, table, or sectionBreak nodes (use at: "h.arch.table.0.1.3c8f" from query --full for cells)',
      );
    }
    const pending = this.#pendingSpec(live.tapeIndex);
    if (pending?.kind === "paragraph") {
      pending.style = { ...pending.style, ...patch };
      if (patch.alignment) pending.alignment = patch.alignment;
      if (patch.indentStart != null) {
        pending.indentStart = { magnitude: patch.indentStart, unit: "PT" };
      }
      applyPatchToPara(live, patch);
      return;
    }
    this.#push({ nodeId: live.tapeIndex, patch, type: "style" });
    applyPatchToPara(live, patch);
    if (patch.columnCount != null) live.columnCount = patch.columnCount;
  }

  /** Paragraph or table-cell alignment. */
  setAlignment(node: DocNode, alignment: ParagraphAlignment, cell?: [number, number], para?: number): void {
    this.setStyle(node, { alignment }, cell, para);
  }

  /**
   * Converts an existing paragraph (or its shared listId run) to a bullet preset.
   * Does not change nestingLevel — tabs are already stripped.
   */
  setBulletPreset(node: DocNode, preset: string): void {
    const live = this.#find(node.tapeIndex);
    if (!live) throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    if (live.kind !== "paragraph") {
      throw new Error("bullet restyle is only valid on a paragraph");
    }
    this.#push({ nodeId: live.tapeIndex, preset, type: "bullets" });
  }

  /** Deletes that node only. */
  remove(node: DocNode): void {
    const live = this.#find(node.tapeIndex);
    if (!live) throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    this.#push({ nodeId: live.tapeIndex, type: "remove" });
    this.#nodes.splice(
      this.#nodes.findIndex((n) => n.tapeIndex === live.tapeIndex),
      1,
    );
  }

  /** Inserts a row into a table at the given cell coordinates. */
  insertTableRow(tableNode: DocNode, cell: [number, number], insertBelow = true, cells?: string[]): void {
    const live = this.#find(tableNode.tapeIndex);
    if (!live) throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("insertTableRow is only valid on a table node");
    }
    this.#push({
      cell,
      ...(cells ? { cells } : {}),
      insertBelow,
      nodeId: live.tapeIndex,
      type: "insertTableRow",
    });
  }

  /** Deletes a row from a table at the given cell coordinates. */
  deleteTableRow(tableNode: DocNode, cell: [number, number]): void {
    const live = this.#find(tableNode.tapeIndex);
    if (!live) throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("deleteTableRow is only valid on a table node");
    }
    this.#push({
      cell,
      nodeId: live.tapeIndex,
      type: "deleteTableRow",
    });
  }

  /** Inserts a column into a table at the given cell coordinates. */
  insertTableColumn(tableNode: DocNode, cell: [number, number], insertRight = true): void {
    const live = this.#find(tableNode.tapeIndex);
    if (!live) throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("insertTableColumn is only valid on a table node");
    }
    this.#push({
      cell,
      insertRight,
      nodeId: live.tapeIndex,
      type: "insertTableColumn",
    });
  }

  /** Deletes a column from a table at the given cell coordinates. */
  deleteTableColumn(tableNode: DocNode, cell: [number, number]): void {
    const live = this.#find(tableNode.tapeIndex);
    if (!live) throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("deleteTableColumn is only valid on a table node");
    }
    this.#push({
      cell,
      nodeId: live.tapeIndex,
      type: "deleteTableColumn",
    });
  }

  #push(mutation: DomMutation): void {
    this.#mutations.push(this.#nextOpIndex != null ? { ...mutation, opIndex: this.#nextOpIndex } : mutation);
  }

  #find(tapeIndex: number): DocNode | undefined {
    return this.#nodes.find((n) => n.tapeIndex === tapeIndex);
  }

  #pendingSpec(tapeIndex: number): ElementSpec | undefined {
    for (const m of this.#mutations) {
      if (m.type === "insertAdjacent" && m.newId === tapeIndex) return m.spec;
    }
    return undefined;
  }
}

/** DOM-shaped handle: innerText setter, insertAdjacentElement, remove. */
export class DomHandle {
  constructor(
    private readonly writer: DomWriter,
    /** Wrapped target document node. */
    readonly node: DocNode,
  ) {}

  /** Gets the text content of the underlying node. */
  get innerText(): string {
    return this.node.text ?? "";
  }

  /** Sets the text content of the underlying node. */
  set innerText(text: string) {
    this.writer.setInnerText(this.node, text);
  }

  /** Sets the named style type of the underlying node. */
  set namedStyleType(namedStyleType: NamedStyle) {
    this.writer.setNamedStyleType(this.node, namedStyleType);
  }

  /** Sets the paragraph alignment of the underlying node. */
  set alignment(alignment: ParagraphAlignment) {
    this.writer.setAlignment(this.node, alignment);
  }

  /** Inserts a new element relative to the underlying node. */
  insertAdjacentElement(position: InsertPosition, element: ElementSpec): DomHandle {
    const created = this.writer.insertAdjacentElement(this.node, position, element);
    return new DomHandle(this.writer, created);
  }

  /** Removes the underlying node from the document. */
  remove(): void {
    this.writer.remove(this.node);
  }
}

/** Inserts a detached element specification relative to an anchor node. */
export function elementInsertAdjacent(
  writer: DomWriter,
  anchor: DocNode,
  position: InsertPosition,
  element: ElementSpec,
): DocNode {
  return writer.insertAdjacentElement(anchor, position, element);
}

/** Free-function form of insertAdjacentElement (alias for elementInsertAdjacent). */
export const insertAdjacentElement = elementInsertAdjacent;

/** Sets the inner text content of a document node. */
export function innerTextSet(writer: DomWriter, node: DocNode, text: string): void {
  writer.setInnerText(node, text);
}

/** Free-function form of setInnerText (alias for innerTextSet). */
export const setInnerText = innerTextSet;

/** Removes a node from the document writer tape. */
export function nodeRemove(writer: DomWriter, node: DocNode): void {
  writer.remove(node);
}

/** Free-function form of remove (alias for nodeRemove). */
export const remove = nodeRemove;

/** Clones a cell paragraph including chip and image arrays. */
function clonePara(p: CellParagraph): CellParagraph {
  return {
    ...p,
    ...(p.chips ? { chips: p.chips.map((chip) => ({ ...chip })) } : {}),
    ...(p.images ? { images: p.images.map((img) => ({ ...img })) } : {}),
  };
}

/** Deep clones a document node and its nested attributes. */
function cloneNode(node: DocNode): DocNode {
  return {
    ...node,
    ...(node.bullet ? { bullet: { ...node.bullet } } : {}),
    ...(node.footnoteIds ? { footnoteIds: [...node.footnoteIds] } : {}),
    ...(node.indentStart ? { indentStart: { ...node.indentStart } } : {}),
    ...(node.indentFirstLine ? { indentFirstLine: { ...node.indentFirstLine } } : {}),
    ...(node.indentEnd ? { indentEnd: { ...node.indentEnd } } : {}),
    ...(node.table
      ? {
          table: {
            ...(node.table.columnWidth != null ? { columnWidth: node.table.columnWidth } : {}),
            ...(node.table.borderColor ? { borderColor: node.table.borderColor } : {}),
            ...(node.table.cellPadding != null ? { cellPadding: node.table.cellPadding } : {}),
            ...(node.table.contentAlignment ? { contentAlignment: node.table.contentAlignment } : {}),
            ...(node.table.minRowHeight != null ? { minRowHeight: node.table.minRowHeight } : {}),
            cells: node.table.cells.map((row) =>
              row.map((cell) => ({
                ...clonePara(cell),
                paragraphs: (cell.paragraphs ?? [cell]).map(clonePara),
                ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
              })),
            ),
          },
        }
      : {}),
    ...(node.images ? { images: node.images.map((img) => ({ ...img })) } : {}),
    ...(node.chips ? { chips: node.chips.map((chip) => ({ ...chip })) } : {}),
  };
}

/** Converts an ElementSpec into an in-memory DocNode placeholder for writing. */
function specToNode(spec: ElementSpec, tapeIndex: number): DocNode {
  if (spec.kind === "table") {
    return {
      end: -1,
      tapeIndex,
      kind: "table",
      start: -1,
      table: {
        cells: spec.table.rows.map((row, r) =>
          row.map((text, c) => {
            const parsed = chipsImagesFromSpecials(spec.table.cellSpecials?.[r]?.[c]);
            const p: CellParagraph = { end: -1, start: -1, text, ...parsed };
            return { ...p, paragraphs: [p] };
          }),
        ),
      },
    };
  }
  if (spec.kind === "pageBreak") {
    return { end: -1, tapeIndex, kind: "pageBreak", start: -1 };
  }
  if (spec.kind === "sectionBreak") {
    return { end: -1, tapeIndex, kind: "sectionBreak", start: -1 };
  }
  if (spec.kind === "person") {
    return {
      chips: [
        {
          email: spec.email,
          end: -1,
          kind: "person",
          start: -1,
          textOffset: 0,
          title: spec.email,
          uri: `mailto:${spec.email}`,
        },
      ],
      end: -1,
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: `@${spec.email}`,
    };
  }
  if (spec.kind === "richLink") {
    return {
      chips: [
        {
          end: -1,
          kind: "richLink",
          start: -1,
          textOffset: 0,
          title: spec.title ?? spec.uri,
          uri: spec.uri,
          ...(spec.mimeType ? { mimeType: spec.mimeType } : {}),
        },
      ],
      end: -1,
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: spec.title ?? spec.uri,
    };
  }
  if (spec.kind === "date") {
    return {
      chips: [
        {
          end: -1,
          kind: "date",
          start: -1,
          textOffset: 0,
          title: spec.displayText ?? spec.timestamp ?? "date",
          uri: "",
          ...(spec.dateFormat ? { dateFormat: spec.dateFormat } : {}),
          ...(spec.timestamp ? { timestamp: spec.timestamp } : {}),
        },
      ],
      end: -1,
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: spec.displayText ?? spec.timestamp ?? "",
    };
  }
  if (spec.kind === "footnote") {
    return {
      end: -1,
      footnoteIds: [""],
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: spec.text ?? "[^]",
    };
  }
  if (spec.kind === "inlineImage") {
    return {
      end: -1,
      tapeIndex,
      images: [
        {
          end: -1,
          objectId: "",
          start: -1,
          sourceUri: spec.uri,
          textOffset: 0,
          ...(spec.heightPt != null ? { heightPt: spec.heightPt } : {}),
          ...(spec.widthPt != null ? { widthPt: spec.widthPt } : {}),
        },
      ],
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: "",
    };
  }
  const node: DocNode = {
    ...(spec.alignment ? { alignment: spec.alignment } : {}),
    ...(spec.bullet ? { bullet: { nestingLevel: spec.bullet.nestingLevel } } : {}),
    ...(spec.indentStart ? { indentStart: spec.indentStart } : {}),
    end: -1,
    tapeIndex,
    kind: "paragraph",
    namedStyleType: spec.namedStyleType,
    start: -1,
    text: spec.text,
  };
  const parsed = chipsImagesFromSpecials(spec.specials);
  if (parsed.chips) node.chips = parsed.chips;
  if (parsed.images) node.images = parsed.images;
  if (spec.style) {
    applyPatchToPara(node, spec.style);
    if (spec.style.foregroundColor || spec.style.fontSize || spec.style.italic) {
      node.style = {
        ...(spec.style.fontSize ? { fontSize: spec.style.fontSize } : {}),
        ...(spec.style.foregroundColor ? { foregroundColor: spec.style.foregroundColor } : {}),
        ...(spec.style.italic ? { italic: spec.style.italic } : {}),
      };
    }
    if (spec.style.foregroundColor) {
      node.fontColors = [spec.style.foregroundColor.toUpperCase()];
    }
  }
  if (spec.runs?.length) {
    const runColors = spec.runs
      .map((r) => r.foregroundColor)
      .filter((c): c is string => Boolean(c))
      .map((c) => c.toUpperCase());
    if (runColors.length > 0) {
      node.fontColors = Array.from(new Set([...(node.fontColors ?? []), ...runColors]));
    }
  }
  return node;
}

/** Maps paragraph specials onto parsed chip/image fields for in-memory nodes. */
function chipsImagesFromSpecials(
  /** Inline specials from a detached spec. */
  specials?: ParagraphInlineSpecial[],
): { chips?: InlineChip[]; images?: InlineImage[] } {
  if (!specials?.length) return {};
  const chips: InlineChip[] = [];
  const images: InlineImage[] = [];
  for (const special of specials) {
    if (special.kind === "person") {
      chips.push({
        email: special.email,
        end: -1,
        kind: "person",
        start: -1,
        textOffset: special.offset,
        title: special.email,
        uri: `mailto:${special.email}`,
      });
    } else if (special.kind === "date") {
      const chip: InlineChip = {
        end: -1,
        kind: "date",
        start: -1,
        textOffset: special.offset,
        title: special.displayText ?? special.timestamp,
        uri: "",
      };
      if (special.dateFormat) chip.dateFormat = special.dateFormat;
      chip.timestamp = special.timestamp;
      chips.push(chip);
    } else if (special.kind === "richLink") {
      const chip: InlineChip = {
        end: -1,
        kind: "richLink",
        start: -1,
        textOffset: special.offset,
        title: special.title ?? special.uri,
        uri: special.uri,
      };
      if (special.mimeType) chip.mimeType = special.mimeType;
      chips.push(chip);
    } else {
      const image: InlineImage = {
        end: -1,
        objectId: "",
        start: -1,
        sourceUri: special.uri,
        textOffset: special.offset,
      };
      if (special.heightPt != null) image.heightPt = special.heightPt;
      if (special.widthPt != null) image.widthPt = special.widthPt;
      images.push(image);
    }
  }
  return {
    ...(chips.length ? { chips } : {}),
    ...(images.length ? { images } : {}),
  };
}

/** Asserts that a table node contains the specified cell coordinates. */
function requireCell(node: DocNode, cell: [number, number]): TableCell & { paragraphs: CellParagraph[] } {
  if (node.kind !== "table" || !node.table) {
    throw new Error("cell id is only valid on a table node");
  }
  const [r, c] = cell;
  const hit = node.table.cells[r]?.[c];
  if (!hit) {
    throw new Error(`No cell [${r}, ${c}] — table is ${node.table.cells.length}×${node.table.cells[0]?.length ?? 0}`);
  }
  if (!hit.paragraphs?.length) {
    hit.paragraphs = [{ end: hit.end, start: hit.start, text: hit.text }];
  }
  return hit as TableCell & { paragraphs: CellParagraph[] };
}

/** Asserts that a table cell contains the specified paragraph index. */
function requireCellPara(node: DocNode, cell: [number, number], para?: number): CellParagraph {
  const tableCell = requireCell(node, cell);
  const i = para ?? 0;
  const hit = tableCell.paragraphs[i];
  if (!hit) {
    throw new Error(`No paragraph ${i} in cell [${cell[0]}, ${cell[1]}] (${tableCell.paragraphs.length} paragraphs)`);
  }
  return hit;
}

/** Synchronizes cell head paragraph properties back to the parent cell. */
function syncCellHead(node: DocNode, cell: [number, number]): void {
  const tableCell = requireCell(node, cell);
  const head = tableCell.paragraphs[0];
  if (!head) return;
  tableCell.alignment = head.alignment;
  tableCell.end = head.end;
  tableCell.images = head.images;
  tableCell.markup = head.markup;
  tableCell.start = head.start;
  tableCell.text = head.text;
}

/** Identifies style patch keys that are not supported directly on table nodes. */
function tableDisallowedKeys(patch: StylePatch): string[] {
  const allowed = new Set<keyof StylePatch | "cellTextAlignment">([
    "alignment",
    "borderColor",
    "borderWidth",
    "cellBackground",
    "cellPadding",
    "cellTextAlignment",
    "columnWidth",
    "contentAlignment",
    "minRowHeight",
    "pinnedHeaderRows",
    "preventOverflow",
  ]);
  return (Object.keys(patch) as Array<keyof StylePatch>).filter(
    (k) => patch[k] !== undefined && !allowed.has(k as any),
  );
}

/** Copies table chrome onto the live table node for query dumps. */
function applyPatchToTable(node: DocNode, patch: StylePatch): void {
  if (!node.table) return;
  if (patch.columnWidth != null) node.table.columnWidth = patch.columnWidth;
  if (patch.borderColor) node.table.borderColor = patch.borderColor;
  if (patch.cellPadding != null) node.table.cellPadding = patch.cellPadding;
  if (patch.contentAlignment) node.table.contentAlignment = patch.contentAlignment;
  if (patch.minRowHeight != null) node.table.minRowHeight = patch.minRowHeight;
  if (patch.pinnedHeaderRows != null) node.table.pinnedHeaderRows = patch.pinnedHeaderRows;
  if (patch.preventOverflow != null) node.table.preventOverflow = patch.preventOverflow;
}

/** Applies paragraph layout and spacing style patch properties to target object. */
function applyPatchToPara(
  target: {
    alignment?: ParagraphAlignment;
    indentEnd?: { magnitude: number; unit: "PT" };
    indentFirstLine?: { magnitude: number; unit: "PT" };
    indentStart?: { magnitude: number; unit: "PT" };
    lineSpacing?: number;
    shading?: string;
    spaceAbove?: number;
    spaceBelow?: number;
  },
  patch: StylePatch,
): void {
  if (patch.alignment) target.alignment = patch.alignment;
  if (patch.lineSpacing != null) target.lineSpacing = patch.lineSpacing;
  if (patch.shading) target.shading = patch.shading;
  if (patch.spaceAbove != null) target.spaceAbove = patch.spaceAbove;
  if (patch.spaceBelow != null) target.spaceBelow = patch.spaceBelow;
  if (patch.indentStart != null) {
    target.indentStart = { magnitude: patch.indentStart, unit: "PT" };
  }
  if (patch.indentFirstLine != null) {
    target.indentFirstLine = { magnitude: patch.indentFirstLine, unit: "PT" };
  }
  if (patch.indentEnd != null) {
    target.indentEnd = { magnitude: patch.indentEnd, unit: "PT" };
  }
}
