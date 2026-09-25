/* v2 run steps: ten kinds discriminated by `kind`. */

import type { NodeInfo } from "~/core/lens/query.ts";
import type { BulletPreset } from "~/core/model/types.ts";

export type { BulletPreset };

/** Docs named paragraph styles, including TITLE and SUBTITLE. */
export type NamedStyle =
  | "HEADING_1"
  | "HEADING_2"
  | "HEADING_3"
  | "HEADING_4"
  | "HEADING_5"
  | "HEADING_6"
  | "NORMAL_TEXT"
  | "SUBTITLE"
  | "TITLE";

/** Node kinds. */
export type NodeKind = NodeInfo["kind"];

/** Where a step acts. Set exactly one key. */
export interface Anchor {
  /** Whole tab body. */
  body?: true;
  /** Node or cell ID from query. */
  node?: string;
  /** Heading text or ID: the heading and everything under it. */
  section?: string;
  /** Unique substring of one node's plain text. */
  text?: string;
}

/** Content to copy; omit node and section to copy the whole tab. */
export interface CopySource {
  /** With section: copy only what is under the heading. */
  bodyOnly?: boolean;
  /** Source doc ID or alias (default: this step's doc). */
  doc?: string;
  /** Source node ID. */
  node?: string;
  /** Source heading text or ID. */
  section?: string;
  /** Source tab ID or title. */
  tab?: string;
}

/** Node filters for output "nodes"; all set filters must match. */
export interface NodeFilter {
  /** Case-insensitive substring of node text. */
  contains?: string;
  /** Text colors present (#RRGGBB). */
  fontColors?: string[];
  /** Only chips, images, equations, footnotes, rules, TOC. */
  fragile?: boolean;
  /** 0 = TITLE, 1–6 = HEADING_n. */
  headingLevels?: number[];
  /** Node kinds. */
  kinds?: NodeKind[];
}

/** Page margins in PT. */
export interface PageMargins {
  /** PT. */
  bottom?: number;
  /** PT. */
  left?: number;
  /** PT. */
  right?: number;
  /** PT. */
  top?: number;
}

/** Paragraph properties; null resets to the inherited value. */
export interface ParagraphStylePatch {
  /** Alignment. */
  alignment?: "CENTER" | "END" | "JUSTIFIED" | "START" | null;
  /** List preset; null removes bullets. */
  bullet?: BulletPreset | null;
  /** PT. */
  indentEnd?: number | null;
  /** PT (bullet glyph position). */
  indentFirstLine?: number | null;
  /** PT. */
  indentStart?: number | null;
  /** 100 = single, 200 = double. */
  lineSpacing?: number | null;
  /** NORMAL_TEXT, TITLE, SUBTITLE, HEADING_1–6. */
  namedStyle?: NamedStyle;
  /** Fill #RRGGBB. */
  shading?: string | null;
  /** PT. */
  spaceAbove?: number | null;
  /** PT. */
  spaceBelow?: number | null;
}

/** Open, create, copy, rename, trash, or delete a doc. */
export interface StepDoc {
  /** delete is permanent; trash is recoverable. */
  action: "copy" | "create" | "delete" | "open" | "rename" | "trash";
  /** Alias for later steps in this run (open/create/copy). */
  as?: string;
  /** Doc ID or alias (all actions but create). */
  doc?: string;
  /** Skip the snapshot cache (open). */
  fresh?: boolean;
  /** Step kind. */
  kind: "doc";
  /** Title (create/copy/rename). */
  title?: string;
}

/** Find and replace plain text; replaces every match in scope. */
export interface StepEdit {
  /** Limit to this node, section, or tab body. */
  at?: Anchor;
  /** Doc ID or alias. */
  doc: string;
  /** Fail unless exactly this many matches. */
  expectCount?: number;
  /** Exact text to find. */
  find: string;
  /** Proceed despite the breakage a refusal listed. */
  force?: boolean;
  /** Step kind. */
  kind: "edit";
  /** Case-sensitive (default true). */
  matchCase?: boolean;
  /** Replacement text ("" deletes). */
  replace: string;
  /** Tab ID or title (default: all tabs). */
  tab?: string;
}

