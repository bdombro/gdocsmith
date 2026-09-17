import { describe, expect, test } from "bun:test";
import type { GdocsmithDocument } from "../commands/run/types.ts";
import { applyScriptExecute } from "./applyScript.ts";

describe("applyScriptExecute", () => {
  test("runs docCreate and markdownInsert in dry-run with unified diff preview", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "myDoc",
          kind: "docCreate",
          title: "Architecture Spec",
        },
        {
          doc: "myDoc",
          kind: "markdownInsert",
          markdown: "# Architecture Spec\n\nInitial overview.",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(2);
    expect(res.diff).toBeDefined();
    expect(res.diff).toContain("--- /dev/null");
    expect(res.diff).toContain("+++ b/myDoc/t.0");
    expect(res.diff).toContain("+# Architecture Spec");
    expect(res.diff).toContain("+Initial overview.");
    expect(res.highlights.length).toBeGreaterThan(0);
    expect(res.highlights[0]?.as).toBe("myDoc");
  });

  test("query alias cannot be used directly as a mutation anchor", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Query and Replace Safety Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: DRAFT\n\n## Section 2\nContent here",
        },
        {
          as: "statusNode",
          contains: "DRAFT",
          doc: "doc1",
          kind: "query",
        },
        {
          doc: "doc1",
          kind: "replace",
          nodeAt: "statusNode",
          replace: "Status: APPROVED",
        },
      ],
    };

    expect(applyScriptExecute(doc)).rejects.toThrow(
      'Alias "statusNode" is a query result. Mutations must target an explicit scopedId from the query output.',
    );
  });

  test("surgical replace applies to an explicit scopedId", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Query and Replace ScopedId Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: DRAFT\n\n## Section 2\nContent here",
        },
        {
          as: "statusNode",
          contains: "DRAFT",
          doc: "doc1",
          kind: "query",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const nodes = res.dumped.statusNode as Array<{ id: string; text?: string }>;
    const targetId = nodes[0]?.id;
    expect(targetId).toBeDefined();

    const mutateDoc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Query and Replace ScopedId Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: DRAFT\n\n## Section 2\nContent here",
        },
        {
          doc: "doc1",
          kind: "replace",
          nodeAt: targetId!,
          replace: "Status: APPROVED",
        },
      ],
    };
    const mutateRes = await applyScriptExecute(mutateDoc);
    expect(mutateRes.ok).toBe(true);
    expect(mutateRes.diff).toContain("+Status: APPROVED");
  });

  test("dump: true on docCreate and tabAdd dumps kind, id, title, and tabs into dumped", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          dump: true,
          kind: "docCreate",
          title: "My Lifecycle Doc",
        },
        {
          as: "tab2",
          doc: "doc1",
          dump: true,
          kind: "tabAdd",
          title: "Sub Tab",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.dumped.doc1).toEqual({
      alias: "doc1",
      id: "virtual:doc1",
      kind: "doc",
      tabs: [
        { id: "t.0", kind: "tab", title: "Main" },
        { id: "virtual:tab_tab2_1", kind: "tab", title: "Sub Tab" },
      ],
      title: "My Lifecycle Doc",
    });
    expect(res.dumped.tab2).toEqual({
      alias: "tab2",
      id: "virtual:tab_tab2_1",
      kind: "tab",
      title: "Sub Tab",
    });
  });

  test("kind query automatically deposits matches into dumped[as]", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Dump Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: DRAFT",
        },
        {
          as: "statusNode",
          contains: "DRAFT",
          doc: "doc1",
          kind: "query",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.dumped.statusNode).toBeDefined();
    const dumped = res.dumped.statusNode as Array<{ text?: string }>;
    expect(Array.isArray(dumped)).toBe(true);
    expect(dumped.some((n) => n.text?.includes("DRAFT"))).toBe(true);
  });

  /** Tests that query retains bullet nesting metadata. */
  test("kind query retains bullet nesting level in dumped output", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Bullet Dump Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "- Top bullet\n  - Nested bullet",
        },
        {
          as: "nestedNodes",
          contains: "Nested",
          doc: "doc1",
          kind: "query",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const dumped = res.dumped.nestedNodes as Array<{ bullet?: { nestingLevel: number }; text?: string }>;
    expect(dumped[0]?.bullet?.nestingLevel).toBe(1);
  });

  test("kind dump step is removed and throws unknown kind error", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "statusNode",
          kind: "dump",
        },
      ],
    };
    expect(applyScriptExecute(doc)).rejects.toThrow("unknown kind: dump");
  });

  test("close removes doc from context and prevents stale access", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "docTemp",
          kind: "docCreate",
          title: "Temporary",
        },
        {
          kind: "docClose",
          doc: "docTemp",
        },
        {
          doc: "docTemp",
          kind: "markdownInsert",
          markdown: "Will fail",
        },
      ],
    };

    expect(applyScriptExecute(doc)).rejects.toThrow("is not open or was closed");
  });

  test("kind query auto-dumps matches and serializes markdown for a tab", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Markdown Dump",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: DRAFT\n\n## Architecture\nDetails here",
        },
        {
          as: "tabMd",
          doc: "doc1",
          kind: "query",
          output: "markdown",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const dumped = res.dumped.tabMd as { id?: string; kind?: string; markdown?: string };
    expect(dumped.kind).toBe("markdown");
    expect(dumped.id).toBe("virtual:doc1");
    expect(dumped.markdown).toContain("# Overview");
    expect(dumped.markdown).toContain("Status: DRAFT");
    expect(dumped.markdown).toContain("Architecture");
  });

  test("kind query output markdown scopes a heading section via nodeUnder", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Section Dump",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nIntro text\n\n## Architecture\nMicroservices design\n\n## Database\nPostgres",
        },
        {
          as: "archMd",
          doc: "doc1",
          kind: "query",
          output: "markdown",
          nodeUnder: "5",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    const dumped = res.dumped.archMd as { markdown?: string };
    expect(dumped.markdown).toContain("Architecture");
    expect(dumped.markdown).toContain("Microservices design");
    expect(dumped.markdown).not.toContain("Postgres");
  });

  test("kind query throws when a filter matches no nodes", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Empty Query",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nHello",
        },
        {
          as: "missing",
          contains: "definitely-not-in-doc",
          doc: "doc1",
          kind: "query",
        },
      ],
    };

    expect(applyScriptExecute(doc)).rejects.toThrow("no nodes matched");
  });

  test("kind surgical insertPerson dry-run applies after a queried heading", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Chip Insert",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nTeam",
        },
        {
          doc: "doc1",
          insertPerson: { email: "alice@example.com" },
          kind: "surgical",
          nodeAfter: "h.heading_3.baa5",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(3);
  });

  test("docOpen, docClose, and nodeAt/nodeAfter/nodeBefore work in workflow steps", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Doc Open Close Test",
        },
        {
          doc: "doc1",
          kind: "docClose",
        },
        {
          as: "doc1",
          doc: "fake-doc-id-12345",
          kind: "docOpen",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: PENDING",
        },
        {
          as: "statusQuery",
          contains: "PENDING",
          doc: "doc1",
          kind: "query",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(5);
    const nodes = res.dumped.statusQuery as Array<{ id: string; text?: string }>;
    const targetId = nodes[0]?.id;
    expect(targetId).toBeDefined();

    const mutateDoc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          doc: "fake-doc-id-12345",
          kind: "docOpen",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# Overview\n\nStatus: PENDING",
        },
        {
          doc: "doc1",
          kind: "replace",
          nodeAt: targetId!,
          replace: "Status: DONE",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "\n\nFollow up note",
          nodeAfter: targetId!,
        },
      ],
    };

    const mutateRes = await applyScriptExecute(mutateDoc);
    expect(mutateRes.ok).toBe(true);
    expect(mutateRes.stepsCount).toBe(4);
    expect(mutateRes.diff).toContain("+Status: DONE");
  });

  test("file-touching steps require doc", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Require Doc",
        },
        {
          kind: "query",
          as: "all",
          output: "markdown",
        },
      ],
    };
    expect(applyScriptExecute(doc)).rejects.toThrow(/Specify doc:/);
  });

  test("rejects raw doc ID on action step with actionable guidance", async () => {
    const rawDocId = "1Gp-Qqt5sv4KUucL__-rYEoSXBrHLtku9g8AF8peK-FU";
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Strict Doc Alias",
        },
        {
          as: "q",
          doc: rawDocId,
          kind: "query",
        },
      ],
    };
    expect(applyScriptExecute(doc)).rejects.toThrow(
      /Document ID "1Gp-Qqt5sv4KUucL__-rYEoSXBrHLtku9g8AF8peK-FU" cannot be used directly in doc: on action steps/,
    );
  });

  test("resolves raw doc ID if document is already open in session", async () => {
    const rawDocId = "1Gp-Qqt5sv4KUucL__-rYEoSXBrHLtku9g8AF8peK-FU";
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "opened",
          doc: rawDocId,
          kind: "docOpen",
        },
        {
          as: "q",
          doc: rawDocId,
          kind: "query",
        },
      ],
    };
    const result = await applyScriptExecute(doc);
    expect(result.ok).toBe(true);
  });

  test("filters query by headingLevels, nestingLevels, and nodeKinds", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Query Filter Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown:
            "# Spec Title\n\n## Section 1\n\n- Root bullet 1\n  - Sub bullet 1.1\n\nParagraph text\n\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |",
        },
        {
          as: "h2Nodes",
          doc: "doc1",
          headingLevels: [2],
          kind: "query",
        },
        {
          as: "rootBullets",
          doc: "doc1",
          kind: "query",
          nestingLevels: [0],
        },
        {
          as: "tables",
          doc: "doc1",
          kind: "query",
          nodeKinds: ["table"],
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const h2Nodes = res.dumped.h2Nodes as Array<{ namedStyleType?: string; text?: string }>;
    expect(h2Nodes).toHaveLength(1);
    expect(h2Nodes[0]?.namedStyleType).toBe("HEADING_2");
    expect(h2Nodes[0]?.text).toBe("Section 1");

    const rootBullets = res.dumped.rootBullets as Array<{ bullet?: { nestingLevel: number }; text?: string }>;
    expect(rootBullets).toHaveLength(1);
    expect(rootBullets[0]?.bullet?.nestingLevel).toBe(0);
    expect(rootBullets[0]?.text).toBe("Root bullet 1");

    const tables = res.dumped.tables as Array<{ kind: string }>;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.kind).toBe("table");
  });

  test("filters table cells by rows and cols", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Table Query Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown:
            "## Pricing\n\n| Plan | Price | Billing |\n| --- | --- | --- |\n| Starter | Free | None |\n| Pro | $20 | Monthly |",
        },
        {
          as: "headerCells",
          doc: "doc1",
          kind: "query",
          rows: [0],
        },
        {
          as: "pricingCol",
          doc: "doc1",
          kind: "query",
          cols: [1],
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const headerCells = res.dumped.headerCells as Array<{ col?: number; row?: number; text?: string }>;
    expect(headerCells).toHaveLength(3);
    expect(headerCells.map((c) => c.text)).toEqual(["Plan", "Price", "Billing"]);
    expect(headerCells.every((c) => c.row === 0)).toBe(true);

    const pricingCol = res.dumped.pricingCol as Array<{ col?: number; row?: number; text?: string }>;
    expect(pricingCol).toHaveLength(3);
    expect(pricingCol.map((c) => c.text)).toEqual(["Price", "Free", "$20"]);
    expect(pricingCol.every((c) => c.col === 1)).toBe(true);
  });

  test("filters nodes by fontColors with semantic names and exclusions", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Color Query Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "## Notes\n\n::alert[CRITICAL WARNING]::\n\nNormal black text",
          markdownStyles: {
            alert: { foregroundColor: "#EA4335" },
          },
        },
        {
          as: "redNodes",
          doc: "doc1",
          fontColors: ["red"],
          kind: "query",
        },
        {
          as: "customColorNodes",
          doc: "doc1",
          fontColors: ["!default"],
          kind: "query",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);

    const redNodes = res.dumped.redNodes as Array<{ text?: string }>;
    expect(redNodes).toHaveLength(1);
    expect(redNodes[0]?.text).toContain("CRITICAL WARNING");

    const customColorNodes = res.dumped.customColorNodes as Array<{ text?: string }>;
    expect(customColorNodes).toHaveLength(1);
    expect(customColorNodes[0]?.text).toContain("CRITICAL WARNING");
  });

  test("filters bullet lists with sameList and nodeUnder", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "SameList Query Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "## Tasks\n\n- Task 1\n  - Subtask 1.1\n- Task 2\n\nNot a list paragraph",
        },
        {
          as: "firstTaskQuery",
          contains: "Task 1",
          doc: "doc1",
          kind: "query",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const targetId = (res.dumped.firstTaskQuery as Array<{ id: string }>)[0]?.id;
    expect(targetId).toBeDefined();

    const scopeDoc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "SameList Query Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "## Tasks\n\n- Task 1\n  - Subtask 1.1\n- Task 2\n\nNot a list paragraph",
        },
        {
          as: "entireList",
          doc: "doc1",
          kind: "query",
          nodeUnder: targetId!,
          sameList: true,
        },
        {
          as: "subtreeOnly",
          doc: "doc1",
          kind: "query",
          nodeUnder: targetId!,
        },
      ],
    };

    const scopeRes = await applyScriptExecute(scopeDoc);
    expect(scopeRes.ok).toBe(true);

    const entireList = scopeRes.dumped.entireList as Array<{ text?: string }>;
    expect(entireList.map((n) => n.text)).toEqual(["Task 1", "Subtask 1.1", "Task 2"]);

    const subtreeOnly = scopeRes.dumped.subtreeOnly as Array<{ text?: string }>;
    expect(subtreeOnly.map((n) => n.text)).toEqual(["Task 1", "Subtask 1.1"]);
  });

  test("tabCopy duplicates tab and content in dryRun, supports queries and diffs", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "sourceDoc",
          kind: "docCreate",
          title: "Tab Copy Test",
        },
        {
          doc: "sourceDoc",
          kind: "markdownInsert",
          markdown: "# Spec Template\n\nOwner: Brian\n\n## Motivation\n\nInitial draft motivation.",
        },
        {
          as: "doc1",
          copyFrom: "sourceDoc",
          kind: "docCopy",
          title: "Multi-tab Copy",
        },
        {
          as: "copiedTab",
          copyFromTab: "Main",
          doc: "doc1",
          kind: "tabCopy",
          title: "Feature Branch Tab",
        },
        {
          as: "copiedQuery",
          doc: "doc1",
          kind: "query",
          output: "markdown",
          tab: "Feature Branch Tab",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(5);

    const queryPayload = res.dumped.copiedQuery as { markdown: string };
    expect(queryPayload.markdown).toContain("Spec Template");
    expect(queryPayload.markdown).toContain("Initial draft motivation.");
  });

  test("textReplace with find/replace works without anchors and updates in-memory content", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Text Replace Find Test",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "# <Project Spec Title in 3-8 words>\n\nStatus: PENDING",
        },
        {
          doc: "doc1",
          find: "<Project Spec Title in 3-8 words>",
          kind: "textReplace",
          replace: "Upgrade legacy automations",
        },
        {
          as: "checkResult",
          doc: "doc1",
          kind: "query",
          output: "markdown",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(4);
    const checkResult = res.dumped.checkResult as { markdown: string };
    expect(checkResult.markdown).toContain("Upgrade legacy automations");
    expect(checkResult.markdown).not.toContain("<Project Spec Title in 3-8 words>");
  });

  test("docCopy in dryRun clones multi-tab doc and allows chained edits", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "sourceDoc",
          kind: "docCreate",
          title: "Multi-tab Source",
        },
        {
          doc: "sourceDoc",
          kind: "markdownInsert",
          markdown: "# Root Tab Content",
        },
        {
          as: "tab2",
          doc: "sourceDoc",
          kind: "tabAdd",
          title: "Second Tab",
        },
        {
          doc: "sourceDoc",
          kind: "markdownInsert",
          markdown: "# Second Tab Content",
          tab: "Second Tab",
        },
        {
          as: "targetDoc",
          copyFrom: "sourceDoc",
          kind: "docCopy",
          title: "Copied Multi-tab Doc",
        },
        {
          doc: "targetDoc",
          find: "Second Tab Content",
          kind: "textReplace",
          replace: "Mutated Second Tab Content",
          tab: "Second Tab",
        },
        {
          as: "targetTab2Query",
          doc: "targetDoc",
          kind: "query",
          output: "markdown",
          tab: "Second Tab",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(7);
    const targetQuery = res.dumped.targetTab2Query as { markdown: string };
    expect(targetQuery.markdown).toContain("Mutated Second Tab Content");
    expect(targetQuery.markdown).not.toContain("# Second Tab Content");

    const queryTab1 = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "docOpenTest",
          doc: "1OHwV5mcmyS1JGe4b7232GqYQlL6-Tgdj_hVfm8AHdhM",
          kind: "docOpen",
        },
        {
          as: "tplByTitle",
          doc: "docOpenTest",
          kind: "query",
          output: "markdown",
          tab: "Project Spec Template",
        },
      ],
    });
    expect(queryTab1.ok).toBe(true);
    expect((queryTab1.dumped.tplByTitle as { markdown: string }).markdown).toContain(
      "<Project Spec Title in 3-8 words>",
    );

    const queryAllTabs = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "docOpenWorkflow",
          doc: "1OHwV5mcmyS1JGe4b7232GqYQlL6-Tgdj_hVfm8AHdhM",
          dump: true,
          kind: "docOpen",
        },
        {
          as: "workflowMd",
          doc: "docOpenWorkflow",
          kind: "query",
          output: "markdown",
        },
      ],
    });
    expect(queryAllTabs.ok).toBe(true);
    const allTabsDumped = queryAllTabs.dumped.workflowMd as { markdown: string };
    expect(allTabsDumped.markdown).toContain("<Project Spec Title in 3-8 words>");
    expect(allTabsDumped.markdown).toContain("---");

    expect(
      applyScriptExecute({
        dryRun: true,
        steps: [
          {
            as: "docOpenWorkflow",
            doc: "1OHwV5mcmyS1JGe4b7232GqYQlL6-Tgdj_hVfm8AHdhM",
            kind: "docOpen",
          },
          {
            as: "workflowNodes",
            doc: "docOpenWorkflow",
            kind: "query",
            output: "nodes",
          },
        ],
      }),
    ).rejects.toThrow("This Doc has multiple tabs. Specify --tab <id|title>.");
  });

  test("query output: outline returns headings with links and deep anchors", async () => {
    const res = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "myDoc",
          kind: "docCreate",
          title: "Spec Doc",
        },
        {
          doc: "myDoc",
          kind: "markdownInsert",
          markdown: "# My Title\n\nOwner line\n\n## Motivation\n\nWhy now.\n\n## Objective\n\nGoals.",
        },
        {
          as: "outlineDump",
          doc: "myDoc",
          kind: "query",
          output: "outline",
        },
      ],
    });

    expect(res.ok).toBe(true);
    const outline = res.dumped.outlineDump as {
      alias: string;
      headings: Array<{ headingId?: string; id: string; level: number; link?: string; text: string }>;
      kind: string;
      tabs: Array<{ headings: Array<{ text: string }> }>;
    };
    expect(outline.kind).toBe("outline");
    expect(outline.headings.length).toBe(3);
    expect(outline.headings[0]?.text).toBe("My Title");
    expect(outline.headings[0]?.level).toBe(1);
    expect(outline.headings[1]?.text).toBe("Motivation");
    expect(outline.headings[1]?.level).toBe(2);
    expect(outline.headings[2]?.text).toBe("Objective");
    expect(outline.headings[2]?.level).toBe(2);
  });

  test("tabMove and tabReorder reorder tabs in dryRun and updates dumped tabs", async () => {
    const res = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "docWithTabs",
          dump: true,
          kind: "docCreate",
          title: "Multi-tab Doc",
        },
        {
          as: "tabAlpha",
          doc: "docWithTabs",
          kind: "tabAdd",
          title: "Alpha",
        },
        {
          as: "tabBeta",
          doc: "docWithTabs",
          kind: "tabAdd",
          title: "Beta",
        },
        {
          doc: "docWithTabs",
          index: 0,
          kind: "tabMove",
          tab: "Beta",
        },
      ],
    });

    expect(res.ok).toBe(true);
    const dumpedDoc = res.dumped.docWithTabs as { tabs: Array<{ title: string }> };
    expect(dumpedDoc.tabs[0]?.title).toBe("Beta");
    expect(res.highlights.length).toBeGreaterThan(0);
  });

  test("replaceMarkdown replaces a heading node in-place without duplicating or breaking section ancestry", async () => {
    const res = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "specDoc",
          kind: "docCreate",
          title: "Test Spec",
        },
        {
          doc: "specDoc",
          kind: "markdownInsert",
          markdown: "# <Project Spec Title in 3-8 words>\n\nOwner: Name\n\n## Motivation\n\nInitial motivation",
        },
        {
          as: "initialNodes",
          doc: "specDoc",
          kind: "query",
          output: "nodes",
        },
      ],
    });

    expect(res.ok).toBe(true);
    const nodes = res.dumped.initialNodes as Array<{ id: string; text?: string }>;
    const titleNode = nodes.find((n) => n.text?.includes("<Project Spec Title in 3-8 words>"));
    const ownerNode = nodes.find((n) => n.text?.includes("Owner: Name"));
    expect(titleNode).toBeDefined();
    expect(ownerNode).toBeDefined();

    const mutated = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "specDoc",
          kind: "docCreate",
          title: "Test Spec",
        },
        {
          doc: "specDoc",
          kind: "markdownInsert",
          markdown: "# <Project Spec Title in 3-8 words>\n\nOwner: Name\n\n## Motivation\n\nInitial motivation",
        },
        {
          doc: "specDoc",
          kind: "replaceMarkdown",
          markdown: "# Upgraded Automations Title",
          nodeAt: titleNode!.id,
        },
        {
          doc: "specDoc",
          kind: "replace",
          nodeAt: ownerNode!.id,
          text: "Owner: Brian Dombrowski",
        },
        {
          as: "finalNodes",
          doc: "specDoc",
          kind: "query",
          output: "nodes",
        },
      ],
    });

    expect(mutated.ok).toBe(true);
    const finalNodes = mutated.dumped.finalNodes as Array<{ id: string; text?: string; namedStyleType?: string }>;
    expect(finalNodes.find((n) => n.text?.includes("<Project Spec Title in 3-8 words>"))).toBeUndefined();
    expect(finalNodes.find((n) => n.text?.includes("Upgraded Automations Title"))).toBeDefined();
    expect(finalNodes.find((n) => n.text?.includes("Owner: Brian Dombrowski"))).toBeDefined();
    const h1Count = finalNodes.filter((n) => n.namedStyleType === "HEADING_1").length;
    expect(h1Count).toBe(1);
  });

  test("sectionCopy transfers section content between documents without roundtripping through context", async () => {
    const res = await applyScriptExecute({
      dryRun: true,
      steps: [
        {
          as: "sourceDoc",
          kind: "docCreate",
          title: "Source Spec",
        },
        {
          doc: "sourceDoc",
          kind: "markdownInsert",
          markdown:
            "# Source Doc\n\n## Decisions\n\n- D1: Use Bun runtime\n- D2: Strict typing\n\n## Out of Scope\n\nIgnore this",
        },
        {
          as: "targetDoc",
          kind: "docCreate",
          title: "Target Subproject",
        },
        {
          doc: "targetDoc",
          kind: "markdownInsert",
          markdown: "# Target Doc\n\n## Decisions\n\nTBD decisions\n\n## Next Steps\n\nFollow up later",
        },
        {
          doc: "targetDoc",
          fromDoc: "sourceDoc",
          fromSection: "Decisions",
          kind: "sectionCopy",
        },
        {
          as: "targetDump",
          doc: "targetDoc",
          kind: "query",
          output: "markdown",
        },
      ],
    });

    expect(res.ok).toBe(true);
    const md = (res.dumped.targetDump as { markdown: string }).markdown;
    expect(md).toContain("D1: Use Bun runtime");
    expect(md).toContain("D2: Strict typing");
    expect(md).toContain("## Next Steps");
    expect(md).not.toContain("TBD decisions");
    expect(md).not.toContain("Out of Scope");
  });

  test("eager preflight pre-validates all docOpen targets before applying mutations", async () => {
    let batchUpdateCalls = 0;
    const mockClient = {
      batchUpdate: async () => {
        batchUpdateCalls++;
        return "{}";
      },
      createDocument: async () => ({ documentId: "mockCreated" }),
      getDocument: async (docId: string) => {
        if (docId === "validDocId") {
          return {
            documentId: "validDocId",
            tabs: [
              {
                documentTab: {
                  body: {
                    content: [
                      {
                        endIndex: 10,
                        paragraph: { elements: [{ textRun: { content: "Content\n" } }] },
                        startIndex: 0,
                      },
                    ],
                  },
                },
                tabProperties: { tabId: "t.0", title: "Main" },
              },
            ],
            title: "Valid Doc",
          };
        }
        throw new Error(`Google API error (404): Document ${docId} not found`);
      },
    } as unknown as import("./gws.ts").GwsClient;

    const doc: GdocsmithDocument = {
      dryRun: false,
      steps: [
        {
          as: "valid",
          doc: "validDocId",
          kind: "docOpen",
        },
        {
          doc: "valid",
          kind: "markdownInsert",
          markdown: "# Mutated",
        },
        {
          as: "invalid",
          doc: "nonExistentDocId",
          kind: "docOpen",
        },
      ],
    };

    expect(applyScriptExecute(doc, { client: mockClient })).rejects.toThrow("Document nonExistentDocId not found");
    // Crucial: batchUpdate must NOT have been called because preflight failed upfront!
    expect(batchUpdateCalls).toBe(0);
  });

  test("workflow optimizer hoists tabMove afterTab directly into tabAdd", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Test Doc",
        },
        {
          as: "specTab",
          doc: "doc1",
          kind: "tabAdd",
          title: "Project Spec",
        },
        {
          afterTab: "Main",
          doc: "doc1",
          kind: "tabMove",
          tab: "Project Spec",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    // tabMove should have been marked no-op and hoisted into tabAdd
    expect(doc.steps![1]?.afterTab).toBe("Main");
    expect(doc.steps![2]?.noop).toBe(true);
  });

  test("live execution skips redundant updateDocumentTabProperties when tabMove is hoisted", async () => {
    const batchRequests: Array<Record<string, unknown>> = [];
    let added = false;
    const mockClient = {
      batchUpdate: async (_docId: string, reqs: Array<Record<string, unknown>>) => {
        batchRequests.push(...reqs);
        added = true;
        return JSON.stringify({
          replies: [{ addDocumentTab: { tabProperties: { tabId: "t.created_spec", title: "Project Spec" } } }],
        });
      },
      getDocument: async (_docId: string) => ({
        documentId: "docLive",
        tabs: added
          ? [
              {
                documentTab: { body: { content: [] } },
                tabProperties: { index: 0, tabId: "t.custom_root", title: "Overview" },
              },
              {
                documentTab: { body: { content: [] } },
                tabProperties: { index: 1, tabId: "t.created_spec", title: "Project Spec" },
              },
            ]
          : [
              {
                documentTab: { body: { content: [] } },
                tabProperties: { index: 0, tabId: "t.custom_root", title: "Overview" },
              },
            ],
        title: "Live Doc Without T0",
      }),
    } as unknown as import("./gws.ts").GwsClient;

    const doc: GdocsmithDocument = {
      dryRun: false,
      steps: [
        {
          as: "myDoc",
          doc: "docLive",
          kind: "docOpen",
        },
        {
          doc: "myDoc",
          kind: "tabAdd",
          title: "Project Spec",
        },
        {
          afterTab: "Overview",
          doc: "myDoc",
          kind: "tabMove",
          tab: "Project Spec",
        },
      ],
    };

    const res = await applyScriptExecute(doc, { client: mockClient });
    expect(res.ok).toBe(true);
    // batchRequests should contain addDocumentTab with index: 1, and ZERO updateDocumentTabProperties requests!
    expect(batchRequests.length).toBe(1);
    expect(batchRequests[0]?.addDocumentTab).toBeDefined();
    expect(batchRequests.some((r) => r.updateDocumentTabProperties)).toBe(false);
  });

  test("workflow optimizer hoists tabRename title directly into tabDuplicate", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Test Doc",
        },
        {
          as: "specTab",
          copyFromTab: "Main",
          doc: "doc1",
          kind: "tabDuplicate",
          title: "Temporary Title",
        },
        {
          doc: "doc1",
          kind: "markdownInsert",
          markdown: "Some content",
          tab: "Temporary Title",
        },
        {
          doc: "doc1",
          kind: "tabRename",
          tab: "Temporary Title",
          title: "Final Specification",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    // tabDuplicate title should have been updated to Final Specification
    expect(doc.steps![1]?.title).toBe("Final Specification");
    // Intermediate step targeting Temporary Title should be updated to Final Specification
    expect(doc.steps![2]?.tab).toBe("Final Specification");
    // tabRename should be marked no-op
    expect(doc.steps![3]?.noop).toBe(true);
  });
});
