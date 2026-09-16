/*

Run document body (stdin / one YAML or JSON argument) and JSON stdout.

Canonical workflow:
  steps:
    - kind: open
      doc: <id>
      as: spec
    - kind: dump
      as: spec

Aliases: `ops` for `steps`; `action` / `op` / `step` for `kind`.
*/

/**
 * One workflow step. Canonical discriminator is `kind`; `action`, `op`, and
 * `step` are accepted aliases.
 */
export interface GdocsmithStepInput {
  /** Alias for `kind`. */
  action?: string;
  /** Anchor node to insert after. */
  after?: number | string;
  /** Label for later steps in this document. */
  as?: string;
  /** Heading-scoped id from query (e.g. h.arch.9a1b). */
  at?: number | string;
  /** Anchor node to insert before. */
  before?: number | string;
  /** Text substring filter for query. */
  contains?: string;
  /** Source doc ID or alias for copyDoc. */
  copyFrom?: string;
  /** Clear the tab/doc before mutations. */
  dangerousClear?: boolean;
  /** Remove the heading and its following section. */
  dangerousRemoveSection?: boolean;
  /** Target document ID or alias. */
  doc?: string;
  /** Alias for doc. */
  docId?: string;
  /** Detached element spec to insert. */
  element?: Record<string, unknown>;
  /** Detached element specs to insert in order. */
  elements?: Array<Record<string, unknown>>;
  /** Local markdown/text path. */
  file?: string;
  /** String to find for replaceText. */
  find?: string;
  /** Treat top-level # as Title instead of HEADING_1. */
  h1IsTitle?: boolean;
  /** Position index for addTab. */
  index?: number;
  /** In-place paragraph text. */
  innerText?: string;
  /** Insert rendered markdown at the anchor. */
  insertMarkdown?: string | boolean;
  /** Step kind: open, close, createDoc, copyDoc, query, dump, insertMarkdown, … */
  kind?: string;
  /** Markdown text string. */
  markdown?: string;
  /** Alias for `kind`. */
  op?: string;
  /** Permanently delete document (deleteDoc). */
  permanent?: boolean;
  /** Delete this node. */
  remove?: boolean;
  /** In-place text replacement (alias for innerText) or replaceText replacement. */
  replace?: string;
  /** Replace one node with markdown. */
  replaceMarkdown?: string | boolean;
  /** Diff-replace a heading section with markdown. */
  replaceSection?: string | boolean;
  /** Alias for `kind`. */
  step?: string;
  /** Native style fields. */
  style?: Record<string, unknown>;
  /** Scope query to custom styled nodes only. */
  stylesOnly?: boolean;
  /** Target tab ID or title. */
  tab?: string;
  /** Alias for tab. */
  tabId?: string;
  /** Dump target alias (kind: dump). */
  target?: string;
  /** Text content for insertMarkdown / replace. */
  text?: string;
  /** Title for createDoc / copyDoc / addTab / renameDoc / renameTab. */
  title?: string;
  /** Heading or scope for query/replace. */
  under?: string;
  /** Scope query to fragile nodes only. */
  unsafeOnly?: boolean;
  [key: string]: unknown;
}

/** Backward-compatible alias for GdocsmithStepInput. */
export type ApplyOpInput = GdocsmithStepInput;

/**
 * Run / apply input. Pipe YAML or JSON, or pass one document argument.
 */
/** @sg */
export interface GdocsmithDocument {
  /** Document ID (raw id, not a URL). Auto-opens as alias `main` when set. */
  documentId?: string;
  /** Preview resolved targets without writing. */
  dryRun?: boolean;
  /** Skip guards. Only if the user asked. */
  force?: boolean;
  /** Output JSON instead of YAML. */
  json?: boolean;
  /** Alias for `steps`. */
  ops?: GdocsmithStepInput[];
  /** Minimal output. */
  quiet?: boolean;
  /** Ordered workflow steps. */
  steps?: GdocsmithStepInput[];
}

/** Backward-compatible alias. */
export type ApplyDocument = GdocsmithDocument;

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

/** JSON stdout for `gdocsmith run`. */
/** @sg */
export type GdocsmithJsonOutput = {
  /** Unified git diff of changes (populated on dryRun). */
  diff?: string;
  /** Document ID mutations were applied to (legacy shape). */
  documentId?: string;
  /** True when `dryRun: true` previewed without writing. */
  dryRun?: boolean;
  /** Values extracted by `kind: dump`. */
  dumped?: Record<string, unknown>;
  /** Highlights of newly created docs, tabs, and headings. */
  highlights?: ApplyHighlightDocJson[];
  /** Status confirmation for minimal response. */
  ok?: boolean;
  /** Steps executed. */
  opsCount?: number;
};

/** Backward-compatible alias. */
export type ApplyJsonOutput = GdocsmithJsonOutput;
