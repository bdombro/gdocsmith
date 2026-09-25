/* Handlers for content steps: write, edit, remove, style, table (G4 D5, M3). */

import { readFileSync } from "node:fs";
import { CoreError } from "~/core/model/errors.ts";
import type { JsonObject } from "~/core/model/rawJson.ts";
import { colorOptionalFromHex } from "~/core/model/styleValues.ts";
import {
  docRefResolve,
  placementResolve,
  rangeRefResolve,
  type StepContext,
  StepError,
  stepErrorCreate,
  tabResolve,
} from "./context.ts";
import type { StepEdit, StepRemove, StepStyle, StepTable, StepWrite } from "./types.ts";

/** Outcome of applying one step. */
export interface StepOutcome {
  /** IDs and kinds of newly created elements. */
  created?: Array<{ id: string; kind: string; text: string }>;
  /** Structured output payload (e.g. queries, share list). */
  data?: unknown;
  /** Paths of files written to disk (e.g. saveTo or spilled results). */
  files?: string[];
  /** Document outline returned alongside markdown queries or saveTo. */
  outline?: unknown;
  /** Count of text replacements made. */
  replaced?: number;
}

/** Executes a `write` step: inserts, appends, or diff-replaces markdown or copied content. */
export async function writeStepApply(ctx: StepContext, step: StepWrite): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);
    const tab = tabResolve(ctx, doc, step.tab, step.replace ?? step.after ?? step.before);
    const placement = placementResolve(ctx, tab, step);

    if (step.from !== undefined) {
      const srcDoc = await docRefResolve(ctx, step.from.doc ?? step.doc);
      const srcAnchor = step.from.section
        ? { section: step.from.section }
        : step.from.node
          ? { node: step.from.node }
          : { body: true as const };
      const srcTab = tabResolve(ctx, srcDoc, step.from.tab, srcAnchor);
      const srcRange = rangeRefResolve(ctx, srcTab, srcAnchor, Boolean(step.from.bodyOnly));
      const res = await tab.copyFrom({ range: srcRange, tab: srcTab }, placement, { force: step.force });
      if (!res.changed) {
        throw stepErrorCreate(
          ctx,
          "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
        );
      }
      return {
        created: res.createdKeys.map((k) => ({ id: `new:${k}`, kind: "block", text: "" })),
      };
    }

    const markdown = step.markdown !== undefined ? step.markdown : readFileSync(step.markdownFile as string, "utf8");

    const res = await tab.writeMarkdown(markdown, placement);
    if (!res.changed) {
      throw stepErrorCreate(
        ctx,
        "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
      );
    }
    return {
      created: res.createdKeys.map((k) => ({ id: `new:${k}`, kind: "block", text: "" })),
    };
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes an `edit` step: plain find-and-replace across one or all tabs. */
export async function editStepApply(ctx: StepContext, step: StepEdit): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);
    const tabsToEdit = step.tab !== undefined ? [doc.tab(step.tab)] : doc.tabs().map((t) => doc.tab(t.tabId));

    let totalCount = 0;
    let anyChanged = false;

    for (const tab of tabsToEdit) {
      const range = step.at ? rangeRefResolve(ctx, tab, step.at) : undefined;
      const res = tab.editText(step.find, step.replace, {
        matchCase: step.matchCase ?? true,
        range,
      });
      totalCount += res.count;
      anyChanged = anyChanged || res.changed;
    }

    if (totalCount === 0) {
      const caseNote = step.matchCase === false ? "case-insensitive" : "exact, case-sensitive unless matchCase: false";
      throw stepErrorCreate(ctx, `"${step.find}" matched nothing (${caseNote})`);
    }

    if (step.expectCount !== undefined && totalCount !== step.expectCount) {
      throw stepErrorCreate(ctx, `found ${totalCount} matches, expected ${step.expectCount}`);
    }

    if (!anyChanged) {
      throw stepErrorCreate(
        ctx,
        "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
      );
    }

    return { replaced: totalCount };
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes a `remove` step: deletes a node, section, or tab body. */
export async function removeStepApply(ctx: StepContext, step: StepRemove): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);
    const tab = tabResolve(ctx, doc, step.tab, step.at);
    const range = rangeRefResolve(ctx, tab, step.at);
    const res = tab.remove(range);
    if (!res.changed) {
      throw stepErrorCreate(
        ctx,
        "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
      );
    }
    return {};
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes a `style` step: applies paragraph or text styles over a range. */
export async function styleStepApply(ctx: StepContext, step: StepStyle): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);
    const tab = tabResolve(ctx, doc, step.tab, step.at);
    const range = rangeRefResolve(ctx, tab, step.at);
    let anyChanged = false;

    if (step.paragraph) {
      if (step.paragraph.bullet !== undefined) {
        if (step.paragraph.bullet === null) {
          const res = tab.bulletsSet(range, null);
          anyChanged = anyChanged || res.changed;
        } else {
          const preset = step.paragraph.bullet;
          const kind: "bullet" | "check" | "number" =
            preset === "BULLET_CHECKBOX" ? "check" : preset.startsWith("NUMBERED_") ? "number" : "bullet";
          const res = tab.bulletsSet(range, { kind, preset });
          anyChanged = anyChanged || res.changed;
        }
      }

      const patch: JsonObject = {};
      if (step.paragraph.alignment !== undefined) patch.alignment = step.paragraph.alignment;
      if (step.paragraph.namedStyle !== undefined) patch.namedStyleType = step.paragraph.namedStyle;
      if (step.paragraph.lineSpacing !== undefined) patch.lineSpacing = step.paragraph.lineSpacing;
      if (step.paragraph.indentStart !== undefined) {
        patch.indentStart =
          step.paragraph.indentStart !== null ? { magnitude: step.paragraph.indentStart, unit: "PT" } : null;
      }
      if (step.paragraph.indentEnd !== undefined) {
        patch.indentEnd =
          step.paragraph.indentEnd !== null ? { magnitude: step.paragraph.indentEnd, unit: "PT" } : null;
      }
      if (step.paragraph.indentFirstLine !== undefined) {
        patch.indentFirstLine =
          step.paragraph.indentFirstLine !== null ? { magnitude: step.paragraph.indentFirstLine, unit: "PT" } : null;
      }
      if (step.paragraph.spaceAbove !== undefined) {
        patch.spaceAbove =
          step.paragraph.spaceAbove !== null ? { magnitude: step.paragraph.spaceAbove, unit: "PT" } : null;
      }
      if (step.paragraph.spaceBelow !== undefined) {
        patch.spaceBelow =
          step.paragraph.spaceBelow !== null ? { magnitude: step.paragraph.spaceBelow, unit: "PT" } : null;
      }
      if (step.paragraph.shading !== undefined) {
        patch.shading =
          step.paragraph.shading !== null ? { backgroundColor: colorOptionalFromHex(step.paragraph.shading) } : null;
      }

      if (Object.keys(patch).length > 0) {
        const res = tab.paragraphStyleSet(range, patch);
        anyChanged = anyChanged || res.changed;
      }
    }

    if (step.text) {
      const patch: JsonObject = {};
      if (step.text.bold !== undefined) patch.bold = step.text.bold;
      if (step.text.italic !== undefined) patch.italic = step.text.italic;
      if (step.text.underline !== undefined) patch.underline = step.text.underline;
      if (step.text.strikethrough !== undefined) patch.strikethrough = step.text.strikethrough;
      if (step.text.fontSize !== undefined) {
        patch.fontSize = step.text.fontSize !== null ? { magnitude: step.text.fontSize, unit: "PT" } : null;
      }
      if (step.text.foregroundColor !== undefined) {
        patch.foregroundColor =
          step.text.foregroundColor !== null ? colorOptionalFromHex(step.text.foregroundColor) : null;
      }
      if (step.text.backgroundColor !== undefined) {
        patch.backgroundColor =
          step.text.backgroundColor !== null ? colorOptionalFromHex(step.text.backgroundColor) : null;
      }
      if (step.text.link !== undefined) {
        patch.link = step.text.link !== null ? { url: step.text.link } : null;
      }
      if (step.text.fontFamily !== undefined) {
        patch.weightedFontFamily = step.text.fontFamily !== null ? { fontFamily: step.text.fontFamily } : null;
      }

      let wherePatch: JsonObject | undefined;
      if (step.where) {
        wherePatch = {};
        if (step.where.bold !== undefined) wherePatch.bold = step.where.bold;
        if (step.where.italic !== undefined) wherePatch.italic = step.where.italic;
        if (step.where.underline !== undefined) wherePatch.underline = step.where.underline;
        if (step.where.strikethrough !== undefined) wherePatch.strikethrough = step.where.strikethrough;
        if (step.where.fontSize !== undefined) wherePatch.fontSize = { magnitude: step.where.fontSize, unit: "PT" };
        if (step.where.foregroundColor !== undefined)
          wherePatch.foregroundColor = colorOptionalFromHex(step.where.foregroundColor);
        if (step.where.backgroundColor !== undefined)
          wherePatch.backgroundColor = colorOptionalFromHex(step.where.backgroundColor);
        if (step.where.fontFamily !== undefined) wherePatch.weightedFontFamily = { fontFamily: step.where.fontFamily };
      }

      const res = tab.textStyleSet(range, patch, { where: wherePatch });
      anyChanged = anyChanged || res.changed;
    }

    if (!anyChanged) {
      throw stepErrorCreate(
        ctx,
        "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
      );
    }

    return {};
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}

