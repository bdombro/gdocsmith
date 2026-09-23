/* Shared workflow step wire types (run input, step kinds, highlights). */

import type { PageSetup, TapeMutation } from "~/core/dom/ops.ts";
import type { NodeKind } from "~/core/dom/types.ts";
import type { DrivePermissionRole, DrivePermissionScope } from "~/core/gws.ts";

/** Document item in highlights. */
export type ApplyHighlightDocJson = {
  as?: string;
  id: string;
  tabs?: ApplyHighlightTabJson[];
  title?: string;
};

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

/** Common base for all workflow steps. */
export interface BaseStepInput {
  /** Target alias to bind this step's output to in the runtime session. */
  as?: string;
  /** Target document ID or alias. Required on every step that reads or writes a file (`docCreate` binds `as` instead). */
  doc?: string;
  /** Dump document or tab metadata into `dumped[as]`. */
  dump?: boolean;
}

/** One workflow step (discriminated union on `kind`). */
export type GdocsmithStepInput =
  | StepDocCreate
  | StepDocLifecycle
  | StepDocOpen
  | StepDocRename
  | StepMarkdownInsert
  | StepPageSetup
  | StepPermission
  | StepQuery
  | StepRemove
  | StepReplace
  | StepReplaceMarkdown
  | StepReplaceSection
  | StepSectionCopy
  | StepSurgical
  | StepTabCreate
  | StepTabModify
  | StepTabPopulate
  | StepTabRename
  | StepTextReplace;

/** Engine-internal step representation with runtime flags. */
export type GdocsmithStepInputInternal = GdocsmithStepInput & {
  /** Internal flag indicating step was optimized into another step (e.g. hoisted into creation). */
  noop?: boolean;
};

/** Serializer for `kind: query` matches written to `dumped` ("headings" is an alias for "outline"). */
export type QueryOutputFormat = "headings" | "markdown" | "nodes" | "outline";

/** Union of content mutation, replacement, and insertion steps. */
export type StepContent =
  | StepMarkdownInsert
  | StepRemove
  | StepReplace
  | StepReplaceMarkdown
  | StepReplaceSection
  | StepSectionCopy
  | StepSurgical
  | StepTextReplace;

/** Document creation or cloning step (`kind: "docCreate"`). */
export interface StepDocCreate extends BaseStepInput {
  /** Target alias to bind this document to in the runtime session. */
  as: string;
  /** Force tab copy even if source contains uncloneable elements (chips/images/equations). */
  force?: boolean;
  /** Bypass the document snapshot cache and fetch `fromDoc` fresh (use when it may have changed externally). */
  forceFetch?: boolean;
  /** Optional source document ID or alias to copy from (creates blank document if omitted). */
  fromDoc?: string;
  /** Optional source tab ID or title to populate the initial tab from (requires fromDoc). */
  fromTab?: string;
  /** Workflow step kind. */
  kind: "docCreate";
  /** Document layout mode: "PAGES" or "PAGELESS". */
  mode?: "PAGES" | "PAGELESS";
  /** Document page setup geometry, layout mode, and margins. */
  pageSetup?: PageSetup;
  /** Whether the document is in pageless mode (convenience alias for mode: "PAGELESS"). */
  pageless?: boolean;
  /** Optional alias to bind the initial tab ID ("t.0") to in the runtime session (when fromTab is provided). */
  tabAs?: string;
  /** Optional title for the initial tab (defaults to source tab's title when fromTab is provided, or "Main"). */
  tabTitle?: string;
  /** Document title. */
  title: string;
}

/** Document lifecycle step (`kind: "docClose" | "docDelete" | "docTrash"`). */
export interface StepDocLifecycle extends BaseStepInput {
  /** Target document ID or alias. */
  doc: string;
  /** Workflow step kind. */
  kind: "docClose" | "docDelete" | "docTrash";
  /** Permanently delete document from Drive (docDelete). */
  permanent?: boolean;
}

/** Open an existing document step (`kind: "docOpen"`). */
export interface StepDocOpen extends BaseStepInput {
  /** Target alias to bind this document to in the runtime session. */
  as: string;
  /** Document ID to load into the session. */
  doc: string;
  /** Bypass the document snapshot cache and fetch fresh (use when the doc may have changed externally). */
  forceFetch?: boolean;
  /** Workflow step kind. */
  kind: "docOpen";
}

