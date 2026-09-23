/* Pins the no-op check exemption lists to measured DomWriter behavior so they cannot silently drift. */

import { describe, expect, test } from "bun:test";
import { applyOps, summarizeNode } from "~/core/dom/ops.ts";
import type { DocNode } from "~/core/dom/types.ts";
import { DomWriter } from "~/core/dom/write.ts";
import { STYLE_PROPS_INVISIBLE, TAPE_INVISIBLE_KEYS } from "./surgicalMutation.ts";

/** Fixture tape: a heading, a paragraph, and a 2x2 table. */
const tapeFixture = (): DocNode[] => [
  { end: 9, kind: "paragraph", namedStyleType: "HEADING_1", start: 1, tapeIndex: 5, text: "Overview" },
  { end: 40, kind: "paragraph", namedStyleType: "NORMAL_TEXT", start: 21, tapeIndex: 20, text: "Hello world" },
  {
    end: 24,
    kind: "table",
    start: 10,
    table: {
      cells: [
        [
          { end: 12, start: 10, text: "a" },
          { end: 16, start: 12, text: "b" },
        ],
        [
          { end: 20, start: 16, text: "c" },
          { end: 24, start: 20, text: "d" },
        ],
      ],
    },
    tapeIndex: 30,
  },
];

/** Applies one op and reports whether the targeted node's full summary changed. */
function tapeReflects(at: number, op: Record<string, unknown>): boolean {
  const writer = new DomWriter(tapeFixture());
  const index = writer.nodes.findIndex((n) => n.tapeIndex === at);
  const read = () => JSON.stringify(summarizeNode(writer.nodes[index]!, { full: true }));
  const before = read();
  applyOps(writer, [{ at, ...op } as never]);
  return read() !== before;
}

/** Ops that can be applied on their own, paired with the node they target. */
const STANDALONE_OPS: Array<{ at: number; key: string; op: Record<string, unknown> }> = [
  { at: 20, key: "alignment", op: { alignment: "CENTER" } },
  { at: 20, key: "bullet", op: { bullet: { nestingLevel: 0, preset: "BULLET_DISC_CIRCLE_SQUARE", type: "BULLET" } } },
  { at: 30, key: "deleteTableColumn", op: { deleteTableColumn: 1 } },
  { at: 30, key: "deleteTableRow", op: { deleteTableRow: 1 } },
  { at: 30, key: "duplicateTableRow", op: { duplicateTableRow: 1 } },
  { at: 30, key: "insertTableColumn", op: { insertTableColumn: 1 } },
  { at: 30, key: "insertTableRow", op: { insertTableRow: 1 } },
  { at: 20, key: "namedStyleType", op: { namedStyleType: "HEADING_3" } },
  { at: 20, key: "style", op: { style: { bold: true } } },
  { at: 30, key: "tableStyle", op: { tableStyle: { borderColor: "#ff0000" } } },
];

describe("tapeInvisibleKeysMatchReality", () => {
  for (const { at, key, op } of STANDALONE_OPS) {
    test(`${key} exemption matches whether it reaches the tape`, () => {
      // Exempt exactly the keys the tape cannot see. Exempting a visible key needlessly weakens the
      // no-op check; failing to exempt an invisible one falsely rejects a real edit.
      expect(TAPE_INVISIBLE_KEYS.has(key)).toBe(!tapeReflects(at, op));
    });
  }

  test("runs stays exempt: it rides along with content and still never reaches the tape", () => {
    expect(tapeReflects(20, { replace: "Hello world", runs: [{ bold: true, end: 5, start: 0 }] })).toBe(false);
    expect(TAPE_INVISIBLE_KEYS.has("runs")).toBe(true);
  });
});

