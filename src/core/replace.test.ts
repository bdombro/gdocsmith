/*

Unit tests for find-and-replace execution (batch native replace and surgical regex engine).

*/

import { describe, expect, test } from "bun:test";
import type { GwsClient } from "./gws.ts";
import {
  createGlobalRegex,
  escapeRegExp,
  executeBatchReplace,
  executeRegexReplace,
  MULTI_TAB_REPLACE_REQUIRED_MSG,
} from "./replace.ts";
import type { DocElement, DocTab, GoogleDoc } from "./types.ts";

function createTab(tabId: string, title: string, content: string[] = []): DocTab {
  return {
    documentTab: {
      body: {
        content: [
          {
            endIndex: 1,
            sectionBreak: {},
            startIndex: 0,
          },
          ...content.map((text, idx) => ({
            endIndex: idx * 10 + 20,
            paragraph: {
              elements: [
                {
                  endIndex: idx * 10 + 20,
                  startIndex: idx * 10 + 1,
                  textRun: { content: `${text}\n` },
                },
              ],
            },
            startIndex: idx * 10 + 1,
          })),
        ],
      },
    },
    tabProperties: { tabId, title },
  };
}

describe("helpers: createGlobalRegex & escapeRegExp", () => {
  test("createGlobalRegex constructs global RegExp with case options", () => {
    const re1 = createGlobalRegex("foo");
    expect(re1.source).toBe("foo");
    expect(re1.flags).toBe("g");

    const re2 = createGlobalRegex("foo", true);
    expect(re2.flags).toBe("gi");

    const re3 = createGlobalRegex(/bar/i);
    expect(re3.source).toBe("bar");
    expect(re3.flags).toBe("gi");

    const re4 = createGlobalRegex("/test/m", true);
    expect(re4.source).toBe("test");
    expect(re4.flags).toContain("g");
    expect(re4.flags).toContain("i");
    expect(re4.flags).toContain("m");
  });

  test("escapeRegExp escapes special regex tokens", () => {
    expect(escapeRegExp("Hello (world) [v1.0]?")).toBe("Hello \\(world\\) \\[v1\\.0\\]\\?");
  });
});

