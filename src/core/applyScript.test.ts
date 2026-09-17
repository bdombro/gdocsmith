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

  test("runs query inside script and binds alias for subsequent surgical replace", async () => {
    const doc: GdocsmithDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "docCreate",
          title: "Query and Replace Test",
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
          at: "statusNode",
          doc: "doc1",
          kind: "replace",
          replace: "Status: APPROVED",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(4);
    expect(res.diff).toContain("+Status: APPROVED");
  });

  test("kind dump returns aliased query matches under dumped", async () => {
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
        {
          as: "statusNode",
          kind: "dump",
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

  /** Tests that query and dump retain bullet nesting metadata. */
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
        {
          as: "nestedNodes",
          kind: "dump",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    const dumped = res.dumped.nestedNodes as Array<{ bullet?: { nestingLevel: number }; text?: string }>;
    expect(dumped[0]?.bullet?.nestingLevel).toBe(1);
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
          as: "docTemp",
          kind: "close",
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
    const dumped = res.dumped.tabMd as { audit?: { nodeCount?: number }; markdown?: string };
    expect(dumped.markdown).toContain("# Overview");
    expect(dumped.markdown).toContain("Status: DRAFT");
    expect(dumped.markdown).toContain("Architecture");
    expect(dumped.audit).toBeDefined();
  });

  test("kind query output markdown scopes a heading section via under", async () => {
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
          as: "archHeading",
          contains: "Architecture",
          doc: "doc1",
          kind: "query",
        },
        {
          as: "archMd",
          doc: "doc1",
          kind: "query",
          output: "markdown",
          under: "archHeading",
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
          as: "heading",
          contains: "Overview",
          doc: "doc1",
          kind: "query",
        },
        {
          after: "heading",
          doc: "doc1",
          insertPerson: { email: "alice@example.com" },
          kind: "surgical",
        },
      ],
    };

    const res = await applyScriptExecute(doc);
    expect(res.ok).toBe(true);
    expect(res.stepsCount).toBe(4);
  });
});