/** Every `StylePatch` property, with a sample value and the fixture node it applies to. */
const STYLE_PROPS: Array<{ at: number; prop: string; value: unknown }> = [
  { at: 20, prop: "alignment", value: "CENTER" },
  { at: 20, prop: "backgroundColor", value: "#ffff00" },
  { at: 20, prop: "bold", value: true },
  { at: 20, prop: "fontFamily", value: "Courier New" },
  { at: 20, prop: "fontSize", value: 18 },
  { at: 20, prop: "foregroundColor", value: "#ff0000" },
  { at: 20, prop: "indentEnd", value: 9 },
  { at: 20, prop: "indentFirstLine", value: 0 },
  { at: 20, prop: "indentStart", value: 18 },
  { at: 20, prop: "italic", value: true },
  { at: 20, prop: "lineSpacing", value: 150 },
  { at: 20, prop: "shading", value: "#eeeeee" },
  { at: 20, prop: "spaceAbove", value: 6 },
  { at: 20, prop: "spaceBelow", value: 6 },
  { at: 20, prop: "strikethrough", value: true },
  { at: 20, prop: "underline", value: true },
  { at: 30, prop: "borderColor", value: "#ff0000" },
  { at: 30, prop: "borderWidth", value: 2 },
  { at: 30, prop: "cellBackground", value: "#eeeeee" },
  { at: 30, prop: "cellPadding", value: 4 },
  { at: 30, prop: "columnWidth", value: 100 },
  { at: 30, prop: "contentAlignment", value: "MIDDLE" },
  { at: 30, prop: "minRowHeight", value: 20 },
  { at: 30, prop: "pinnedHeaderRows", value: 1 },
  { at: 30, prop: "preventOverflow", value: true },
];

describe("styleInvisiblePropsMatchReality", () => {
  for (const { at, prop, value } of STYLE_PROPS) {
    test(`style.${prop} exemption matches whether it reaches the tape`, () => {
      expect(STYLE_PROPS_INVISIBLE.has(prop)).toBe(!tapeReflects(at, { style: { [prop]: value } }));
    });
  }

  test("mirrored run chrome follows the parser's rules for defaults", () => {
    const writer = new DomWriter(tapeFixture());
    applyOps(writer, [{ at: 20, style: { bold: true, fontSize: 18, underline: true } }] as never);
    expect(summarizeNode(writer.nodes[1]!, { full: true }).style).toEqual({
      bold: true,
      fontSize: 18,
      underline: true,
    });

    // The parser records neither a false flag nor the default size, so neither is mirrored.
    applyOps(writer, [{ at: 20, style: { bold: false, fontSize: 11, underline: false } }] as never);
    expect(summarizeNode(writer.nodes[1]!, { full: true }).style).toBeUndefined();
  });

  test("cellBackground on a table node fills every cell", () => {
    const writer = new DomWriter(tapeFixture());
    applyOps(writer, [{ at: 30, style: { cellBackground: "#eeeeee" } }] as never);
    const cells = summarizeNode(writer.nodes[2]!, { full: true }).table?.cells;
    expect(cells?.flat().map((c) => c.backgroundColor)).toEqual(["#eeeeee", "#eeeeee", "#eeeeee", "#eeeeee"]);
  });
});

describe("mirrored ops are visible to later steps in the same batch", () => {
  test("a bullet restyle is readable after it is applied", () => {
    const writer = new DomWriter(tapeFixture());
    applyOps(writer, [
      { at: 20, bullet: { nestingLevel: 0, preset: "NUMBERED_DECIMAL_ALPHA_ROMAN", type: "NUMBERED" } },
    ] as never);
    expect(summarizeNode(writer.nodes[1]!, { full: true }).bullet).toEqual({
      nestingLevel: 0,
      preset: "NUMBERED_DECIMAL_ALPHA_ROMAN",
      type: "NUMBERED",
    });
  });

  test("grid ops resize the table a later step reads", () => {
    const writer = new DomWriter(tapeFixture());
    const table = () => summarizeNode(writer.nodes[2]!, { full: true }).table;
    expect(table()).toMatchObject({ cols: 2, rows: 2 });

    applyOps(writer, [{ at: 30, insertTableRow: { insertBelow: true, row: 0 } }] as never);
    expect(table()).toMatchObject({ cols: 2, rows: 3 });

    applyOps(writer, [{ at: 30, insertTableColumn: { col: 0, insertRight: true } }] as never);
    expect(table()).toMatchObject({ cols: 3, rows: 3 });

    applyOps(writer, [{ at: 30, deleteTableRow: { row: 0 } }] as never);
    applyOps(writer, [{ at: 30, deleteTableColumn: { col: 0 } }] as never);
    expect(table()).toMatchObject({ cols: 2, rows: 2 });
  });

  test("duplicateTableRow copies the source row's text onto the tape", () => {
    const writer = new DomWriter(tapeFixture());
    applyOps(writer, [{ at: 30, duplicateTableRow: { insertBelow: true, row: 0 } }] as never);
    const cells = summarizeNode(writer.nodes[2]!, { full: true }).table?.cells;
    expect(cells?.[1]?.map((c) => c.text)).toEqual(["a", "b"]);
  });
});
