/* Unit tests for Gdoc load helpers. */

import { describe, expect, test } from "bun:test";
import { Gdoc } from "./gdoc.ts";

describe("Gdoc", () => {
  test("parseId passes through raw id", () => {
    expect(Gdoc.parseId("abc123")).toBe("abc123");
  });

  test("parseId refuses full URL with instructive error", () => {
    expect(() => Gdoc.parseId("https://docs.google.com/document/d/abc123_XYZ/edit")).toThrow(
      /Pass the document ID, not the full URL/,
    );
  });

  test("parseRef passes through raw id and rejects URLs", () => {
    expect(Gdoc.parseRef("abc123")).toEqual({ documentId: "abc123" });
    expect(() => Gdoc.parseRef("https://docs.google.com/document/d/abc123/edit?tab=t.0")).toThrow(
      /Pass the document ID, not the full URL/,
    );
  });

  test("findTableAt searches the overlaid tab body", () => {
    const gdoc = new Gdoc(
      {
        tabs: [
          {
            documentTab: {
              body: {
                content: [
                  {
                    endIndex: 20,
                    startIndex: 10,
                    table: { columns: 1, rows: 1 },
                  },
                ],
              },
            },
            tabProperties: { tabId: "t.0", title: "Intro" },
          },
        ],
      },
      "doc",
    ).withTab("t.0");
    expect(gdoc.findTableAt(10)?.table).toEqual({ columns: 1, rows: 1 });
  });
});
