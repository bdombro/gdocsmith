/* Seeded differential fuzzing: random primitive edits on synthetic docs; every plan's emulator self-check must match the edited model (G3 M11). */

import { describe, expect, test } from "bun:test";
import {
  blockFind,
  blocksDelete,
  type EditTarget,
  paragraphSplice,
  paragraphStyleUpdate,
  paragraphsInsert,
  textStyleUpdate,
} from "../model/edit.ts";
import { bulletsSet, nestingSet } from "../model/editLists.ts";
import {
  cellsMerge,
  columnsInsert,
  pageBreakParagraphInsert,
  rowsDelete,
  rowsInsert,
  sectionBreakInsert,
  tableCreate,
} from "../model/editTables.ts";
import { CoreError } from "../model/errors.ts";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { listPresetTable } from "../model/lists.ts";
import { type BlockSpec, docJsonBuild, rngCreate } from "../model/testDocs.ts";
import type { Block, ParagraphBlock, TableBlock } from "../model/types.ts";
import { docPlanSelfCheck, docReconcile } from "./reconcile.ts";

const SEEDS = 2000;
/** Generous: 2,000 seeds run in under a second (20,000 in about 6 s). */
const FUZZ_TIMEOUT_MS = 60_000;
const WORDS = ["alpha", "beta", "gamma", "delta", "émoji😀", "x"];

/** A random synthetic document. */
function docSpec(rng: () => number): BlockSpec[] {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const blocks: BlockSpec[] = [];
  const count = 2 + Math.floor(rng() * 6);
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const text = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(WORDS)).join(" ");
    if (roll < 0.15)
      blocks.push({
        content: [text],
        headingId: `h.${i}`,
        kind: "paragraph",
        style: { namedStyleType: pick(["HEADING_1", "HEADING_2"]) },
      });
    else if (roll < 0.35) {
      const level = Math.floor(rng() * 2);
      blocks.push({
        bullet: { listId: "kix.p", nestingLevel: level },
        content: [text],
        kind: "paragraph",
        style: {
          indentFirstLine: { magnitude: 36 * (level + 1) - 18, unit: "PT" },
          indentStart: { magnitude: 36 * (level + 1), unit: "PT" },
        },
      });
    } else if (roll < 0.45 && blocks.at(-1)?.kind === "paragraph") {
      blocks.push({
        cells: [
          [[{ content: [pick(WORDS)] }], [{ content: [] }]],
          [[{ content: [pick(WORDS)] }], [{ content: [pick(WORDS)] }]],
        ],
        kind: "table",
      });
    } else if (roll < 0.6)
      blocks.push({ content: [{ style: { bold: true }, text }, " ", pick(WORDS)], kind: "paragraph" });
    else blocks.push({ content: [text], kind: "paragraph" });
  }
  blocks.push({ content: ["end"], kind: "paragraph" });
  return blocks;
}

/** Every paragraph key in the tab, body and cells. */
function paragraphKeys(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) =>
    b.kind === "paragraph"
      ? [b.key]
      : b.kind === "table"
        ? b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks.map((p) => p.key)))
        : [],
  );
}

