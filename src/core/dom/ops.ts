/* JSON ops for the surgical write API. Agents write this file; CLI applies it. */

import { existsSync, readFileSync, statSync } from "node:fs";
import { InlineMarkup, type InlineRunInput } from "~/core/inline.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { computeNodeChecksum } from "./checksum.ts";
import { type CloneNodeRef, resolveIntraDocCloneNode } from "./clone.ts";
import {
  asBulletPreset,
  type BulletPreset,
  type BulletProps,
  type CreateParagraphProps,
  createCodeBlock,
  createElement,
  type ElementSpec,
  type InsertPosition,
  type ParagraphSpec,
  stripTrailingNewline,
} from "./element.ts";
import { CHIP_MUTATE_MSG, EXISTING_NEST_MSG, HEADING_BULLET_MSG, hasChips } from "./guards.ts";
import { type MarkdownParseOptions, markdownStylesParse, parseMarkdownToElements } from "./markdownParser.ts";
import { DocDom, formatMissingScopedTargetMsg, missingNodeIdMsg, neighborhoodFrom } from "./query.ts";
import { hangingFirstLine, hasIndent, hasStyle, type StylePatch } from "./style.ts";
import {
  asAlignment,
  type CellContentAlignment,
  type CellParagraph,
  type DocNode,
  type DocSegment,
  isHeadingStyle,
  type NamedStyle,
  type ParagraphAlignment,
  type QueryTextStyle,
  type TableCell,
} from "./types.ts";
import type { DomWriter } from "./write.ts";

const PREVIEW_LEN = 80;

/** One surgical tape mutation. Targets a node by "at", "after", or "before". */
export type TapeMutation = {
  /** Anchor node to insert after (sets position to "afterend"). */
  after?: number | string;
  /** Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED). */
  alignment?: ParagraphAlignment;
  /** Name/alias for this node or inserted section, referable by subsequent ops as an anchor. */
  as?: string;
  /** Snapshot id from query: heading-scoped `"h.arch.9a1b"`, cell `"h.arch.table.0.1.3c8f"`. */
  at?: number | string;
  /** Anchor node to insert before (sets position to "beforebegin"). */
  before?: number | string;
  /**
   * Convert this paragraph (and siblings sharing listId) to a Docs bullet preset.
   * Preset only — not nestingLevel, not custom glyph text.
   */
  bullet?: BulletProps;
  /** Clone an existing node with 100% style/bullet fidelity. */
  cloneNode?: number | string | CloneNodeRef;
  /** Batch cloning of existing nodes. */
  cloneNodes?: Array<number | string | CloneNodeRef>;
  /** Removes the target heading and all following siblings until the next same-or-higher heading. */
  dangerousRemoveSection?: boolean;
  deleteTableColumn?: boolean | { col?: number };
  deleteTableRow?: boolean | { row?: number };
  duplicateTableRow?: boolean | { insertBelow?: boolean; row?: number };
  /** Detached element spec to insert at anchor (e.g. { kind: "paragraph", text: "..." }). */
  element?: Record<string, unknown>;
  /** Array of detached element specs to insert sequentially at anchor. */
  elements?: Array<Record<string, unknown>>;
  /** Local file path to read markdown/text from for insertMarkdown, replaceMarkdown, or replaceSection. */
  file?: string;
  /** Force destructive mutation even if targeting a fragile node (chips, equations, TOC). */
  force?: boolean;
  /** Treat the first markdown `#` as TITLE when parsing insertMarkdown / replaceMarkdown / replaceSection. */
  h1IsTitle?: boolean;
  innerText?: string;
  insertAdjacentElement?: {
    cloneNode?: number | string | CloneNodeRef;
    cloneNodes?: Array<number | string | CloneNodeRef>;
    element?: Record<string, unknown>;
    elements?: Array<Record<string, unknown>>;
    position?: InsertPosition;
  };
  insertDate?: { dateFormat?: string; displayText?: string; timestamp?: string };
  insertFootnote?: { text?: string };
  insertImage?: { heightPt?: number; uri: string; widthPt?: number };
  /** Inserts rendered markdown elements at anchor (defaults to afterend for after, beforebegin for before/at). Accepts markdown text or file path. */
  insertMarkdown?: string | boolean;
  insertPerson?: { email: string };
  insertRichLink?: { mimeType?: string; title?: string; uri: string };
  insertSectionBreak?: boolean | { sectionType?: "CONTINUOUS" | "NEXT_PAGE" };
  insertTableColumn?: boolean | { col?: number; insertRight?: boolean };
  insertTableRow?: boolean | { cells?: string[]; insertBelow?: boolean; row?: number };
  /** Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`. */
  markdownStyles?: Record<string, unknown>;
  /** Change namedStyleType on an existing paragraph (demote leftover H3, etc.). */
  namedStyleType?: NamedStyle;
  /** Sibling insert position: "afterend" (default for after) or "beforebegin" (default for before). */
  position?: InsertPosition;
  remove?: boolean;
  /** In-place text replacement (alias for innerText). */
  replace?: string;
  /** In-place single-node markdown replacement. Never touches children or following siblings. Accepts markdown text or file path. */
  replaceMarkdown?: string | boolean;
  /** Section-level diff-preserving markdown replacement. Target MUST be a heading. Accepts markdown text or file path. */
  replaceSection?: string | boolean;
  /** Alias for replaceSection. */
  replaceSectionMarkdown?: string | boolean;
  /** Explicit styled text runs for inline formatting (e.g. { text: "word", code: true, fontSize: 9 }). */
  runs?: InlineRunInput[];
  /** Native paragraph / text / cell / section fields. Combinable with innerText/replace. */
  style?: StylePatch;
  /** Table styling (pinnedHeaderRows, preventOverflow, columnWidth, etc.). */
  tableStyle?: StylePatch;
  /**
   * Refused at apply time — Docs REST API has no table page alignment.
   * Use `columnWidth` or `cellTextAlignment` instead.
   */
  tableAlignment?: ParagraphAlignment;
};

/**
 * Canonical {@link TapeMutation} property names. The run adapter must forward
 * every key; the type check below fails if the object type and this list drift.
 */
export const TAPE_MUTATION_KEYS = [
  "after",
  "alignment",
  "as",
  "at",
  "before",
  "bullet",
  "cloneNode",
  "cloneNodes",
  "dangerousRemoveSection",
  "deleteTableColumn",
  "deleteTableRow",
  "duplicateTableRow",
  "element",
  "elements",
  "file",
  "force",
  "h1IsTitle",
  "innerText",
  "insertAdjacentElement",
  "insertDate",
  "insertFootnote",
  "insertImage",
  "insertMarkdown",
  "insertPerson",
  "insertRichLink",
  "insertSectionBreak",
  "insertTableColumn",
  "insertTableRow",
  "markdownStyles",
  "namedStyleType",
  "position",
  "remove",
  "replace",
  "replaceMarkdown",
  "replaceSection",
  "replaceSectionMarkdown",
  "runs",
  "style",
  "tableAlignment",
  "tableStyle",
] as const;

/** Property name of {@link TapeMutation}. */
export type TapeMutationKey = (typeof TAPE_MUTATION_KEYS)[number];

type TapeMutationKeysComplete =
  Exclude<keyof TapeMutation, TapeMutationKey> extends never
    ? Exclude<TapeMutationKey, keyof TapeMutation> extends never
      ? true
      : never
    : never;
const _tapeMutationKeysComplete: TapeMutationKeysComplete = true;
void _tapeMutationKeysComplete;

/** @deprecated Use TapeMutation. */
export type DomOp = TapeMutation;

/** Tab-level mutations for multi-tab apply. */
export type TabDomOp = {
  dangerousClear?: boolean;
  ops: TapeMutation[];
  tabId?: string;
  tabTitle?: string;
};

/** Document page setup geometry and margins. */
export type PageSetup = {
  margins?: {
    bottom?: number;
    left?: number;
    right?: number;
    top?: number;
  };
  orientation?: "LANDSCAPE" | "PORTRAIT";
  pageHeight?: number;
  pageSize?: "LETTER" | "LEGAL" | "TABLOID" | "A3" | "A4" | "A5" | "CUSTOM";
  pageWidth?: number;
};

/** File shape: query JSON + `ops`, or multi-tab `tabs`. Header/footer files also stamp `tape` + `segmentId`. */
export type DomOpFile =
  | {
      dangerousClear?: boolean;
      documentId?: string;
      ops?: DomOp[];
      pageSetup?: PageSetup;
      segmentId?: string;
      tabId?: string;
      tabs?: TabDomOp[];
      tabTitle?: string;
      tape?: "body" | "footer" | "header";
      use?: DocSegment["use"];
    }
  | DomOp[];

/** Normalized mutations file. */
export type ParsedDomFile = {
  dangerousClear?: boolean;
  documentId?: string;
  ops: DomOp[];
  pageSetup?: PageSetup;
  segmentId?: string;
  tabId?: string;
  tabs?: TabDomOp[];
  tape?: "body" | "footer" | "header";
  use?: DocSegment["use"];
};

/** One resolved op after applyOps (dry-run target preview). */
export type AppliedOpPlan = {
  action:
    | "alignment"
    | "bullets"
    | "dangerousRemoveSection"
    | "deleteTableColumn"
    | "deleteTableRow"
    | "duplicateTableRow"
    | "insertTableColumn"
    | "insertTableRow"
    | "innerText"
    | "insertAdjacentElement"
    | "namedStyleType"
    | "remove"
    | "replaceMarkdown"
    | "replaceSection"
    | "style";
  alignment?: ParagraphAlignment;
  as?: string;
  bullet?: BulletProps;
  cell?: [number, number];
  index: number;
  innerText?: string;
  insertAdjacentElement?: {
    bullet?: boolean;
    kind: string;
    namedStyleType?: NamedStyle;
    position: InsertPosition;
    text?: string;
  };
  namedStyleType?: NamedStyle;
  para?: number;
  segmentId?: string;
  style?: StylePatch;
  target: NodeSummary;
  warnings?: string[];
};

/** Subset of {@link AppliedOpPlan} attached to batchUpdate error context. */
export type AppliedOpPlanPreview = Pick<AppliedOpPlan, "action" | "index" | "target">;