/** Rename an open document step (`kind: "docRename"`). */
export interface StepDocRename extends BaseStepInput {
  /** Target document ID or alias. */
  doc: string;
  /** Workflow step kind. */
  kind: "docRename";
  /** New title for the document. */
  title: string;
}

/** Insert rendered markdown step (`kind: "markdownInsert"`). */
export interface StepMarkdownInsert extends BaseStepInput {
  /** Anchor alias or binding for newly created elements. */
  as?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Local markdown or text file path to read and insert (or '-' for stdin). */
  file?: string;
  /** Treat top-level # as Title instead of HEADING_1. */
  h1IsTitle?: boolean;
  /** Workflow step kind. */
  kind: "markdownInsert";
  /** Canonical markdown content to render and insert. */
  markdown?: string;
  /** Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`. */
  markdownStyles?: Record<string, unknown>;
  /** Anchor node to insert after (heading-scoped id from query). */
  nodeAfter?: string;
  /** Anchor node to insert at (heading-scoped id from query). */
  nodeAt?: string;
  /** Anchor node to insert before (heading-scoped id from query). */
  nodeBefore?: string;
  /** Target tab ID or title. */
  tab?: string;
  /** Plain text content (fallback alias for canonical markdown:). */
  text?: string;
}

/** Document page geometry / layout mode step (`kind: "pageSetup"`). */
export interface StepPageSetup extends BaseStepInput {
  /** Target document ID or alias. */
  doc: string;
  /** Workflow step kind. */
  kind: "pageSetup";
  /** Document layout mode: "PAGES" or "PAGELESS". */
  mode?: "PAGES" | "PAGELESS";
  /** Document page setup geometry, layout mode, and margins. */
  pageSetup?: PageSetup;
  /** Whether the document is in pageless mode (convenience alias for mode: "PAGELESS"). */
  pageless?: boolean;
  /** Target tab ID or title. */
  tab?: string;
}

/** Document permission step (`kind: "docPermissionAdd" | "docPermissionList" | "docPermissionRemove"`). */
export interface StepPermission extends BaseStepInput {
  /** Target document ID or alias. */
  doc: string;
  /** Domain name for domain-level file permissions (docPermissionAdd). */
  domain?: string;
  /** Email address of grantee for docPermissionAdd or docPermissionRemove. */
  email?: string;
  /** Notification email message body for docPermissionAdd. */
  emailMessage?: string;
  /** Workflow step kind. */
  kind: "docPermissionAdd" | "docPermissionList" | "docPermissionRemove";
  /** Whether to move the file to the new owner's root folder when transferring ownership (docPermissionAdd). */
  moveToNewOwnersRoot?: boolean;
  /** Specific permission ID to revoke in docPermissionRemove. */
  permissionId?: string;
  /** Access level role for docPermissionAdd (commenter / fileOrganizer / organizer / owner / reader / writer). */
  role?: DrivePermissionRole;
  /** Grantee access scope for docPermissionAdd or docPermissionRemove (anyone / domain / group / internal / user). */
  scope?: DrivePermissionScope;
  /** Whether to send an email notification to grantees on docPermissionAdd. */
  sendNotificationEmail?: boolean;
  /** Whether to transfer file ownership to the grantee on docPermissionAdd. */
  transferOwnership?: boolean;
}

