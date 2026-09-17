/* Compile DomWriter mutations to Docs batchUpdate requests and apply them. */

export {
  applyDom,
  batchUpdateErrorWrap,
  buildDocumentStyleRequest,
  documentStyleRequestBuilder,
  domApply,
  googleRequestIndexParse,
  parseGoogleRequestIndex,
  wrapBatchUpdateError,
} from "./applyBatch.ts";
export type { CompiledDomWrite, ListIndent } from "./applyCompile.ts";
export {
  compileDom,
  domCompile,
  LAST_PARAGRAPH_MSG,
  nestingIndentResolve,
  nestingStyleResolve,
  resolveNestingIndent,
  resolveNestingStyle,
  STOCK_NESTING_HANGING_PT,
  STOCK_NESTING_INDENT_PT,
} from "./applyCompile.ts";