/** Compact cell row for `query --full` (no API indexes). */
export type CellSummary = {
  alignment?: ParagraphAlignment;
  /** `"h.arch.table.0.1.3c8f"` — copy into write `at`. */
  id: string;
  image?: { count: number; heightPt?: number; widthPt?: number };
  indentEnd?: number;
  indentFirstLine?: number;
  indentStart?: number;
  markup?: string;
  /** Extra paragraphs when the cell has more than one. */
  paragraphs?: CellSummary[];
  shading?: string;
  style?: QueryTextStyle;
  text?: string;
};

/** Compact node row for `doc query --selector` (not a full AST dump). */
export type NodeSummary = {
  alignment?: ParagraphAlignment;
  bullet?: {
    nestingLevel: number;
    preset?: BulletPreset;
    type?: "NUMBERED" | "BULLET" | "CHECKBOX";
  };
  chips?: Array<{ title: string; uri: string }>;
  columnCount?: number;
  footnoteIds?: string[];
  /** True if this node contains a math equation (REST API cannot recreate equations). */
  hasEquation?: boolean;
  /** True if this node contains a native horizontal rule divider. */
  hasHorizontalRule?: boolean;
  id: number | string;
  image?: { count: number; heightPt?: number; widthPt?: number };
  indentEnd?: number;
  indentFirstLine?: number;
  indentStart?: number;
  kind: DocNode["kind"];
  lineSpacing?: number;
  /** Explains why this node is fragile or immutable before mutations are attempted. */
  lossWarning?: string;
  markup?: string;
  namedStyleType?: DocNode["namedStyleType"];
  shading?: string;
  spaceAbove?: number;
  spaceBelow?: number;
  /** Uniform non-default italic / size / color — compact and --full. */
  style?: QueryTextStyle;
  table?: {
    borderColor?: string;
    cells?: CellSummary[][];
    cellPadding?: number;
    cols: number;
    columnWidth?: number;
    contentAlignment?: CellContentAlignment;
    minRowHeight?: number;
    pinnedHeaderRows?: number;
    preventOverflow?: boolean;
    rows: number;
  };
  text?: string;
};

/** Query dump — same envelope as apply (`tabs` + empty `ops`). Compact heading echo for large tabs; `--full` keeps every node. */
export type LiveDumpTab = {
  nodes: NodeSummary[];
  ops: [];
  tabId?: string;
  tabTitle?: string;
};

export type LiveDump = {
  customStyledNodes?: Array<number | string>;
  documentId?: string;
  pageSetup?: PageSetup;
  segmentId?: string;
  styles?: Record<string, QueryTextStyle>;
  tabs: LiveDumpTab[];
  tape?: "body" | "footer" | "header";
  truncated?: boolean;
  use?: DocSegment["use"];
};

export const TAPE_ECHO_CAP = 80;

/** Compact tape dump. Large docs echo headings only (`truncated: true`). `--full` keeps every node. */
export function liveDump(opts: {
  allNodes?: DocNode[];
  documentId?: string;
  full?: boolean;
  includeStyles?: boolean;
  nodes: DocNode[];
  pageSetup?: PageSetup;
  segmentId?: string;
  tabId?: string;
  tabTitle?: string;
  tape?: "body" | "footer" | "header";
  use?: DocSegment["use"];
}): LiveDump {
  const overCap = opts.nodes.length > TAPE_ECHO_CAP;
  const truncated = overCap && !opts.full;
  const src = truncated ? opts.nodes.filter((n) => isHeadingStyle(n.namedStyleType)) : opts.nodes;

  const tab: LiveDumpTab = {
    nodes: src.map((n) => summarizeNode(n, { full: opts.full })),
    ops: [],
  };
  if (opts.tabId) tab.tabId = opts.tabId;
  if (opts.tabTitle) tab.tabTitle = opts.tabTitle;

  const dump: LiveDump = { tabs: [tab] };

  if (opts.documentId) dump.documentId = opts.documentId;
  if (truncated) dump.truncated = true;
  if (opts.tape) dump.tape = opts.tape;
  if (opts.segmentId) dump.segmentId = opts.segmentId;
  if (opts.use) dump.use = opts.use;
  if (opts.pageSetup) dump.pageSetup = opts.pageSetup;

  const nodesToInspect = opts.allNodes ?? opts.nodes;
  const styledNodes = nodesToInspect.filter((n) => n.style != null);
  if (styledNodes.length > 0) {
    dump.customStyledNodes = styledNodes.map((n) => n.scopedId ?? n.tapeIndex);
    if (opts.includeStyles) {
      dump.styles = Object.fromEntries(styledNodes.map((n) => [String(n.scopedId ?? n.tapeIndex), n.style!]));
    }
  }

  return dump;
}

/** Extracts high-level page geometry and margins from GoogleDoc.documentStyle. */
export function pageSetupExtract(docStyle?: GoogleDoc["documentStyle"]): PageSetup | undefined {
  if (!docStyle) return undefined;
  const top = docStyle.marginTop?.magnitude;
  const bottom = docStyle.marginBottom?.magnitude;
  const left = docStyle.marginLeft?.magnitude;
  const right = docStyle.marginRight?.magnitude;
  const w = docStyle.pageSize?.width?.magnitude;
  const h = docStyle.pageSize?.height?.magnitude;

  const hasMargins = top != null || bottom != null || left != null || right != null;
  const hasSize = w != null || h != null;
  if (!hasMargins && !hasSize) return undefined;

  const pageSetup: PageSetup = {};
  if (hasMargins) {
    pageSetup.margins = {
      ...(top != null ? { top } : {}),
      ...(bottom != null ? { bottom } : {}),
      ...(left != null ? { left } : {}),
      ...(right != null ? { right } : {}),
    };
  }
  if (hasSize) {
    pageSetup.pageWidth = w;
    pageSetup.pageHeight = h;
    if (w != null && h != null) {
      pageSetup.orientation = w > h ? "LANDSCAPE" : "PORTRAIT";
      if ((w === 612 && h === 792) || (w === 792 && h === 612)) {
        pageSetup.pageSize = "LETTER";
      } else if ((w === 612 && h === 1008) || (w === 1008 && h === 612)) {
        pageSetup.pageSize = "LEGAL";
      } else if ((w === 792 && h === 1224) || (w === 1224 && h === 792)) {
        pageSetup.pageSize = "TABLOID";
      } else if ((w === 595.28 && h === 841.89) || (w === 841.89 && h === 595.28)) {
        pageSetup.pageSize = "A4";
      } else {
        pageSetup.pageSize = "CUSTOM";
      }
    }
  }
  return pageSetup;
}

/** Extracts high-level page geometry and margins (alias for pageSetupExtract). */
export const extractPageSetup = pageSetupExtract;

export const TABLE_INSERT_MIX_MSG =
  "Table insert cannot share an apply with remove or edits to other nodes. Insert the table (optional style on that new table), query, then fill or remove.";

export const WRITE_AT_ONLY_MSG = 'Write ops require "at" from query nodes[].id or cells[].id (e.g. "h.arch.9a1b").';

export const CELL_FIELD_MSG =
  'Copy the cell id from query --full (e.g. "h.arch.table.0.1.3c8f"), not cell/para/segmentId/tabId fields.';

export function wrongDocumentMsg(file: string, live: string): string {
  return `File is for document ${file}, apply target is ${live}. Do not apply this file to a different Doc.`;
}

export function wrongTabMsg(file: string, live: string): string {
  return `File tabId is ${file}, live tab is ${live}. Query that tab; do not apply this file to a different tab.`;
}

/** Requires documentId in the apply document body. */
export function domDocumentAssert(opts: { documentId?: string }): string {
  if (!opts.documentId) {
    throw new Error("documentId required in the apply document");
  }
  return opts.documentId;
}

/** Requires documentId in the apply document body (alias for domDocumentAssert). */
export const assertDomDocument = domDocumentAssert;

/** Normalizes `{ ops }`, `{ tabs }`, or a bare array. */
export function domOpsParse(raw: unknown): ParsedDomFile {
  if (Array.isArray(raw)) return { ops: raw as DomOp[] };
  if (
    raw &&
    typeof raw === "object" &&
    (Array.isArray((raw as { ops?: unknown }).ops) || Array.isArray((raw as { tabs?: unknown }).tabs))
  ) {
    const obj = raw as {
      dangerousClear?: unknown;
      documentId?: unknown;
      ops?: DomOp[];
      pageSetup?: unknown;
      segmentId?: unknown;
      tabId?: unknown;
      tabs?: unknown;
      tape?: unknown;
      use?: unknown;
    };
    const documentId = typeof obj.documentId === "string" && obj.documentId ? obj.documentId : undefined;
    const segmentId = typeof obj.segmentId === "string" && obj.segmentId ? obj.segmentId : undefined;
    const tabId = typeof obj.tabId === "string" && obj.tabId ? obj.tabId : undefined;
    const tape = obj.tape === "body" || obj.tape === "header" || obj.tape === "footer" ? obj.tape : undefined;
    const use = obj.use === "default" || obj.use === "first" || obj.use === "even" ? obj.use : undefined;
    const dangerousClear = Boolean(obj.dangerousClear);

    const tabs: TabDomOp[] | undefined = Array.isArray(obj.tabs)
      ? (obj.tabs as Array<Record<string, unknown>>).map((t) => ({
          dangerousClear: Boolean(t.dangerousClear),
          ops: Array.isArray(t.ops) ? (t.ops as DomOp[]) : [],
          tabId: typeof t.tabId === "string" ? t.tabId : undefined,
          tabTitle: typeof t.tabTitle === "string" ? t.tabTitle : undefined,
        }))
      : undefined;

    const ops = Array.isArray(obj.ops) ? obj.ops : [];
    const pageSetup = obj.pageSetup && typeof obj.pageSetup === "object" ? (obj.pageSetup as PageSetup) : undefined;

    return {
      dangerousClear: dangerousClear || undefined,
      documentId,
      ops,
      pageSetup,
      segmentId,
      tabId,
      tabs,
      tape,
      use,
    };
  }
  throw new Error(
    "DOM mutations file must be `{ tabs: [{ tabId, ops }] }`, `{ ops: [ ... ] }`, or a list of ops (YAML or JSON)",
  );
}

