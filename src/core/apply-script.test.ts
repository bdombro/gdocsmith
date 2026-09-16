import { describe, expect, test } from "bun:test";
import type { ApplyDocument } from "../commands/run/types.ts";
import { executeApplyScript } from "./apply-script.ts";

describe("executeApplyScript", () => {
  test("runs createDoc and insertMarkdown in dry-run with unified diff preview", async () => {
    const doc: ApplyDocument = {
      dryRun: true,
      steps: [
        {
          as: "myDoc",
          kind: "createDoc",
          title: "Architecture Spec",
        },
        {
          doc: "myDoc",
          markdown: "# Architecture Spec\n\nInitial overview.",
          kind: "insertMarkdown",
        },
      ],
    };

    const res = await executeApplyScript(doc);
    expect(res.ok).toBe(true);
    expect(res.opsCount).toBe(2);
    expect(res.diff).toBeDefined();
    expect(res.diff).toContain("--- /dev/null");
    expect(res.diff).toContain("+++ b/myDoc/t.0");
    expect(res.diff).toContain("+# Architecture Spec");
    expect(res.diff).toContain("+Initial overview.");
    expect(res.highlights.length).toBeGreaterThan(0);
    expect(res.highlights[0]?.as).toBe("myDoc");
  });

  test("accepts ops/op aliases for steps/kind", async () => {
    const doc: ApplyDocument = {
      dryRun: true,
      ops: [
        {
          as: "docA",
          op: "createDoc",
          title: "Doc with Tabs",
        },
        {
          as: "archTab",
          doc: "docA",
          op: "addTab",
          title: "Architecture Tab",
        },
        {
          doc: "docA",
          markdown: "# Arch Heading\nSub details",
          op: "insertMarkdown",
          tab: "archTab",
        },
      ],
    };

    const res = await executeApplyScript(doc);
    expect(res.ok).toBe(true);
    expect(res.opsCount).toBe(3);
    expect(res.diff).toContain("Arch Heading");
  });

  test("runs query inside script and binds alias for subsequent surgical replace", async () => {
    const doc: ApplyDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "createDoc",
          title: "Query and Replace Test",
        },
        {
          doc: "doc1",
          markdown: "# Overview\n\nStatus: DRAFT\n\n## Section 2\nContent here",
          kind: "insertMarkdown",
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

    const res = await executeApplyScript(doc);
    expect(res.ok).toBe(true);
    expect(res.opsCount).toBe(4);
    expect(res.diff).toContain("+Status: APPROVED");
  });

  test("kind dump returns aliased query matches under dumped", async () => {
    const doc: ApplyDocument = {
      dryRun: true,
      steps: [
        {
          as: "doc1",
          kind: "createDoc",
          title: "Dump Test",
        },
        {
          doc: "doc1",
          markdown: "# Overview\n\nStatus: DRAFT",
          kind: "insertMarkdown",
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

    const res = await executeApplyScript(doc);
    expect(res.ok).toBe(true);
    expect(res.dumped.statusNode).toBeDefined();
    const dumped = res.dumped.statusNode as Array<{ text?: string }>;
    expect(Array.isArray(dumped)).toBe(true);
    expect(dumped.some((n) => n.text?.includes("DRAFT"))).toBe(true);
  });

  test("close removes doc from context and prevents stale access", async () => {
    const doc: ApplyDocument = {
      dryRun: true,
      steps: [
        {
          as: "docTemp",
          kind: "createDoc",
          title: "Temporary",
        },
        {
          as: "docTemp",
          kind: "close",
        },
        {
          doc: "docTemp",
          markdown: "Will fail",
          kind: "insertMarkdown",
        },
      ],
    };

    expect(executeApplyScript(doc)).rejects.toThrow("is not open or was closed");
  });
});
