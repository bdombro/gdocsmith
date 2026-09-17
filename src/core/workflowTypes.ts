/* Shared workflow step wire types (run input, step kinds, highlights). */

import type { PageSetup, TapeMutation } from "~/core/dom/ops.ts";

/** Canonical workflow step kinds handled by the apply script engine. */
export type WorkflowStepKind =
  | "close"
  | "docCopy"
  | "docCreate"
  | "docDelete"
  | "docRename"
  | "docTrash"
  | "dump"
  | "innerText"
  | "markdownInsert"
  | "open"
  | "query"
  | "remove"
  | "replace"
  | "replaceMarkdown"
  | "replaceSection"
  | "surgical"
  | "tabAdd"
  | "tabDelete"
  | "tabRename"
  | "textReplace";

/** Serializer for `kind: query` matches written to `dumped`. */
export type QueryOutputFormat = "markdown" | "nodes" | "yaml";

/** One workflow step; discriminator is `kind`. */
export interface GdocsmithStepInput {
  /** Anchor node to insert after (heading-scoped id from query). */
  after?: string;
  /** Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED). */
  alignment?: TapeMutation["alignment"];
  /** On open/query: binds a doc or node alias. On dump: existing alias to extract into `dumped`. */
  as?: string;
  /** Heading-scoped id from query (e.g. h.arch.9a1b). */
  at?: string;
  /** Anchor node to insert before (heading-scoped id from query). */
  before?: string;
  /** Convert this paragraph (and siblings sharing listId) to a Docs bullet preset. */
  bullet?: TapeMutation["bullet"];
  /** Clone an existing node with style/bullet fidelity (heading-scoped id or ref). */
  cloneNode?: Exclude<TapeMutation["cloneNode"], number>;
  /** Batch cloning of existing nodes. */
  cloneNodes?: Array<Exclude<NonNullable<TapeMutation["cloneNodes"]>[number], number>>;
  /** Text substring filter for query. */
  contains?: string;
  /** Source doc ID or alias for docCopy. */
  copyFrom?: string;
  /** Clear the tab/doc before mutations. */
  dangerousClear?: boolean;
  /** Remove the heading and its following section. */
  dangerousRemoveSection?: boolean;
  /** Delete a table column. */
  deleteTableColumn?: TapeMutation["deleteTableColumn"];
  /** Delete a table row. */
  deleteTableRow?: TapeMutation["deleteTableRow"];
  /** Target document ID or alias. */
  doc?: string;
  /** Duplicate a table row. */
  duplicateTableRow?: TapeMutation["duplicateTableRow"];
  /** Detached element spec to insert. */
  element?: Record<string, unknown>;
  /** Detached element specs to insert in order. */
  elements?: Array<Record<string, unknown>>;
  /** Local markdown/text path. */
  file?: string;
  /** String to find for textReplace. */
  find?: string;
  /** Force destructive mutation even if targeting a fragile node. */
  force?: boolean;
  /** Keep every node in query dumps (no heading-only truncation; include table cells). */
  full?: boolean;
  /** Treat top-level # as Title instead of HEADING_1. */
  h1IsTitle?: boolean;
  /** Position index for tabAdd. */
  index?: number;
  /** In-place paragraph text. */
  innerText?: string;
  /** Nested insertAdjacentElement payload. */
  insertAdjacentElement?: TapeMutation["insertAdjacentElement"];
  /** Insert a native date chip. */
  insertDate?: TapeMutation["insertDate"];
  /** Insert a footnote reference. */
  insertFootnote?: TapeMutation["insertFootnote"];
  /** Insert a public HTTPS inline image. */
  insertImage?: TapeMutation["insertImage"];
  /** Insert rendered markdown at the anchor (surgical; prefer kind: markdownInsert). */
  insertMarkdown?: TapeMutation["insertMarkdown"];
  /** Insert a person mention chip. */
  insertPerson?: TapeMutation["insertPerson"];
  /** Insert a rich link chip. */
  insertRichLink?: TapeMutation["insertRichLink"];
  /** Insert a section break. */
  insertSectionBreak?: TapeMutation["insertSectionBreak"];
  /** Insert a table column. */
  insertTableColumn?: TapeMutation["insertTableColumn"];
  /** Insert a table row. */
  insertTableRow?: TapeMutation["insertTableRow"];
  /** Workflow step kind. */
  kind?: WorkflowStepKind | (string & {});
  /** Markdown text string. */
  markdown?: string;
  /** Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`. */
  markdownStyles?: Record<string, unknown>;
  /** Change namedStyleType on an existing paragraph. */
  namedStyleType?: TapeMutation["namedStyleType"];
  /** Query serialization format (default nodes). */
  output?: QueryOutputFormat;
  /** Permanently delete document (docDelete). */
  permanent?: boolean;
  /** Sibling insert position. */
  position?: TapeMutation["position"];
  /** Delete this node. */
  remove?: boolean;
  /** In-place text for `kind: replace` / `innerText`, or replacement string for `textReplace`. */
  replace?: string;
  /** Replace one node with markdown. */
  replaceMarkdown?: string | boolean;
  /** Diff-replace a heading section with markdown. */
  replaceSection?: string | boolean;
  /** Alias for replaceSection. */
  replaceSectionMarkdown?: string | boolean;
  /** Explicit styled text runs for inline formatting. */
  runs?: TapeMutation["runs"];
  /** Native style fields. */
  style?: TapeMutation["style"];
  /** Scope query to custom styled nodes only. */
  stylesOnly?: boolean;
  /** Target tab ID or title. */
  tab?: string;
  /** Refused at apply time — Docs REST API has no table page alignment. */
  tableAlignment?: TapeMutation["tableAlignment"];
  /** Table styling (pinnedHeaderRows, preventOverflow, columnWidth, etc.). */
  tableStyle?: TapeMutation["tableStyle"];
  /** Text content for markdownInsert / replace. */
  text?: string;
  /** Title for docCreate / docCopy / tabAdd / docRename / tabRename. */
  title?: string;
  /** Heading or scope for query/replace. */
  under?: string;
  /** Scope query to fragile nodes only. */
  unsafeOnly?: boolean;
  [key: string]: unknown;
}

/** Document page geometry applied on a live `run` (paper size and margins). */
export type { PageSetup };

/** Newly created heading item in highlights. */
export type ApplyHighlightHeadingJson = {
  id: string;
  text: string;
};

/** Tab item in highlights. */
export type ApplyHighlightTabJson = {
  as?: string;
  headings?: ApplyHighlightHeadingJson[];
  id: string;
  title?: string;
};

/** Document item in highlights. */
export type ApplyHighlightDocJson = {
  as?: string;
  id: string;
  tabs?: ApplyHighlightTabJson[];
  title?: string;
};