function resolveMarkdownContent(
  val: string | boolean | undefined,
  filePath: string | undefined,
  opName: string,
  index: number,
): string | undefined {
  if (val === undefined && filePath === undefined) return undefined;
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ops[${index}] failed to read file "${filePath}": ${msg}`);
    }
  }
  if (val === true) {
    throw new Error(`ops[${index}] ${opName}: true requires a "file" property specifying the path to read`);
  }
  if (typeof val === "string") {
    if (!val.includes("\n") && (val.endsWith(".md") || val.endsWith(".markdown") || existsSync(val))) {
      try {
        if (existsSync(val) && statSync(val).isFile()) {
          return readFileSync(val, "utf8");
        }
      } catch {
        // Fall back to literal string
      }
    }
    return val;
  }
  return undefined;
}

/** Normalizes `{ ops }`, `{ tabs }`, or a bare array (alias for domOpsParse). */
export const parseDomOps = domOpsParse;

/**
 * Applies JSON ops to a writer. Re-queries `writer.nodes` after each op so a
 * later insert can target a node created earlier in the same file.
 * Returns a plan of resolved targets (for dry-run preview). Snapshots are
 * taken before each mutation.
 */
export function tapeMutationsApply(
  writer: DomWriter,
  ops: TapeMutation[],
  baseIndex = 0,
  opts: { clearedNodes?: DocNode[]; force?: boolean } = {},
): AppliedOpPlan[] {
  const plan: AppliedOpPlan[] = [];
  const afterendTails = new Map<number, DocNode>();
  const rootAnchors = new Map<number, number>();
  const namedAnchors = new Map<string, DocNode>();
  const deletedNodes: DocNode[] = [...(opts.clearedNodes ?? [])];
  const wipedScopeNodes: DocNode[] = [...(opts.clearedNodes ?? [])];
  const insertedNodes: Array<Record<string, unknown>> = [];

  for (let i = 0; i < ops.length; i++) {
    const rawInputOp = ops[i]!;
    const op: DomOp = { ...rawInputOp };
    const effectiveForce = Boolean(op.force || opts.force || writer.force);
    const index = baseIndex + i;
    writer.setNextOpIndex(index);
    const live = new DocDom(writer.nodes);
    if (
      Object.hasOwn(op, "cell") ||
      Object.hasOwn(op, "para") ||
      Object.hasOwn(op, "segmentId") ||
      Object.hasOwn(op, "tabId")
    ) {
      throw new Error(`ops[${index}] ${CELL_FIELD_MSG}`);
    }

    const anchorCount = Number(op.at != null) + Number(op.after != null) + Number(op.before != null);
    if (anchorCount > 1) {
      throw new Error(`ops[${index}] specify only one of "at", "after", or "before"`);
    }
    if (anchorCount === 0) {
      throw new Error(`ops[${index}] requires an anchor ("at", "after", or "before")`);
    }
    const rawAnchor = op.at ?? op.after ?? op.before;
    op.at = rawAnchor;
    const inferredPosition: InsertPosition =
      op.after != null ? "afterend" : op.before != null ? "beforebegin" : (op.position ?? "afterend");

    if (op.replaceSectionMarkdown !== undefined) {
      if (op.replaceSection !== undefined) {
        throw new Error(`ops[${index}] specify either "replaceSection" or "replaceSectionMarkdown", not both`);
      }
      op.replaceSection = op.replaceSectionMarkdown;
    }

    if (op.replace !== undefined) {
      if (op.innerText !== undefined) {
        throw new Error(`ops[${index}] specify either "replace" or "innerText", not both`);
      }
      op.innerText = op.replace;
    }

    if (op.insertMarkdown !== undefined || (op.file && !op.replaceMarkdown && !op.replaceSection)) {
      op.insertMarkdown = resolveMarkdownContent(op.insertMarkdown, op.file, "insertMarkdown", index);
    }
    if (op.replaceMarkdown !== undefined) {
      op.replaceMarkdown = resolveMarkdownContent(op.replaceMarkdown, op.file, "replaceMarkdown", index);
    }
    if (op.replaceSection !== undefined) {
      op.replaceSection = resolveMarkdownContent(op.replaceSection, op.file, "replaceSection", index);
    }

    const markdownOpts = markdownParseOptionsFromOp(op);

    if (op.insertMarkdown !== undefined) {
      if (typeof op.insertMarkdown !== "string") {
        throw new Error(`ops[${index}] insertMarkdown must be a string or file path`);
      }
      if (op.insertAdjacentElement != null) {
        throw new Error(`ops[${index}] specify either "insertMarkdown" or "insertAdjacentElement", not both`);
      }
      const specs = parseMarkdownToElements(op.insertMarkdown, markdownOpts);
      op.insertAdjacentElement = {
        elements: specs as Array<Record<string, unknown>>,
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertSectionBreak !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertSectionBreak" or "insertAdjacentElement", not both`);
      }
      const sectionType = typeof op.insertSectionBreak === "object" ? op.insertSectionBreak.sectionType : "NEXT_PAGE";
      op.insertAdjacentElement = {
        element: { kind: "sectionBreak", sectionType },
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertPerson !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertPerson" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { email: op.insertPerson.email, kind: "person" },
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertRichLink !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertRichLink" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "richLink", ...op.insertRichLink },
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertDate !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertDate" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "date", ...op.insertDate },
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertFootnote !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertFootnote" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "footnote", ...op.insertFootnote },
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertImage !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertImage" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "inlineImage", ...op.insertImage },
        position: op.position ?? inferredPosition,
      };
    }

    if (op.element != null || op.elements != null || op.cloneNode != null || op.cloneNodes != null) {
      if (op.insertAdjacentElement != null) {
        throw new Error(
          `ops[${index}] specify either top-level element/elements/cloneNode or insertAdjacentElement, not both`,
        );
      }
      op.insertAdjacentElement = {
        cloneNode: op.cloneNode,
        cloneNodes: op.cloneNodes,
        element: op.element,
        elements: op.elements,
        position: op.position ?? inferredPosition,
      };
    }

    if (op.insertAdjacentElement && !op.insertAdjacentElement.position) {
      op.insertAdjacentElement = {
        ...op.insertAdjacentElement,
        position: inferredPosition,
      };
    }

    if (op.tableStyle) {
      op.style = { ...(op.style ?? {}), ...op.tableStyle };
    }

    const dest = writeAtParse(op.at, namedAnchors);
    const target = targetResolve(live, op, namedAnchors);
    const cell = dest.cell;
    const para = dest.para;
    const patch = styleFromOp(op, index);
    const isTableGridOp =
      op.insertTableRow != null ||
      op.deleteTableRow != null ||
      op.insertTableColumn != null ||
      op.deleteTableColumn != null ||
      op.duplicateTableRow != null;
    const exclusive =
      Number(op.insertAdjacentElement != null) +
      Number(Boolean(op.remove)) +
      Number(Boolean(op.dangerousRemoveSection)) +
      Number(op.replaceMarkdown !== undefined) +
      Number(op.replaceSection !== undefined) +
      Number(isTableGridOp);
    const content = Number(op.innerText !== undefined) + Number(op.namedStyleType !== undefined);
    const listAction = Number(op.bullet != null);
    if (exclusive && (exclusive !== 1 || content || patch || listAction)) {
      throw new Error(
        `ops[${index}] table grid ops, replaceSection, replaceMarkdown, insertAdjacentElement, remove, and dangerousRemoveSection cannot combine with other actions`,
      );
    }
    if (op.tableAlignment !== undefined) {
      throw new Error(
        `ops[${index}] tableAlignment is not supported: Google Docs tables default to full page width (left-aligned under the hood). Google Docs REST API has no property or request for table page alignment (center/left/right). Use fixed columnWidth to control column sizes (table remains left-aligned), or cellTextAlignment to align cell text.`,
      );
    }
    if (!exclusive && !content && !patch && !listAction) {
      throw new Error(
        `ops[${index}] needs replaceSection, replaceMarkdown, insertMarkdown, innerText, replace, element/elements, insertAdjacentElement, namedStyleType, style/alignment, bullet, remove, dangerousRemoveSection, or table grid operation`,
      );
    }
    if (
      cell &&
      !isTableGridOp &&
      (op.insertAdjacentElement != null ||
        op.remove ||
        op.dangerousRemoveSection ||
        op.replaceMarkdown !== undefined ||
        op.replaceSection !== undefined ||
        op.namedStyleType !== undefined ||
        op.bullet)
    ) {
      throw new Error(
        `ops[${index}] cell ids are only valid with innerText, replace, alignment, style, or table row/column operations`,
      );
    }

    const snapshot = summarizeNode(target);
    const handle = writer.wrap(target);
    const loc = {
      ...(cell ? { cell } : {}),
      ...(para != null ? { para } : {}),
    };
    const warnings: string[] = [];
    if (patch) warnings.push(...indentWarnings(target, patch, writer.nodes));
    if (op.bullet) {
      applyBulletRestyle(writer, target, op.bullet, index);
      const others = listSiblingCount(writer.nodes, target);
      const presetName = typeof op.bullet === "object" ? op.bullet.preset : "";
      warnings.push(
        `createParagraphBullets converts ${others + 1} item(s) sharing this listId to ${presetName}. Custom glyph text and start-at-N are not in the Docs API.`,
      );
    }

    if (op.dangerousRemoveSection) {
      if (!isHeadingStyle(target.namedStyleType)) {
        throw new Error(`ops[${index}] dangerousRemoveSection requires a heading node target`);
      }
      const sectionNodes = neighborhoodFrom(writer.nodes, target.tapeIndex);
      const unrecWarnings: string[] = [];
      for (const sNode of sectionNodes) {
        assertNotFragile(sNode, "remove", effectiveForce);
        const w = formatUnrecoverableWarning(sNode);
        if (w) unrecWarnings.push(w);
      }
      deletedNodes.push(...sectionNodes);
      wipedScopeNodes.push(...sectionNodes);
      plan.push(
        withWarnings(
          {
            action: "dangerousRemoveSection",
            index,
            target: snapshot,
            ...loc,
          },
          [
            ...chipWarnings(target, cell, para),
            `Removing heading and all ${sectionNodes.length - 1} following section nodes.`,
            ...unrecWarnings,
          ],
        ),
      );
      for (let s = sectionNodes.length - 1; s >= 0; s--) {
        const sNode = sectionNodes[s]!;
        removeNodeSafely(writer, sNode);
      }
      continue;
    }

    if (isTableGridOp) {
      if (target.kind !== "table") {
        throw new Error(`ops[${index}] table row/column operations require a table target`);
      }
      const r = cell
        ? cell[0]
        : ((typeof op.insertTableRow === "object"
            ? op.insertTableRow.row
            : typeof op.deleteTableRow === "object"
              ? op.deleteTableRow.row
              : typeof op.duplicateTableRow === "object"
                ? op.duplicateTableRow.row
                : 0) ?? 0);
      const c = cell
        ? cell[1]
        : ((typeof op.insertTableColumn === "object"
            ? op.insertTableColumn.col
            : typeof op.deleteTableColumn === "object"
              ? op.deleteTableColumn.col
              : 0) ?? 0);

      if (op.insertTableRow != null) {
        const insertBelow =
          typeof op.insertTableRow === "object" && op.insertTableRow.insertBelow !== undefined
            ? op.insertTableRow.insertBelow
            : true;
        plan.push(
          withWarnings(
            {
              action: "insertTableRow",
              index,
              target: snapshot,
              ...loc,
            },
            warnings,
          ),
        );
        const cells =
          typeof op.insertTableRow === "object" && Array.isArray(op.insertTableRow.cells)
            ? op.insertTableRow.cells
            : undefined;
        writer.insertTableRow(target, [r, c], insertBelow, cells);
        if (op.as) namedAnchors.set(op.as.trim(), target);
        continue;
      }

      if (op.deleteTableRow != null) {
        plan.push(
          withWarnings(
            {
              action: "deleteTableRow",
              index,
              target: snapshot,
              ...loc,
            },
            warnings,
          ),
        );
        writer.deleteTableRow(target, [r, c]);
        if (op.as) namedAnchors.set(op.as.trim(), target);
        continue;
      }

      if (op.insertTableColumn != null) {
        const insertRight =
          typeof op.insertTableColumn === "object" && op.insertTableColumn.insertRight !== undefined
            ? op.insertTableColumn.insertRight
            : true;
        plan.push(
          withWarnings(
            {
              action: "insertTableColumn",
              index,
              target: snapshot,
              ...loc,
            },
            warnings,
          ),
        );
        writer.insertTableColumn(target, [r, c], insertRight);
        if (op.as) namedAnchors.set(op.as.trim(), target);
        continue;
      }

      if (op.deleteTableColumn != null) {
        plan.push(
          withWarnings(
            {
              action: "deleteTableColumn",
              index,
              target: snapshot,
              ...loc,
            },
            warnings,
          ),
        );
        writer.deleteTableColumn(target, [r, c]);
        if (op.as) namedAnchors.set(op.as.trim(), target);
        continue;
      }

      if (op.duplicateTableRow != null) {
        const insertBelow =
          typeof op.duplicateTableRow === "object" && op.duplicateTableRow.insertBelow !== undefined
            ? op.duplicateTableRow.insertBelow
            : true;
        plan.push(
          withWarnings(
            {
              action: "duplicateTableRow",
              index,
              target: snapshot,
              ...loc,
            },
            warnings,
          ),
        );
        const sourceCells = target.table?.cells?.[r];
        const cells = sourceCells ? sourceCells.map((sc) => sc.text ?? "") : undefined;
        writer.insertTableRow(target, [r, c], insertBelow, cells);
        if (op.as) namedAnchors.set(op.as.trim(), target);
        continue;
      }
    }

    if (op.remove) {
      assertNotFragile(target, "remove", effectiveForce);
      deletedNodes.push(target);
      const remainingParas = writer.nodes.filter((n) => n.kind === "paragraph");
      const isLastRemainingPara =
        target.kind === "paragraph" &&
        (remainingParas.length <= 1 || writer.nodes[writer.nodes.length - 1]?.tapeIndex === target.tapeIndex);

      if (isLastRemainingPara) {
        if (target.bullet) {
          delete (target as any).bullet;
        }
        handle.innerText = "";
        handle.namedStyleType = "NORMAL_TEXT";
        plan.push(
          withWarnings(
            {
              action: "innerText",
              index,
              innerText: "",
              namedStyleType: "NORMAL_TEXT",
              target: snapshot,
              ...loc,
            },
            [
              ...chipWarnings(target, cell, para),
              "Target is the last paragraph of the document tape; converted remove to clear innerText and reset namedStyleType to NORMAL_TEXT (Docs rejects deleting the trailing newline).",
            ],
          ),
        );
        continue;
      }

      const removeUnrec = formatUnrecoverableWarning(target);
      plan.push(
        withWarnings({ action: "remove", index, target: snapshot, ...loc }, [
          ...chipWarnings(target, cell, para),
          ...(removeUnrec ? [removeUnrec] : []),
        ]),
      );
      handle.remove();
      continue;
    }

    if (op.replaceSection !== undefined) {
      if (typeof op.replaceSection !== "string") {
        throw new Error(`ops[${index}] replaceSection must be a string or file path`);
      }
      if (!isHeadingStyle(target.namedStyleType)) {
        throw new Error(
          `ops[${index}] replaceSection requires a heading node target (found "${target.namedStyleType ?? target.kind}"). To replace a single node, use replaceMarkdown or replace.`,
        );
      }
      const scopeNodes = neighborhoodFrom(writer.nodes, target.tapeIndex);
      const incomingSpecs = parseMarkdownToElements(op.replaceSection, markdownOpts);

      plan.push(
        withWarnings(
          {
            action: "replaceSection",
            index,
            target: snapshot,
            ...loc,
          },
          [
            ...chipWarnings(target, cell, para),
            `Diff-replacing section (${scopeNodes.length} live node(s) vs ${incomingSpecs.length} markdown element(s)).`,
          ],
          op.as,
        ),
      );

      diffAndApplyMarkdown(writer, scopeNodes, incomingSpecs, target, effectiveForce);
      if (op.as) namedAnchors.set(op.as.trim(), target);
      continue;
    }

    if (op.replaceMarkdown !== undefined) {
      if (typeof op.replaceMarkdown !== "string") {
        throw new Error(`ops[${index}] replaceMarkdown must be a string or file path`);
      }
      assertNotFragile(target, "replace", effectiveForce);
      // Single-node replacement only! Never touches following siblings.
      const scopeNodes = [target];
      const incomingSpecs = parseMarkdownToElements(op.replaceMarkdown, markdownOpts);

      plan.push(
        withWarnings(
          {
            action: "replaceMarkdown",
            index,
            target: snapshot,
            ...loc,
          },
          [
            ...chipWarnings(target, cell, para),
            `Diff-replacing single node (${target.namedStyleType ?? target.kind}) with ${incomingSpecs.length} markdown element(s).`,
          ],
          op.as,
        ),
      );

      diffAndApplyMarkdown(writer, scopeNodes, incomingSpecs, target, effectiveForce);
      if (op.as) namedAnchors.set(op.as.trim(), target);
      continue;
    }

    if (op.insertAdjacentElement) {
      const adj = op.insertAdjacentElement;
      if (
        !adj.elements?.length &&
        !adj.element &&
        (adj.cloneNode != null || (Array.isArray(adj.cloneNodes) && adj.cloneNodes.length > 0))
      ) {
        const refs: CloneNodeRef[] = [];
        if (adj.cloneNode != null) {
          refs.push(typeof adj.cloneNode === "object" ? (adj.cloneNode as CloneNodeRef) : { nodeId: adj.cloneNode });
        }
        if (Array.isArray(adj.cloneNodes)) {
          for (const item of adj.cloneNodes) {
            refs.push(typeof item === "object" ? (item as CloneNodeRef) : { nodeId: item });
          }
        }
        const specs: Array<Record<string, unknown>> = [];
        for (const ref of refs) {
          if (ref.fromDoc) {
            throw new Error(
              `ops[${index}] cloneNode with fromDoc ("${ref.fromDoc}") requires resolveCloneNodeOps or running via apply`,
            );
          }
          const spec = resolveIntraDocCloneNode(ref, writer.nodes);
          specs.push(spec as unknown as Record<string, unknown>);
        }
        adj.elements = specs;
      }

      const initialElements: Array<Record<string, unknown>> = Array.isArray(adj.elements)
        ? adj.elements
        : adj.element
          ? [adj.element as Record<string, unknown>]
          : [];
      if (!initialElements.length) {
        throw new Error(`ops[${index}] insertAdjacentElement requires "element", "elements", or "cloneNode"`);
      }

      const rawElements: Array<Record<string, unknown>> = [];
      for (const el of initialElements) {
        if (
          el &&
          el.kind === "codeBlock" &&
          typeof el.text === "string" &&
          stripTrailingNewline(el.text).includes("\n")
        ) {
          const specs = createCodeBlock(
            {
              alignment: typeof el.alignment === "string" ? asAlignment(el.alignment) : undefined,
              language: typeof el.language === "string" ? el.language : undefined,
              style: el.style && typeof el.style === "object" ? (el.style as StylePatch) : undefined,
              text: el.text,
            },
            { force: writer.force },
          );
          for (const s of specs) {
            rawElements.push(s as unknown as Record<string, unknown>);
          }
        } else {
          rawElements.push(el);
        }
      }

      insertedNodes.push(...rawElements);
      let currentHandle = handle;
      let currentAnchor = target;
      let firstInsertedNode: DocNode | undefined;
      if (adj.position === "afterend") {
        const root = rootAnchors.get(target.tapeIndex) ?? target.tapeIndex;
        const tail = afterendTails.get(root) ?? afterendTails.get(target.tapeIndex);
        const liveTail = tail ? writer.nodes.find((n) => n.tapeIndex === tail.tapeIndex) : undefined;
        if (liveTail) {
          currentAnchor = liveTail;
          currentHandle = writer.wrap(liveTail);
        }
      }
      for (let elIdx = 0; elIdx < rawElements.length; elIdx++) {
        const rawEl = rawElements[elIdx]!;
        const effectivePosition: InsertPosition =
          adj.position === "beforebegin" && elIdx > 0 ? "afterend" : (adj.position ?? "afterend");
        if (
          effectivePosition === "afterend" &&
          currentAnchor.bullet &&
          rawEl &&
          (rawEl.bullet === true ||
            (rawEl.bullet &&
              typeof rawEl.bullet === "object" &&
              (rawEl.bullet as Record<string, unknown>).nestingLevel == null))
        ) {
          const rawBullet = rawEl.bullet === true ? {} : (rawEl.bullet as Record<string, unknown>);
          rawEl.bullet = {
            ...rawBullet,
            nestingLevel: currentAnchor.bullet.nestingLevel,
          };
        }
        const spec = elementFromJson(rawEl, writer.force);
        const insertWarnings: string[] = [];
        if ("warnings" in spec && Array.isArray(spec.warnings)) {
          insertWarnings.push(...spec.warnings);
        }
        const neighbor =
          effectivePosition === "afterend"
            ? live.nextElementSibling(currentAnchor)
            : effectivePosition === "beforebegin"
              ? live.previousElementSibling(currentAnchor)
              : null;
        if (spec.kind === "table" && effectivePosition === "afterend" && isHeadingStyle(currentAnchor.namedStyleType)) {
          insertWarnings.push(
            "insertTable afterend of a heading splits an empty HEADING_* that Docs will not delete. Insert afterend of a NORMAL_TEXT sibling.",
          );
        }
        if (spec.kind === "paragraph" && neighbor?.kind === "paragraph" && samePlainText(neighbor.text, spec.text)) {
          insertWarnings.push(
            "The paragraph next to this insert already says the same thing. Query that heading's neighbors before inserting, or you will duplicate it.",
          );
        }
        if (effectivePosition === "afterend" && currentAnchor.bullet && spec.kind === "paragraph" && !spec.bullet) {
          insertWarnings.push(
            'Inserting paragraph after list item without "bullet" — stripped inherited list glyph. Pass "bullet": true (or "bullet": {}) to continue the list.',
          );
        }
        if (spec.kind === "paragraph") {
          insertWarnings.push(
            ...indentFootguns({
              indentFirstLine: spec.style?.indentFirstLine,
              indentStart: spec.indentStart?.magnitude ?? spec.style?.indentStart,
              isBullet: Boolean(spec.bullet),
              siblingCount: 0,
            }),
          );
        }
        plan.push(
          withWarnings(
            {
              action: "insertAdjacentElement",
              index,
              insertAdjacentElement: summarizeInsert(effectivePosition, spec),
              target: summarizeNode(currentAnchor),
              ...loc,
            },
            insertWarnings,
          ),
        );
        currentHandle = currentHandle.insertAdjacentElement(effectivePosition, spec);
        currentAnchor = currentHandle.node;
        if (!firstInsertedNode) firstInsertedNode = currentAnchor;
        if (adj.position === "afterend") {
          const root = rootAnchors.get(target.tapeIndex) ?? target.tapeIndex;
          rootAnchors.set(currentAnchor.tapeIndex, root);
          afterendTails.set(root, currentAnchor);
          afterendTails.set(target.tapeIndex, currentAnchor);
        }
      }
      if (op.as) {
        const asName = op.as.trim();
        const headNode = firstInsertedNode ?? currentAnchor;
        namedAnchors.set(asName, headNode);
        if (headNode && currentAnchor && headNode.tapeIndex !== currentAnchor.tapeIndex) {
          afterendTails.set(headNode.tapeIndex, currentAnchor);
        }
      }
      continue;
    }

    if (op.innerText !== undefined) {
      const targetPara =
        cell && target.table
          ? (target.table.cells[cell[0]]?.[cell[1]]?.paragraphs?.[para ?? 0] ??
            target.table.cells[cell[0]]?.[cell[1]] ??
            target)
          : target;
      assertNotFragile(targetPara, "innerText", effectiveForce);
      plan.push(
        withWarnings(
          {
            action: "innerText",
            index,
            innerText: op.innerText,
            ...(op.namedStyleType !== undefined ? { namedStyleType: op.namedStyleType } : {}),
            ...(op.bullet ? { bullet: op.bullet } : {}),
            ...(patch ? { style: patch } : {}),
            target: snapshot,
            ...loc,
          },
          [...chipWarnings(target, cell, para), ...warnings],
        ),
      );
      writer.setInnerText(target, op.innerText, cell, para, {
        runs: op.runs,
      });
      if (op.namedStyleType !== undefined) {
        handle.namedStyleType = op.namedStyleType;
      }
      if (patch) writer.setStyle(target, patch, cell, para);
      if (op.as) namedAnchors.set(op.as.trim(), target);
      continue;
    }

    if (op.namedStyleType !== undefined) {
      plan.push(
        withWarnings(
          {
            action: "namedStyleType",
            index,
            namedStyleType: op.namedStyleType,
            ...(op.bullet ? { bullet: op.bullet } : {}),
            ...(patch ? { style: patch } : {}),
            target: snapshot,
            ...loc,
          },
          warnings,
        ),
      );
      handle.namedStyleType = op.namedStyleType;
      if (patch) writer.setStyle(target, patch, cell, para);
      if (op.as) namedAnchors.set(op.as.trim(), target);
      continue;
    }

    if (!patch) {
      plan.push(
        withWarnings(
          {
            action: "bullets",
            bullet: op.bullet,
            index,
            target: snapshot,
            ...loc,
          },
          warnings,
        ),
      );
      if (op.as) namedAnchors.set(op.as.trim(), target);
      continue;
    }

    const action = Object.keys(patch).length === 1 && patch.alignment && !op.bullet ? "alignment" : "style";
    if (target.kind === "table" && !cell && (patch.alignment || (patch as any).cellTextAlignment)) {
      warnings.push(
        "Google Docs REST API lacks page-level table alignment. Setting alignment on a table formats the text inside cells (cellTextAlignment). Tables with fixed columnWidth remain left-aligned on the page.",
      );
    }
    plan.push(
      withWarnings(
        {
          action,
          ...(patch.alignment ? { alignment: patch.alignment } : {}),
          ...(op.bullet ? { bullet: op.bullet } : {}),
          index,
          ...(action === "style" ? { style: patch } : {}),
          target: snapshot,
          ...loc,
        },
        warnings,
      ),
    );
    writer.setStyle(target, patch, cell, para);
    if (op.as) namedAnchors.set(op.as.trim(), target);
  }

  // Anti-demolition guard: block lazy deletion and re-creation of unchanged nodes
  if (!opts.force && !writer.force && deletedNodes.length > 0 && insertedNodes.length > 0) {
    const isSingleNodeMove = wipedScopeNodes.length === 0 && deletedNodes.length === 1 && insertedNodes.length === 1;

    if (!isSingleNodeMove) {
      const unchangedMatches: Array<{ deleted: DocNode; inserted: Record<string, unknown> }> = [];
      for (const del of deletedNodes) {
        const normText = (del.text ?? "").trim();
        const wasWipedScope = wipedScopeNodes.some((w) => w.tapeIndex === del.tapeIndex);
        // Skip short / trivial text to prevent false positives on repeated items (e.g. "N/A", "Done", "None", bullets)
        // Exception: if the node was part of an explicitly wiped scope (dangerousClear or dangerousRemoveSection), check all non-empty text.
        if (!normText || (!wasWipedScope && normText.length < 40)) continue;

        const delCsum = computeNodeChecksum(del);
        for (const ins of insertedNodes) {
          const insText = (typeof ins.text === "string" ? ins.text : "").trim();
          if (!insText || (!wasWipedScope && insText.length < 40)) continue;
          if (computeNodeChecksum(ins) === delCsum) {
            unchangedMatches.push({ deleted: del, inserted: ins });
            break;
          }
        }
      }

      const hasWipedScopeMatch = unchangedMatches.some((m) =>
        wipedScopeNodes.some((w) => w.tapeIndex === m.deleted.tapeIndex),
      );
      if (hasWipedScopeMatch || unchangedMatches.length >= 2) {
        const details = unchangedMatches
          .slice(0, 10)
          .map(
            (m) =>
              `  - ${m.deleted.namedStyleType ?? m.deleted.kind}: "${preview(m.deleted.text ?? "")}" (id: ${m.deleted.scopedId ?? m.deleted.tapeIndex})`,
          )
          .join("\n");
        throw new Error(
          `Lazy replacement rejected: ${unchangedMatches.length} unchanged node(s) were deleted and re-created with identical content:\n${details}\n` +
            `Deleting existing nodes destroys comment threads, suggestion mode history, and revision blame.\n` +
            `Keep unchanged nodes intact:\n` +
            `  • Use "replaceSection" to automatically diff a section and preserve unchanged nodes\n` +
            `  • Use "replaceMarkdown" to surgically replace a single node\n` +
            `  • Or target changed nodes surgically with "innerText" / "replace"\n` +
            `  • Only use "remove" for nodes that are genuinely deleted\n` +
            `  • To override and force wholesale replacement, pass force: true on the op or apply document`,
        );
      }
    }
  }

  return plan;
}

