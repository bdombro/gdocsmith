/*

Public exports for the document tape + DOM query layer.

*/

export type { CompiledDomWrite, ListIndent } from "./apply.ts";
export {
  applyDom,
  compileDom,
  LAST_PARAGRAPH_MSG,
  parseGoogleRequestIndex,
  resolveNestingIndent,
  resolveNestingStyle,
  STOCK_NESTING_HANGING_PT,
  STOCK_NESTING_INDENT_PT,
  wrapBatchUpdateError,
} from "./apply.ts";
export { computeCellChecksum, computeNodeChecksum } from "./checksum.ts";
export type {
  CloneNodeRef,
  CloneResolutionContext,
} from "./clone.ts";
export {
  nodeToElementSpec,
  resolveCloneNodeOps,
  resolveIntraDocCloneNode,
} from "./clone.ts";
export type { UnifiedDiffOptions } from "./diff.ts";
export { formatUnifiedDiff } from "./diff.ts";
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
export { asBulletPreset, BULLET_GLYPH_PRESETS, createCodeBlock, createElement } from "./element.ts";
export type {
  ExportAuditSummary,
  ExportMarkdownResult,
  ExportTabInput,
} from "./export.ts";
export {
  auditDocNodes,
  exportDocumentToMarkdown,
  exportTabToMarkdown,
} from "./export.ts";
export {
  assertWritable,
  CHIP_MUTATE_MSG,
  DOUBLE_NUMBER_MSG,
  EMPTY_BULLET_MSG,
  EXISTING_NEST_MSG,
  FAKE_BULLET_MSG,
  HEADING_BULLET_MSG,
  hasChips,
} from "./guards.ts";
export type {
  AppliedOpPlan,
  CellSummary,
  DomOp,
  DomOpFile,
  LiveDump,
  LiveDumpTab,
  NodeSummary,
  PageSetup,
  ParsedDomFile,
  TabDomOp,
} from "./ops.ts";
export {
  applyOps,
  assertDomDocument,
  CELL_FIELD_MSG,
  cellId,
  elementFromJson,
  executeDangerousClear,
  extractPageSetup,
  formatUnrecoverableWarning,
  liveDump,
  parseDomOps,
  parseWriteAt,
  resolveTarget,
  summarizeNode,
  TABLE_INSERT_MIX_MSG,
  TAPE_ECHO_CAP,
  WRITE_AT_ONLY_MSG,
  wrongDocumentMsg,
  wrongTabMsg,
} from "./ops.ts";
export type { ParsedDocument, ParsedTape } from "./parse.ts";
export { parseDocument, parseTape } from "./parse.ts";
export type { FindHeadingTextOptions, FindNodeTextOptions } from "./query.ts";
export {
  DocDom,
  findHeadingsByText,
  findNodeAt,
  findNodesByText,
  formatFollowingSiblings,
  missingNodeIdMsg,
  neighborhoodFrom,
  nextElementSibling,
  previousElementSibling,
  queryFrom,
  querySelector,
  querySelectorAll,
} from "./query.ts";
export type { StylePatch } from "./style.ts";
export {
  hangingFirstLine,
  hasIndent,
  hasStyle,
  hasTableChrome,
  hexColor,
  isMonospaceFont,
  rgbColor,
  uniformQueryTextStyle,
} from "./style.ts";
export type {
  CellContentAlignment,
  CellParagraph,
  DocNode,
  DocSegment,
  DocSegmentKind,
  DocSegmentUse,
  InlineImage,
  NamedStyle,
  NodeKind,
  ParagraphAlignment,
  QueryTextStyle,
  TableCell,
} from "./types.ts";
export {
  asAlignment,
  asContentAlignment,
  asNamedStyle,
  HEADING_STYLES,
  isHeadingStyle,
  NAMED_STYLES,
  STYLE_TO_LEVEL,
} from "./types.ts";
export type { DomMutation, DomWriterOpts } from "./write.ts";
export {
  DomHandle,
  DomWriter,
  insertAdjacentElement,
  remove,
  setInnerText,
} from "./write.ts";
export type {
  ExportYamlResult,
  YamlCodeBlockSpec,
  YamlNodeSpec,
  YamlPageBreakSpec,
  YamlParagraphSpec,
  YamlTableSpec,
  YamlTabTreePayload,
  YamlTreePayload,
} from "./yaml.ts";
export {
  exportDocumentToYaml,
  exportTabToYaml,
  nodeToYamlSpec,
  parseYamlTree,
} from "./yaml.ts";
