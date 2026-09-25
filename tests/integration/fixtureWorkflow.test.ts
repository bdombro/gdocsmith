/* Live fixture workflow through the v2 run surface (G4 M10). */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gwsDrive } from "~/core/gws.ts";
import { type GdocsmithRunResult, runExecute } from "~/core/steps/run.ts";

/** Canonical fixture copied for each live workflow run. */
const FIXTURE_DOC_ID = "1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc";

/** Live Google calls need generous headroom for multi-phase sends. */
const TIMEOUT_MS = 180_000;

/** Test-only copy, always deleted after this suite. */
let fixtureCopyId = "";

/** Finds a query's tab entry by title. */
function outlineTab(result: GdocsmithRunResult, stepIndex: number, title: string) {
  const data = result.steps[stepIndex]?.data as {
    tabs: Array<{
      headings: Array<{ id: string; level: number; text: string }>;
      tabId: string;
      title: string;
    }>;
  };
  const tab = data.tabs.find((entry) => entry.title === title);
  if (!tab) throw new Error(`missing tab ${title}`);
  return tab;
}

describe("v2 fixture workflow", () => {
  beforeAll(async () => {
    const copy = await gwsDrive.copyFile(FIXTURE_DOC_ID, `[TEST] v2 fixture workflow ${Date.now()}`);
    fixtureCopyId = copy.id;
  }, TIMEOUT_MS);

  afterAll(async () => {
    if (!fixtureCopyId) return;
    await gwsDrive.deleteFile(fixtureCopyId);
  }, TIMEOUT_MS);

  test(
    "updates the fixture through v2 steps while preserving protected structure",
    async () => {
      expect(fixtureCopyId).not.toBe("");

      const result = await runExecute({
        steps: [
          { doc: fixtureCopyId, kind: "query", output: "outline" },
          {
            doc: fixtureCopyId,
            kind: "write",
            markdown:
              "## Architectural Decisions\n\n- Keep telemetry changes reversible.\n- Preserve reviewable links.\n- Verify every planned write.",
            replace: { section: "Architectural Decisions" },
            tab: "Spec Template",
          },
          {
            doc: fixtureCopyId,
            kind: "write",
            markdown: "The validated architecture routes telemetry through the crumb core.",
            replace: { text: "Placeholder: Replace with architectural specification and component breakdown." },
            tab: "Spec Template",
          },
          {
            action: "create",
            after: "Mission Brief",
            doc: fixtureCopyId,
            from: { tab: "Mission Brief" },
            kind: "tab",
            title: "Mission Brief Copy",
          },
          {
            action: "insertRow",
            at: { section: "Roost Capacity Matrix" },
            cells: ["Andromeda Relay", "Quantum Perch", "300 Flocks", "18,000"],
            doc: fixtureCopyId,
            kind: "table",
            position: "below",
            tab: "Spec Template",
          },
          {
            at: { section: "System Architecture" },
            doc: fixtureCopyId,
            expectCount: 1,
            find: "validated architecture",
            kind: "edit",
            replace: "reviewed architecture",
            tab: "Spec Template",
          },
          { doc: fixtureCopyId, kind: "query", output: "outline" },
          {
            doc: fixtureCopyId,
            kind: "query",
            output: "nodes",
            tab: "Spec Template",
            where: { fragile: true },
          },
          {
            at: { section: "Roost Capacity Matrix" },
            doc: fixtureCopyId,
            kind: "query",
            output: "nodes",
            tab: "Spec Template",
          },
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.phases.some((phase) => phase.name === "content" && phase.sent)).toBe(true);

      const specOutline = outlineTab(result, 6, "Spec Template");
      expect(specOutline.headings.map((heading) => heading.text)).toEqual(
        expect.arrayContaining([
          "Avionics Personnel & Timeline",
          "Network Topology Diagram",
          "Roost Capacity Matrix",
          "Architectural Decisions",
        ]),
      );
      expect(result.docs[0]?.tabs.map((tab) => tab.title)).toContain("Mission Brief Copy");

      const fragile = result.steps[7]?.data as { nodes: Array<{ flags: string[]; text: string }> };
      expect(fragile.nodes.length).toBeGreaterThan(0);
      expect(fragile.nodes.every((node) => node.flags.includes("unrecreatable"))).toBe(true);

      const tableNodes = result.steps[8]?.data as {
        nodes: Array<{ kind: string; table?: { cols: number; rows: number }; text: string }>;
      };
      const table = tableNodes.nodes.find((node) => node.kind === "table");
      expect(table?.table?.rows).toBe(5);
      expect(table?.text).toContain("Andromeda Relay");
    },
    TIMEOUT_MS,
  );
});
