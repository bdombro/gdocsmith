/* Tests for query steps and large-output spill management (G4 D8, M5). */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeGoogle } from "~/core/emulator/fakeGoogle.ts";
import { CoreSession } from "~/core/engine/session.ts";
import blankTab from "~/core/model/blankTab.json";
import { docJsonBuild, type TabSpec } from "~/core/model/testDocs.ts";
import type { StepContext } from "./context.ts";
import {
  diffSpill,
  INLINE_DIFF_CHARS_MAX,
  INLINE_STEP_CHARS_MAX,
  SPILL_RETENTION_MS,
  spillBaseDir,
  spillDirCreate,
  spillPrune,
  stepDataSpill,
} from "./output.ts";
import { queryStepApply } from "./query.ts";
import type { StepQuery } from "./types.ts";

const TEST_DOC_ID = "doc-1234567890123456789012345";

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

function makeCtx(session: CoreSession, step: StepQuery): StepContext {
  session.stepBegin(0);
  return {
    aliases: new Map(),
    session,
    stepIndex: 0,
    steps: [step],
  };
}

describe("query step and output files", () => {
  const testSaveDir = join(tmpdir(), "gdocsmith-save-test");

  beforeAll(() => {
    mkdirSync(testSaveDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testSaveDir, { force: true, recursive: true });
  });

  test("query defaults to outline", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [
            heading("Introduction", "h.intro"),
            para("Some body text"),
            heading("Details", "h.details", "HEADING_2"),
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: StepQuery = {
      doc: TEST_DOC_ID,
      kind: "query",
    };

    const outcome = await queryStepApply(makeCtx(session, step), step);
    const data = outcome.data as {
      tabs: Array<{ headings: Array<{ id: string; level: number; text: string }>; tabId: string }>;
    };
    expect(data.tabs).toHaveLength(1);
    expect(data.tabs[0].headings).toHaveLength(2);
    expect(data.tabs[0].headings[0].text).toBe("Introduction");
    expect(data.tabs[0].headings[1].text).toBe("Details");
  });

  test("markdown includes frontmatter; skipFrontmatter omits it", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [heading("Title", "h.t"), para("Body text")],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });

    // With frontmatter (default)
    const withFmStep: StepQuery = {
      doc: TEST_DOC_ID,
      kind: "query",
      output: "markdown",
    };
    const withFmOutcome = await queryStepApply(makeCtx(session, withFmStep), withFmStep);
    const withFmData = withFmOutcome.data as { tabs: Array<{ markdown: string }> };
    expect(withFmData.tabs[0].markdown).toContain("---");
    expect(withFmData.tabs[0].markdown).toContain(`doc: "${TEST_DOC_ID}"`);

    // With skipFrontmatter: true
    const noFmStep: StepQuery = {
      doc: TEST_DOC_ID,
      kind: "query",
      output: "markdown",
      skipFrontmatter: true,
    };
    const noFmOutcome = await queryStepApply(makeCtx(session, noFmStep), noFmStep);
    const noFmData = noFmOutcome.data as { tabs: Array<{ markdown: string }> };
    expect(noFmData.tabs[0].markdown).not.toContain("---");
    expect(noFmData.tabs[0].markdown).toContain("# Title");
  });

  test("nodes honor where.contains", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        {
          blocks: [para("apple fruit"), para("banana fruit"), para("carrot vegetable")],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const step: StepQuery = {
      doc: TEST_DOC_ID,
      kind: "query",
      output: "nodes",
      where: { contains: "fruit" },
    };

    const outcome = await queryStepApply(makeCtx(session, step), step);
    const data = outcome.data as { nodes: Array<{ text: string }> };
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes.every((n) => n.text.includes("fruit"))).toBe(true);
  });

  test("saveTo writes one file per tab and returns an outline", async () => {
    const g = fakeGoogle({
      [TEST_DOC_ID]: [
        { blocks: [heading("Tab One", "h.1"), para("Content 1")], tabId: "t.0", title: "Tab One" },
        { blocks: [heading("Tab Two", "h.2"), para("Content 2")], tabId: "t.1", title: "Tab Two" },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const targetDir = join(testSaveDir, "run-save-export");

    const step: StepQuery = {
      doc: TEST_DOC_ID,
      kind: "query",
      output: "markdown",
      saveTo: targetDir,
    };

    const outcome = await queryStepApply(makeCtx(session, step), step);
    expect(outcome.files).toHaveLength(2);
    expect(outcome.outline).toBeDefined();

    for (const file of outcome.files!) {
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  test("over-cap payloads spill to temp files", () => {
    const spillDir = spillDirCreate();
    expect(existsSync(spillDir)).toBe(true);

    // Large markdown tabs payload
    const largeText = "A".repeat(INLINE_STEP_CHARS_MAX + 100);
    const data = {
      tabs: [{ markdown: largeText, tabId: "t.0", title: "Long Tab" }],
    };
    const outline = { tabs: [{ headings: [], tabId: "t.0", title: "Long Tab" }] };

    const result = stepDataSpill(spillDir, 0, "query", data, outline);
    expect(result.files).toHaveLength(1);
    expect(result.inlineData).toBeUndefined();
    expect(result.outline).toBeDefined();
    expect(existsSync(result.files[0])).toBe(true);
    expect(readFileSync(result.files[0], "utf8")).toBe(largeText);

    // Diff spill
    const largeDiff = "diff line\n".repeat(INLINE_DIFF_CHARS_MAX);
    const diffFile = diffSpill(spillDir, largeDiff);
    expect(existsSync(diffFile)).toBe(true);
    expect(readFileSync(diffFile, "utf8")).toBe(largeDiff);

    rmSync(spillDir, { force: true, recursive: true });
  });

  test("prune removes spill directories older than 24 h", () => {
    const base = spillBaseDir();
    const oldDir = join(base, "2020-01-01T00-00-00-000Z-old12345");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "test.txt"), "stale");

    // Backdate the directory modification time by 2 days
    const pastTime = (Date.now() - SPILL_RETENTION_MS * 2) / 1000;
    utimesSync(oldDir, pastTime, pastTime);

    expect(existsSync(oldDir)).toBe(true);
    spillPrune();
    expect(existsSync(oldDir)).toBe(false);
  });
});