/** Document inspection / query step (`kind: "query"`). */
export interface StepQuery extends BaseStepInput {
  /** On query: binds an output alias in `dumped[as]`. */
  as: string;
  /** Scope query to table column indices (0-based). */
  cols?: number[];
  /** Text substring filter for query. */
  contains?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Scope query to foreground font colors. */
  fontColors?: string[];
  /** Keep every node in query dumps (no heading-only truncation; include table cells). */
  full?: boolean;
  /** Scope query to outline heading levels (0 = TITLE, 1 = HEADING_1, etc.). */
  headingLevels?: number[];
  /** Workflow step kind. */
  kind: "query";
  /** Scope query to bullet nesting levels (0 = root bullet, 1 = sub-bullet, etc.). */
  nestingLevels?: number[];
  /** Scope query to structural node kinds ("paragraph", "table", "sectionBreak", etc.). */
  nodeKinds?: NodeKind[];
  /** Heading or scope node ID for query. */
  nodeUnder?: string;
  /** Query serialization format (nodes, markdown, outline, or headings). */
  output?: QueryOutputFormat;
  /** Scope query to table row indices (0-based). */
  rows?: number[];
  /** When targeting a bullet list item with nodeUnder, scopes to contiguous bullet items sharing listId. */
  sameList?: boolean;
  /** Scope query to custom styled nodes only. */
  stylesOnly?: boolean;
  /** Target tab ID or title. */
  tab?: string;
  /** Scope query to fragile nodes only. */
  unsafeOnly?: boolean;
}

/** Node or section removal step (`kind: "remove" | "dangerousRemoveSection"`). */
export interface StepRemove extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Remove entire section below heading. */
  dangerousRemoveSection?: boolean;
  /** Target document ID or alias. */
  doc: string;
  /** Force destructive deletion even if targeting a fragile node. */
  force?: boolean;
  /** Workflow step kind. */
  kind: "dangerousRemoveSection" | "remove";
  /** Heading-scoped id from query to delete (e.g. h.arch.9a1b). */
  nodeAt: string;
  /** Delete this node flag. */
  remove?: boolean;
  /** Target tab ID or title. */
  tab?: string;
}

/** In-place text replacement step (`kind: "replace" | "innerText"`). */
export interface StepReplace extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED). */
  alignment?: TapeMutation["alignment"];
  /** Target document ID or alias. */
  doc: string;
  /** Target text snippet or substring to find and replace. */
  find?: string;
  /** In-place text for a targeted node. */
  innerText?: string;
  /** Workflow step kind. */
  kind: "innerText" | "replace";
  /** Change namedStyleType on an existing paragraph. */
  namedStyleType?: TapeMutation["namedStyleType"];
  /** Heading-scoped id from query or text snippet to replace (e.g. h.arch.9a1b or "Placeholder: ..."). */
  nodeAt?: string;
  /** Canonical replacement text. */
  replace?: string;
  /** Explicit styled text runs for inline formatting. */
  runs?: TapeMutation["runs"];
  /** Native style fields. */
  style?: TapeMutation["style"];
  /** Target tab ID or title. */
  tab?: string;
  /** Plain text content (fallback alias for canonical replace:). */
  text?: string;
}

/** Single-node markdown replacement step (`kind: "replaceMarkdown"`). */
export interface StepReplaceMarkdown extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Anchor alias or binding for newly created elements. */
  as?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Local markdown or text file path to read (or '-' for stdin). */
  file?: string;
  /** Target text snippet or substring to find and replace with markdown. */
  find?: string;
  /** Workflow step kind. */
  kind: "replaceMarkdown";
  /** Markdown content for replacing one node. */
  markdown?: string;
  /** Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`. */
  markdownStyles?: Record<string, unknown>;
  /** Heading-scoped id from query or text snippet to replace (e.g. h.arch.9a1b or "Placeholder: ..."). */
  nodeAt?: string;
  /** Markdown content or boolean flag when file: is specified. */
  replaceMarkdown?: string | boolean;
  /** Target tab ID or title. */
  tab?: string;
  /** Plain text content (fallback alias for canonical markdown:). */
  text?: string;
}

/** Section-level auto-diffing replacement step (`kind: "replaceSection"`). */
export interface StepReplaceSection extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Anchor alias or binding for newly created elements. */
  as?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Local markdown or text file path to read (or '-' for stdin). */
  file?: string;
  /** Force destructive mutation even if deleting child subsections under top-level headings. */
  force?: boolean;
  /** Workflow step kind. */
  kind: "replaceSection";
  /** Markdown content for diff-replacing a heading section. */
  markdown?: string;
  /** Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`. */
  markdownStyles?: Record<string, unknown>;
  /** Anchor node to insert after when inserting adjacent rather than replacing. */
  nodeAfter?: string;
  /** Target heading node ID from query (e.g. h.arch.9a1b) to diff-replace. */
  nodeAt?: string;
  /** Anchor node to insert before when inserting adjacent rather than replacing. */
  nodeBefore?: string;
  /** Markdown content or boolean flag when file: is specified. */
  replaceSection?: string | boolean;
  /** Target tab ID or title. */
  tab?: string;
  /** Plain text content (fallback alias for canonical markdown:). */
  text?: string;
}

