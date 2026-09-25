/* Live end-to-end suite for the v2 core: real Docs and Drive calls through transactionRun, on scratch copies and scratch documents that are always deleted (G3 M20). */

import { afterAll, describe, expect, test } from "bun:test";
import { transactionRun } from "~/core/engine/transaction.ts";
import type { DocHandle, Session } from "~/core/engine/types.ts";
import { gws, gwsDrive } from "~/core/gws.ts";

/** The fixture template (copied, never edited). */
const FIXTURE_DOC_ID = "1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc";

/** Per-test timeout: several round trips plus rate-limit headroom. */
const TIMEOUT_MS = 180_000;

/** Every document this suite created (deleted afterwards). */
const scratch: string[] = [];

/** Runs a program live (or dry) with the real clients. */
function live<T>(program: (s: Session) => Promise<T>, dryRun = false) {
  return transactionRun(program, { client: gws, drive: gwsDrive, dryRun, force: false });
}

/** Content requests a result sent (or would send). */
function contentRequests(result: { phases: Array<{ docs: Array<{ requestCount: number }>; phase: string }> }): number {
  return result.phases
    .filter((p) => p.phase === "content")
    .flatMap((p) => p.docs)
    .reduce((n, d) => n + d.requestCount, 0);
}

/** Creates a scratch document through the transaction and returns its real id. */
async function scratchDoc(title: string, markdown: string): Promise<string> {
  const result = await live(async (s) => {
    const doc = await s.docCreate({ alias: "scratch", title: `[V2 LIVE] ${title} ${Date.now()}` });
    await doc.tab().writeMarkdown(markdown, { kind: "append" });
  });
  const id = result.newIds.docs["new:scratch"];
  scratch.push(id);
  expect(result.verification).toEqual([{ docId: id, status: "match" }]);
  return id;
}

/** Writes every tab's own markdown back (GetPut), returning the content requests it planned. */
async function getPut(docId: string): Promise<number> {
  const result = await live(async (s) => {
    const doc: DocHandle = await s.docOpen(docId, { forceFetch: true });
    for (const info of doc.tabs()) {
      const tab = doc.tab(info.tabId);
      await tab.writeMarkdown(tab.markdown().markdown, { kind: "replace", range: { kind: "tab" } });
    }
  }, true);
  return contentRequests(result);
}

afterAll(async () => {
  for (const id of scratch)
    await gwsDrive.deleteFile(id).catch((err) => console.error(`failed to delete ${id}: ${err.message}`));
}, TIMEOUT_MS);