/** Page setup for every tab, or one tab. */
export interface StepPage {
  /** Doc ID or alias. */
  doc: string;
  /** Custom page height PT (with width). */
  height?: number;
  /** Step kind. */
  kind: "page";
  /** Margins PT. */
  margins?: PageMargins;
  /** Orientation. */
  orientation?: "LANDSCAPE" | "PORTRAIT";
  /** true = pageless. */
  pageless?: boolean;
  /** Paper size. */
  size?: "A3" | "A4" | "A5" | "LEGAL" | "LETTER" | "TABLOID";
  /** Tab ID or title (default: all tabs). */
  tab?: string;
  /** Custom page width PT (with height). */
  width?: number;
}

/** Read a doc; large results are saved to files. */
export interface StepQuery {
  /** Limit to a node, section, or text match. */
  at?: Anchor;
  /** Doc ID or alias. */
  doc: string;
  /** Step kind. */
  kind: "query";
  /** outline (default) | markdown (editable) | nodes (IDs, styles). */
  output?: "markdown" | "nodes" | "outline";
  /** Absolute directory to always save the result into. */
  saveTo?: string;
  /** Markdown without frontmatter/directives (read-only copy). */
  skipFrontmatter?: boolean;
  /** Tab ID or title (default: all tabs). */
  tab?: string;
  /** Node filters (output nodes). */
  where?: NodeFilter;
}

/** Delete a node, a section (heading + subtree), or a tab body. */
export interface StepRemove {
  /** What to remove. */
  at: Anchor;
  /** Doc ID or alias. */
  doc: string;
  /** Proceed despite the breakage a refusal listed. */
  force?: boolean;
  /** Step kind. */
  kind: "remove";
  /** Tab ID or title. */
  tab?: string;
}

/** Add, list, or remove Drive sharing. */
export interface StepShare {
  /** add | list | remove. */
  action: "add" | "list" | "remove";
  /** Doc ID or alias. */
  doc: string;
  /** Domain for scope domain (default: yours). */
  domain?: string;
  /** User or group email. */
  email?: string;
  /** Step kind. */
  kind: "share";
  /** Notification message (add; implies notify). */
  message?: string;
  /** Email the grantee (add; default false). */
  notify?: boolean;
  /** Permission ID from list (remove). */
  permissionId?: string;
  /** Role (add); owner transfers ownership. */
  role?: "commenter" | "owner" | "reader" | "writer";
  /** Grantee scope. */
  scope?: "anyone" | "domain" | "group" | "user";
}

/** Set text/paragraph style; null resets a property. */
export interface StepStyle {
  /** What to style. */
  at: Anchor;
  /** Doc ID or alias. */
  doc: string;
  /** Proceed despite the breakage a refusal listed. */
  force?: boolean;
  /** Step kind. */
  kind: "style";
  /** Paragraph properties. */
  paragraph?: ParagraphStylePatch;
  /** Tab ID or title. */
  tab?: string;
  /** Text (run) properties. */
  text?: TextStylePatch;
  /** Only restyle runs whose set values match these. */
  where?: TextStyleMatch;
}

/** Create, rename, move, or delete a tab. */
export interface StepTab {
  /** create | rename | move | delete. */
  action: "create" | "delete" | "move" | "rename";
  /** Place after this tab (ID or title). */
  after?: string;
  /** Place before this tab (ID or title). */
  before?: string;
  /** Doc ID or alias. */
  doc: string;
  /** Proceed despite the breakage a refusal listed. */
  force?: boolean;
  /** Seed the new tab with a copy of this content (create). */
  from?: CopySource;
  /** Step kind. */
  kind: "tab";
  /** Tab to rename, move, or delete (ID or title). */
  tab?: string;
  /** Title (create/rename); unique per doc. */
  title?: string;
}

/** Change table structure or cell style. */
export interface StepTable {
  /** Table operation. */
  action: "deleteColumn" | "deleteRow" | "insertColumn" | "insertRow" | "merge" | "style" | "unmerge" | "widths";
  /** Table/cell ID ({node}) or {section} holding one table. */
  at: Anchor;
  /** Texts for new row/column cells. */
  cells?: string[];
  /** 0-based column. */
  column?: number;
  /** Columns to merge (default 1). */
  columnSpan?: number;
  /** Doc ID or alias. */
  doc: string;
  /** Proceed despite the breakage a refusal listed. */
  force?: boolean;
  /** Step kind. */
  kind: "table";
  /** Insert side: above/below (rows), left/right (columns). */
  position?: "above" | "below" | "left" | "right";
  /** 0-based row. */
  row?: number;
  /** Rows to merge (default 1). */
  rowSpan?: number;
  /** Cell style (style). */
  style?: TableCellStylePatch;
  /** Tab ID or title. */
  tab?: string;
  /** Column widths PT; null = even (widths). */
  widths?: Array<number | null>;
}