function removeNodeSafely(writer: DomWriter, node: DocNode): void {
  const remainingParas = writer.nodes.filter((n) => n.kind === "paragraph");
  const handle = writer.wrap(node);
  if (node.kind === "paragraph" && remainingParas.length <= 1) {
    if (node.bullet) delete (node as Record<string, unknown>).bullet;
    handle.innerText = "";
    handle.namedStyleType = "NORMAL_TEXT";
  } else {
    handle.remove();
  }
}

function diffAndApplyMarkdown(
  writer: DomWriter,
  oldNodes: DocNode[],
  newSpecs: ElementSpec[],
  anchorTarget: DocNode,
  force?: boolean,
): void {
  const oldChecksums = oldNodes.map((n) => computeNodeChecksum(n));
  const newChecksums = newSpecs.map((s) => computeNodeChecksum(s as Record<string, unknown>));

  const N = oldNodes.length;
  const M = newSpecs.length;

  const dp: number[][] = Array.from({ length: N + 1 }, () => Array(M + 1).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      if (oldChecksums[i] === newChecksums[j]) {
        dp[i + 1]![j + 1] = dp[i]?.[j]! + 1;
      } else {
        dp[i + 1]![j + 1] = Math.max(dp[i + 1]?.[j]!, dp[i]?.[j + 1]!);
      }
    }
  }

  const matches: Array<{ oldIdx: number; newIdx: number }> = [];
  let ci = N;
  let cj = M;
  while (ci > 0 && cj > 0) {
    if (oldChecksums[ci - 1] === newChecksums[cj - 1]) {
      matches.unshift({ oldIdx: ci - 1, newIdx: cj - 1 });
      ci--;
      cj--;
    } else if (dp[ci - 1]?.[cj]! >= dp[ci]?.[cj - 1]!) {
      ci--;
    } else {
      cj--;
    }
  }

  const boundaries = [{ oldIdx: -1, newIdx: -1 }, ...matches, { oldIdx: N, newIdx: M }];
  let lastAnchorNode: DocNode | undefined;

  for (let b = 0; b < boundaries.length - 1; b++) {
    const prevMatch = boundaries[b]!;
    const nextMatch = boundaries[b + 1]!;

    if (prevMatch.oldIdx >= 0) {
      lastAnchorNode = oldNodes[prevMatch.oldIdx];
    }

    const fromOld = prevMatch.oldIdx + 1;
    const toOld = nextMatch.oldIdx;
    const fromNew = prevMatch.newIdx + 1;
    const toNew = nextMatch.newIdx;

    const oldSlice = oldNodes.slice(fromOld, toOld);
    const newSlice = newSpecs.slice(fromNew, toNew);

    const p = oldSlice.length;
    const q = newSlice.length;
    const shared = Math.min(p, q);

    for (let k = 0; k < shared; k++) {
      const oldNode = oldSlice[k]!;
      const newSpec = newSlice[k]!;
      assertNotFragile(oldNode, "replace", force);
      const paraSpec = newSpec.kind === "paragraph" ? (newSpec as ParagraphSpec) : undefined;
      const oldHasBullet = Boolean(oldNode.bullet);
      const newHasBullet = Boolean(paraSpec?.bullet);
      const oldNesting = oldNode.bullet?.nestingLevel ?? 0;
      const newNesting = paraSpec?.bullet?.nestingLevel ?? 0;
      const oldPreset = oldNode.bullet?.preset;
      const newPreset = paraSpec?.bullet?.preset;
      const bulletChanged =
        oldHasBullet !== newHasBullet ||
        (oldHasBullet && (oldNesting !== newNesting || (oldPreset && newPreset && oldPreset !== newPreset)));

      if (oldNode.kind === "paragraph" && newSpec.kind === "paragraph" && !bulletChanged) {
        const handle = writer.wrap(oldNode);
        handle.innerText = paraSpec!.text;
        handle.namedStyleType = paraSpec!.namedStyleType;
        if (paraSpec!.alignment) handle.alignment = paraSpec!.alignment;
        if (paraSpec!.style) writer.setStyle(oldNode, paraSpec!.style);
        lastAnchorNode = oldNode;
      } else {
        const insertAnchor = lastAnchorNode ?? anchorTarget;
        const inserted = writer.insertAdjacentElement(insertAnchor, "afterend", newSpec);
        lastAnchorNode = inserted;
        removeNodeSafely(writer, oldNode);
      }
    }

    if (p < q) {
      for (let k = shared; k < q; k++) {
        const newSpec = newSlice[k]!;
        const insertAnchor = lastAnchorNode ?? anchorTarget;
        const pos: InsertPosition = lastAnchorNode ? "afterend" : "beforebegin";
        const inserted = writer.insertAdjacentElement(insertAnchor, pos, newSpec);
        lastAnchorNode = inserted;
      }
    } else if (p > q) {
      for (let k = shared; k < p; k++) {
        const oldNode = oldSlice[k]!;
        assertNotFragile(oldNode, "remove", force);
        removeNodeSafely(writer, oldNode);
      }
    }

    if (nextMatch.oldIdx >= 0 && nextMatch.oldIdx < N) {
      lastAnchorNode = oldNodes[nextMatch.oldIdx];
    }
  }
}