describe("v2 live", () => {
  test(
    "L0: a copy of the fixture: writing back every tab's markdown sends nothing",
    async () => {
      const copy = await gwsDrive.copyFile(FIXTURE_DOC_ID, `[V2 LIVE] L0 ${Date.now()}`);
      scratch.push(copy.id);
      expect(await getPut(copy.id)).toBe(0);
    },
    TIMEOUT_MS,
  );

  const RICH = [
    "# Overview",
    "",
    "Intro with **bold**, *italic*, `code`, and a [link](<https://example.com>).",
    "",
    "## Steps",
    "",
    "1. first step",
    "   - a detail",
    "   - another",
    "1. second step",
    "",
    "- [ ] a checkbox",
    "",
    "```",
    "let x = *1*;",
    "```",
    "",
    "| Name | Role |",
    "| --- | :-: |",
    "| Ada | Eng |",
    "",
    `See [the steps](<#Steps>), {{person:someone@example.com}} on {{date:2026-01-15T00:00:00Z}}, {{richlink:https://docs.google.com/document/d/${FIXTURE_DOC_ID}/edit}}.`,
    "",
    "![logo](https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png)",
  ].join("\n");

  test(
    "L1: a new document from rich markdown verifies, and writing it back sends nothing",
    async () => {
      const id = await scratchDoc("L1", RICH);
      expect(await getPut(id)).toBe(0);
    },
    TIMEOUT_MS,
  );

  test(
    "L2: markdown edits keep untouched headings' ids and verify",
    async () => {
      const id = await scratchDoc("L2", RICH);
      let before: string[] = [];
      await live(async (s) => {
        before = (await s.docOpen(id, { forceFetch: true }))
          .tab()
          .outline()
          .map((o) => o.anchor);
      }, true);
      const result = await live(async (s) => {
        const tab = (await s.docOpen(id, { forceFetch: true })).tab();
        const md = tab.markdown().markdown;
        await tab.writeMarkdown(
          md
            .replace("Intro with", "Intro, edited, with")
            .replace("1. second step", "1. second step\n   1. nested number")
            .replace("## Steps", "### Steps")
            .replace("- [ ] a checkbox", "- a bullet now"),
          { kind: "replace", range: { kind: "tab" } },
        );
      });
      expect(result.verification.map((v) => v.diffs ?? v.status)).toEqual(["match"]);
      let after: string[] = [];
      await live(async (s) => {
        after = (await s.docOpen(id, { forceFetch: true }))
          .tab()
          .outline()
          .map((o) => o.anchor);
      }, true);
      expect(after[0]).toBe(before[0]);
    },
    TIMEOUT_MS,
  );

  test(
    "L3: table edits in markdown and table operations",
    async () => {
      const id = await scratchDoc("L3", "intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nend");
      const result = await live(async (s) => {
        const tab = (await s.docOpen(id, { forceFetch: true })).tab();
        const md = tab.markdown().markdown;
        await tab.writeMarkdown(
          md
            .replace("| A | B |\n| --- | --- |", "| A | C | B |\n| --- | --- | --- |")
            .replace("| 1 | 2 |", "| 1 | x | 2 |")
            .replace("| 3 | 4 |", "| 3 | y | 4 |\n| 5 | z | 6 |"),
          { kind: "replace", range: { kind: "tab" } },
        );
        const anchor = tab.nodes().find((n) => n.kind === "table")?.anchor as string;
        tab.table(anchor).columnWidthsSet([{ col: 0, widthPt: 90 }]);
      });
      expect(result.verification.map((v) => v.diffs ?? v.status)).toEqual(["match"]);
    },
    TIMEOUT_MS,
  );

  test(
    "L4: copying a section across documents",
    async () => {
      const source = await scratchDoc("L4 source", "# Goals\n\nShip **v2**.\n\n# Other\n\nx");
      const target = await scratchDoc("L4 target", "start");
      const result = await live(async (s) => {
        const src = await s.docOpen(source, { forceFetch: true });
        const dst = await s.docOpen(target, { forceFetch: true });
        await dst
          .tab()
          .copyFrom(
            { range: { heading: "Goals", includeHeading: true, kind: "section" }, tab: src.tab() },
            { kind: "append" },
          );
      });
      expect(result.verification.find((v) => v.docId === target)?.status).toBe("match");
    },
    TIMEOUT_MS,
  );

  test(
    "L5: tabs (create from, rename, move, delete) and page setup",
    async () => {
      const id = await scratchDoc("L5", "main text");
      const result = await live(async (s) => {
        const doc = await s.docOpen(id, { forceFetch: true });
        const main = doc.tab("Tab 1");
        doc.tabCreate({ from: main, title: "Copy" });
        doc.tabCreate({ title: "Scratch" });
        main.pageSetupSet({ pageless: false, size: "A4" });
      });
      expect(result.verification.map((v) => v.diffs ?? v.status)).toEqual(["match"]);
      const second = await live(async (s) => {
        const doc = await s.docOpen(id, { forceFetch: true });
        doc.tab("Copy").rename("Copied");
        doc.tab("Scratch").move({ index: 0 });
        doc.tab("Scratch").delete();
      });
      expect(second.verification.map((v) => v.diffs ?? v.status)).toEqual(["match"]);
    },
    TIMEOUT_MS,
  );

  test(
    "L6: links to headings created in the same run (same tab and another tab)",
    async () => {
      const id = await scratchDoc("L6", "start");
      const result = await live(async (s) => {
        const doc = await s.docOpen(id, { forceFetch: true });
        await doc.tab("Tab 1").writeMarkdown("# Fresh Heading\n\nSee [it](<#Fresh Heading>).", { kind: "append" });
        const other = doc.tabCreate({ title: "Other" });
        await other.writeMarkdown("# Over Here\n\n[back](<#Over Here>)", { kind: "append" });
      });
      expect(result.verification.every((v) => v.status === "match")).toBe(true);
      expect(Object.keys(result.newIds.headings).length).toBeGreaterThanOrEqual(2);
    },
    TIMEOUT_MS,
  );

  test(
    "L7: an edit made between planning and sending is merged by re-running",
    async () => {
      const id = await scratchDoc("L7", "one\n\ntwo");
      let first = true;
      const result = await live(async (s) => {
        const tab = (await s.docOpen(id, { forceFetch: true })).tab();
        if (first) {
          first = false;
          await gws.batchUpdate(id, [{ insertText: { location: { index: 1 }, text: "EXTERNAL " } }]);
        }
        await tab.writeMarkdown("three", { kind: "append" });
      });
      expect(result.attempts).toBe(2);
      let md = "";
      await live(async (s) => {
        md = (await s.docOpen(id, { forceFetch: true })).tab().markdown({ skipFrontmatter: true }).markdown;
      }, true);
      expect(md).toBe("EXTERNAL one\n\ntwo\n\nthree\n");
    },
    TIMEOUT_MS,
  );

  test(
    "L8: dry and live results have the same shape",
    async () => {
      const id = await scratchDoc("L8", "text");
      const program = async (s: Session) => {
        await (await s.docOpen(id, { forceFetch: true })).tab().writeMarkdown("more", { kind: "append" });
      };
      const dry = await live(program, true);
      const real = await live(program);
      expect(Object.keys(dry).sort()).toEqual(Object.keys(real).sort());
      expect(contentRequests(dry)).toBe(contentRequests(real));
    },
    TIMEOUT_MS,
  );
});