describe("executeBatchReplace", () => {
  test("validates non-empty replacements and find strings", async () => {
    await expect(
      executeBatchReplace("doc-1", {
        replacements: [],
      }),
    ).rejects.toThrow(/No replacements provided/);

    await expect(
      executeBatchReplace("doc-1", {
        replacements: [{ find: "", replace: "val" }],
      }),
    ).rejects.toThrow(/Find string cannot be empty/);
  });

  test("requires --tab or --all-tabs on multi-tab documents", async () => {
    const mockClient: GwsClient = {
      batchUpdate: async () => JSON.stringify({ replies: [] }),
      getDocument: async () => ({
        documentId: "doc-multi",
        revisionId: "rev-1",
        tabs: [createTab("t.1", "Tab One"), createTab("t.2", "Tab Two")],
      }),
      run: async () => "{}",
    };

    await expect(
      executeBatchReplace("doc-multi", {
        client: mockClient,
        replacements: [{ find: "{{NAME}}", replace: "Alice" }],
      }),
    ).rejects.toThrow(MULTI_TAB_REPLACE_REQUIRED_MSG);
  });

  test("executes batch replacement targeting a specific tab", async () => {
    let capturedRequests: object[] = [];

    const mockClient: GwsClient = {
      batchUpdate: async (_docId, requests) => {
        capturedRequests = requests;
        return JSON.stringify({
          replies: [{ replaceAllText: { occurrencesChanged: 3 } }, { replaceAllText: { occurrencesChanged: 1 } }],
        });
      },
      getDocument: async () => ({
        documentId: "doc-1",
        revisionId: "rev-abc-123",
        tabs: [createTab("t.1", "First"), createTab("t.2", "Second")],
      }),
      run: async () => "{}",
    };

    const result = await executeBatchReplace("doc-1", {
      client: mockClient,
      matchCase: true,
      replacements: [
        { find: "{{VAR_1}}", replace: "Val1" },
        { find: "{{VAR_2}}", replace: "Val2" },
      ],
      tabHint: "t.1",
    });

    expect(capturedRequests).toEqual([
      {
        replaceAllText: {
          containsText: { matchCase: true, text: "{{VAR_1}}" },
          replaceText: "Val1",
          tabsCriteria: { tabIds: ["t.1"] },
        },
      },
      {
        replaceAllText: {
          containsText: { matchCase: true, text: "{{VAR_2}}" },
          replaceText: "Val2",
          tabsCriteria: { tabIds: ["t.1"] },
        },
      },
    ]);

    expect(result.occurrencesChanged).toBe(4);
    expect(result.replacements).toEqual([
      { find: "{{VAR_1}}", occurrences: 3, replace: "Val1" },
      { find: "{{VAR_2}}", occurrences: 1, replace: "Val2" },
    ]);
    expect(result.tabId).toBe("t.1");
    expect(result.tabTitle).toBe("First");
    expect(result.dryRun).toBe(false);
  });

  test("executes replacement across all tabs when allTabs is true", async () => {
    let capturedRequests: object[] = [];

    const mockClient: GwsClient = {
      batchUpdate: async (_docId, requests) => {
        capturedRequests = requests;
        return JSON.stringify({
          replies: [{ replaceAllText: { occurrencesChanged: 5 } }],
        });
      },
      getDocument: async () => ({
        documentId: "doc-1",
        revisionId: "rev-1",
        tabs: [createTab("t.1", "First"), createTab("t.2", "Second")],
      }),
      run: async () => "{}",
    };

    const result = await executeBatchReplace("doc-1", {
      allTabs: true,
      client: mockClient,
      matchCase: false,
      replacements: [{ find: "old", replace: "new" }],
    });

    // tabsCriteria must be omitted when targeting all tabs
    expect(capturedRequests).toEqual([
      {
        replaceAllText: {
          containsText: { matchCase: false, text: "old" },
          replaceText: "new",
        },
      },
    ]);
    expect(result.allTabs).toBe(true);
    expect(result.occurrencesChanged).toBe(5);
  });

  test("dry-run accurately counts occurrences and provides snippets without mutating", async () => {
    let batchUpdateCalled = false;

    const mockClient: GwsClient = {
      batchUpdate: async () => {
        batchUpdateCalled = true;
        return "{}";
      },
      getDocument: async () => ({
        documentId: "doc-dry",
        revisionId: "rev-dry-1",
        tabs: [
          createTab("t.1", "Main Tab", [
            "Project status for {{PROJECT_NAME}} is in progress.",
            "Contact {{AUTHOR}} or team lead about {{PROJECT_NAME}} updates.",
          ]),
        ],
      }),
      run: async () => "{}",
    };

    const result = await executeBatchReplace("doc-dry", {
      client: mockClient,
      dryRun: true,
      matchCase: true,
      replacements: [
        { find: "{{PROJECT_NAME}}", replace: "Alpha Core" },
        { find: "{{AUTHOR}}", replace: "Jane Doe" },
        { find: "{{NON_EXISTENT}}", replace: "N/A" },
      ],
      tabHint: "Main Tab",
    });

    expect(batchUpdateCalled).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.occurrencesChanged).toBe(3);
    expect(result.replacements[0]?.find).toBe("{{PROJECT_NAME}}");
    expect(result.replacements[0]?.occurrences).toBe(2);
    expect(result.replacements[0]?.snippets?.length).toBe(2);
    expect(result.replacements[1]?.occurrences).toBe(1);
    expect(result.replacements[2]?.occurrences).toBe(0);
  });
});

