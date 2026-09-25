/* Tests the v2 run command schema and MCP size contract (G4 M7). */

import { describe, expect, test } from "bun:test";
import { Validator } from "@cfworker/json-schema";
import { mcpSizeReport } from "argsbarg";
import { runExecute } from "~/core/steps/run.ts";
import { program } from "~/program.ts";
import { GdocsmithRunResultSchema } from "./__generated__/index.ts";

describe("v2 run command", () => {
  test("run fits client limits", () => {
    const report = mcpSizeReport(program);
    const run = report.tools.find((tool) => tool.name === "run");

    expect(report.warnings).toEqual([]);
    expect(run?.descriptionChars).toBeLessThanOrEqual(1_800);
    expect(run?.definitionBytes).toBeLessThanOrEqual(45_000);
    expect(run?.definitionLines).toBeLessThanOrEqual(1_800);
    expect(report.instructionsChars).toBeLessThanOrEqual(600);
  });

  test("run results conform to the output schema", async () => {
    const result = await runExecute({
      dryRun: true,
      steps: [
        { action: "create", as: "d", kind: "doc", title: "Kitchen sink" },
        { append: true, doc: "d", kind: "write", markdown: "# Hello\n\nBody" },
        { doc: "d", kind: "query", output: "outline" },
        { at: { text: "Body" }, doc: "d", find: "Body", kind: "edit", replace: "Updated" },
        { at: { text: "Updated" }, doc: "d", kind: "style", text: { bold: true } },
        { action: "create", doc: "d", kind: "tab", title: "Second" },
        { doc: "d", kind: "page", margins: { top: 73 } },
        { action: "list", doc: "d", kind: "share" },
      ],
    });
    const validator = new Validator(GdocsmithRunResultSchema as never, undefined, false);
    const validated = validator.validate(result);

    expect(validated.valid).toBe(true);
  });
});
