/* Shared workflow step wire types (run input, step kinds, highlights). */

import type { PageSetup, TapeMutation } from "~/core/dom/ops.ts";
import type { NodeKind } from "~/core/dom/types.ts";
import type { DrivePermissionRole, DrivePermissionScope } from "~/core/gws.ts";

/** Canonical workflow step kinds handled by the apply script engine. */
export type WorkflowStepKind =
  | "dangerousRemoveSection"
  | "docClose"
  | "docCopy"
  | "docCreate"
  | "docDelete"
  | "docOpen"
  | "docPermissionAdd"
  | "docPermissionList"
  | "docPermissionRemove"
  | "docRename"
  | "docTrash"
  | "innerText"
  | "markdownInsert"
  | "query"
  | "remove"
  | "replace"
  | "replaceMarkdown"
  | "replaceSection"
  | "sectionCopy"
  | "surgical"
  | "tabAdd"
  | "tabCopy"
  | "tabDelete"
  | "tabDuplicate"
  | "tabMove"
  | "tabRename"
  | "tabReorder"
  | "textReplace";

/** Serializer for `kind: query` matches written to `dumped`. */
export type QueryOutputFormat = "markdown" | "nodes" | "outline";

/** One workflow step; discriminator is `kind`. */
export interface GdocsmithStepInput {
  /** Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED). */
  alignment?: TapeMutation["alignment"];
  /** Replace all occurrences across all tabs in textReplace. */
  allTabs?: boolean;
  /** Insert or move this tab immediately after the specified tab title or ID. */
  afterTab?: string;
  /** On open/query: binds a doc or output alias. */
  as?: string;
  /** Insert or move this tab immediately before the specified tab title or ID. */
  beforeTab?: string;
  /** Convert this paragraph (and siblings sharing listId) to a Docs bullet preset. */
  bullet?: TapeMutation["bullet"];
  /** Clone an existing node with style/bullet fidelity (heading-scoped id or ref). */
  cloneNode?: Exclude<TapeMutation["cloneNode"], number>;
  /** Batch cloning of existing nodes. */
  cloneNodes?: Array<Exclude<NonNullable<TapeMutation["cloneNodes"]>[number], number>>;
  /** Scope query to table column indices (0-based). */
  cols?: number[];
  /** Text substring filter for query. */
  contains?: string;
  /** Source doc ID or alias for docCopy. */
  copyFrom?: string;
  /** Source doc ID or alias for tabCopy / tabDuplicate (defaults to doc). */
  copyFromDoc?: string;
  /** Source tab ID or title for tabCopy / tabDuplicate / tabAdd. */
  copyFromTab?: string;
  /** Clear the tab/doc before mutations. */
  dangerousClear?: boolean;
  /** Remove the heading and its following section. */
  dangerousRemoveSection?: boolean;
  /** Delete a table column. */
  deleteTableColumn?: TapeMutation["deleteTableColumn"];
  /** Delete a table row. */
  deleteTableRow?: TapeMutation["deleteTableRow"];
  /** Target document ID or alias. Required on every step that reads or writes a file (`docCreate` binds `as` instead; `docCopy` uses `copyFrom`). */
  doc?: string;
  /** Domain name for domain-level file permissions (docPermissionAdd). */
  domain?: string;
  /** Dump document or tab metadata into `dumped[as]`. */
  dump?: boolean;
  /** Duplicate a table row. */
  duplicateTableRow?: TapeMutation["duplicateTableRow"];
  /** Detached element spec to insert. */
  element?: Record<string, unknown>;
  /** Detached element specs to insert in order. */
  elements?: Array<Record<string, unknown>>;
  /** Email address of grantee for docPermissionAdd or docPermissionRemove (alias for emailAddress). */
  email?: string;
  /** Email address of grantee for docPermissionAdd or docPermissionRemove. */
  emailAddress?: string;
  /** Notification email message body for docPermissionAdd. */
  emailMessage?: string;
  /** Local markdown/text path. */
  file?: string;
  /** String to find for textReplace. */
  find?: string;
  /** Scope query to foreground font colors (supports semantic colors like "red", hex like "#ea4335", and exclusions like "!#000000" or "!default"). */
  fontColors?: string[];
  /** Force destructive mutation even if targeting a fragile node. */
  force?: boolean;
  /** Source document ID or alias for sectionCopy (defaults to doc). */
  fromDoc?: string;
  /** Source heading title, slug, or heading ID to copy from for sectionCopy. */
  fromSection?: string;
  /** Source tab ID or title for sectionCopy (defaults to source doc active tab). */
  fromTab?: string;
  /** Keep every node in query dumps (no heading-only truncation; include table cells). */
  full?: boolean;
  /** Treat top-level # as Title instead of HEADING_1. */
  h1IsTitle?: boolean;
  /** Scope query to outline heading levels (0 = TITLE, 1 = HEADING_1, 2 = HEADING_2, etc.). */
  headingLevels?: number[];
  /** Whether to include the source section heading in sectionCopy (default true). */
  includeHeading?: boolean;
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
  /** Match case in textReplace (default true). */
  matchCase?: boolean;
  /** Whether to move the file to the new owner's root folder when transferring ownership (docPermissionAdd). */
  moveToNewOwnersRoot?: boolean;
  /** Change namedStyleType on an existing paragraph. */
  namedStyleType?: TapeMutation["namedStyleType"];
  /** Scope query to bullet nesting levels (0 = root bullet, 1 = sub-bullet, etc.). */
  nestingLevels?: number[];
  /** Anchor node to insert after (heading-scoped id from query). */
  nodeAfter?: string;
  /** Heading-scoped id from query (e.g. h.arch.9a1b). */
  nodeAt?: string;
  /** Anchor node to insert before (heading-scoped id from query). */
  nodeBefore?: string;
  /** Scope query to structural node kinds ("paragraph", "table", "sectionBreak", etc.). */
  nodeKinds?: NodeKind[];
  /** Heading or scope for query/replace. */
  nodeUnder?: string;
  /** Internal flag indicating step was optimized into another step (e.g. hoisted into creation). */
  noop?: boolean;
  /** Query serialization format (default nodes). */
  output?: QueryOutputFormat;
  /** Permanently delete document (docDelete). */
  permanent?: boolean;
  /** Specific permission ID to revoke in docPermissionRemove. */
  permissionId?: string;
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
  /** Access level role for docPermissionAdd (commenter / fileOrganizer / organizer / owner / reader / writer). */
  role?: DrivePermissionRole;
  /** Scope query to table row indices (0-based). */
  rows?: number[];
  /** Explicit styled text runs for inline formatting. */
  runs?: TapeMutation["runs"];
  /** When targeting a bullet list item with nodeUnder, scopes to contiguous bullet items sharing listId. */
  sameList?: boolean;
  /** Grantee access scope for docPermissionAdd or docPermissionRemove (anyone / domain / group / internal / user). */
  scope?: DrivePermissionScope;
  /** Whether to send an email notification to grantees on docPermissionAdd. */
  sendNotificationEmail?: boolean;
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
  /** Title for docCreate / docCopy / tabAdd / tabCopy / tabDuplicate / docRename / tabRename. */
  title?: string;
  /** Whether to transfer file ownership to the grantee on docPermissionAdd. */
  transferOwnership?: boolean;
  /** Scope query to fragile nodes only. */
  unsafeOnly?: boolean;
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
