/* Public exports for the document tape and DOM query layer. */

export type { CompiledDomWrite, ListIndent } from "./apply.ts";
export {
  applyDom,
  batchUpdateErrorWrap,
  buildDocumentStyleRequest,
  compileDom,
  documentStyleRequestBuilder,
  domApply,
  domCompile,
  googleRequestIndexParse,
  LAST_PARAGRAPH_MSG,
  nestingIndentResolve,
  nestingStyleResolve,
  parseGoogleRequestIndex,
  resolveNestingIndent,
  resolveNestingStyle,
  STOCK_NESTING_HANGING_PT,
  STOCK_NESTING_INDENT_PT,
  wrapBatchUpdateError,
} from "./apply.ts";

export {
  cellChecksumCompute,
  computeCellChecksum,
  computeNodeChecksum,
  nodeChecksumCompute,
} from "./checksum.ts";

export type {
  CloneNodeRef,
  CloneResolutionContext,
} from "./clone.ts";
export {
  cloneNodeOpsResolve,
  elementSpecFromNode,
  intraDocCloneNodeResolve,
  nodeToElementSpec,
  resolveCloneNodeOps,
  resolveIntraDocCloneNode,
} from "./clone.ts";

export type { UnifiedDiffOptions } from "./diff.ts";
export {
  diffUnifiedFormat,
  formatUnifiedDiff,
} from "./diff.ts";

export type {
  BulletPreset,
  BulletProps,
  CreateCodeBlockProps,
  CreateParagraphProps,
  CreateTableProps,
  DateChipSpec,
  ElementSpec,
  FootnoteSpec,
  IndentStart,
  InlineImageSpec,
  InsertPosition,
  PageBreakSpec,
  ParagraphSpec,
  PersonChipSpec,
  RichLinkChipSpec,
  SectionBreakSpec,
  SiblingPosition,
  TableSpec,
} from "./element.ts";
export {
  asBulletPreset,
  BULLET_GLYPH_PRESETS,
  bulletPresetAs,
  codeBlockCreate,
  createCodeBlock,
  createElement,
  elementCreate,
} from "./element.ts";

export type {
  ExportAuditSummary,
  ExportMarkdownResult,
  ExportTabInput,
} from "./export.ts";
export {
  auditDocNodes,
  docNodesAudit,
  documentExportToMarkdown,
  exportDocumentToMarkdown,
  exportTabToMarkdown,
  tabExportToMarkdown,
} from "./export.ts";

export {
  assertWritable,
  bulletTextIsEmpty,
  CHIP_MUTATE_MSG,
  chipsHave,
  DOUBLE_NUMBER_MSG,
  EMPTY_BULLET_MSG,
  EXISTING_NEST_MSG,
  FAKE_BULLET_MSG,
  fakeBulletPrefixIs,
  HEADING_BULLET_MSG,
  hasChips,
  isEmptyBulletText,
  isFakeBulletPrefix,
  isNumberedPrefix,
  numberedPrefixIs,
  writableAssert,
} from "./guards.ts";

export type {
  AppliedOpPlan,
  AppliedOpPlanPreview,
  CellSummary,
  DomOp,
  DomOpFile,
  LiveDump,
  LiveDumpTab,
  NodeSummary,
  PageSetup,
  ParsedDomFile,
  TabDomOp,
  TapeMutation,
  TapeMutationKey,
  WriteAt,
} from "./ops.ts";
export {
  applyOps,
  assertDomDocument,
  assertNotFragile,
  CELL_FIELD_MSG,
  cellId,
  dangerousClearExecute,
  domDocumentAssert,
  domOpsParse,
  elementFromJson,
  executeDangerousClear,
  extractPageSetup,
  formatUnrecoverableWarning,
  liveDump,
  nodeSummarize,
  notFragileAssert,
  opsApply,
  pageSetupExtract,
  parseDomOps,
  parseWriteAt,
  resolveTarget,
  summarizeNode,
  TABLE_INSERT_MIX_MSG,
  TAPE_ECHO_CAP,
  TAPE_MUTATION_KEYS,
  tapeMutationsApply,
  targetResolve,
  unrecoverableWarningFormat,
  WRITE_AT_ONLY_MSG,
  writeAtParse,
  wrongDocumentMsg,
  wrongTabMsg,
} from "./ops.ts";

export type {
  ParsedDocument,
  ParsedTape,
} from "./parse.ts";
export {
  documentParse,
  parseDocument,
  parseTape,
  scopedIdsAssign,
  tapeParse,
} from "./parse.ts";

export type {
  FindHeadingTextOptions,
  FindNodeTextOptions,
} from "./query.ts";
export {
  DocDom,
  findHeadingByTitleOrSlug,
  findHeadingsByText,
  findNodeAt,
  findNodesByText,
  followingSiblingsFormat,
  formatFollowingSiblings,
  formatMissingScopedTargetMsg,
  headingByTitleOrSlugFind,
  headingsByTextFind,
  missingNodeIdMsg,
  missingScopedTargetMsgFormat,
  neighborhoodFrom,
  nextElementSibling,
  nodeAtFind,
  nodeIdMissingMsg,
  nodeQuery,
  nodesByTextFind,
  nodesQueryAll,
  nodesQueryFrom,
  previousElementSibling,
  queryFrom,
  querySelector,
  querySelectorAll,
} from "./query.ts";

export type { StylePatch } from "./style.ts";
export {
  colorHex,
  colorOptional,
  colorRgb,
  firstLineHanging,
  hangingFirstLine,
  hasIndent,
  hasStyle,
  hasTableChrome,
  hexColor,
  indentHas,
  indentOmit,
  isMonospaceFont,
  monospaceFontIs,
  point,
  pt,
  queryTextStyleUniform,
  rgbColor,
  styleHas,
  tableChromeHas,
  uniformQueryTextStyle,
} from "./style.ts";

export type {
  CellContentAlignment,
  CellParagraph,
  DocNode,
  DocSegment,
  DocSegmentKind,
  DocSegmentUse,
  InlineChip,
  InlineImage,
  NamedStyle,
  NodeKind,
  ParagraphAlignment,
  QueryTextStyle,
  TableCell,
} from "./types.ts";
export {
  alignmentAs,
  asAlignment,
  asContentAlignment,
  asNamedStyle,
  contentAlignmentAs,
  HEADING_STYLES,
  headingStyleIs,
  isHeadingStyle,
  NAMED_STYLES,
  namedStyleAs,
  STYLE_TO_LEVEL,
} from "./types.ts";

export type {
  DomMutation,
  DomWriterOpts,
  ElementSpec as WriteElementSpec,
  InsertPosition as WriteInsertPosition,
} from "./write.ts";
export {
  DomHandle,
  DomWriter,
  elementInsertAdjacent,
  innerTextSet,
  insertAdjacentElement,
  nodeRemove,
  remove,
  setInnerText,
} from "./write.ts";
