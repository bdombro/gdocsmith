/* Execute compiled DOM writes via Docs batchUpdate (live path + error mapping). */

import { Gdoc } from "~/core/gdoc.ts";
import { type GwsClient, gws } from "~/core/gws.ts";
import { InlineMarkup } from "~/core/inline.ts";
import { RequestBuilder } from "~/core/requests.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { type CompiledDomWrite, compileDom } from "./applyCompile.ts";
import type { AppliedOpPlanPreview, PageSetup } from "./ops.ts";
import { pt } from "./style.ts";
import type { DomWriter } from "./write.ts";

/** Constructs an updateDocumentStyle batchUpdate request for page geometry and margins. */
export function documentStyleRequestBuilder(pageSetup: PageSetup, tabId?: string): object {
  const setup = pageSetup as PageSetup & { mode?: string; pageless?: boolean };
  if (setup.pageless !== undefined || setup.mode === "PAGELESS") {
    throw new Error(
      "Pageless mode cannot be set via API: Google Docs REST API does not support toggling pageless mode (web UI only).",
    );
  }
  const documentStyle: Record<string, unknown> = {};
  const fields: string[] = [];
  if (pageSetup.margins) {
    if (pageSetup.margins.top != null) {
      documentStyle.marginTop = pt(pageSetup.margins.top);
      fields.push("marginTop");
    }
    if (pageSetup.margins.bottom != null) {
      documentStyle.marginBottom = pt(pageSetup.margins.bottom);
      fields.push("marginBottom");
    }
    if (pageSetup.margins.left != null) {
      documentStyle.marginLeft = pt(pageSetup.margins.left);
      fields.push("marginLeft");
    }
    if (pageSetup.margins.right != null) {
      documentStyle.marginRight = pt(pageSetup.margins.right);
      fields.push("marginRight");
    }
  }
  if (pageSetup.orientation || pageSetup.pageSize || pageSetup.pageWidth != null || pageSetup.pageHeight != null) {
    let w = pageSetup.pageWidth ?? (pageSetup.orientation === "LANDSCAPE" ? 792 : 612);
    let h = pageSetup.pageHeight ?? (pageSetup.orientation === "LANDSCAPE" ? 612 : 792);
    if (pageSetup.pageSize === "LEGAL") {
      w = pageSetup.orientation === "LANDSCAPE" ? 1008 : 612;
      h = pageSetup.orientation === "LANDSCAPE" ? 612 : 1008;
    } else if (pageSetup.pageSize === "TABLOID") {
      w = pageSetup.orientation === "LANDSCAPE" ? 1224 : 792;
      h = pageSetup.orientation === "LANDSCAPE" ? 792 : 1224;
    } else if (pageSetup.pageSize === "A4") {
      w = pageSetup.orientation === "LANDSCAPE" ? 841.89 : 595.28;
      h = pageSetup.orientation === "LANDSCAPE" ? 595.28 : 841.89;
    }
    documentStyle.pageSize = {
      height: pt(h),
      width: pt(w),
    };
    fields.push("pageSize");
  }
  return RequestBuilder.updateDocumentStyle({
    documentStyle,
    fields: fields.join(","),
    tabId,
  });
}

/** Constructs an updateDocumentStyle batchUpdate request (alias for documentStyleRequestBuilder). */
export const buildDocumentStyleRequest = documentStyleRequestBuilder;

