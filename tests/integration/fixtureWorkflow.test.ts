/* Live integration tests against Google Docs & Drive APIs using cloned fixture doc. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyScriptExecute } from "~/core/applyScript.ts";
import { gwsDrive } from "~/core/gws.ts";

/** Canonical fixture template document ID used by E2E scenarios. */
const FIXTURE_DOC_ID = "1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc";

/** Standard timeout for live Google API integration test operations (60 seconds). */
const LIVE_TEST_TIMEOUT_MS = 60_000;

describe("live integration fixture workflow", () => {
  let firstTabTitle = "";
  let testDocId = "";
  let elementsTabTitle = "";

  beforeAll(async () => {
    const testTitle = `[TEST] Integration ${Date.now()}`;
    const result = await applyScriptExecute({
      steps: [
        {
          as: "clone",
          dump: true,
          fromDoc: FIXTURE_DOC_ID,
          kind: "docCreate",
          title: testTitle,
        },
      ],
    });

    expect(result.ok).toBe(true);
    const dumpedClone = result.dumped.clone as {
      id: string;
      tabs?: Array<{ id: string; title: string }>;
    };
    expect(dumpedClone?.id).toBeDefined();
    testDocId = dumpedClone.id;

    if (dumpedClone.tabs && dumpedClone.tabs.length > 0) {
      firstTabTitle = dumpedClone.tabs[0]?.title ?? "";
    }
  }, LIVE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (testDocId) {
      try {
        await gwsDrive.deleteFile(testDocId);
      } catch (err) {
        console.error(`Failed to clean up test document ${testDocId}:`, err);
      }
    }
  }, LIVE_TEST_TIMEOUT_MS);

  test(
    "queries document structure, tabs, and outline from live cloned doc",
    async () => {
      expect(testDocId).not.toBe("");

      const result = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            dump: true,
            kind: "docOpen",
          },
          {
            as: "outline",
            doc: "doc",
            kind: "query",
            output: "headings",
          },
        ],
      });

      expect(result.ok).toBe(true);
      const dumpedDoc = result.dumped.doc as {
        id: string;
        tabs: Array<{ id: string; title: string }>;
      };
      expect(dumpedDoc).toBeDefined();
      expect(dumpedDoc.id).toBe(testDocId);
      expect(Array.isArray(dumpedDoc.tabs)).toBe(true);
      expect(dumpedDoc.tabs.length).toBeGreaterThan(0);

      if (!firstTabTitle && dumpedDoc.tabs[0]?.title) {
        firstTabTitle = dumpedDoc.tabs[0].title;
      }

      const dumpedOutline = result.dumped.outline as {
        alias: string;
        headings: Array<{ headingId?: string; id?: string; level: number; text: string }>;
        id: string;
        kind: "outline";
        tabs: Array<{
          headings: Array<{ headingId?: string; id?: string; level: number; text: string }>;
          tabId?: string;
          tabTitle?: string;
        }>;
      };
      expect(dumpedOutline.kind).toBe("outline");
      expect(Array.isArray(dumpedOutline.headings)).toBe(true);
      expect(dumpedOutline.headings.length).toBeGreaterThan(0);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  test(
    "performs surgical section replacement and verified in-place update",
    async () => {
      expect(testDocId).not.toBe("");
      expect(firstTabTitle).not.toBe("");

      const initialTimestamp = Date.now();
      const insertResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            doc: "doc",
            kind: "markdownInsert",
            markdown: `\n\n## Verification Section\n\nInitial verification payload ${initialTimestamp}.\n`,
            tab: firstTabTitle,
          },
        ],
      });
      expect(insertResult.ok).toBe(true);

      const updatedTimestamp = Date.now();
      const replaceResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            doc: "doc",
            kind: "replaceSection",
            markdown: `## Verification Section\n\nReplaced surgical payload ${updatedTimestamp}.\n`,
            nodeAt: "Verification Section",
            tab: firstTabTitle,
          },
        ],
      });
      expect(replaceResult.ok).toBe(true);

      const verifyResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "tabMarkdown",
            doc: "doc",
            kind: "query",
            output: "markdown",
            tab: firstTabTitle,
          },
        ],
      });
      expect(verifyResult.ok).toBe(true);
      const tabMd = (verifyResult.dumped.tabMarkdown as { markdown: string }).markdown;
      expect(tabMd).toContain(`Replaced surgical payload ${updatedTimestamp}`);
      expect(tabMd).not.toContain(`Initial verification payload ${initialTimestamp}`);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  test(
    "creates a tab with relative positioning and cross-tab symbolic links",
    async () => {
      expect(testDocId).not.toBe("");
      expect(firstTabTitle).not.toBe("");

      const newTabTitle = `Integration Tab ${Date.now()}`;
      const tabCreateResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            afterTab: firstTabTitle,
            as: "newTab",
            doc: "doc",
            kind: "tabCreate",
            title: newTabTitle,
          },
          {
            doc: "doc",
            kind: "markdownInsert",
            markdown: `# Linked Tab\n\nReference back to [Workflow](tab:${firstTabTitle}#Verification Section).\n`,
            tab: newTabTitle,
          },
        ],
      });
      expect(tabCreateResult.ok).toBe(true);

      const queryTabResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "newTabMd",
            doc: "doc",
            kind: "query",
            output: "markdown",
            tab: newTabTitle,
          },
        ],
      });
      expect(queryTabResult.ok).toBe(true);
      const newTabMd = (queryTabResult.dumped.newTabMd as { markdown: string }).markdown;
      expect(newTabMd).toContain("Linked Tab");
      expect(newTabMd).toContain("Reference back to");
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  test(
    "replaces placeholder paragraph using find: in replaceMarkdown while preserving child subsections and headings",
    async () => {
      expect(testDocId).not.toBe("");

      const placeholderNeedle = "Placeholder: Replace with architectural specification and component breakdown.";
      const updatedOverview = "Quantum Pigeon Routing Service operates at 432MHz.";

      const replaceResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            doc: "doc",
            find: placeholderNeedle,
            kind: "replaceMarkdown",
            markdown: `### Architectural Specification\n\n1. **Core Service**: ${updatedOverview}\n2. **Beacon Array**: Calibrates frequency.`,
            tab: "Spec Template",
          },
        ],
      });
      expect(replaceResult.ok).toBe(true);

      const queryResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "specMd",
            doc: "doc",
            kind: "query",
            output: "markdown",
            tab: "Spec Template",
          },
        ],
      });
      expect(queryResult.ok).toBe(true);
      const specMd = (queryResult.dumped.specMd as { markdown: string }).markdown;

      // Placeholder is replaced
      expect(specMd).toContain(updatedOverview);
      expect(specMd).not.toContain(placeholderNeedle);

      // Child subsections and table under System Architecture remain intact
      expect(specMd).toContain("Avionics Personnel & Timeline");
      expect(specMd).toContain("Network Topology Diagram");
      expect(specMd).toContain("Roost Capacity Matrix");
      expect(specMd).toContain("Alpha Centauri Orbital");
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  test(
    "inserts markdown tables and nested lists with multi-level bullets and numbering",
    async () => {
      expect(testDocId).not.toBe("");

      elementsTabTitle = `Elements Tab ${Date.now()}`;
      const insertResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "elTab",
            doc: "doc",
            kind: "tabCreate",
            title: elementsTabTitle,
          },
          {
            doc: "doc",
            kind: "markdownInsert",
            markdown: [
              "# Elements Showcase",
              "",
              "## Nested Bullet Section",
              "",
              "- Root Bullet Level 0",
              "  - Nested Bullet Level 1",
              "    - Deep Bullet Level 2",
              "",
              "## Nested Numbered Section",
              "",
              "1. First Numbered Step",
              "   1. Sub-step Level 1",
              "      1. Detail Level 2",
              "2. Second Numbered Step",
              "",
              "## Component Table Section",
              "",
              "| Module | Status | Latency |",
              "| --- | --- | --- |",
              "| Quantum Router | Active | 12ms |",
              "| Subspace Relay | Standby | 48ms |",
            ].join("\n"),
            tab: elementsTabTitle,
          },
        ],
      });
      expect(insertResult.ok).toBe(true);

      const queryResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "elNodes",
            doc: "doc",
            full: true,
            kind: "query",
            output: "nodes",
            tab: elementsTabTitle,
          },
        ],
      });
      expect(queryResult.ok).toBe(true);
      const nodes = queryResult.dumped.elNodes as Array<{
        bullet?: { nestingLevel: number; type?: string };
        id: string;
        kind: string;
        namedStyleType?: string;
        table?: { cols: number; rows: number };
        text?: string;
      }>;
      expect(Array.isArray(nodes)).toBe(true);

      // Verify table node
      const tableNode = nodes.find((n) => n.kind === "table" && n.table?.rows === 3);
      expect(tableNode).toBeDefined();
      expect(tableNode?.table?.cols).toBe(3);

      // Verify bullet list nesting levels
      const bulletLevel0 = nodes.find((n) => n.text?.includes("Root Bullet Level 0"));
      const bulletLevel1 = nodes.find((n) => n.text?.includes("Nested Bullet Level 1"));
      const bulletLevel2 = nodes.find((n) => n.text?.includes("Deep Bullet Level 2"));
      expect(bulletLevel0?.bullet?.nestingLevel).toBe(0);
      expect(bulletLevel1?.bullet?.nestingLevel).toBe(1);
      expect(bulletLevel2?.bullet?.nestingLevel).toBe(2);

      // Verify numbered list nesting levels
      const numLevel0 = nodes.find((n) => n.text?.includes("First Numbered Step"));
      const numLevel1 = nodes.find((n) => n.text?.includes("Sub-step Level 1"));
      const numLevel2 = nodes.find((n) => n.text?.includes("Detail Level 2"));
      expect(numLevel0?.bullet?.nestingLevel).toBe(0);
      expect(numLevel1?.bullet?.nestingLevel).toBe(1);
      expect(numLevel2?.bullet?.nestingLevel).toBe(2);
      expect(numLevel0?.bullet?.type).toBe("NUMBERED");
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  test(
    "clones element nodes (styled heading, table, list item) and copies styles and structure",
    async () => {
      expect(testDocId).not.toBe("");
      expect(elementsTabTitle).not.toBe("");

      // Query the existing elements from the tab
      const queryResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "sourceNodes",
            doc: "doc",
            full: true,
            kind: "query",
            output: "nodes",
            tab: elementsTabTitle,
          },
        ],
      });
      expect(queryResult.ok).toBe(true);
      const sourceNodes = queryResult.dumped.sourceNodes as Array<{
        bullet?: { nestingLevel: number; type?: string };
        id: string;
        kind: string;
        namedStyleType?: string;
        table?: { cols: number; rows: number };
        text?: string;
      }>;

      const headingNode = sourceNodes.find((n) => n.text?.includes("Nested Bullet Section"));
      expect(headingNode?.id).toBeDefined();
      expect(headingNode?.namedStyleType).toBe("HEADING_2");

      const tableNode = sourceNodes.find((n) => n.kind === "table" && n.table?.rows === 3);
      expect(tableNode?.id).toBeDefined();

      const bulletNode = sourceNodes.find((n) => n.text?.includes("Root Bullet Level 0"));
      expect(bulletNode?.id).toBeDefined();

      // Clone heading with custom text, clone table, and clone bullet item
      const cloneResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            cloneNode: {
              innerText: "Cloned Bullet Section Heading",
              nodeId: headingNode!.id,
            },
            doc: "doc",
            kind: "surgical",
            nodeAfter: tableNode!.id,
            tab: elementsTabTitle,
          },
          {
            cloneNode: tableNode!.id,
            doc: "doc",
            kind: "surgical",
            nodeAfter: "Cloned Bullet Section Heading",
            tab: elementsTabTitle,
          },
          {
            cloneNode: bulletNode!.id,
            doc: "doc",
            kind: "surgical",
            nodeAfter: "Cloned Bullet Section Heading",
            tab: elementsTabTitle,
          },
        ],
      });
      expect(cloneResult.ok).toBe(true);

      // Verify the cloned nodes and their preserved styles
      const verifyQueryResult = await applyScriptExecute({
        steps: [
          {
            as: "doc",
            doc: testDocId,
            kind: "docOpen",
          },
          {
            as: "clonedNodes",
            doc: "doc",
            full: true,
            kind: "query",
            output: "nodes",
            tab: elementsTabTitle,
          },
        ],
      });
      expect(verifyQueryResult.ok).toBe(true);
      const clonedNodes = verifyQueryResult.dumped.clonedNodes as Array<{
        bullet?: { nestingLevel: number; type?: string };
        id: string;
        kind: string;
        namedStyleType?: string;
        table?: { cols: number; rows: number };
        text?: string;
      }>;

      // 1. Verify cloned heading copied style (HEADING_2)
      const clonedHeading = clonedNodes.find((n) => n.text?.includes("Cloned Bullet Section Heading"));
      expect(clonedHeading).toBeDefined();
      expect(clonedHeading?.namedStyleType).toBe("HEADING_2");

      // 2. Verify cloned table copied structure (rows: 3, cols: 3)
      const tables = clonedNodes.filter((n) => n.kind === "table");
      expect(tables.length).toBeGreaterThanOrEqual(2);
      const clonedTable = tables[tables.length - 1];
      expect(clonedTable?.table?.rows).toBe(3);
      expect(clonedTable?.table?.cols).toBe(3);

      // 3. Verify cloned bullet item copied list bullet style and nesting
      const matchingBullets = clonedNodes.filter((n) => n.text?.includes("Root Bullet Level 0"));
      expect(matchingBullets.length).toBeGreaterThanOrEqual(2);
      const clonedBullet = matchingBullets[matchingBullets.length - 1];
      expect(clonedBullet?.bullet?.nestingLevel).toBe(0);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  test(
    "executes CLI workflow document piped via stdin",
    async () => {
      expect(testDocId).not.toBe("");

      const cliPayload = {
        steps: [
          {
            as: "cliDoc",
            doc: testDocId,
            dump: true,
            kind: "docOpen",
          },
          {
            as: "cliOutline",
            doc: "cliDoc",
            kind: "query",
            output: "headings",
          },
        ],
      };

      const proc = Bun.spawn(["bun", "./src/index.ts", "run"], {
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      });

      proc.stdin.write(JSON.stringify(cliPayload));
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        console.error("CLI stdout:", stdout);
        console.error("CLI stderr:", stderr);
      }
      expect(exitCode).toBe(0);

      const parsed = JSON.parse(stdout) as {
        dumped?: {
          cliDoc?: { id: string };
          cliOutline?: { headings?: Array<{ level: number; text: string }> };
        };
        ok: boolean;
        stepsCount: number;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.dumped?.cliDoc?.id).toBe(testDocId);
      expect(Array.isArray(parsed.dumped?.cliOutline?.headings)).toBe(true);
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
