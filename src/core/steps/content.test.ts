/* Tests for content step handlers (G4 M3). */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { FakeGoogle } from "~/core/emulator/fakeGoogle.ts";
import { CoreSession } from "~/core/engine/session.ts";
import blankTab from "~/core/model/blankTab.json";
import { docJsonBuild, type TabSpec } from "~/core/model/testDocs.ts";
import { editStepApply, removeStepApply, styleStepApply, tableStepApply, writeStepApply } from "./content.ts";
import type { StepContext } from "./context.ts";
import type { GdocsmithStep } from "./types.ts";

/** Helper to seed a FakeGoogle instance. */
function fakeGoogle(docs: Record<string, TabSpec[]>): FakeGoogle {
  const g = new FakeGoogle();
  for (const [id, tabs] of Object.entries(docs)) {
    const json = docJsonBuild({ tabs, title: id }) as unknown as {
      tabs: Array<{ documentTab: Record<string, unknown> }>;
    };
    for (const t of json.tabs) {
      t.documentTab.namedStyles = structuredClone(blankTab.namedStyles);
    }
    g.seedDocument(id, json as never);
  }
  return g;
}

const para = (text: string) => ({ content: [text], kind: "paragraph" as const });
const heading = (text: string, id: string, level = "HEADING_1") => ({
  content: [text],
  headingId: id,
  kind: "paragraph" as const,
  style: { namedStyleType: level },
});

const TEST_DOC_ID = "doc-1234567890123456789012345";
const TEST_DOC_ID_2 = "doc-abcdefghijklmnopqrstuvwxy";

function makeCtx(session: CoreSession, step: GdocsmithStep): StepContext {
  session.stepBegin(0);
  return {
    aliases: new Map(),
    session,
    stepIndex: 0,
    steps: [step],
  };
}