describe("executeRegexReplace", () => {
  function makeStructuredDoc(revisionId = "rev-structured-1"): GoogleDoc {
    const content: DocElement[] = [
      {
        endIndex: 1,
        sectionBreak: {},
        startIndex: 0,
      },
      {
        endIndex: 20,
        paragraph: {
          paragraphStyle: { namedStyleType: "HEADING_1" },
          elements: [
            {
              endIndex: 20,
              startIndex: 1,
              textRun: { content: "Section Alpha\n" },
            },
          ],
        },
        startIndex: 1,
      },
      {
        endIndex: 60,
        paragraph: {
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          elements: [
            {
              endIndex: 60,
              startIndex: 20,
              textRun: { content: "Alpha tracked under PROJ-101 and PROJ-102.\n" },
            },
          ],
        },
        startIndex: 20,
      },
      {
        endIndex: 80,
        paragraph: {
          paragraphStyle: { namedStyleType: "HEADING_1" },
          elements: [
            {
              endIndex: 80,
              startIndex: 60,
              textRun: { content: "Section Beta\n" },
            },
          ],
        },
        startIndex: 60,
      },
      {
        endIndex: 120,
        paragraph: {
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          elements: [
            {
              endIndex: 120,
              startIndex: 80,
              textRun: { content: "Beta tracked under PROJ-201 here.\n" },
            },
          ],
        },
        startIndex: 80,
      },
    ];

    return {
      body: { content },
      documentId: "doc-regex",
      revisionId,
    };
  }

  test("replaces pattern with capture groups across whole document", async () => {
    let capturedRequests: object[] = [];

    const mockClient: GwsClient = {
      batchUpdate: async (_docId, requests) => {
        capturedRequests = requests;
        return JSON.stringify({ replies: [] });
      },
      getDocument: async () => makeStructuredDoc("rev-999"),
      run: async () => "{}",
    };

    const result = await executeRegexReplace("doc-regex", {
      client: mockClient,
      regex: "PROJ-(\\d+)",
      replace: "https://jira.corp/$1",
    });

    expect(result.occurrencesChanged).toBe(3);
    expect(result.touchedNodeIds).toEqual(["h.heading_2.09a1", "h.heading_4.1d8b"]);
    expect(result.matches.length).toBe(2);
    expect(result.matches[0]?.at).toBe("h.heading_2.09a1");
    expect(result.matches[0]?.after).toBe("Alpha tracked under https://jira.corp/101 and https://jira.corp/102.");
    expect(result.matches[1]?.at).toBe("h.heading_4.1d8b");
    expect(result.matches[1]?.after).toBe("Beta tracked under https://jira.corp/201 here.");
    expect(capturedRequests.length).toBeGreaterThan(0);
  });

  test("scopes replacements to heading neighborhood using --at", async () => {
    let _capturedRequests: object[] = [];

    const mockClient: GwsClient = {
      batchUpdate: async (_docId, requests) => {
        _capturedRequests = requests;
        return JSON.stringify({ replies: [] });
      },
      getDocument: async () => makeStructuredDoc(),
      run: async () => "{}",
    };

    // Node 2 is "Section Alpha" HEADING_1. Neighborhood walks node 2 and node 3, stopping before node 4 (HEADING_1 Section Beta).
    const result = await executeRegexReplace("doc-regex", {
      at: 2,
      client: mockClient,
      regex: "PROJ-(\\d+)",
      replace: "JIRA-$1",
    });

    expect(result.occurrencesChanged).toBe(2);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.at).toBe("h.heading_2.09a1");
    expect(result.matches[0]?.after).toBe("Alpha tracked under JIRA-101 and JIRA-102.");
    // Node 5 (in Section Beta) must NOT be modified
    expect(result.matches.some((m) => m.at === 5)).toBe(false);
  });

  test("targets only the anchor node when nodeOnly is true", async () => {
    const mockClient: GwsClient = {
      batchUpdate: async () => JSON.stringify({ replies: [] }),
      getDocument: async () => makeStructuredDoc(),
      run: async () => "{}",
    };

    // Node 2 is HEADING_1 "Section Alpha". With nodeOnly, it should not inspect node 3.
    const result = await executeRegexReplace("doc-regex", {
      at: 2,
      client: mockClient,
      nodeOnly: true,
      regex: "Section (\\w+)",
      replace: "Topic $1",
    });

    expect(result.occurrencesChanged).toBe(1);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.at).toBe("h.heading_2.a0e4");
    expect(result.matches[0]?.after).toBe("Topic Alpha");
  });

  test("preserves inline markup and formatting during replacement", async () => {
    const mockClient: GwsClient = {
      batchUpdate: async () => JSON.stringify({ replies: [] }),
      getDocument: async () => ({
        body: {
          content: [
            {
              endIndex: 1,
              sectionBreak: {},
              startIndex: 0,
            },
            {
              endIndex: 40,
              paragraph: {
                elements: [
                  {
                    endIndex: 10,
                    startIndex: 1,
                    textRun: { content: "See " },
                  },
                  {
                    endIndex: 25,
                    startIndex: 10,
                    textRun: {
                      content: "PROJ-500",
                      textStyle: { bold: true },
                    },
                  },
                  {
                    endIndex: 40,
                    startIndex: 25,
                    textRun: { content: " details.\n" },
                  },
                ],
              },
              startIndex: 1,
            },
          ],
        },
        documentId: "doc-markup",
        revisionId: "rev-m",
      }),
      run: async () => "{}",
    };

    const result = await executeRegexReplace("doc-markup", {
      client: mockClient,
      regex: "PROJ-(\\d+)",
      replace: "TICKET-$1",
    });

    expect(result.occurrencesChanged).toBe(1);
    // Preserves markdown syntax (**bold**)
    expect(result.matches[0]?.before).toBe("See **PROJ-500** details.");
    expect(result.matches[0]?.after).toBe("See **TICKET-500** details.");
  });

  test("replaces text inside table cells and handles specific cell targeting", async () => {
    const mockDoc: GoogleDoc = {
      body: {
        content: [
          {
            endIndex: 1,
            sectionBreak: {},
            startIndex: 0,
          },
          {
            endIndex: 50,
            startIndex: 1,
            table: {
              columns: 2,
              rows: 1,
              tableRows: [
                {
                  tableCells: [
                    {
                      content: [
                        {
                          endIndex: 20,
                          paragraph: {
                            elements: [
                              {
                                endIndex: 20,
                                startIndex: 2,
                                textRun: { content: "Status: [TBD]\n" },
                              },
                            ],
                          },
                          startIndex: 2,
                        },
                      ],
                    },
                    {
                      content: [
                        {
                          endIndex: 48,
                          paragraph: {
                            elements: [
                              {
                                endIndex: 48,
                                startIndex: 22,
                                textRun: { content: "Owner: [TBD]\n" },
                              },
                            ],
                          },
                          startIndex: 22,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      documentId: "doc-table",
      revisionId: "rev-tbl-1",
    };

    const mockClient: GwsClient = {
      batchUpdate: async () => JSON.stringify({ replies: [] }),
      getDocument: async () => mockDoc,
      run: async () => "{}",
    };

    // 1. Whole doc regex replace across all table cells
    const allResult = await executeRegexReplace("doc-table", {
      client: mockClient,
      regex: "\\[TBD\\]",
      replace: "Done",
    });

    expect(allResult.occurrencesChanged).toBe(2);
    expect(allResult.matches.length).toBe(2);
    expect(allResult.matches[0]?.at).toBe("_preamble.table.0.0.9f27");
    expect(allResult.matches[0]?.after).toBe("Status: Done");
    expect(allResult.matches[1]?.at).toMatch(/table\.0\.1\./);
    expect(allResult.matches[1]?.after).toBe("Owner: Done");

    // 2. Scoped to a specific cell "2.0.1" (the second cell)
    const cellResult = await executeRegexReplace("doc-table", {
      at: "2.0.1",
      client: mockClient,
      regex: "\\[TBD\\]",
      replace: "Alice",
    });

    expect(cellResult.occurrencesChanged).toBe(1);
    expect(cellResult.matches.length).toBe(1);
    expect(cellResult.matches[0]?.at).toMatch(/table\.0\.1\./);
    expect(cellResult.matches[0]?.after).toBe("Owner: Alice");
  });

  test("dry-run reports matches and diffs without calling batchUpdate", async () => {
    let calledBatchUpdate = false;

    const mockClient: GwsClient = {
      batchUpdate: async () => {
        calledBatchUpdate = true;
        return "{}";
      },
      getDocument: async () => makeStructuredDoc(),
      run: async () => "{}",
    };

    const result = await executeRegexReplace("doc-regex", {
      client: mockClient,
      dryRun: true,
      regex: "Beta",
      replace: "Gamma",
    });

    expect(calledBatchUpdate).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.occurrencesChanged).toBe(2);
    expect(result.matches.length).toBe(2);
  });

  test("throws descriptive error on invalid regular expression", async () => {
    await expect(
      executeRegexReplace("doc-1", {
        regex: "[unclosed",
        replace: "foo",
      }),
    ).rejects.toThrow(/Invalid regular expression/);
  });
});