/** Write markdown or copied content. One content field, one placement. */
export interface StepWrite {
  /** Insert after (a section: after its last node). */
  after?: Anchor;
  /** Append to the end of the tab. */
  append?: true;
  /** Insert before (a section: before its heading). */
  before?: Anchor;
  /** Doc ID or alias. */
  doc: string;
  /** Proceed despite the breakage a refusal listed. */
  force?: boolean;
  /** Copy content (keeps chips, images, styles). */
  from?: CopySource;
  /** Step kind. */
  kind: "write";
  /** Markdown (frontmatter styles and directives allowed). */
  markdown?: string;
  /** Absolute path of a markdown file (e.g. an edited export). */
  markdownFile?: string;
  /** Replace, diffed: unchanged nodes keep their IDs. */
  replace?: Anchor;
  /** Tab ID or title. */
  tab?: string;
}

/** One run step. */
export type GdocsmithStep =
  | StepDoc
  | StepEdit
  | StepPage
  | StepQuery
  | StepRemove
  | StepShare
  | StepStyle
  | StepTab
  | StepTable
  | StepWrite;

/** Cell/table style. */
export interface TableCellStylePatch {
  /** Fill #RRGGBB; null clears. */
  background?: string | null;
  /** Border #RRGGBB, all sides. */
  borderColor?: string;
  /** Border width PT (with borderColor). */
  borderWidth?: number;
  /** Min row height PT. */
  minRowHeight?: number;
  /** Padding PT, all sides. */
  padding?: number;
  /** Header rows repeated per page (table only). */
  pinnedHeaderRows?: number;
  /** Vertical alignment. */
  verticalAlign?: "BOTTOM" | "MIDDLE" | "TOP";
}

/** Run filter; every set property must equal the run's set value. */
export interface TextStyleMatch {
  /** #RRGGBB. */
  backgroundColor?: string;
  /** Bold. */
  bold?: boolean;
  /** Font. */
  fontFamily?: string;
  /** PT. */
  fontSize?: number;
  /** #RRGGBB. */
  foregroundColor?: string;
  /** Italic. */
  italic?: boolean;
  /** Strikethrough. */
  strikethrough?: boolean;
  /** Underline. */
  underline?: boolean;
}

/** Run properties; null resets to the inherited value. */
export interface TextStylePatch {
  /** Highlight #RRGGBB. */
  backgroundColor?: string | null;
  /** Bold. */
  bold?: boolean | null;
  /** Font. */
  fontFamily?: string | null;
  /** PT. */
  fontSize?: number | null;
  /** Text color #RRGGBB. */
  foregroundColor?: string | null;
  /** Italic. */
  italic?: boolean | null;
  /** Link URL; null removes. */
  link?: string | null;
  /** Strikethrough. */
  strikethrough?: boolean | null;
  /** Underline. */
  underline?: boolean | null;
}

/** Step kinds in schema order. */
export const STEP_KINDS = [
  "doc",
  "edit",
  "page",
  "query",
  "remove",
  "share",
  "style",
  "tab",
  "table",
  "write",
] as const;

/** Every step kind. */
export type StepKind = (typeof STEP_KINDS)[number];

/** Complete run document (local until commands/run/types.ts switches in M7). */
export interface GdocsmithRun {
  /** Check and plan every step; send nothing; same result. */
  dryRun?: boolean;
  /** Steps, applied in order to an in-memory copy before sending. */
  steps: GdocsmithStep[];
}

// Compile-time checks for exhaustiveness:
type StepKindComplete =
  Exclude<GdocsmithStep["kind"], StepKind> extends never
    ? Exclude<StepKind, GdocsmithStep["kind"]> extends never
      ? true
      : never
    : never;
const _stepKindComplete: StepKindComplete = true;
void _stepKindComplete;
