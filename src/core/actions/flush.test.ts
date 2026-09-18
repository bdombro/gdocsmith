import { describe, expect, test } from "bun:test";
import { applyScriptExecute } from "~/core/applyScript.ts";
import { docCache } from "~/core/cache/docCache.ts";

describe("flush and revision mismatch replay", () => {
  test("replays declarative mutations when batchUpdate fails on revision conflict", async () => {
    docCache.clear();

    let batchUpdateAttempts = 0;
    const requiredRevisionIdsSeen: string[] = [];
    let getDocumentCalls = 0;

    const initialDocData = {
      body: {
        content: [
          { endIndex: 1, sectionBreak: {}, startIndex: 0 },
          {
            endIndex: 15,
            paragraph: {
              elements: [{ textRun: { content: "Original text\n" } }],
              paragraphStyle: { headingId: "h.intro", namedStyleType: "HEADING_1" },
            },
            startIndex: 1,
          },
        ],
      },
      documentId: "doc-replay",
      revisionId: "rev-initial-1",
    };

    const updatedDocData = {
      body: {
        content: [
          { endIndex: 1, sectionBreak: {}, startIndex: 0 },
          {
            endIndex: 25,
            paragraph: {
              elements: [{ textRun: { content: "Original text with edit\n" } }],
              paragraphStyle: { headingId: "h.intro", namedStyleType: "HEADING_1" },
            },
            startIndex: 1,
          },
        ],
      },
      documentId: "doc-replay",
      revisionId: "rev-cloud-2",
    };

    const mockClient = {
      batchUpdate: async (_docId: string, _reqs: unknown[], opts?: { requiredRevisionId?: string }) => {
        batchUpdateAttempts++;
        if (opts?.requiredRevisionId) {
          requiredRevisionIdsSeen.push(opts.requiredRevisionId);
        }

        // First attempt fails with Google Docs revision mismatch 400
        if (batchUpdateAttempts === 1) {
          throw new Error(
            "Google API error (400): The revision ID provided in the write control does not match the current revision of the document.",
          );
        }
        return "{}";
      },
      getDocument: async () => {
        getDocumentCalls++;
        // Return updated doc once first batchUpdate fails
        return batchUpdateAttempts > 0 ? structuredClone(updatedDocData) : structuredClone(initialDocData);
      },
      run: async () => "",
    };

    const res = await applyScriptExecute(
      {
        dryRun: false,
        steps: [
          { as: "doc", doc: "doc-replay", kind: "docOpen" },
          {
            doc: "doc",
            kind: "innerText",
            nodeAt: "h.intro",
            text: "Updated text",
          },
        ],
      },
      { client: mockClient },
    );

    expect(res.ok).toBe(true);
    // Two batch update attempts: first failed on rev-initial-1, second succeeded on rev-cloud-2
    expect(batchUpdateAttempts).toBe(2);
    expect(requiredRevisionIdsSeen[0]).toBe("rev-initial-1");
    expect(requiredRevisionIdsSeen[1]).toBe("rev-cloud-2");
    expect(getDocumentCalls).toBeGreaterThanOrEqual(2);

    docCache.clear();
  });

  test("throws immediately when error is not a revision conflict", async () => {
    docCache.clear();

    const docData = {
      body: {
        content: [
          { endIndex: 1, sectionBreak: {}, startIndex: 0 },
          {
            endIndex: 10,
            paragraph: {
              elements: [{ textRun: { content: "Header\n" } }],
              paragraphStyle: { headingId: "h.hdr", namedStyleType: "HEADING_1" },
            },
            startIndex: 1,
          },
        ],
      },
      documentId: "doc-perm-err",
      revisionId: "rev-1",
    };

    const mockClient = {
      batchUpdate: async () => {
        throw new Error("Permission denied on doc-perm-err.");
      },
      getDocument: async () => structuredClone(docData),
      run: async () => "",
    };

    await expect(
      applyScriptExecute(
        {
          dryRun: false,
          steps: [
            { as: "doc", doc: "doc-perm-err", kind: "docOpen" },
            {
              doc: "doc",
              kind: "innerText",
              nodeAt: "h.hdr",
              text: "New content",
            },
          ],
        },
        { client: mockClient },
      ),
    ).rejects.toThrow("Permission denied");

    docCache.clear();
  });
});
