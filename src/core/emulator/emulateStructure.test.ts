/* Tests for structural request emulation: page breaks, section breaks, chip/image atoms, tabs, and document style. */

import { describe, expect, test } from "bun:test";
import { docModelParse } from "../model/fromJson.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import type { ParagraphBlock, TabModel } from "../model/types.ts";
import { requestsEmulate } from "./emulate.ts";

function parse(json: ReturnType<typeof docJsonBuild>) {
  return docModelParse(json, { docId: "d1", keys: new KeyAllocator() });
}

describe("emulateStructure", () => {
  test("insertPageBreak occupies 2 indices (atom + newline split)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["abcdef"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [{ insertPageBreak: { location: { index: 4 } } }]);
    const blocks = parse(out).tabs[0].blocks as ParagraphBlock[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].inlines).toMatchObject([
      { kind: "text", text: "abc" },
      { kind: "atom", type: "pageBreak" },
    ]);
    expect(blocks[1].inlines).toMatchObject([{ kind: "text", text: "def" }]);
  });

  test("insertSectionBreak occupies 2 indices (newline split + break marker)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["abcdef"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [
      { insertSectionBreak: { location: { index: 4 }, sectionType: "NEXT_PAGE" } },
    ]);
    const doc = parse(out);
    expect(doc.tabs[0].blocks.map((b) => b.kind)).toEqual(["paragraph", "sectionBreak", "paragraph"]);
  });

  test("updateSectionStyle sizes columns from the page and rejects columnCount (F26)", () => {
    const json = docJsonBuild({
      tabs: [
        {
          blocks: [
            { content: ["a"], kind: "paragraph" },
            { kind: "sectionBreak" },
            { content: ["b"], kind: "paragraph" },
          ],
        },
      ],
    });
    const withPage = structuredClone(json) as unknown as { tabs: Array<{ documentTab: Record<string, unknown> }> };
    withPage.tabs[0].documentTab.documentStyle = {
      marginLeft: { magnitude: 72, unit: "PT" },
      marginRight: { magnitude: 72, unit: "PT" },
      pageSize: { width: { magnitude: 612, unit: "PT" } },
    };
    const columns = [{ paddingEnd: { magnitude: 36, unit: "PT" } }, { paddingEnd: { magnitude: 0, unit: "PT" } }];
    const { json: out } = requestsEmulate(withPage as never, [
      {
        updateSectionStyle: {
          fields: "columnProperties",
          range: { endIndex: 4, startIndex: 3 },
          sectionStyle: { columnProperties: columns },
        },
      },
    ]);
    const sb = parse(out).tabs[0].blocks.find((b) => b.kind === "sectionBreak");
    expect(sb).toMatchObject({
      sectionStyle: { columnProperties: [{ width: { magnitude: 216 } }, { width: { magnitude: 216 } }] },
    });
    expect(() =>
      requestsEmulate(json, [
        {
          updateSectionStyle: {
            fields: "columnCount",
            range: { endIndex: 4, startIndex: 3 },
            sectionStyle: { columnCount: 2 },
          },
        },
      ]),
    ).toThrow(/columnCount/);
    expect(() =>
      requestsEmulate(json, [
        {
          updateSectionStyle: {
            fields: "columnProperties",
            range: { endIndex: 4, startIndex: 3 },
            sectionStyle: { columnProperties: [{}, {}] },
          },
        },
      ]),
    ).toThrow(/Column padding/);
  });

  test("updateSectionStyle on the first section switches a pageless doc to PAGES (F26)", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [
      {
        updateSectionStyle: {
          fields: "marginTop",
          range: { endIndex: 1, startIndex: 0 },
          sectionStyle: { marginTop: { magnitude: 20, unit: "PT" } },
        },
      },
    ]);
    const tab = parse(out).tabs[0];
    expect(tab.documentStyle).toMatchObject({ documentFormat: { documentMode: "PAGES" } });
    expect(tab.leadingSectionStyle).toMatchObject({ marginTop: { magnitude: 20 } });
  });

  test("insertPerson, insertDate, insertRichLink insert single-index chips", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [
      { insertPerson: { location: { index: 2 }, personProperties: { email: "a@example.com" } } },
      { insertDate: { dateElementProperties: { timestamp: "2026-01-15T00:00:00Z" }, location: { index: 3 } } },
      { insertRichLink: { location: { index: 4 }, richLinkProperties: { uri: "https://example.com" } } },
    ]);
    const p = parse(out).tabs[0].blocks[0] as ParagraphBlock;
    const atomTypes = p.inlines.filter((i) => i.kind === "atom").map((i) => (i.kind === "atom" ? i.type : undefined));
    expect(atomTypes).toEqual(["person", "date", "richLink"]);
    const date = p.inlines[2] as { raw?: { dateElement?: Record<string, unknown> } };
    expect(date.raw?.dateElement).toMatchObject({
      dateElementProperties: { displayText: "Jan 15, 2026", locale: "en", timestamp: "2026-01-15T00:00:00Z" },
    });
    expect(typeof date.raw?.dateElement?.dateId).toBe("string");
  });

  test("insertInlineImage mints an inlineObjects entry with sourceUri", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [
      { insertInlineImage: { location: { index: 1 }, uri: "https://example.com/x.png" } },
    ]);
    const tab = parse(out).tabs[0];
    const p = tab.blocks[0] as ParagraphBlock;
    const imageAtom = p.inlines.find((i) => i.kind === "atom" && i.type === "image");
    expect(imageAtom).toBeDefined();
    const objectId = (imageAtom as { raw?: { inlineObjectElement?: { inlineObjectId?: string } } }).raw
      ?.inlineObjectElement?.inlineObjectId;
    expect(objectId).toBeDefined();
    expect(tab.inlineObjects[objectId as string]).toMatchObject({
      inlineObjectProperties: { embeddedObject: { imageProperties: { sourceUri: "https://example.com/x.png" } } },
    });
  });

  test("addDocumentTab creates a blank tab; deleteTab removes it and its children", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }], tabId: "t.0" }] });
    const created = requestsEmulate(json, [
      { addDocumentTab: { tabProperties: { parentTabId: "t.0", title: "New Tab" } } },
    ]);
    const doc = parse(created.json);
    expect(doc.tabs).toHaveLength(2);
    expect(doc.tabs[1].title).toBe("New Tab");
    expect(doc.tabs[1].parentTabId).toBe("t.0");
    expect(created.replies[0]).toMatchObject({
      addDocumentTab: { tabProperties: { index: 0, nestingLevel: 1, parentTabId: "t.0", title: "New Tab" } },
    });
    const newTabId = doc.tabs[1].tabId;

    const deleted = requestsEmulate(created.json, [{ deleteTab: { tabId: newTabId } }]);
    expect(parse(deleted.json).tabs).toHaveLength(1);
  });

  test("updateDocumentTabProperties renames and moves a tab", () => {
    const json = docJsonBuild({
      tabs: [
        { blocks: [{ content: ["a"], kind: "paragraph" }], tabId: "t.0", title: "First" },
        { blocks: [{ content: ["b"], kind: "paragraph" }], tabId: "t.1", title: "Second" },
      ],
    });
    const renamed = requestsEmulate(json, [
      { updateDocumentTabProperties: { fields: "title", tabProperties: { tabId: "t.1", title: "Renamed" } } },
    ]);
    expect(parse(renamed.json).tabs.map((t: TabModel) => t.title)).toEqual(["First", "Renamed"]);

    const moved = requestsEmulate(renamed.json, [
      { updateDocumentTabProperties: { fields: "index", tabProperties: { index: 0, tabId: "t.1" } } },
    ]);
    expect(parse(moved.json).tabs.map((t: TabModel) => t.tabId)).toEqual(["t.1", "t.0"]);
  });

  test("updateDocumentStyle applies dotted field paths", () => {
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    const { json: out } = requestsEmulate(json, [
      {
        updateDocumentStyle: {
          documentStyle: { pageSize: { width: { magnitude: 612, unit: "PT" } } },
          fields: "pageSize.width",
        },
      },
    ]);
    const tab = parse(out).tabs[0];
    expect(tab.documentStyle).toMatchObject({ pageSize: { width: { magnitude: 612, unit: "PT" } } });
  });
});