/** One random edit (refusals are fine: they just don't change anything). */
function editRandom(t: EditTarget, rng: () => number, log: string[]): void {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const paragraphs = paragraphKeys(t.tab.blocks);
  const key = pick(paragraphs);
  const p = blockFind(t.tab, key)?.block as ParagraphBlock;
  const symbols = p.inlines.reduce((n, i) => n + (i.kind === "text" ? Array.from(i.text).length : 1), 0);
  const at = Math.floor(rng() * (symbols + 1));
  const tables = t.tab.blocks.filter((b): b is TableBlock => b.kind === "table");
  const op = Math.floor(rng() * 13);
  log.push(`op${op} ${key} at${at}`);
  try {
    switch (op) {
      case 0:
        paragraphSplice(t, key, at, Math.min(symbols - at, Math.floor(rng() * 4)), [{ ch: pick(WORDS) }]);
        break;
      case 1:
        if (symbols)
          textStyleUpdate(t, key, Math.min(at, symbols - 1), symbols, {
            bold: rng() < 0.5 ? true : null,
            italic: rng() < 0.3 ? true : null,
          });
        break;
      case 2:
        paragraphStyleUpdate(
          t,
          key,
          rng() < 0.5
            ? { namedStyleType: pick(["NORMAL_TEXT", "HEADING_1", "HEADING_3"]) }
            : { alignment: pick(["CENTER", "END", null]) },
        );
        break;
      case 3:
        paragraphsInsert(t, { kind: "body" }, Math.floor(rng() * (t.tab.blocks.length + 1)), [
          { syms: [{ ch: pick(WORDS) }] },
          ...(rng() < 0.3 ? [{ syms: [{ ch: pick(WORDS), style: { italic: true } }] }] : []),
        ]);
        break;
      case 4:
        if (t.tab.blocks.length > 2) blocksDelete(t, [pick(t.tab.blocks.slice(0, -1)).key]);
        break;
      case 5:
        bulletsSet(t, [key], rng() < 0.3 ? null : { kind: pick(["bullet", "number"] as const) });
        break;
      case 6:
        if (p.bullet) nestingSet(t, key, Math.floor(rng() * 3));
        break;
      case 7:
        tableCreate(t, Math.floor(rng() * (t.tab.blocks.length + 1)), { rows: [[[{ ch: pick(WORDS) }], []]] });
        break;
      case 8:
        if (tables.length) rowsInsert(t, pick(tables).key, Math.floor(rng() * 3), 1);
        break;
      case 9:
        if (tables.length)
          rng() < 0.5
            ? rowsDelete(t, pick(tables).key, [0])
            : columnsInsert(t, pick(tables).key, Math.floor(rng() * 3), 1);
        break;
      case 10:
        pageBreakParagraphInsert(t, Math.floor(rng() * t.tab.blocks.length));
        break;
      case 11:
        sectionBreakInsert(
          t,
          1 + Math.floor(rng() * (t.tab.blocks.length - 1)),
          rng() < 0.5 ? "CONTINUOUS" : "NEXT_PAGE",
        );
        break;
      case 12:
        if (tables.length) cellsMerge(t, pick(tables).key, { column: 0, columnSpan: 2, row: Math.floor(rng() * 2) });
        break;
    }
  } catch (err) {
    // The primitives refuse invalid arguments too (e.g. deleting every row); the session validates those first.
    if (!(err instanceof CoreError)) throw err;
    log.push(`  refused: ${err.code}`);
  }
}

describe("reconcile fuzz", () => {
  test(
    `${SEEDS} seeds × up to 8 random edits: every self-check matches`,
    () => {
      const failures: string[] = [];
      let unrealizable = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = rngCreate(seed);
        const json = docJsonBuild({
          tabs: [
            {
              blocks: docSpec(rng),
              lists: { "kix.p": { listProperties: { nestingLevels: listPresetTable().BULLET_DISC_CIRCLE_SQUARE } } },
            },
          ],
        });
        const keys = new KeyAllocator();
        const original = docModelParse(json, { docId: "d", keys });
        const final = structuredClone(original);
        const target: EditTarget = {
          ctx: { keys, stamp: { force: false, stepIndex: 0 }, tombstones: [] },
          tab: final.tabs[0],
        };
        const log: string[] = [];
        try {
          const edits = 1 + Math.floor(rng() * 8);
          for (let i = 0; i < edits; i++) editRandom(target, rng, log);
          const input = { final, original, originalJson: json };
          const check = docPlanSelfCheck(docReconcile(input), input);
          if (!check.equal)
            failures.push(`seed ${seed}: ${log.join("; ")}\n    ${check.diffs.slice(0, 4).join("\n    ")}`);
        } catch (err) {
          if (err instanceof CoreError && err.code === "unrealizableList") unrealizable++;
          else failures.push(`seed ${seed}: ${log.join("; ")}\n    threw ${(err as Error).message}`);
        }
      }
      if (failures.length)
        console.log(
          `${failures.length} failing seeds (${unrealizable} unrealizable):\n${failures.slice(0, 12).join("\n")}`,
        );
      expect(failures).toEqual([]);
    },
    FUZZ_TIMEOUT_MS,
  );
});
