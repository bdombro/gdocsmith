/* Unit tests for Docs tab targeting. */

import { describe, expect, test } from "bun:test";
import { parseDocument } from "./dom/parse.ts";
import { Gdoc } from "./gdoc.ts";
import {
  APPLY_TAB_REQUIRED_MSG,
  flattenTabs,
  listedTabs,
  overlayTab,
  parseRef,
  resolveApplyTab,
  resolveRelativeTabIndex,
  resolveTab,
  TAB_REQUIRED_MSG,
  tabContent,
  tabTree,
} from "./tabs.ts";
import { mockDoc } from "./testFixtures.ts";
import type { DocTab, GoogleDoc } from "./types.ts";

function para(text: string, start = 1): NonNullable<GoogleDoc["body"]>["content"][number] {
  return {
    endIndex: start + text.length + 1,
    paragraph: { elements: [{ textRun: { content: `${text}\n` } }] },
    startIndex: start,
  };
}

function docTab(tabId: string, title: string, text: string, childTabs?: DocTab[]): DocTab {
  const tab: DocTab = {
    documentTab: { body: { content: [para(text)] } },
    tabProperties: { tabId, title },
  };
  if (childTabs) tab.childTabs = childTabs;
  return tab;
}

const nested: GoogleDoc = {
  tabs: [docTab("t.0", "Intro", "hello", [docTab("t.0.1", "Nested", "child")]), docTab("t.1", "Notes", "notes")],
};

describe("parseRef", () => {
  test("passes through a raw id", () => {
    expect(parseRef("abc123")).toEqual({ documentId: "abc123" });
  });

  test("refuses full URL without a tab", () => {
    expect(() => parseRef("https://docs.google.com/document/d/abc123_XYZ/edit")).toThrow(
      /Pass the document ID, not the full URL/,
    );
  });

  test("refuses full URL with ?tab=", () => {
    expect(() => parseRef("https://docs.google.com/document/d/abc123/edit?tab=t.0")).toThrow(
      /Pass the document ID, not the full URL/,
    );
  });

  test("refuses full URL with #tab=", () => {
    expect(() => parseRef("https://docs.google.com/document/d/abc123/edit#tab=t.5up1ytauvsxg")).toThrow(
      /Pass the document ID, not the full URL/,
    );
  });
});

describe("flattenTabs", () => {
  test("walks nested childTabs in UI (DFS) order", () => {
    expect(flattenTabs(nested.tabs)).toEqual([
      { tabId: "t.0", title: "Intro" },
      { tabId: "t.0.1", title: "Nested" },
      { tabId: "t.1", title: "Notes" },
    ]);
  });

  test("tabTree keeps children nested", () => {
    expect(tabTree(nested.tabs)).toEqual([
      {
        tabId: "t.0",
        title: "Intro",
        children: [{ tabId: "t.0.1", title: "Nested" }],
      },
      { tabId: "t.1", title: "Notes" },
    ]);
  });

  test("tabTree does not include url", () => {
    expect(tabTree(nested.tabs, "doc-xyz")).toEqual([
      {
        children: [
          {
            tabId: "t.0.1",
            title: "Nested",
          },
        ],
        tabId: "t.0",
        title: "Intro",
      },
      {
        tabId: "t.1",
        title: "Notes",
      },
    ]);
  });
});

describe("resolveTab", () => {
  test("resolves an exact tabId", () => {
    expect(resolveTab(nested, "t.1")).toEqual({ tabId: "t.1", title: "Notes" });
  });

  test("resolves a unique title", () => {
    expect(resolveTab(nested, "Notes")).toEqual({ tabId: "t.1", title: "Notes" });
    expect(resolveTab(nested, "notes")).toEqual({ tabId: "t.1", title: "Notes" });
  });

  test("refuses an ambiguous title", () => {
    const data: GoogleDoc = {
      tabs: [docTab("t.0", "Dup", "a"), docTab("t.1", "Dup", "b")],
    };
    expect(() => resolveTab(data, "Dup")).toThrow(/Ambiguous tab title/);
  });

  test("rejects unknown tab with known list", () => {
    expect(() => resolveTab(nested, "Missing")).toThrow(/Unknown tab Missing.*Known: t.0/);
  });

  test("sole tab is implicit", () => {
    expect(resolveTab({ tabs: [docTab("t.0", "Only", "x")] })).toEqual({
      tabId: "t.0",
      title: "Only",
    });
  });

  test("auto-resolves t.0, 0, or root to topmost tab when literal t.0 is missing", () => {
    const dataWithoutT0: GoogleDoc = {
      tabs: [docTab("t.abc", "Overview", "intro"), docTab("t.xyz", "Details", "body")],
    };
    expect(resolveTab(dataWithoutT0, "t.0")).toEqual({ tabId: "t.abc", title: "Overview" });
    expect(resolveTab(dataWithoutT0, "0")).toEqual({ tabId: "t.abc", title: "Overview" });
    expect(resolveTab(dataWithoutT0, "root")).toEqual({ tabId: "t.abc", title: "Overview" });
  });

  test("several tabs without a hint fail closed with tabs in the error", () => {
    expect(() => resolveTab(nested)).toThrow(TAB_REQUIRED_MSG);
    expect(() => resolveTab(nested)).toThrow(/"tabId": "t.0"/);
  });
});

