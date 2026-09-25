/* Tests for outline and node queries. */

import { describe, expect, test } from "bun:test";
import blankTab from "../model/blankTab.json";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { listPresetTable } from "../model/lists.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import { tabNodes, tabOutline } from "./query.ts";

const json = docJsonBuild({
  tabs: [
    {
      blocks: [
        { content: ["Title"], headingId: "h.1", kind: "paragraph", style: { namedStyleType: "HEADING_1" } },
        {
          content: [{ style: { foregroundColor: { color: { rgbColor: { red: 1 } } } }, text: "red" }],
          kind: "paragraph",
        },
        { bullet: { listId: "kix.p" }, content: ["item"], kind: "paragraph" },
        { content: [], kind: "paragraph" },
        { cells: [[[{ content: ["a"] }], [{ content: ["b"] }]]], kind: "table" },
        { content: ["eq ", { type: "equation" }], kind: "paragraph" },
      ],
      lists: { "kix.p": { listProperties: { nestingLevels: listPresetTable().BULLET_DISC_CIRCLE_SQUARE } } },
    },
  ],
}) as unknown as { tabs: Array<{ documentTab: Record<string, unknown> }> };
json.tabs[0].documentTab.namedStyles = structuredClone(blankTab.namedStyles);
const tab = docModelParse(json as never, { docId: "d", keys: new KeyAllocator() }).tabs[0];

describe("queries", () => {
  test("outline", () => {
    expect(tabOutline(tab)).toEqual([{ anchor: "h.1", level: 1, namedStyleType: "HEADING_1", text: "Title" }]);
  });

  test("nodes: kinds, sections, lists, colors, uniform style, cells, flags", () => {
    const nodes = tabNodes(tab, { includeCells: true }, { linkedHeadingIds: new Set(["h.1"]) });
    expect(nodes.map((n) => n.kind)).toEqual(["heading", "paragraph", "listItem", "empty", "table", "paragraph"]);
    expect(nodes.every((n, i) => i === 0 || n.section === "h.1")).toBe(true);
    expect(nodes[0].flags).toEqual(["linkedHeading"]);
    expect(nodes[1]).toMatchObject({
      fontColors: ["#FF0000"],
      markdown: "red",
      textStyle: { foregroundColor: { color: { rgbColor: { blue: 0, green: 0, red: 1 } } } },
    });
    expect(nodes[2].list).toEqual({ kind: "bullet", listId: "kix.p", nesting: 0 });
    expect(nodes[4]).toMatchObject({
      cells: [
        { col: 0, row: 0, text: "a" },
        { col: 1, row: 0, text: "b" },
      ],
      table: { cols: 2, rows: 1 },
    });
    expect(nodes[5].flags).toEqual(["unrecreatable"]);
  });

  test("a range limits the nodes", () => {
    expect(tabNodes(tab, { range: { heading: "Title", includeHeading: false, kind: "section" } })).toHaveLength(5);
  });
});