function withWarnings(entry: AppliedOpPlan, warnings: string[], as?: string): AppliedOpPlan {
  if (warnings.length) entry.warnings = warnings;
  if (as) entry.as = as;
  return entry;
}

/** Converts an existing paragraph / shared listId run to a Docs bullet preset. */
function applyBulletRestyle(writer: DomWriter, target: DocNode, bullet: BulletProps, index: number): void {
  if (isHeadingStyle(target.namedStyleType)) {
    throw new Error(HEADING_BULLET_MSG);
  }
  if (typeof bullet === "boolean") {
    if (!bullet) {
      throw new Error(`ops[${index}] bullet: false is not supported; use remove or style`);
    }
    throw new Error(`ops[${index}] bullet restyle requires preset (a Docs BulletGlyphPreset)`);
  }
  if (bullet.nestingLevel != null) {
    const current = target.bullet?.nestingLevel ?? 0;
    if (target.bullet ? bullet.nestingLevel !== current : bullet.nestingLevel > 0) {
      throw new Error(EXISTING_NEST_MSG);
    }
  }
  if (!bullet.preset) {
    throw new Error(`ops[${index}] bullet restyle requires preset (a Docs BulletGlyphPreset)`);
  }
  const preset = asBulletPreset(bullet.preset);
  if (!preset) {
    throw new Error(`Unknown bullet preset "${bullet.preset}". Use a Docs BulletGlyphPreset (NUMBERED_* / BULLET_*).`);
  }
  writer.setBulletPreset(target, preset);
}