describe("listedTabs", () => {
  test("adds zero-based index in UI order", () => {
    expect(listedTabs(nested.tabs)).toEqual([
      { index: 0, tabId: "t.0", title: "Intro" },
      { index: 1, tabId: "t.0.1", title: "Nested" },
      { index: 2, tabId: "t.1", title: "Notes" },
    ]);
  });
});

describe("resolveApplyTab", () => {
  test("file tabId wins; matching --tab hint is ok", () => {
    expect(resolveApplyTab(nested, "t.1", "Notes")).toEqual({
      tabId: "t.1",
      title: "Notes",
    });
  });

  test("refuses file tabId that does not match the --tab hint", () => {
    expect(() => resolveApplyTab(nested, "t.0", "t.1")).toThrow(/File tabId t.0 does not match --tab t.1/);
  });

  test("refuses a multi-tab file with no tabId", () => {
    expect(() => resolveApplyTab(nested)).toThrow(APPLY_TAB_REQUIRED_MSG);
    expect(() => resolveApplyTab(nested)).toThrow(/"tabId": "t.1"/);
  });
});

describe("tabContent / overlayTab", () => {
  test("returns that tab's documentTab", () => {
    expect(tabContent(nested, "t.0.1").body?.content?.[0]?.paragraph).toBeDefined();
    const overlaid = overlayTab(nested, "t.1");
    expect(overlaid.body?.content?.[0]?.paragraph?.elements?.[0]?.textRun?.content).toBe("notes\n");
  });
});

describe("parseDocument from tabs", () => {
  test("flat body mock still parses", () => {
    const parsed = parseDocument(new Gdoc(mockDoc([para("flat-body")]), "doc"));
    expect(parsed.nodes[0]).toMatchObject({ text: "flat-body" });
  });

  test("reads the selected documentTab, not empty flat body", () => {
    const data: GoogleDoc = {
      tabs: [
        docTab("t.0", "Intro", "hello", undefined),
        {
          ...docTab("t.1", "Notes", "notes"),
          documentTab: {
            body: { content: [para("notes")] },
            headers: {
              "kix.h": {
                headerId: "kix.h",
                content: [para("CONFIDENTIAL")],
              },
            },
            documentStyle: { defaultHeaderId: "kix.h" },
          },
        },
      ],
    };
    const parsed = parseDocument(new Gdoc(data, "doc").withTab("t.1"));
    expect(parsed.nodes[0]).toMatchObject({ text: "notes" });
    expect(parsed.segments).toEqual([
      expect.objectContaining({
        kind: "header",
        segmentId: "kix.h",
        use: "default",
        nodes: [expect.objectContaining({ text: "CONFIDENTIAL" })],
      }),
    ]);
  });
});

describe("resolveRelativeTabIndex", () => {
  const tabsDoc: GoogleDoc = {
    tabs: [
      docTab("t.0", "Intro", "content"),
      docTab("t.1", "Decisions", "content"),
      docTab("t.2", "Appendix", "content"),
    ],
  };

  test("calculates afterTab correctly", () => {
    expect(resolveRelativeTabIndex(tabsDoc, { afterTab: "Intro" })).toBe(1);
    expect(resolveRelativeTabIndex(tabsDoc, { afterTab: "Decisions" })).toBe(2);
    expect(resolveRelativeTabIndex(tabsDoc, { afterTab: "Appendix" })).toBe(3);
  });

  test("calculates beforeTab correctly", () => {
    expect(resolveRelativeTabIndex(tabsDoc, { beforeTab: "Intro" })).toBe(0);
    expect(resolveRelativeTabIndex(tabsDoc, { beforeTab: "Decisions" })).toBe(1);
    expect(resolveRelativeTabIndex(tabsDoc, { beforeTab: "Appendix" })).toBe(2);
  });

  test("resolves movingTabId properly", () => {
    expect(resolveRelativeTabIndex(tabsDoc, { afterTab: "Intro", movingTabId: "t.2" })).toBe(1);
    expect(resolveRelativeTabIndex(tabsDoc, { afterTab: "Decisions", movingTabId: "t.0" })).toBe(1);
  });

  test("throws if both afterTab and beforeTab are passed", () => {
    expect(() => resolveRelativeTabIndex(tabsDoc, { afterTab: "Intro", beforeTab: "Appendix" })).toThrow(
      /Cannot specify both "afterTab" and "beforeTab"/,
    );
  });

  test("throws if index and afterTab are passed", () => {
    expect(() => resolveRelativeTabIndex(tabsDoc, { afterTab: "Intro", index: 2 })).toThrow(
      /Cannot specify both "index" and "afterTab"/,
    );
  });

  test("throws if tab is unknown", () => {
    expect(() => resolveRelativeTabIndex(tabsDoc, { afterTab: "Unknown" })).toThrow(/Unknown tab Unknown/);
  });

  test("throws if tab title is ambiguous", () => {
    const ambiguousDoc: GoogleDoc = {
      tabs: [docTab("t.0", "Notes", "a"), docTab("t.1", "Notes", "b")],
    };
    expect(() => resolveRelativeTabIndex(ambiguousDoc, { afterTab: "Notes" })).toThrow(/Ambiguous tab title "Notes"/);
  });
});
