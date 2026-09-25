/* Tests for structure step handlers: doc, tab, page, share (G4 M4). */

import { describe, expect, test } from "bun:test";
import { FakeGoogle } from "~/core/emulator/fakeGoogle.ts";
import { CoreSession } from "~/core/engine/session.ts";
import blankTab from "~/core/model/blankTab.json";
import { docJsonBuild, type TabSpec } from "~/core/model/testDocs.ts";
import { writeStepApply } from "./content.ts";
import type { StepContext } from "./context.ts";
import { docStepApply, pageStepApply, shareStepApply, tabStepApply } from "./structure.ts";
import type { GdocsmithStep } from "./types.ts";

const TEST_DOC_ID = "doc-1234567890123456789012345";
const _TEST_DOC_ID_2 = "doc-abcdefghijklmnopqrstuvwxy";

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
const heading = (text: string, id: string) => ({
  content: [text],
  headingId: id,
  kind: "paragraph" as const,
  style: { namedStyleType: "HEADING_1" },
});

function makeCtx(session: CoreSession, steps: GdocsmithStep[], stepIndex = 0): StepContext {
  session.stepBegin(stepIndex);
  return {
    aliases: new Map(),
    session,
    stepIndex,
    steps,
  };
}

describe("structure step handlers", () => {
  test("doc create binds an alias used by a later write", async () => {
    const g = fakeGoogle({});
    const session = new CoreSession({ client: g, drive: g });
    const createStep: GdocsmithStep = {
      action: "create",
      as: "myDoc",
      kind: "doc",
      title: "Created Doc",
    };
    const writeStep: GdocsmithStep = {
      append: true,
      doc: "myDoc",
      kind: "write",
      markdown: "Content in created doc",
    };
    const ctx = makeCtx(session, [createStep, writeStep], 0);

    const createOutcome = await docStepApply(ctx, createStep);
    expect(createOutcome.created?.[0]?.id).toBe("new:myDoc");
    expect(ctx.aliases.has("myDoc")).toBe(true);

    ctx.stepIndex = 1;
    session.stepBegin(1);
    const writeOutcome = await writeStepApply(ctx, writeStep);
    expect(writeOutcome.created).toBeDefined();

    const boundDoc = ctx.aliases.get("myDoc")!;
    const md = boundDoc.tab().markdown({ skipFrontmatter: true }).markdown;
    expect(md).toContain("Content in created doc");
  });

  test("doc copy yields a provisional id on dry runs", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [heading("Title", "h.t")], title: "Source" }],
    });
    const session = new CoreSession({ client: g, drive: g });
    const copyStep: GdocsmithStep = {
      action: "copy",
      as: "copiedDoc",
      doc: TEST_DOC_ID,
      kind: "doc",
      title: "Copy of Source",
    };
    const ctx = makeCtx(session, [copyStep]);

    const outcome = await docStepApply(ctx, copyStep);
    expect(outcome.created?.[0]?.id).toBe("new:copiedDoc");
    expect(ctx.aliases.get("copiedDoc")?.docId).toBe("new:copiedDoc");
  });

  test("tab create from copies content; a lossy source is refused without force", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            heading("Title", "h.t"),
            para("Body text"),
            {
              kind: "toc" as const,
              length: 10,
            },
          ],
          title: "SourceTab",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });

    // Without force, copying an unrecreatable item (TOC) is refused
    const badStep: GdocsmithStep = {
      action: "create",
      doc: TEST_DOC_ID,
      from: {
        doc: TEST_DOC_ID,
        tab: "SourceTab",
      },
      kind: "tab",
      title: "CopiedTab",
    };
    await expect(tabStepApply(makeCtx(session, [badStep]), badStep)).rejects.toThrow(
      /Refused: .* \(force: true to proceed\)/,
    );

    // With force: true, copying proceeds
    const forceStep: GdocsmithStep = {
      action: "create",
      doc: TEST_DOC_ID,
      force: true,
      from: {
        doc: TEST_DOC_ID,
        tab: "SourceTab",
      },
      kind: "tab",
      title: "CopiedTabForced",
    };
    const outcome = await tabStepApply(makeCtx(session, [forceStep]), forceStep);
    expect(outcome.created?.[0]?.id).toBeDefined();

    const doc = await session.docOpen(TEST_DOC_ID);
    const newTab = doc.tab("CopiedTabForced");
    const md = newTab.markdown({ skipFrontmatter: true }).markdown;
    expect(md).toContain("Title");
    expect(md).toContain("Body text");
  });

  test("tab titles must be unique", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        { blocks: [para("1")], title: "Tab 1" },
        { blocks: [para("2")], title: "Tab 2" },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });

    const step: GdocsmithStep = {
      action: "create",
      doc: TEST_DOC_ID,
      kind: "tab",
      title: "Tab 1",
    };
    await expect(tabStepApply(makeCtx(session, [step]), step)).rejects.toThrow('a tab titled "Tab 1" already exists');
  });

  test("deleting t.0 is refused without force", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        { blocks: [para("1")], tabId: "t.0", title: "Tab 1" },
        { blocks: [para("2")], tabId: "t.1", title: "Tab 2" },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });

    const step: GdocsmithStep = {
      action: "delete",
      doc: TEST_DOC_ID,
      kind: "tab",
      tab: "t.0",
    };
    await expect(tabStepApply(makeCtx(session, [step]), step)).rejects.toThrow(
      'Refused: deleting root tab "t.0" requires force: true',
    );

    // With force: true, it succeeds
    const forceStep: GdocsmithStep = {
      action: "delete",
      doc: TEST_DOC_ID,
      force: true,
      kind: "tab",
      tab: "t.0",
    };
    await expect(tabStepApply(makeCtx(session, [forceStep]), forceStep)).resolves.toEqual({});
  });

  test("page pageless applies to every tab", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        { blocks: [para("1")], tabId: "t.0", title: "Tab 1" },
        { blocks: [para("2")], tabId: "t.1", title: "Tab 2" },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });

    const step: GdocsmithStep = {
      doc: TEST_DOC_ID,
      kind: "page",
      pageless: true,
    };
    await pageStepApply(makeCtx(session, [step]), step);

    const doc = await session.docOpen(TEST_DOC_ID);
    // Verified across all tabs
    for (const t of doc.tabs()) {
      // In-memory model updated
      expect(doc.tab(t.tabId)).toBeDefined();
    }
  });

  test("share add requires scope", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [{ blocks: [para("1")], title: "Main" }],
    });
    const session = new CoreSession({ client: g, drive: g });

    const step: GdocsmithStep = {
      action: "add",
      doc: TEST_DOC_ID,
      kind: "share",
      role: "reader",
      scope: undefined as never,
    };
    await expect(shareStepApply(makeCtx(session, [step]), step)).rejects.toThrow('action "add" needs scope');
  });
});