describe("content step handlers", () => {
  const tempFile = "/tmp/gdocsmith-test-file.md";

  beforeAll(() => {
    writeFileSync(tempFile, "File content written to doc.\n");
  });

  afterAll(() => {
    rmSync(tempFile, { force: true });
  });

  test("write append adds markdown at the end", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [heading("Title", "h.t"), para("Paragraph 1")], title: "Main" }],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      append: true,
      doc: TEST_DOC_ID,
      kind: "write",
      markdown: "Paragraph 2",
    };
    const ctx = makeCtx(session, step);

    const outcome = await writeStepApply(ctx, step);
    expect(outcome.created).toBeDefined();

    const doc = await session.docOpen(TEST_DOC_ID);
    const md = doc.tab().markdown({ skipFrontmatter: true }).markdown;
    expect(md).toContain("Paragraph 1");
    expect(md).toContain("Paragraph 2");
  });

  test("write replace section keeps unchanged heading IDs", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            heading("Section 1", "h.s1", "HEADING_1"),
            heading("Sub 1", "h.sub1", "HEADING_2"),
            para("Sub 1 body"),
            heading("Sub 2", "h.sub2", "HEADING_2"),
            para("Sub 2 body"),
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      doc: TEST_DOC_ID,
      kind: "write",
      markdown: "## Sub 1\n\nEdited Sub 1 body\n\n## Sub 2\n\nSub 2 body",
      replace: { section: "Section 1" },
    };
    const ctx = makeCtx(session, step);

    await writeStepApply(ctx, step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const outline = doc.tab().outline();
    const sub1 = outline.find((h) => h.text === "Sub 1");
    const sub2 = outline.find((h) => h.text === "Sub 2");
    expect(sub1?.anchor).toBe("h.sub1");
    expect(sub2?.anchor).toBe("h.sub2");
  });

  test("write replace text targets the unique paragraph; ambiguous text lists candidates", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [para("Unique line alpha"), para("Duplicate line beta"), para("Duplicate line beta")],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });

    // Unique match succeeds
    const okStep: GdocsmithStep = {
      doc: TEST_DOC_ID,
      kind: "write",
      markdown: "Replaced line alpha",
      replace: { text: "Unique line alpha" },
    };
    await writeStepApply(makeCtx(session, okStep), okStep);

    const doc = await session.docOpen(TEST_DOC_ID);
    expect(doc.tab().markdown({ skipFrontmatter: true }).markdown).toContain("Replaced line alpha");

    // Ambiguous match throws with candidate list
    const badStep: GdocsmithStep = {
      doc: TEST_DOC_ID,
      kind: "write",
      markdown: "New",
      replace: { text: "Duplicate line" },
    };
    await expect(writeStepApply(makeCtx(session, badStep), badStep)).rejects.toThrow(/matched 2 nodes \(expected 1\):/);
  });

  test("write after section inserts before the next same-level heading", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [heading("H1 Alpha", "h.a"), para("Alpha body"), heading("H1 Beta", "h.b"), para("Beta body")],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      after: { section: "H1 Alpha" },
      doc: TEST_DOC_ID,
      kind: "write",
      markdown: "Inserted after Alpha",
    };

    await writeStepApply(makeCtx(session, step), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const md = doc.tab().markdown({ skipFrontmatter: true }).markdown;
    const posAlpha = md.indexOf("Alpha body");
    const posInserted = md.indexOf("Inserted after Alpha");
    const posBeta = md.indexOf("# H1 Beta");

    expect(posAlpha).toBeLessThan(posInserted);
    expect(posInserted).toBeLessThan(posBeta);
  });

  test("write from section copies across docs", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [heading("Target", "h.t")], title: "TargetDoc" }],
      [TEST_DOC_ID_2]: [
        {
          blocks: [heading("Source Section", "h.src"), para("Source text paragraph")],
          title: "SourceDoc",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      append: true,
      doc: TEST_DOC_ID,
      from: {
        doc: TEST_DOC_ID_2,
        section: "Source Section",
      },
      kind: "write",
    };

    await writeStepApply(makeCtx(session, step), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const md = doc.tab().markdown({ skipFrontmatter: true }).markdown;
    expect(md).toContain("Source Section");
    expect(md).toContain("Source text paragraph");
  });

  test("write markdownFile reads the file", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [heading("Title", "h.t")], title: "Main" }],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      append: true,
      doc: TEST_DOC_ID,
      kind: "write",
      markdownFile: tempFile,
    };

    await writeStepApply(makeCtx(session, step), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const md = doc.tab().markdown({ skipFrontmatter: true }).markdown;
    expect(md).toContain("File content written to doc.");
  });

  test("a write that changes nothing is rejected", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [heading("Overview", "h.o"), para("Unchanged line.")], title: "Main" }],
    });
    const session = new CoreSession({ client: g, drive: g });

    const step: GdocsmithStep = {
      doc: TEST_DOC_ID,
      kind: "write",
      markdown: "Unchanged line.",
      replace: { text: "Unchanged line." },
    };

    await expect(writeStepApply(makeCtx(session, step), step)).rejects.toThrow("changed nothing");
  });

  test("edit replaces all matches in scope; zero matches rejected", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [para("Body text with pigeon and another pigeon.")], title: "Main" }],
    });
    const session = new CoreSession({ client: g, drive: g });

    // Zero matches throws
    const absentStep: GdocsmithStep = {
      doc: TEST_DOC_ID,
      find: "zzz-absent",
      kind: "edit",
      replace: "x",
    };
    await expect(editStepApply(makeCtx(session, absentStep), absentStep)).rejects.toThrow(
      '"zzz-absent" matched nothing',
    );

    // Matching replaces all occurrences
    const okStep: GdocsmithStep = {
      doc: TEST_DOC_ID,
      find: "pigeon",
      kind: "edit",
      replace: "falcon",
    };
    const outcome = await editStepApply(makeCtx(session, okStep), okStep);
    expect(outcome.replaced).toBe(2);

    const doc = await session.docOpen(TEST_DOC_ID);
    expect(doc.tab().markdown({ skipFrontmatter: true }).markdown).toBe("Body text with falcon and another falcon.\n");
  });

  test("edit expectCount mismatch rejected", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [para("pigeon and pigeon.")], title: "Main" }],
    });
    const session = new CoreSession({ client: g, drive: g });

    const step: GdocsmithStep = {
      doc: TEST_DOC_ID,
      expectCount: 5,
      find: "pigeon",
      kind: "edit",
      replace: "falcon",
    };

    await expect(editStepApply(makeCtx(session, step), step)).rejects.toThrow("found 2 matches, expected 5");
  });

  test("remove section removes the heading subtree", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            heading("Keep H1", "h.k1"),
            para("Keep body"),
            heading("Remove H1", "h.r1"),
            heading("Remove H2", "h.r2", "HEADING_2"),
            para("Child body"),
            heading("Final H1", "h.f1"),
            para("Final body"),
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      at: { section: "Remove H1" },
      doc: TEST_DOC_ID,
      kind: "remove",
    };

    await removeStepApply(makeCtx(session, step), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const outline = doc.tab().outline();
    const headings = outline.map((h) => h.text);
    expect(headings).toEqual(["Keep H1", "Final H1"]);
    const md = doc.tab().markdown({ skipFrontmatter: true }).markdown;
    expect(md).not.toContain("Remove H1");
    expect(md).not.toContain("Remove H2");
    expect(md).not.toContain("Child body");
  });

  test("style where foregroundColor → null clears only matching runs", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            {
              content: [
                {
                  style: { foregroundColor: { color: { rgbColor: { blue: 0.2, green: 0.2, red: 0.2 } } } },
                  text: "dark ",
                },
                { style: { foregroundColor: { color: { rgbColor: { blue: 0, green: 0, red: 1 } } } }, text: "red" },
              ],
              kind: "paragraph" as const,
            },
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      at: { body: true },
      doc: TEST_DOC_ID,
      kind: "style",
      text: { foregroundColor: null },
      where: { foregroundColor: "#333333" },
    };

    await styleStepApply(makeCtx(session, step), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const nodes = doc.tab().nodes();
    // Color #333333 was cleared, but #FF0000 remains
    expect(nodes[0].fontColors).toEqual(["#FF0000"]);
  });

  test("table insertRow at the section's only table", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            heading("Matrix Section", "h.m"),
            {
              cells: [
                [[{ content: ["A1"] }], [{ content: ["B1"] }]],
                [[{ content: ["A2"] }], [{ content: ["B2"] }]],
              ],
              kind: "table" as const,
            },
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      action: "insertRow",
      at: { section: "Matrix Section" },
      cells: ["A3", "B3"],
      doc: TEST_DOC_ID,
      kind: "table",
      row: 1,
    };

    await tableStepApply(makeCtx(session, step), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    const tableNode = doc
      .tab()
      .nodes()
      .find((n) => n.kind === "table");
    expect(tableNode?.table?.rows).toBe(3);
  });

  test("table at a section with two tables lists both IDs", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            heading("Two Tables", "h.two"),
            {
              cells: [[[{ content: ["1"] }]]],
              kind: "table" as const,
            },
            {
              cells: [[[{ content: ["2"] }]]],
              kind: "table" as const,
            },
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: GdocsmithStep = {
      action: "insertRow",
      at: { section: "Two Tables" },
      doc: TEST_DOC_ID,
      kind: "table",
    };

    await expect(tableStepApply(makeCtx(session, step), step)).rejects.toThrow(
      /multiple tables \(.*, .*\); target by table node ID/,
    );
  });
});