/** Executes a `table` step: modifies structure, column widths, or cell styles. */
export async function tableStepApply(ctx: StepContext, step: StepTable): Promise<StepOutcome> {
  try {
    const doc = await docRefResolve(ctx, step.doc);
    const tab = tabResolve(ctx, doc, step.tab, step.at);

    let tableAnchor: string;
    let cellRow: number | undefined;
    let cellCol: number | undefined;

    if (step.at.node !== undefined) {
      if (step.at.node.includes("/")) {
        const parts = step.at.node.split("/");
        tableAnchor = parts[0];
        const [r, c] = parts[1].split(".").map(Number);
        cellRow = r;
        cellCol = c;
      } else {
        tableAnchor = step.at.node;
      }
    } else if (step.at.section !== undefined) {
      const sectionRange = {
        heading: step.at.section,
        includeHeading: true,
        kind: "section" as const,
      };
      const sectionNodes = tab.nodes({ range: sectionRange });
      const tables = sectionNodes.filter((n) => n.kind === "table");
      if (tables.length === 0) {
        throw stepErrorCreate(ctx, `no table found in section "${step.at.section}"`);
      }
      if (tables.length > 1) {
        const ids = tables.map((t) => t.anchor).join(", ");
        throw stepErrorCreate(
          ctx,
          `section "${step.at.section}" has multiple tables (${ids}); target by table node ID`,
        );
      }
      tableAnchor = tables[0].anchor;
    } else {
      throw stepErrorCreate(ctx, "at.body is not a table target");
    }

    const tableNode = tab.nodes().find((n) => n.anchor === tableAnchor);
    const totalRows = tableNode?.table?.rows ?? 0;
    const totalCols = tableNode?.table?.cols ?? 0;
    const table = tab.table(tableAnchor);
    let changed = false;

    switch (step.action) {
      case "insertRow": {
        const refRow = step.row ?? cellRow;
        let atIndex: number;
        if (refRow === undefined) {
          atIndex = totalRows;
        } else if (step.position === "above") {
          atIndex = refRow;
        } else {
          atIndex = refRow + 1;
        }
        const res = table.rowsInsert(atIndex, 1, step.cells ? [step.cells] : undefined);
        changed = res.changed;
        break;
      }
      case "insertColumn": {
        const refCol = step.column ?? cellCol;
        let atIndex: number;
        if (refCol === undefined) {
          atIndex = totalCols;
        } else if (step.position === "left") {
          atIndex = refCol;
        } else {
          atIndex = refCol + 1;
        }
        const res = table.columnsInsert(atIndex, 1);
        changed = res.changed;
        if (step.cells) {
          for (let r = 0; r < step.cells.length; r++) {
            const cellAnchor = `${tableAnchor}/${r}.${atIndex}`;
            await tab.writeMarkdown(step.cells[r], {
              kind: "replace",
              range: { anchor: cellAnchor, kind: "cell" },
            });
          }
        }
        break;
      }
      case "deleteRow": {
        const row = step.row ?? cellRow!;
        const res = table.rowsDelete([row]);
        changed = res.changed;
        break;
      }
      case "deleteColumn": {
        const col = step.column ?? cellCol!;
        const res = table.columnsDelete([col]);
        changed = res.changed;
        break;
      }
      case "merge": {
        const row = step.row ?? cellRow!;
        const col = step.column ?? cellCol!;
        const res = table.cellsMerge({
          column: col,
          columnSpan: step.columnSpan ?? 1,
          row,
          rowSpan: step.rowSpan ?? 1,
        });
        changed = res.changed;
        break;
      }
      case "unmerge": {
        const row = step.row ?? cellRow!;
        const col = step.column ?? cellCol!;
        const res = table.cellsUnmerge({
          column: col,
          columnSpan: step.columnSpan ?? 1,
          row,
          rowSpan: step.rowSpan ?? 1,
        });
        changed = res.changed;
        break;
      }
      case "widths": {
        const res = table.columnWidthsSet(step.widths!.map((w, col) => ({ col, widthPt: w })));
        changed = res.changed;
        break;
      }
      case "style": {
        if (step.style?.pinnedHeaderRows !== undefined) {
          const pRes = table.headerRowsPin(step.style.pinnedHeaderRows);
          changed = changed || pRes.changed;
        }
        const row = step.row ?? cellRow;
        const col = step.column ?? cellCol;
        const patch: JsonObject = {};
        if (step.style?.background !== undefined) {
          patch.backgroundColor = step.style.background !== null ? colorOptionalFromHex(step.style.background) : {};
        }
        if (step.style?.padding !== undefined) {
          const pad = { magnitude: step.style.padding, unit: "PT" };
          patch.paddingBottom = pad;
          patch.paddingLeft = pad;
          patch.paddingRight = pad;
          patch.paddingTop = pad;
        }
        if (step.style?.verticalAlign !== undefined) {
          patch.contentAlignment = step.style.verticalAlign;
        }
        if (step.style?.minRowHeight !== undefined) {
          const rPatch = { minRowHeight: { magnitude: step.style.minRowHeight, unit: "PT" } };
          const rRes = table.rowStyleSet(row !== undefined ? [row] : [0], rPatch);
          changed = changed || rRes.changed;
        }
        if (Object.keys(patch).length > 0) {
          const cellRange = {
            column: col ?? 0,
            columnSpan: step.columnSpan ?? (col !== undefined ? 1 : totalCols),
            row: row ?? 0,
            rowSpan: step.rowSpan ?? (row !== undefined ? 1 : totalRows),
          };
          const cRes = table.cellStyleSet(cellRange, patch);
          changed = changed || cRes.changed;
        }
        break;
      }
    }

    if (!changed) {
      throw stepErrorCreate(
        ctx,
        "changed nothing (content already matches, or the anchor resolved elsewhere). Nothing was sent.",
      );
    }

    return {};
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof CoreError) throw stepErrorCreate(ctx, err.message);
    throw stepErrorCreate(ctx, (err as Error).message);
  }
}