/** Sends compiled requests via GwsClient. Accepts one writer or several (body + segments). */
export async function domApply(
  documentId: string,
  writer: DomWriter | DomWriter[],
  opts: {
    client?: GwsClient;
    doc?: GoogleDoc;
    dryRun?: boolean;
    force?: boolean;
    pageSetup?: PageSetup;
    plan?: AppliedOpPlanPreview[];
  } = {},
): Promise<CompiledDomWrite> {
  const client = opts.client ?? gws;
  const writers = Array.isArray(writer) ? writer : [writer];
  const compiled = mergeCompiled(
    writers.map((w) => compileDom(w, { force: opts.force, lists: opts.doc?.lists ?? w.lists })),
  );
  if (opts.pageSetup) {
    const styleReq = buildDocumentStyleRequest(opts.pageSetup, writers[0]?.tabId);
    compiled.requests.unshift(styleReq);
    compiled.requestOrigins.unshift({ mutationIndexes: [] });
    compiled.summary.requestCount = compiled.requests.length;
  }
  if (opts.dryRun || !compiled.requests.length) return compiled;

  try {
    await client.batchUpdate(documentId, compiled.requests);
  } catch (err) {
    throw wrapBatchUpdateError(err, {
      batch: "main",
      origins: compiled.requestOrigins,
      plan: opts.plan,
    });
  }

  for (const table of compiled.tableInserts) {
    try {
      const data = await client.getDocument(documentId);
      const gdoc = table.tabId ? new Gdoc(data, documentId).withTab(table.tabId) : new Gdoc(data, documentId);
      const tableEl = gdoc.findInsertedTableAt(table.insertIndex) ?? gdoc.findTableAt(table.insertIndex);
      if (!tableEl?.table) continue;
      const fill = RequestBuilder.buildTableFill(
        table.rows.length > 1,
        table.rows,
        tableEl,
        table.segmentId,
        table.tabId,
      );
      if (fill.length) {
        await client.batchUpdate(documentId, fill);
      }
    } catch (err) {
      throw wrapBatchUpdateError(err, { batch: "table-fill", plan: opts.plan });
    }
  }

  if (compiled.rowFills && compiled.rowFills.length > 0) {
    try {
      const data = await client.getDocument(documentId);
      const rowFillReqs: object[] = [];
      for (const fill of compiled.rowFills) {
        const gdoc = fill.tabId ? new Gdoc(data, documentId).withTab(fill.tabId) : new Gdoc(data, documentId);
        const tableEl = gdoc.findTableAt(fill.tableStart);
        if (!tableEl?.table?.tableRows) continue;
        const targetRowIdx = fill.insertBelow ? fill.rowIndex + 1 : fill.rowIndex;
        const row = tableEl.table.tableRows[targetRowIdx];
        if (!row?.tableCells) continue;
        const cellsToFill: Array<{ idx: number; text: string }> = [];
        for (let c = 0; c < fill.cells.length; c++) {
          const text = fill.cells[c];
          if (!text) continue;
          const cell = row.tableCells[c];
          if (!cell) continue;
          const idx = RequestBuilder.cellInsertIndex(cell);
          cellsToFill.push({ idx, text });
        }
        cellsToFill.sort((a, b) => b.idx - a.idx);
        for (const item of cellsToFill) {
          const { runs, text: plain } = InlineMarkup.parse(item.text);
          const line = plain.endsWith("\n") ? plain : `${plain}\n`;
          rowFillReqs.push({
            insertText: {
              location: {
                index: item.idx,
                ...(fill.segmentId ? { segmentId: fill.segmentId } : {}),
                ...(fill.tabId ? { tabId: fill.tabId } : {}),
              },
              text: line,
            },
          });
          const textEnd = item.idx + Math.max(0, line.length - (line.endsWith("\n") ? 1 : 0));
          if (textEnd > item.idx) {
            rowFillReqs.push(RequestBuilder.clearInlineStyles(item.idx, textEnd, fill.segmentId, fill.tabId));
          }
          rowFillReqs.push(...RequestBuilder.textStyleRequests(item.idx, runs, fill.segmentId, fill.tabId));
        }
      }
      if (rowFillReqs.length > 0) {
        await client.batchUpdate(documentId, rowFillReqs);
      }
    } catch (err) {
      throw wrapBatchUpdateError(err, { batch: "table-fill", plan: opts.plan });
    }
  }

  return compiled;
}

/** Sends compiled requests via GwsClient (alias for domApply). */
export const applyDom = domApply;

/** Combines multiple compiled DOM write results into a unified write payload. */
function mergeCompiled(parts: CompiledDomWrite[]): CompiledDomWrite {
  const out: CompiledDomWrite = {
    requestOrigins: [],
    requests: [],
    summary: { deleteChars: 0, insertChars: 0, requestCount: 0, tables: 0 },
    tableInserts: [],
  };
  for (const part of parts) {
    out.requests.push(...part.requests);
    out.requestOrigins.push(...part.requestOrigins);
    out.tableInserts.push(...part.tableInserts);
    if (part.rowFills) {
      out.rowFills = [...(out.rowFills ?? []), ...part.rowFills];
    }
    out.summary.deleteChars += part.summary.deleteChars;
    out.summary.insertChars += part.summary.insertChars;
    out.summary.tables += part.summary.tables;
  }
  out.summary.requestCount = out.requests.length;
  return out;
}

/**
 * Maps a Docs `requests[n]` API error back to mutation/op indexes.
 * A single batchUpdate is atomic; table fills are a second call.
 */
export function batchUpdateErrorWrap(
  err: unknown,
  opts: {
    batch: "main" | "table-fill";
    origins?: Array<{ mutationIndexes: number[] }>;
    plan?: AppliedOpPlanPreview[];
  },
): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (opts.batch === "table-fill") {
    return new Error(
      `${raw}\nFailed during table cell fill (second batchUpdate). The table may already exist from the first call. Restore the pinned revision if the Doc looks half-written.`,
    );
  }
  const idx = parseGoogleRequestIndex(raw);
  const origin = idx != null && opts.origins ? opts.origins[idx] : undefined;
  const ops = origin?.mutationIndexes ?? [];
  const labels = ops.map((i) => {
    const p = opts.plan?.find((op) => op.index === i);
    if (!p) return `ops[${i}]`;
    const preview = p.target.text ?? p.target.namedStyleType ?? "";
    return `ops[${i}] ${p.action} #${p.target.id}${preview ? ` ${JSON.stringify(preview)}` : ""}`;
  });
  const where = idx != null ? `API requests[${idx}]${labels.length ? ` ← ${labels.join("; ")}` : ""}. ` : "";
  return new Error(`${where}${raw}\nThat batchUpdate is atomic — none of its requests applied.`);
}

/** Maps a Docs requests API error back to mutation/op indexes (alias for batchUpdateErrorWrap). */
export const wrapBatchUpdateError = batchUpdateErrorWrap;

/** Parses `requests[12]` from a Docs/gws error string. */
export function googleRequestIndexParse(message: string): number | undefined {
  const m = /\brequests\[(\d+)\]/.exec(message);
  if (!m) return undefined;
  return Number(m[1]);
}

/** Parses requests[12] from a Docs/gws error string (alias for googleRequestIndexParse). */
export const parseGoogleRequestIndex = googleRequestIndexParse;