/** Server-side section transfer step across documents or tabs (`kind: "sectionCopy"`). */
export interface StepSectionCopy extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Anchor alias or binding for newly created elements. */
  as?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Source document ID or alias (defaults to target doc). */
  fromDoc?: string;
  /** Source heading title, slug, or heading ID to copy from. */
  fromSection: string;
  /** Source tab ID or title (defaults to source doc active tab). */
  fromTab?: string;
  /** Whether to include the source section heading in copy (default true). */
  includeHeading?: boolean;
  /** Workflow step kind. */
  kind: "sectionCopy";
  /** Anchor node to insert after (heading-scoped id from query). */
  nodeAfter?: string;
  /** Anchor node to insert at (heading-scoped id from query). */
  nodeAt?: string;
  /** Anchor node to insert before (heading-scoped id from query). */
  nodeBefore?: string;
  /** Target tab ID or title. */
  tab?: string;
}

/** Surgical DOM and tape mutation step (`kind: "surgical"`). */
export interface StepSurgical extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED). */
  alignment?: TapeMutation["alignment"];
  /** Anchor alias or binding for newly created elements. */
  as?: string;
  /** Convert this paragraph (and siblings sharing listId) to a Docs bullet preset. */
  bullet?: TapeMutation["bullet"];
  /** Clone an existing node with style/bullet fidelity (heading-scoped id or ref). */
  cloneNode?: Exclude<TapeMutation["cloneNode"], number>;
  /** Batch cloning of existing nodes. */
  cloneNodes?: Array<Exclude<NonNullable<TapeMutation["cloneNodes"]>[number], number>>;
  /** Clear the tab/doc before mutations. */
  dangerousClear?: boolean;
  /** Delete a table column. */
  deleteTableColumn?: TapeMutation["deleteTableColumn"];
  /** Delete a table row. */
  deleteTableRow?: TapeMutation["deleteTableRow"];
  /** Target document ID or alias. */
  doc: string;
  /** Duplicate a table row. */
  duplicateTableRow?: TapeMutation["duplicateTableRow"];
  /** Detached element spec to insert. */
  element?: Record<string, unknown>;
  /** Detached element specs to insert in order. */
  elements?: Array<Record<string, unknown>>;
  /** Force destructive mutation even if targeting a fragile node. */
  force?: boolean;
  /** Source document ID or alias for cloneNode (defaults to doc). */
  fromDoc?: string;
  /** Source tab ID or title for cloneNode (defaults to source doc active tab). */
  fromTab?: string;
  /** Insert a native date chip. */
  insertDate?: TapeMutation["insertDate"];
  /** Insert a footnote reference. */
  insertFootnote?: TapeMutation["insertFootnote"];
  /** Insert a public HTTPS inline image. */
  insertImage?: TapeMutation["insertImage"];
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
  kind: "surgical";
  /** Change namedStyleType on an existing paragraph. */
  namedStyleType?: TapeMutation["namedStyleType"];
  /** Anchor node to insert after (heading-scoped id from query). */
  nodeAfter?: string;
  /** Heading-scoped id from query (e.g. h.arch.9a1b). */
  nodeAt?: string;
  /** Anchor node to insert before (heading-scoped id from query). */
  nodeBefore?: string;
  /** Explicit styled text runs for inline formatting. */
  runs?: TapeMutation["runs"];
  /** Native style fields. */
  style?: TapeMutation["style"];
  /** Target tab ID or title. */
  tab?: string;
  /** Table styling (pinnedHeaderRows, preventOverflow, columnWidth, etc.). */
  tableStyle?: TapeMutation["tableStyle"];
}

