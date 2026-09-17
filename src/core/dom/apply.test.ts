/* Surgical DOM write compile/apply tests. */

import { describe, expect, test } from "bun:test";
import type { GwsClient } from "../gws.ts";
import { mockDoc } from "../testFixtures.ts";
import type { GoogleDoc } from "../types.ts";
import {
  applyDom,
  buildDocumentStyleRequest,
  compileDom,
  LAST_PARAGRAPH_MSG,
  resolveNestingIndent,
  resolveNestingStyle,
  wrapBatchUpdateError,
} from "./apply.ts";
import { createElement } from "./element.ts";
import { FAKE_BULLET_MSG } from "./guards.ts";
import { TABLE_INSERT_MIX_MSG } from "./ops.ts";
import type { DocNode } from "./types.ts";
import { DomWriter } from "./write.ts";

function heading2(): DocNode {
  return {
    end: 8,
    tapeIndex: 1,
    kind: "paragraph",
    namedStyleType: "HEADING_2",
    start: 1,
    text: "Status",
  };
}

function capturingClient(doc: GoogleDoc): {
  client: GwsClient;
  requests: object[];
} {
  const requests: object[] = [];
  return {
    client: {
      batchUpdate: async (_id, reqs) => {
        requests.push(...reqs);
        return "{}";
      },
      getDocument: async () => doc,
      run: async () => "{}",
    },
    requests,
  };
}

function namedStyleRequests(requests: object[]): Array<{
  namedStyleType?: string;
  startIndex: number;
}> {
  return requests.flatMap((r) => {
    if (!r || typeof r !== "object" || !("updateParagraphStyle" in r)) {
      return [];
    }
    const u = (
      r as {
        updateParagraphStyle: {
          paragraphStyle: { namedStyleType?: string };
          range: { startIndex: number };
        };
      }
    ).updateParagraphStyle;
    if (!u.paragraphStyle.namedStyleType) return [];
    return [
      {
        namedStyleType: u.paragraphStyle.namedStyleType,
        startIndex: u.range.startIndex,
      },
    ];
  });
}