/** Other tape items that share this listId. */
function listSiblingCount(nodes: DocNode[], target: DocNode): number {
  const listId = target.bullet?.listId;
  if (!listId) return 0;
  return nodes.filter((n) => n.tapeIndex !== target.tapeIndex && n.bullet?.listId === listId).length;
}

/** Hanging / shared-list indent footguns. */
function indentFootguns(opts: {
  indentFirstLine?: number;
  indentStart?: number;
  isBullet: boolean;
  siblingCount: number;
}): string[] {
  const out: string[] = [];
  if (opts.isBullet && opts.indentStart != null && opts.indentFirstLine == null) {
    const first = hangingFirstLine(opts.indentStart);
    out.push(
      `List indentStart ${opts.indentStart} sets hanging indentFirstLine ${first} (glyph vs text). Flush level-0 is indentStart: 18, indentFirstLine: 0. Pass both to skip the default. indentStart: 0 stacks the glyph on the text.`,
    );
  }
  if (opts.isBullet && opts.siblingCount > 0 && (opts.indentStart != null || opts.indentFirstLine != null)) {
    out.push(
      `This listId is shared by ${opts.siblingCount} other item(s). Paragraph indent may not move siblings — style each item, or use the Docs ruler for the list.`,
    );
  }
  return out;
}

function indentWarnings(target: DocNode, patch: StylePatch, nodes: DocNode[]): string[] {
  if (!hasIndent(patch)) return [];
  return indentFootguns({
    indentFirstLine: patch.indentFirstLine,
    indentStart: patch.indentStart,
    isBullet: Boolean(target.bullet),
    siblingCount: listSiblingCount(nodes, target),
  });
}

/** Applies tape mutations to a writer (alias for tapeMutationsApply). */
export const applyOps = tapeMutationsApply;

/** @deprecated Use tapeMutationsApply. */
export const opsApply = tapeMutationsApply;

/**
 * Hard refusal when mutating or removing fragile nodes (equations, chips, TOC).
 * Pass `force: true` to bypass.
 */
export function notFragileAssert(
  node: DocNode | CellParagraph,
  action: "remove" | "innerText" | "replace" | "replaceMarkdown" | "replaceSection",
  force?: boolean,
): void {
  if (force) return;

  const id = "kind" in node ? (node.scopedId ?? node.tapeIndex) : "cell";

  if (node.hasEquation) {
    throw new Error(
      `Refusing to ${action} node ${id} (contains a math equation):\n` +
        `Google Docs REST API cannot recreate math equations; modifying or deleting this node will permanently destroy it.\n` +
        `To proceed intentionally, pass force: true in the op or on the apply document.`,
    );
  }

  if (node.chips?.length) {
    const titles = node.chips.map((c) => `"${c.title || c.uri}"`).join(", ");
    throw new Error(
      `Refusing to ${action} node ${id} (contains ${node.chips.length} smart chip(s): ${titles}):\n` +
        `Modifying or deleting this node permanently destroys interactive smart chips (Google Docs REST API cannot recreate smart chips).\n` +
        `To proceed intentionally, pass force: true in the op or on the apply document.`,
    );
  }

  if ("kind" in node && node.kind === "tableOfContents" && action === "remove") {
    throw new Error(
      `Refusing to remove node ${id} (tableOfContents):\n` +
        `Google Docs REST API cannot recreate a Table of Contents.\n` +
        `To remove intentionally, pass force: true in the op or on the apply document.`,
    );
  }
}

/** Hard refusal when mutating or removing fragile nodes (alias for notFragileAssert). */
export const assertNotFragile = notFragileAssert;

/** innerText / remove on a chip, equation, or divider paragraph is allowed with force; plan warns that they will be destroyed. */
function chipWarnings(target: DocNode, cell?: [number, number], para?: number): string[] {
  const warnings: string[] = [];
  const checkNode = (node: DocNode | CellParagraph) => {
    if (hasChips(node as DocNode)) warnings.push(CHIP_MUTATE_MSG);
    if ("hasEquation" in node && node.hasEquation) {
      warnings.push("Caution: this paragraph contains a math equation. innerText and remove destroy it.");
    }
    if ("hasHorizontalRule" in node && node.hasHorizontalRule) {
      warnings.push("Caution: this paragraph contains a horizontal rule/divider. innerText and remove destroy it.");
    }
  };

  if (!cell) {
    checkNode(target);
    return warnings;
  }
  const hit = target.table?.cells[cell[0]]?.[cell[1]];
  if (!hit) return [];
  const node = para ? (hit.paragraphs?.[para] ?? hit) : hit;
  checkNode(node);
  return warnings;
}

/** Compares normalized visible plain text between two strings. */
function samePlainText(a?: string, b?: string): boolean {
  const left = plainVisible(a);
  const right = plainVisible(b);
  return left.length > 0 && left === right;
}