/** Tab creation or cloning step (`kind: "tabCreate"`). */
export interface StepTabCreate extends BaseStepInput {
  /** Insert this tab immediately after the specified tab title or ID. */
  afterTab?: string;
  /** Target alias to bind this tab ID to in the runtime session. */
  as: string;
  /** Insert this tab immediately before the specified tab title or ID. */
  beforeTab?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Force tab copy even if source contains uncloneable elements (chips/images/equations). */
  force?: boolean;
  /** Source document ID or alias when copying a tab across documents (defaults to doc). */
  fromDoc?: string;
  /** Source tab ID or title when copying an existing tab (creates blank tab if omitted). */
  fromTab?: string;
  /** Position index for the tab. */
  index?: number;
  /** Workflow step kind. */
  kind: "tabCreate";
  /** Title for the new tab. Note: supply final title directly at creation to avoid HTTP 500 on template copies. */
  title: string;
}

/** Tab modification step (`kind: "tabDelete" | "tabMove" | "tabReorder"`). */
export interface StepTabModify extends BaseStepInput {
  /** Move this tab immediately after the specified tab title or ID. */
  afterTab?: string;
  /** Move this tab immediately before the specified tab title or ID. */
  beforeTab?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Position index for tab move. */
  index?: number;
  /** Workflow step kind. */
  kind: "tabDelete" | "tabMove" | "tabReorder";
  /** Target tab ID or title. */
  tab: string;
}

/** Whole-tab population step into an existing tab (`kind: "tabPopulate"`). */
export interface StepTabPopulate extends BaseStepInput {
  /** Target alias to bind this tab ID to in the runtime session. */
  as?: string;
  /** Target document ID or alias. */
  doc: string;
  /** Force overwrite if the target tab already contains content, or if source contains uncloneable elements. */
  force?: boolean;
  /** Source document ID or alias when copying a tab across documents (defaults to doc). */
  fromDoc?: string;
  /** Source tab ID or title to copy content from. */
  fromTab: string;
  /** Workflow step kind. */
  kind: "tabPopulate";
  /** Target tab ID, title, or alias to populate (e.g. "Tab 1" or "t.0"). */
  tab: string;
  /** Optional new title to rename the target tab in place. */
  title?: string;
}

/** Tab renaming step (`kind: "tabRename"`). */
export interface StepTabRename extends BaseStepInput {
  /** Target document ID or alias. */
  doc: string;
  /** Workflow step kind. */
  kind: "tabRename";
  /** Target tab ID or current title to rename. */
  tab: string;
  /** New title for the tab. Note: tabRename 500s on docs lacking root 't.0' (set title directly on tabCreate). */
  title: string;
}

/** Plain find-and-replace text step (`kind: "textReplace"`). */
export interface StepTextReplace extends BaseStepInput {
  /** Accept a step that changes nothing instead of rejecting it as a likely anchor or content mistake. */
  allowNoop?: boolean;
  /** Replace all occurrences across all tabs. */
  allTabs?: boolean;
  /** Target document ID or alias. */
  doc: string;
  /** String to find for replacement. */
  find: string;
  /** Workflow step kind. */
  kind: "textReplace";
  /** Match case in textReplace (default true). */
  matchCase?: boolean;
  /** Optional anchor node to insert after. */
  nodeAfter?: string;
  /** Optional anchor node to replace text within. */
  nodeAt?: string;
  /** Optional anchor node to insert before. */
  nodeBefore?: string;
  /** Optional heading or scope node to restrict replacement under. */
  nodeUnder?: string;
  /** Canonical replacement text string. */
  replace: string;
  /** Target tab ID or title. */
  tab?: string;
  /** Plain text replacement (fallback alias for replace:). */
  text?: string;
}

/** Canonical workflow step kinds handled by the apply script engine. */
export type WorkflowStepKind =
  | "dangerousRemoveSection"
  | "docClose"
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
  | "pageSetup"
  | "query"
  | "remove"
  | "replace"
  | "replaceMarkdown"
  | "replaceSection"
  | "sectionCopy"
  | "surgical"
  | "tabCreate"
  | "tabDelete"
  | "tabMove"
  | "tabPopulate"
  | "tabRename"
  | "tabReorder"
  | "textReplace";

/** Document page geometry applied on a live `run` (paper size and margins). */
export type { PageSetup };