describe("DomWriter apply", () => {
  test("innerText on HEADING_2 does not emit updateParagraphStyle namedStyleType", async () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.wrap(h).innerText = "New Heading";

    const doc = mockDoc([]);
    const { client, requests } = capturingClient(doc);
    await applyDom("doc-id", writer, { client, doc });

    expect(namedStyleRequests(requests)).toEqual([]);
    const deletes = requests.filter((r) => r && typeof r === "object" && "deleteContentRange" in r);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { location: { index: number }; text: string };
    }>;
    expect(deletes.length).toBe(1);
    expect(inserts.some((r) => r.insertText.text === "New Heading")).toBe(true);
    expect(inserts.every((r) => r.insertText.location.index === 1)).toBe(true);
  });

  test("insertAdjacent after heading inserts \\n at heading end-1 then writes in new para", async () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("paragraph", {
        namedStyleType: "NORMAL_TEXT",
        text: "Body",
      }),
    );

    const doc = mockDoc([]);
    const { client, requests } = capturingClient(doc);
    await applyDom("doc-id", writer, { client, doc });

    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { location: { index: number }; text: string };
    }>;
    expect(inserts[0]).toMatchObject({
      insertText: { location: { index: 7 }, text: "\n" },
    });
    expect(inserts[1]).toMatchObject({
      insertText: { location: { index: 8 }, text: "Body" },
    });
    expect(namedStyleRequests(requests).every((s) => s.startIndex >= 8)).toBe(true);
  });

  test("insertAdjacent after a table inserts at table.end, not inside a cell", () => {
    const table: DocNode = {
      end: 50,
      tapeIndex: 5,
      images: [{ col: 0, end: 12, objectId: "kix.img", row: 0, start: 11 }],
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            { end: 12, start: 11, text: "" },
            { end: 20, start: 12, text: "Name" },
          ],
        ],
      },
    };
    const writer = new DomWriter([table]);
    writer.insertAdjacentElement(
      table,
      "afterend",
      createElement("paragraph", {
        namedStyleType: "NORMAL_TEXT",
        text: "After",
      }),
    );
    const { requests } = compileDom(writer);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { location: { index: number }; text: string };
    }>;
    expect(inserts[0]).toMatchObject({
      insertText: { location: { index: 50 }, text: "\n" },
    });
    expect(inserts[1]).toMatchObject({
      insertText: { location: { index: 50 }, text: "After" },
    });
    expect(inserts.every((r) => r.insertText.location.index !== 49)).toBe(true);
  });

  test("consecutive bullet createElements compile to one createParagraphBullets", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    const a = writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("paragraph", {
        bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Alpha",
      }),
    );
    writer.insertAdjacentElement(
      a,
      "afterend",
      createElement("paragraph", {
        bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Beta",
      }),
    );

    const { requests } = compileDom(writer);
    const bullets = requests.filter((r) => r && typeof r === "object" && "createParagraphBullets" in r) as Array<{
      createParagraphBullets: {
        bulletPreset: string;
        range: { endIndex: number; startIndex: number };
      };
    }>;
    expect(bullets).toHaveLength(1);
    expect(bullets[0]?.createParagraphBullets.bulletPreset).toBe("BULLET_DISC_CIRCLE_SQUARE");
    expect(bullets[0]?.createParagraphBullets.range).toEqual({
      endIndex: 19,
      startIndex: 8,
    });

    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "Alpha\nBeta")).toBe(true);
  });

  test("hyphen-prefix refuse", () => {
    expect(() =>
      createElement("paragraph", {
        namedStyleType: "NORMAL_TEXT",
        text: "- **Status:** draft",
      }),
    ).toThrow(FAKE_BULLET_MSG);

    const h = heading2();
    const writer = new DomWriter([h]);
    expect(() => {
      writer.setInnerText(h, "- leaked markdown");
    }).not.toThrow();
    const body: DocNode = {
      end: 20,
      tapeIndex: 8,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 8,
      text: "ok",
    };
    const w2 = new DomWriter([h, body]);
    expect(() => w2.setInnerText(body, "- leaked markdown")).toThrow(FAKE_BULLET_MSG);
  });

  test("empty bullet refuse", () => {
    expect(() =>
      createElement("paragraph", {
        bullet: {},
        namedStyleType: "NORMAL_TEXT",
        text: "",
      }),
    ).toThrow(/Empty or dash-only list item/);
  });

  test("refuses afterbegin on an outline heading", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    expect(() =>
      writer.insertAdjacentElement(
        h,
        "afterbegin",
        createElement("paragraph", {
          namedStyleType: "NORMAL_TEXT",
          text: "inside",
        }),
      ),
    ).toThrow(/inside the heading/);
  });

  test("nested bullet indent uses listProperties then 36pt fallback", () => {
    expect(
      resolveNestingIndent({
        lists: {
          "kix.list1": {
            listProperties: {
              nestingLevels: [{}, { indentStart: { magnitude: 54, unit: "PT" } }],
            },
          },
        },
        listId: "kix.list1",
        nestingLevel: 1,
      }),
    ).toBe(54);
    expect(resolveNestingIndent({ nestingLevel: 1 })).toBe(72);
    expect(resolveNestingIndent({ nestingLevel: 0 })).toBeUndefined();
    expect(resolveNestingStyle({ nestingLevel: 1 })).toEqual({
      indentFirstLine: 54,
      indentStart: 72,
    });
    expect(
      resolveNestingIndent({
        explicit: { magnitude: 12, unit: "PT" },
        nestingLevel: 2,
      }),
    ).toBe(12);
  });

  test("nested createElement prefixes leading tabs for createParagraphBullets", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("paragraph", {
        bullet: { nestingLevel: 1, preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Nested",
      }),
    );
    const { requests } = compileDom(writer);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "\tNested")).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "deleteParagraphBullets" in r)).toBe(true);
    const bullets = requests.filter((r) => r && typeof r === "object" && "createParagraphBullets" in r);
    expect(bullets).toHaveLength(1);
    const indents = requests.filter((r) => {
      if (!r || typeof r !== "object" || !("updateParagraphStyle" in r)) return false;
      const u = r as {
        updateParagraphStyle: { paragraphStyle: { indentStart?: unknown } };
      };
      return Boolean(u.updateParagraphStyle.paragraphStyle.indentStart);
    });
    expect(indents).toHaveLength(0);
  });

  test("coalesced mixed nesting inserts parent then tab-prefixed child", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    const parent = writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("paragraph", {
        bullet: { nestingLevel: 0, preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Parent",
      }),
    );
    writer.insertAdjacentElement(
      parent,
      "afterend",
      createElement("paragraph", {
        bullet: { nestingLevel: 1, preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Child",
      }),
    );
    const { requests } = compileDom(writer);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "Parent\n\tChild")).toBe(true);
    expect(requests.filter((r) => r && typeof r === "object" && "createParagraphBullets" in r)).toHaveLength(1);
  });

  test("heading insert after a list item deletes inherited bullets", () => {
    const item: DocNode = {
      bullet: { listId: "kix.x", nestingLevel: 0 },
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "Item",
    };
    const writer = new DomWriter([item]);
    writer.insertAdjacentElement(
      item,
      "afterend",
      createElement("paragraph", {
        namedStyleType: "HEADING_3",
        text: "Goals",
      }),
    );
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "createParagraphBullets" in r)).toBe(false);
    const deletes = requests.filter((r) => r && typeof r === "object" && "deleteParagraphBullets" in r) as Array<{
      deleteParagraphBullets: { range: { startIndex: number; endIndex: number } };
    }>;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.deleteParagraphBullets.range).toEqual({
      endIndex: 26,
      startIndex: 20,
    });
  });

  test("namedStyleType to a heading deletes bullets on that paragraph", () => {
    const item: DocNode = {
      bullet: { listId: "kix.x", nestingLevel: 0 },
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "Item",
    };
    const writer = new DomWriter([item]);
    writer.wrap(item).namedStyleType = "HEADING_3";
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "deleteParagraphBullets" in r)).toBe(true);
  });

  test("joining an existing list at the same nestingLevel does not add indent", () => {
    const item: DocNode = {
      bullet: { listId: "kix.x", nestingLevel: 1 },
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "Ticket",
    };
    const writer = new DomWriter([item], {
      lists: {
        "kix.x": {
          listProperties: {
            nestingLevels: [
              { indentStart: { magnitude: 36, unit: "PT" } },
              { indentStart: { magnitude: 72, unit: "PT" } },
            ],
          },
        },
      },
    });
    writer.insertAdjacentElement(
      item,
      "afterend",
      createElement("paragraph", {
        bullet: { nestingLevel: 1, preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Discipline",
      }),
    );
    const { requests } = compileDom(writer, {
      lists: {
        "kix.x": {
          listProperties: {
            nestingLevels: [
              { indentStart: { magnitude: 36, unit: "PT" } },
              { indentStart: { magnitude: 72, unit: "PT" } },
            ],
          },
        },
      },
    });
    const indents = requests.filter((r) => {
      if (!r || typeof r !== "object" || !("updateParagraphStyle" in r)) return false;
      const u = r as {
        updateParagraphStyle: { paragraphStyle: { indentStart?: unknown } };
      };
      return Boolean(u.updateParagraphStyle.paragraphStyle.indentStart);
    });
    expect(indents).toHaveLength(0);
    expect(requests.some((r) => r && typeof r === "object" && "createParagraphBullets" in r)).toBe(false);
    expect(requests.some((r) => r && typeof r === "object" && "deleteParagraphBullets" in r)).toBe(false);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "Discipline")).toBe(true);
    expect(inserts.some((r) => r.insertText.text.includes("\t"))).toBe(false);
  });

  test("insertAdjacent strips inline markdown and styles the plain text", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("paragraph", {
        namedStyleType: "NORMAL_TEXT",
        text: "Use `linkUrl` and [docs](https://example.com).",
      }),
    );
    const { requests } = compileDom(writer);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "Use linkUrl and docs.")).toBe(true);
    expect(inserts.some((r) => r.insertText.text.includes("`"))).toBe(false);
    expect(inserts.some((r) => r.insertText.text.includes("[docs]("))).toBe(false);

    const styles = requests.filter((r) => r && typeof r === "object" && "updateTextStyle" in r) as Array<{
      updateTextStyle: {
        range: { endIndex: number; startIndex: number };
        textStyle: { link?: { url: string }; weightedFontFamily?: { fontFamily: string } };
      };
    }>;
    const writeAt = 8;
    const code = styles.find((s) => s.updateTextStyle.textStyle.weightedFontFamily?.fontFamily === "Courier New");
    expect(code?.updateTextStyle.range).toEqual({
      endIndex: writeAt + 11,
      startIndex: writeAt + 4,
    });
    const link = styles.find((s) => s.updateTextStyle.textStyle.link);
    expect(link?.updateTextStyle.range).toEqual({
      endIndex: writeAt + 20,
      startIndex: writeAt + 16,
    });
    expect(link?.updateTextStyle.textStyle.link?.url).toBe("https://example.com");
  });

  test("innerText clears inherited inline styles before applying markup", () => {
    const node: DocNode = {
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "placeholder",
    };
    const writer = new DomWriter([node]);
    writer.wrap(node).innerText = "**Unit ID**: unit-02-evaluator";
    const { requestOrigins, requests } = compileDom(writer);
    const styles = requests.filter((r) => r && typeof r === "object" && "updateTextStyle" in r) as Array<{
      updateTextStyle: { fields: string; textStyle: { bold?: boolean } };
    }>;
    expect(styles[0]?.updateTextStyle.fields).toMatch(/bold/);
    expect(styles[0]?.updateTextStyle.textStyle.bold).toBe(false);
    expect(styles.some((s) => s.updateTextStyle.textStyle.bold === true)).toBe(true);
    expect(requestOrigins).toHaveLength(requests.length);
    expect(requestOrigins.every((o) => o.mutationIndexes.includes(0))).toBe(true);
  });

  test("innerText on a paragraph with smart chips writes", () => {
    const node: DocNode = {
      chips: [
        {
          end: 11,
          start: 10,
          title: "Unit template",
          uri: "https://docs.google.com/document/d/abc/edit",
        },
      ],
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "From Unit template",
    };
    const writer = new DomWriter([node]);
    writer.wrap(node).innerText = "rewritten";
    expect(writer.nodes[0]?.text).toBe("rewritten");
  });

  test("remove on a paragraph with smart chips deletes the node", () => {
    const node: DocNode = {
      chips: [
        {
          end: 11,
          start: 10,
          title: "Unit template",
          uri: "https://docs.google.com/document/d/abc/edit",
        },
      ],
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "From Unit template",
    };
    const writer = new DomWriter([
      node,
      {
        end: 30,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "keep",
      },
    ]);
    writer.wrap(node).remove();
    expect(writer.nodes.map((n) => n.tapeIndex)).toEqual([2]);
  });

  test("innerText on a paragraph with an image deletes text only", () => {
    const node: DocNode = {
      end: 14,
      tapeIndex: 1,
      images: [{ end: 13, objectId: "kix.img", start: 12, widthPt: 480 }],
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 10,
      text: "Hi",
    };
    const writer = new DomWriter([node]);
    writer.wrap(node).innerText = "Caption";
    const { requests } = compileDom(writer);
    const deletes = requests.filter((r) => r && typeof r === "object" && "deleteContentRange" in r) as Array<{
      deleteContentRange: { range: { endIndex: number; startIndex: number } };
    }>;
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { location: { index: number }; text: string };
    }>;
    expect(deletes.map((d) => d.deleteContentRange.range)).toEqual([{ endIndex: 12, startIndex: 10 }]);
    expect(inserts.some((r) => r.insertText.text === "Caption")).toBe(true);
    expect(deletes.every((d) => d.deleteContentRange.range.startIndex !== 12)).toBe(true);
  });

  test("wrapBatchUpdateError maps requests[n] to ops", () => {
    const err = wrapBatchUpdateError(
      new Error("Invalid requests[2].insertText: Index 9 must be inside the document."),
      {
        batch: "main",
        origins: [{ mutationIndexes: [0] }, { mutationIndexes: [0] }, { mutationIndexes: [1] }],
        plan: [
          {
            action: "innerText",
            index: 0,
            target: { id: 12, kind: "paragraph", namedStyleType: "HEADING_2", text: "Status" },
          },
          {
            action: "innerText",
            index: 1,
            target: { id: 40, kind: "paragraph", text: "Ticket: AUTO-781" },
          },
        ],
      },
    );
    expect(err.message).toMatch(/API requests\[2\] ← ops\[1\] innerText #40/);
    expect(err.message).toMatch(/atomic/);
  });

  test("refuses remove of the last paragraph", () => {
    const h = heading2();
    const body: DocNode = {
      end: 20,
      tapeIndex: 8,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 8,
      text: "gone",
    };
    const writer = new DomWriter([h, body]);
    writer.remove(body);
    expect(() => compileDom(writer)).toThrow(LAST_PARAGRAPH_MSG);

    const w2 = new DomWriter([h, body]);
    w2.remove(h);
    const { requests } = compileDom(w2);
    expect(requests).toEqual([{ deleteContentRange: { range: { endIndex: 8, startIndex: 1 } } }]);
  });

  test("namedStyleType demotes a heading without changing text", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.wrap(h).namedStyleType = "NORMAL_TEXT";
    const { requests } = compileDom(writer);
    expect(namedStyleRequests(requests)).toEqual([{ namedStyleType: "NORMAL_TEXT", startIndex: 1 }]);
    expect(requests.some((r) => r && typeof r === "object" && "insertText" in r)).toBe(false);
  });

  test("remove deletes a non-last node", () => {
    const h = heading2();
    const body: DocNode = {
      end: 20,
      tapeIndex: 8,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 8,
      text: "gone",
    };
    const tail: DocNode = {
      end: 30,
      tapeIndex: 20,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 20,
      text: "keep",
    };
    const writer = new DomWriter([h, body, tail]);
    writer.remove(body);
    const { requests } = compileDom(writer);
    expect(requests).toEqual([
      {
        deleteContentRange: {
          range: { endIndex: 20, startIndex: 8 },
        },
      },
    ]);
  });

  test("alignment emits updateParagraphStyle on the paragraph range", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.setAlignment(h, "CENTER");
    const { requests } = compileDom(writer);
    expect(requests).toEqual([
      {
        updateParagraphStyle: {
          fields: "alignment",
          paragraphStyle: { alignment: "CENTER" },
          range: { endIndex: 8, startIndex: 1 },
        },
      },
    ]);
  });

  test("cell innerText and alignment target the cell paragraph, not the table bounds", () => {
    const table: DocNode = {
      end: 50,
      tapeIndex: 5,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            { end: 20, start: 16, text: "A" },
            { end: 26, start: 20, text: "B" },
          ],
        ],
      },
    };
    const writer = new DomWriter([table]);
    writer.setInnerText(table, "Hello", [0, 0]);
    writer.setAlignment(table, "CENTER", [0, 1]);
    const { requests } = compileDom(writer);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { location: { index: number }; text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "Hello")).toBe(true);
    expect(inserts.every((r) => r.insertText.location.index === 16)).toBe(true);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "updateParagraphStyle" in r &&
          (
            r as {
              updateParagraphStyle: {
                paragraphStyle: { alignment?: string };
                range: { endIndex: number; startIndex: number };
              };
            }
          ).updateParagraphStyle.paragraphStyle.alignment === "CENTER" &&
          (
            r as {
              updateParagraphStyle: { range: { endIndex: number; startIndex: number } };
            }
          ).updateParagraphStyle.range.startIndex === 22,
      ),
    ).toBe(true);
  });

  test("segmentId is stamped on ranges", () => {
    const h = heading2();
    const writer = new DomWriter([h], { segmentId: "kix.h" });
    writer.setInnerText(h, "CONFIDENTIAL");
    const { requests } = compileDom(writer);
    expect(JSON.stringify(requests).includes('"segmentId":"kix.h"')).toBe(true);
  });

  test("tabId is stamped on ranges", () => {
    const h = heading2();
    const writer = new DomWriter([h], { tabId: "t.0" });
    writer.setInnerText(h, "CONFIDENTIAL");
    const { requests } = compileDom(writer);
    expect(JSON.stringify(requests).includes('"tabId":"t.0"')).toBe(true);
  });

  test("pageBreak insert emits insertPageBreak", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(h, "afterend", createElement("pageBreak"));
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "insertPageBreak" in r)).toBe(true);
  });

  test("sectionBreak insert emits insertSectionBreak", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(h, "afterend", createElement("sectionBreak", { sectionType: "CONTINUOUS" }));
    const { requests } = compileDom(writer);
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "insertSectionBreak" in r &&
          (r as any).insertSectionBreak.sectionType === "CONTINUOUS",
      ),
    ).toBe(true);
  });

  test("smart chips insert emits insertPerson, insertRichLink, and insertDate", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(h, "afterend", createElement("person", { email: "user@example.com" }));
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("richLink", { title: "Doc", uri: "https://docs.google.com" }),
    );
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("date", { displayText: "Sep 15", timestamp: "2026-09-15" }),
    );
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "insertPerson" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "insertRichLink" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "insertDate" in r)).toBe(true);
  });

  test("footnote insert emits createFootnote", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(h, "afterend", createElement("footnote"));
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "createFootnote" in r)).toBe(true);
  });

  test("inlineImage insert emits insertInlineImage", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("inlineImage", { heightPt: 50, uri: "https://example.com/logo.png", widthPt: 100 }),
    );
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "insertInlineImage" in r)).toBe(true);
  });

  test("table grid operations compile to expected requests", () => {
    const table: DocNode = {
      end: 50,
      tapeIndex: 10,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            { end: 20, paragraphs: [{ end: 20, start: 12, text: "A" }], start: 12, text: "A" },
            { end: 30, paragraphs: [{ end: 30, start: 22, text: "B" }], start: 22, text: "B" },
          ],
        ],
      },
    };
    const writer = new DomWriter([table]);
    writer.insertTableRow(table, [0, 0], true, ["C", "D"]);
    writer.deleteTableRow(table, [0, 0]);
    writer.insertTableColumn(table, [0, 1], true);
    writer.deleteTableColumn(table, [0, 0]);
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "insertTableRow" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "deleteTableRow" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "insertTableColumn" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "deleteTableColumn" in r)).toBe(true);
  });

  test("pageSetup prepends updateDocumentStyle in applyDom", async () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.wrap(h).innerText = "Hello";
    const doc = mockDoc([]);
    const { client, requests } = capturingClient(doc);
    await applyDom("doc-id", writer, {
      client,
      doc,
      pageSetup: {
        margins: { bottom: 72, left: 72, right: 72, top: 72 },
        orientation: "LANDSCAPE",
        pageSize: "LETTER",
      },
    });
    expect(
      requests.some(
        (r) =>
          r &&
          typeof r === "object" &&
          "updateDocumentStyle" in r &&
          (r as any).updateDocumentStyle.fields.includes("pageSize"),
      ),
    ).toBe(true);
  });

  test("buildDocumentStyleRequest rejects pageless mode", () => {
    expect(() => buildDocumentStyleRequest({ pageless: true } as any)).toThrow("Pageless mode cannot be set via API");
    expect(() => buildDocumentStyleRequest({ mode: "PAGELESS" } as any)).toThrow("Pageless mode cannot be set via API");
  });

  test("style patch emits spacing, shading, and columnCount", () => {
    const para = heading2();
    const section: DocNode = {
      columnCount: 1,
      end: 10,
      tapeIndex: 2,
      kind: "sectionBreak",
      start: 8,
    };
    const writer = new DomWriter([para, section]);
    writer.setStyle(para, {
      foregroundColor: "#666666",
      shading: "#F5F5F5",
      spaceAbove: 12,
    });
    writer.setStyle(section, { columnCount: 2 });
    const { requests } = compileDom(writer);
    expect(requests).toEqual(
      expect.arrayContaining([
        {
          updateParagraphStyle: {
            fields: "spaceAbove,shading",
            paragraphStyle: {
              shading: {
                backgroundColor: {
                  color: { rgbColor: { blue: 245 / 255, green: 245 / 255, red: 245 / 255 } },
                },
              },
              spaceAbove: { magnitude: 12, unit: "PT" },
            },
            range: { endIndex: 8, startIndex: 1 },
          },
        },
        {
          updateTextStyle: {
            fields: "foregroundColor",
            range: { endIndex: 7, startIndex: 1 },
            textStyle: {
              foregroundColor: {
                color: { rgbColor: { blue: 102 / 255, green: 102 / 255, red: 102 / 255 } },
              },
            },
          },
        },
        {
          updateSectionStyle: {
            fields: "columnCount",
            range: { endIndex: 10, startIndex: 8 },
            sectionStyle: { columnCount: 2 },
          },
        },
      ]),
    );
  });

  test("cell para innerText targets the extra paragraph", () => {
    const table: DocNode = {
      end: 40,
      tapeIndex: 5,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            {
              end: 12,
              paragraphs: [
                { end: 12, start: 10, text: "Photo" },
                { end: 24, start: 12, text: "caption" },
              ],
              start: 10,
              text: "Photo",
            },
          ],
        ],
      },
    };
    const writer = new DomWriter([table]);
    writer.setInnerText(table, "under the photo", [0, 0], 1);
    const { requests } = compileDom(writer);
    const inserts = requests.filter((r) => r && typeof r === "object" && "insertText" in r) as Array<{
      insertText: { location: { index: number }; text: string };
    }>;
    expect(inserts.some((r) => r.insertText.text === "under the photo")).toBe(true);
    expect(inserts.every((r) => r.insertText.location.index === 12)).toBe(true);
  });

  test("table insert cannot share an apply with remove", () => {
    const h = heading2();
    const para: DocNode = {
      end: 20,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 8,
      text: "Old bullets",
    };
    const writer = new DomWriter([h, para]);
    writer.insertAdjacentElement(h, "afterend", createElement("table", { rows: [["Status"]] }));
    writer.remove(para);
    expect(() => compileDom(writer)).toThrow(TABLE_INSERT_MIX_MSG);
  });

  test("table insert may style the new table in the same apply", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    const table = writer.insertAdjacentElement(h, "afterend", createElement("table", { rows: [["Status"]] }));
    writer.setStyle(table, {
      borderColor: "#999999",
      cellPadding: 5,
      columnWidth: 500,
      contentAlignment: "TOP",
    });
    const { requests } = compileDom(writer);
    expect(requests.some((r) => r && typeof r === "object" && "insertTable" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "updateTableColumnProperties" in r)).toBe(true);
    expect(requests.some((r) => r && typeof r === "object" && "updateTableCellStyle" in r)).toBe(true);
  });

  test("table style emits width, borders, padding, and cell text alignment", () => {
    const table: DocNode = {
      end: 50,
      tapeIndex: 5,
      kind: "table",
      start: 10,
      table: {
        cells: [[{ end: 20, paragraphs: [{ end: 20, start: 12, text: "Status" }], start: 12, text: "Status" }]],
      },
    };
    const writer = new DomWriter([table]);
    writer.setStyle(table, {
      alignment: "START",
      borderColor: "#999999",
      cellPadding: 5,
      columnWidth: 500,
      contentAlignment: "TOP",
      minRowHeight: 20,
    });
    const { requests } = compileDom(writer);
    expect(requests).toEqual(
      expect.arrayContaining([
        {
          updateParagraphStyle: {
            fields: "alignment",
            paragraphStyle: { alignment: "START" },
            range: { endIndex: 20, startIndex: 12 },
          },
        },
        {
          updateTableColumnProperties: {
            fields: "widthType,width",
            tableColumnProperties: {
              width: { magnitude: 500, unit: "PT" },
              widthType: "FIXED_WIDTH",
            },
            tableStartLocation: { index: 10 },
          },
        },
        {
          updateTableRowStyle: {
            fields: "minRowHeight",
            tableRowStyle: { minRowHeight: { magnitude: 20, unit: "PT" } },
            tableStartLocation: { index: 10 },
          },
        },
      ]),
    );
    const cellStyle = requests.find((r) => r && typeof r === "object" && "updateTableCellStyle" in r) as {
      updateTableCellStyle: {
        fields: string;
        tableCellStyle: {
          contentAlignment?: string;
          paddingTop?: { magnitude: number; unit: string };
        };
        tableStartLocation: { index: number };
      };
    };
    expect(cellStyle.updateTableCellStyle.tableStartLocation.index).toBe(10);
    expect(cellStyle.updateTableCellStyle.tableCellStyle.contentAlignment).toBe("TOP");
    expect(cellStyle.updateTableCellStyle.tableCellStyle.paddingTop).toEqual({
      magnitude: 5,
      unit: "PT",
    });
    expect(cellStyle.updateTableCellStyle.fields).toContain("borderTop");
  });

  test("style indentStart on a bullet hangs first-line; quotes do not", () => {
    const bullet: DocNode = {
      bullet: { listId: "kix.x", nestingLevel: 0 },
      end: 20,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "Item",
    };
    const quote: DocNode = {
      end: 40,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 20,
      text: "Quote",
    };
    const writer = new DomWriter([bullet, quote]);
    writer.setStyle(bullet, { indentStart: 18 });
    writer.setStyle(quote, { indentStart: 36 });
    const { requests } = compileDom(writer);
    expect(requests).toEqual(
      expect.arrayContaining([
        {
          updateParagraphStyle: {
            fields: "indentStart,indentFirstLine",
            paragraphStyle: {
              indentFirstLine: { magnitude: 0, unit: "PT" },
              indentStart: { magnitude: 18, unit: "PT" },
            },
            range: { endIndex: 20, startIndex: 1 },
          },
        },
        {
          updateParagraphStyle: {
            fields: "indentStart",
            paragraphStyle: {
              indentStart: { magnitude: 36, unit: "PT" },
            },
            range: { endIndex: 40, startIndex: 20 },
          },
        },
      ]),
    );
  });

  test("createElement style.indentStart applies after bullets", () => {
    const h = heading2();
    const writer = new DomWriter([h]);
    writer.insertAdjacentElement(
      h,
      "afterend",
      createElement("paragraph", {
        bullet: { nestingLevel: 0, preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        style: { indentStart: 18, indentFirstLine: 0 },
        text: "Flush",
      }),
    );
    const { requests } = compileDom(writer);
    const bulletAt = requests.findIndex((r) => r && typeof r === "object" && "createParagraphBullets" in r);
    const indentAt = requests.findIndex((r) => {
      if (!r || typeof r !== "object" || !("updateParagraphStyle" in r)) return false;
      const u = r as {
        updateParagraphStyle: { paragraphStyle: { indentStart?: unknown } };
      };
      return Boolean(u.updateParagraphStyle.paragraphStyle.indentStart);
    });
    expect(bulletAt).toBeGreaterThan(-1);
    expect(indentAt).toBeGreaterThan(bulletAt);
    expect(requests[indentAt]).toEqual({
      updateParagraphStyle: {
        fields: "indentStart,indentFirstLine",
        paragraphStyle: {
          indentFirstLine: { magnitude: 0, unit: "PT" },
          indentStart: { magnitude: 18, unit: "PT" },
        },
        range: expect.anything(),
      },
    });
  });

  test("table node rejects indentStart", () => {
    const table: DocNode = {
      end: 50,
      tapeIndex: 5,
      kind: "table",
      start: 10,
      table: {
        cells: [
          [
            {
              end: 20,
              paragraphs: [{ end: 20, start: 12, text: "Status" }],
              start: 12,
              text: "Status",
            },
          ],
        ],
      },
    };
    const writer = new DomWriter([table]);
    expect(() => writer.setStyle(table, { indentStart: 18 })).toThrow(/not indentStart/);
  });

  test("bullet restyle converts the shared listId run", () => {
    const a: DocNode = {
      bullet: { listId: "kix.x", nestingLevel: 0 },
      end: 10,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 1,
      text: "One",
    };
    const b: DocNode = {
      bullet: { listId: "kix.x", nestingLevel: 0 },
      end: 20,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 10,
      text: "Two",
    };
    const writer = new DomWriter([a, b]);
    writer.setBulletPreset(a, "NUMBERED_DECIMAL_ALPHA_ROMAN");
    const { requests } = compileDom(writer);
    expect(requests).toEqual([
      {
        createParagraphBullets: {
          bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN",
          range: { endIndex: 20, startIndex: 1 },
        },
      },
    ]);
  });
});