/** Extracts normalized lower-cased plain text stripped of markup and excess whitespace. */
function plainVisible(s: string | undefined): string {
  if (!s) return "";
  return InlineMarkup.parse(s).text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Resolves one op to a tape node. Writes use `at` only (body id, not cell id). */
export function targetResolve(
  dom: DocDom,
  op: Pick<DomOp, "at"> & Record<string, unknown>,
  namedAnchors?: Map<string, DocNode>,
): DocNode {
  const dest = writeAtParse(op.at, namedAnchors);

  if (namedAnchors && typeof op.at === "string" && namedAnchors.has(op.at.trim())) {
    return namedAnchors.get(op.at.trim())!;
  }

  // 1. Numeric nodeId if specified
  if (dest.nodeId != null) {
    const hit = dom.nodes.find((n) => n.tapeIndex === dest.nodeId);
    if (hit) return hit;
  }

  // 2. Exact match on scopedId
  if (dest.scopedId != null) {
    const hit = dom.nodes.find((n) => n.scopedId === dest.scopedId);
    if (hit) return hit;
  }

  // 3. Exact match on headingId when heading was explicitly targeted
  if (dest.isHeadingTarget && dest.headingId != null) {
    const hit = dom.nodes.find((n) => n.headingId === dest.headingId);
    if (hit) return hit;
  }

  // 4. Raw string match on scopedId or headingId
  const rawStr = String(dest.rawAt);
  const rawHit = dom.nodes.find(
    (n) => n.scopedId === rawStr || (dest.isHeadingTarget && n.headingId === rawStr) || String(n.tapeIndex) === rawStr,
  );
  if (rawHit) return rawHit;

  // 5. If it's a table target under a heading
  if (dest.cell && dest.headingId) {
    const headingIndex = dom.nodes.findIndex(
      (n) => n.headingId === dest.headingId || n.scopedId?.startsWith(`${dest.headingId}.`),
    );
    if (headingIndex >= 0) {
      const startNode = dom.nodes[headingIndex]!;
      const sectionNodes = neighborhoodFrom(dom.nodes, startNode.tapeIndex);
      const tables = sectionNodes.filter((n) => n.kind === "table");
      const targetTable = tables[(dest.tableIndex ?? 1) - 1];
      if (targetTable) return targetTable;
    }
  }

  if (dest.nodeId != null) {
    throw new Error(missingNodeIdMsg(dest.nodeId, dom.nodes.length));
  }

  throw new Error(formatMissingScopedTargetMsg(dom.nodes, dest.rawAt ?? ""));
}

/** Resolves one op to a tape node (alias for targetResolve). */
export const resolveTarget = targetResolve;

/** Body node id, cell id, or heading-scoped id. */
export type WriteAt = {
  cell?: [number, number];
  headingId?: string;
  isHeadingTarget?: boolean;
  nodeId?: number;
  para?: number;
  rawAt?: string | number;
  scopedId?: string;
  tableIndex?: number;
};

/** Parses write `at` from query ids. */
export function writeAtParse(at: unknown, namedAnchors?: Map<string, DocNode>): WriteAt {
  if (at == null) throw new Error(WRITE_AT_ONLY_MSG);
  if (typeof at === "number") {
    if (!Number.isInteger(at) || at < 1) throw new Error(WRITE_AT_ONLY_MSG);
    return { nodeId: at };
  }
  if (typeof at !== "string") throw new Error(WRITE_AT_ONLY_MSG);
  const trimmed = at.trim();
  if (!trimmed) throw new Error(WRITE_AT_ONLY_MSG);

  if (namedAnchors?.has(trimmed)) {
    const node = namedAnchors.get(trimmed)!;
    return { nodeId: node.tapeIndex, rawAt: at, scopedId: node.scopedId };
  }

  if (namedAnchors && trimmed.includes(".")) {
    const dotParts = trimmed.split(".");
    const baseName = dotParts[0]!;
    if (namedAnchors.has(baseName)) {
      const baseNode = namedAnchors.get(baseName)!;
      if (dotParts.length === 3 || dotParts.length === 4) {
        const row = Number(dotParts[1]);
        const col = Number(dotParts[2]);
        const para = dotParts[3] != null ? Number(dotParts[3]) : undefined;
        if (Number.isInteger(row) && Number.isInteger(col)) {
          return {
            cell: [row, col],
            nodeId: baseNode.tapeIndex,
            rawAt: at,
            ...(para != null ? { para } : {}),
          };
        }
      }
    }
  }

  const parts = trimmed.split(".");
  const isPureNumeric = parts.every((p) => /^\d+$/.test(p));

  if (isPureNumeric) {
    const nums = parts.map((p) => Number(p));
    const nodeId = nums[0]!;
    if (nodeId < 1) throw new Error(WRITE_AT_ONLY_MSG);
    if (parts.length === 1) return { nodeId };
    if (parts.length === 3 || parts.length === 4) {
      const row = nums[1]!;
      const col = nums[2]!;
      const para = nums[3];
      return {
        cell: [row, col],
        nodeId,
        ...(para ? { para } : {}),
      };
    }
    throw new Error(WRITE_AT_ONLY_MSG);
  }

  // Heading-scoped table cell: {headingId}.table[n].{r}.{c}[.{checksum}][.{para}]
  const tableCellMatch = /^(.*?)\.table(\d*)\.(\d+)\.(\d+)(?:\.([a-zA-Z0-9_-]+))?(?:\.(\d+))?$/.exec(trimmed);
  if (tableCellMatch) {
    const headingPart = tableCellMatch[1]!;
    const tableIdx = tableCellMatch[2] ? Number(tableCellMatch[2]) : 1;
    const row = Number(tableCellMatch[3]!);
    const col = Number(tableCellMatch[4]!);
    const fourth = tableCellMatch[5];
    const fifth = tableCellMatch[6];
    let para: number | undefined;
    if (fifth != null) {
      para = Number(fifth);
    } else if (fourth != null && /^\d+$/.test(fourth)) {
      para = Number(fourth);
    }
    return {
      cell: [row, col],
      headingId: headingPart,
      para,
      rawAt: at,
      scopedId: trimmed,
      tableIndex: tableIdx,
    };
  }

  const isPreamble = trimmed.startsWith("_preamble");
  let isHeadingDirect = false;
  let headingId: string | undefined;

  if (isPreamble) {
    headingId = "_preamble";
    isHeadingDirect = trimmed === "_preamble";
  } else if (trimmed.startsWith("h.")) {
    if (parts.length <= 2) {
      headingId = trimmed;
      isHeadingDirect = true;
    } else {
      headingId = `${parts[0]}.${parts[1]}`;
      isHeadingDirect = false;
    }
  } else {
    headingId = parts[0];
    isHeadingDirect = parts.length === 1;
  }

  return {
    headingId,
    isHeadingTarget: isHeadingDirect,
    rawAt: at,
    scopedId: trimmed,
  };
}

/** Parses write `at` from query ids (alias for writeAtParse). */
export const parseWriteAt = writeAtParse;

/** `"h.arch.table.0.1.3c8f"` or extra cell paragraphs `"….1"`. */
export function cellId(tableId: number, row: number, col: number, para = 0): string {
  return para ? `${tableId}.${row}.${col}.${para}` : `${tableId}.${row}.${col}`;
}

/** Resolves StylePatch from an op, incorporating alignment if present. */
function styleFromOp(op: DomOp, index: number): StylePatch | undefined {
  const patch: StylePatch = { ...op.style };
  const rawAlign = op.alignment ?? op.style?.cellTextAlignment;
  if (rawAlign !== undefined) {
    const alignment = asAlignment(rawAlign);
    if (!alignment) {
      throw new Error(`ops[${index}] unknown alignment: ${rawAlign}`);
    }
    patch.alignment = alignment;
  }
  return hasStyle(patch) ? patch : undefined;
}

/**
 * Formats a diagnostic warning for a destroyed unrecoverable node.
 * Used for Drive revision recovery paper trail.
 */
export function unrecoverableWarningFormat(node: DocNode): string | undefined {
  const loc = node.scopedId ? `node ${node.scopedId}` : `node ${node.tapeIndex}`;
  if (node.hasEquation) {
    const snippet = (node.text ?? "").trim() ? ` "${(node.text ?? "").trim().slice(0, 40)}"` : "";
    return `Destroyed math equation at ${loc}${snippet} (unrecoverable via API)`;
  }
  if (node.chips?.length) {
    const titles = node.chips.map((c) => `"${c.title || c.uri}"`).join(", ");
    return `Destroyed ${node.chips.length} smart chip(s) at ${loc}: ${titles} (unrecoverable via API)`;
  }
  if (node.kind === "tableOfContents") {
    return `Destroyed Table of Contents at ${loc} (unrecoverable via API)`;
  }
  if (node.hasHorizontalRule) {
    return `Destroyed horizontal rule divider at ${loc} (unrecoverable via API)`;
  }
  if (node.kind === "table" && node.table) {
    let chipCount = 0;
    for (const r of node.table.cells) {
      for (const c of r) {
        if (c.chips?.length) chipCount += c.chips.length;
      }
    }
    if (chipCount > 0) {
      return `Destroyed table with ${chipCount} smart chip(s) at ${loc} (unrecoverable via API)`;
    }
  }
  return undefined;
}

/** Formats a diagnostic warning for a destroyed unrecoverable node (alias for unrecoverableWarningFormat). */
export const formatUnrecoverableWarning = unrecoverableWarningFormat;

/**
 * Clears an entire tab / tape: removes all nodes except the last paragraph
 * whose text is cleared and named style is reset to NORMAL_TEXT.
 * Returns the list of cleared nodes for anti-demolition tracking.
 */
export function dangerousClearExecute(writer: DomWriter): DocNode[] {
  const nodes = writer.nodes.map((n) => ({ ...n }));
  for (let s = writer.nodes.length - 1; s >= 0; s--) {
    const sNode = writer.nodes[s]!;
    const sHandle = writer.wrap(sNode);
    const remaining = writer.nodes.filter((n) => n.kind === "paragraph");
    if (sNode.kind === "paragraph" && remaining.length <= 1) {
      if (sNode.bullet) delete (sNode as any).bullet;
      sHandle.innerText = "";
      sHandle.namedStyleType = "NORMAL_TEXT";
    } else {
      sHandle.remove();
    }
  }
  return nodes;
}

/** Clears an entire tab / tape (alias for dangerousClearExecute). */
export const executeDangerousClear = dangerousClearExecute;

/** Compact summary: id first. Never prints API startIndex. */
export function nodeSummarize(node: DocNode, opts: { full?: boolean } = {}): NodeSummary {
  const out: NodeSummary = {
    id: node.scopedId ?? node.tapeIndex,
    kind: node.kind,
  };
  if (node.namedStyleType) out.namedStyleType = node.namedStyleType;
  if (node.alignment) out.alignment = node.alignment;
  if (node.bullet) {
    out.bullet = {
      nestingLevel: node.bullet.nestingLevel,
      ...(node.bullet.preset ? { preset: node.bullet.preset } : {}),
      ...(node.bullet.type ? { type: node.bullet.type } : {}),
    };
  }
  if (node.indentStart) out.indentStart = node.indentStart.magnitude;
  if (node.indentFirstLine) out.indentFirstLine = node.indentFirstLine.magnitude;
  if (node.indentEnd) out.indentEnd = node.indentEnd.magnitude;
  if (node.chips?.length) {
    out.chips = node.chips.map((c) => ({ title: c.title, uri: c.uri }));
  }
  if (node.style) out.style = node.style;
  if (node.columnCount != null) out.columnCount = node.columnCount;
  if (node.footnoteIds?.length) out.footnoteIds = node.footnoteIds;
  if (node.hasEquation) out.hasEquation = true;
  if (node.hasHorizontalRule) out.hasHorizontalRule = true;

  const lossWarnings: string[] = [];
  if (node.hasEquation) {
    lossWarnings.push("IMMUTABLE: Contains math equation. API cannot recreate equations if modified or removed.");
  }
  if (node.chips?.length) {
    lossWarnings.push(
      `FRAGILE: Contains ${node.chips.length} smart chip(s). Modifying text replaces chip with plain text.`,
    );
  }
  if (node.hasHorizontalRule) {
    lossWarnings.push("FRAGILE: Contains horizontal rule divider.");
  }
  if (node.kind === "tableOfContents") {
    lossWarnings.push("IMMUTABLE: Table of contents cannot be recreated via API. Do not remove.");
  }
  if (node.kind === "sectionBreak") {
    lossWarnings.push("CAUTION: Section break controls page layout/margins/headers. Removing merges sections.");
  }
  if (lossWarnings.length > 0) {
    out.lossWarning = lossWarnings.join(" ");
  }
  if (opts.full) {
    if (node.shading) out.shading = node.shading;
    if (node.spaceAbove != null) out.spaceAbove = node.spaceAbove;
    if (node.spaceBelow != null) out.spaceBelow = node.spaceBelow;
    if (node.lineSpacing != null) out.lineSpacing = node.lineSpacing;
  }
  if (node.kind === "table" && node.table) {
    out.table = {
      cols: Math.max(0, ...node.table.cells.map((r) => r.length)),
      rows: node.table.cells.length,
    };
    if (node.table.columnWidth != null) out.table.columnWidth = node.table.columnWidth;
    if (node.table.borderColor) out.table.borderColor = node.table.borderColor;
    if (node.table.cellPadding != null) out.table.cellPadding = node.table.cellPadding;
    if (node.table.contentAlignment) {
      out.table.contentAlignment = node.table.contentAlignment;
    }
    if (node.table.minRowHeight != null) out.table.minRowHeight = node.table.minRowHeight;
    if (node.table.pinnedHeaderRows != null) out.table.pinnedHeaderRows = node.table.pinnedHeaderRows;
    if (node.table.preventOverflow != null) out.table.preventOverflow = node.table.preventOverflow;
    if (opts.full) {
      out.table.cells = node.table.cells.map((row, r) =>
        row.map((cell, c) => summarizeCell(cell, cellId(node.tapeIndex, r, c))),
      );
    }
  }
  if (node.images?.length) {
    const first = node.images[0]!;
    out.image = { count: node.images.length };
    if (first.widthPt != null) out.image.widthPt = first.widthPt;
    if (first.heightPt != null) out.image.heightPt = first.heightPt;
  }
  if (node.kind === "paragraph") {
    const text = node.text ?? "";
    if (opts.full) out.text = text;
    else if (text !== "") out.text = preview(text);
    if (node.markup) out.markup = node.markup;
  }
  return out;
}

/** Compact summary of node (alias for nodeSummarize). */
export const summarizeNode = nodeSummarize;

/** Formats a compact summary of a table cell or cell paragraph for diagnostic output. */
function summarizeCell(cell: TableCell | CellParagraph, id: string): CellSummary {
  const out: CellSummary = { id: cell.scopedId ?? id, text: cell.text };
  if (cell.alignment) out.alignment = cell.alignment;
  if (cell.indentStart) out.indentStart = cell.indentStart.magnitude;
  if (cell.indentFirstLine) out.indentFirstLine = cell.indentFirstLine.magnitude;
  if (cell.indentEnd) out.indentEnd = cell.indentEnd.magnitude;
  if (cell.markup) out.markup = cell.markup;
  if (cell.shading) out.shading = cell.shading;
  if (cell.style) out.style = cell.style;
  if (cell.images?.length) {
    const first = cell.images[0]!;
    out.image = { count: cell.images.length };
    if (first.widthPt != null) out.image.widthPt = first.widthPt;
    if (first.heightPt != null) out.image.heightPt = first.heightPt;
  }
  const extra = "paragraphs" in cell ? (cell.paragraphs ?? []).slice(1) : [];
  if (extra.length) {
    out.paragraphs = extra.map((p, i) => summarizeCell(p, `${id}.${i + 1}`));
  }
  return out;
}

/** Builds a detached spec via createElement (refuses p/q/ul/ol). */
export function elementFromJson(raw: Record<string, unknown>, force = false): ElementSpec {
  const kind = typeof raw.kind === "string" ? raw.kind : undefined;
  if (kind === "pageBreak") {
    return createElement("pageBreak");
  }
  if (kind === "sectionBreak") {
    return createElement("sectionBreak", {
      sectionType: typeof raw.sectionType === "string" ? (raw.sectionType as "CONTINUOUS" | "NEXT_PAGE") : undefined,
    });
  }
  if (kind === "person") {
    return createElement("person", { email: String(raw.email ?? "") });
  }
  if (kind === "richLink") {
    return createElement("richLink", {
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
      title: typeof raw.title === "string" ? raw.title : undefined,
      uri: String(raw.uri ?? ""),
    });
  }
  if (kind === "date") {
    return createElement("date", {
      dateFormat: typeof raw.dateFormat === "string" ? raw.dateFormat : undefined,
      displayText: typeof raw.displayText === "string" ? raw.displayText : undefined,
      timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    });
  }
  if (kind === "footnote") {
    return createElement("footnote", { text: typeof raw.text === "string" ? raw.text : undefined });
  }
  if (kind === "inlineImage") {
    return createElement("inlineImage", {
      heightPt: typeof raw.heightPt === "number" ? raw.heightPt : undefined,
      uri: String(raw.uri ?? ""),
      widthPt: typeof raw.widthPt === "number" ? raw.widthPt : undefined,
    });
  }
  if (kind === "codeBlock") {
    return createElement(
      "codeBlock",
      {
        alignment: typeof raw.alignment === "string" ? asAlignment(raw.alignment) : undefined,
        language: typeof raw.language === "string" ? raw.language : undefined,
        style: raw.style && typeof raw.style === "object" ? (raw.style as StylePatch) : undefined,
        text: String(raw.text ?? ""),
      },
      { force },
    );
  }
  if (kind === "table" || (kind == null && (Array.isArray(raw.rows) || isNestedTableRows(raw)))) {
    const rows = Array.isArray(raw.rows) ? raw.rows : (raw.table as { rows?: unknown } | undefined)?.rows;
    if (!Array.isArray(rows)) {
      throw new Error('table element requires rows: { "kind": "table", "rows": [["cell"]] }');
    }
    const warnings = Array.isArray(raw.warnings) ? (raw.warnings as string[]) : undefined;
    return createElement("table", { rows: rows as string[][], warnings }, { force });
  }
  const props: CreateParagraphProps = {
    namedStyleType: raw.namedStyleType as NamedStyle,
    text: String(raw.text ?? ""),
  };
  if (Array.isArray(raw.warnings)) {
    props.warnings = raw.warnings as string[];
  }
  if (raw.indentStart != null) {
    props.indentStart = raw.indentStart as CreateParagraphProps["indentStart"];
  }
  if (raw.bullet === true || (raw.bullet && typeof raw.bullet === "object")) {
    props.bullet = raw.bullet === true ? {} : (raw.bullet as CreateParagraphProps["bullet"]);
  }
  if (typeof raw.alignment === "string") {
    const alignment = asAlignment(raw.alignment);
    if (!alignment) throw new Error(`Unknown alignment: ${raw.alignment}`);
    props.alignment = alignment;
  }
  if (raw.style && typeof raw.style === "object") {
    props.style = raw.style as StylePatch;
  }
  if (Array.isArray(raw.runs)) {
    props.runs = raw.runs as CreateParagraphProps["runs"];
  }
  return createElement((kind ?? "paragraph") as "paragraph", props, { force });
}

/** Checks whether raw object contains nested table rows property. */
function isNestedTableRows(raw: Record<string, unknown>): boolean {
  const nested = raw.table;
  return nested != null && typeof nested === "object" && Array.isArray((nested as { rows?: unknown }).rows);
}

/** Generates a plan summary object for an insertAdjacentElement operation. */
function summarizeInsert(
  position: InsertPosition,
  spec: ElementSpec,
): NonNullable<AppliedOpPlan["insertAdjacentElement"]> {
  const out: NonNullable<AppliedOpPlan["insertAdjacentElement"]> = {
    kind: spec.kind,
    position,
  };
  if (spec.kind === "paragraph") {
    out.namedStyleType = spec.namedStyleType;
    if (spec.text) out.text = preview(spec.text);
    if (spec.bullet) out.bullet = true;
  }
  return out;
}

/** Formats a preview of long strings up to PREVIEW_LEN characters. */
function preview(text: string): string {
  const one = text.split(/\s+/).join(" ").trim();
  if (one.length <= PREVIEW_LEN) return one;
  return `${one.slice(0, PREVIEW_LEN - 1)}…`;
}

/**
 * Markdown lexer options from a tape mutation (`markdownStyles` + `h1IsTitle`).
 */
function markdownParseOptionsFromOp(
  /** Mutation carrying optional markdown parse fields. */
  op: TapeMutation,
): MarkdownParseOptions {
  return {
    customStyles: op.markdownStyles ? markdownStylesParse(op.markdownStyles) : undefined,
    h1IsTitle: op.h1IsTitle,
  };
}
