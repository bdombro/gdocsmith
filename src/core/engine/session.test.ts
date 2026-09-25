/* Tests for the core session and its handles (dry: FakeGoogle, nothing sent). */

import { describe, expect, test } from "bun:test";
import { FakeGoogle } from "../emulator/fakeGoogle.ts";
import blankTab from "../model/blankTab.json";
import { docJsonBuild, type TabSpec } from "../model/testDocs.ts";
import { planBuild } from "./plan.ts";
import { CoreSession } from "./session.ts";

/** A FakeGoogle holding `docs` (tabs get the blank document's named styles). */
function fake(docs: Record<string, TabSpec[]>): FakeGoogle {
  const g = new FakeGoogle();
  for (const [id, tabs] of Object.entries(docs)) {
    const json = docJsonBuild({ tabs, title: id }) as unknown as {
      tabs: Array<{ documentTab: Record<string, unknown> }>;
    };
    for (const t of json.tabs) t.documentTab.namedStyles = structuredClone(blankTab.namedStyles);
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
const code = async (fn: () => unknown) => {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return (err as { code: string }).code;
  }
};

describe("CoreSession", () => {
  test("writes are visible to later queries in the same run; nothing is sent", async () => {
    const g = fake({ d1: [{ blocks: [heading("Intro", "h.i"), para("old text")], title: "Main" }] });
    const session = new CoreSession({ client: g, drive: g });
    const tab = (await session.docOpen("d1")).tab();
    session.stepBegin(0);
    const report = await tab.writeMarkdown("new text", {
      kind: "replace",
      range: { heading: "Intro", includeHeading: false, kind: "section" },
    });
    expect(report.changed).toBe(true);
    expect(tab.markdown({ skipFrontmatter: true }).markdown).toBe("# Intro\n\nnew text\n");
    expect(tab.outline()).toEqual([{ anchor: "h.i", level: 1, namedStyleType: "HEADING_1", text: "Intro" }]);
    expect(g.callLog.filter((c) => c.method === "batchUpdate")).toEqual([]);
  });

  test("tab resolution by id or title; errors name the tabs", async () => {
    const g = fake({
      d1: [
        { blocks: [para("a")], tabId: "t.0", title: "One" },
        { blocks: [para("b")], tabId: "t.1", title: "Two" },
      ],
    });
    const doc = await new CoreSession({ client: g, drive: g }).docOpen("d1");
    expect(doc.tab(" two ").tabId).toBe("t.1");
    expect(doc.tab("t.0").tabId).toBe("t.0");
    expect(await code(() => doc.tab())).toBe("tabRequired");
    expect(await code(() => doc.tab("Three"))).toBe("tabNotFound");
    expect(await code(() => doc.tabCreate({ title: "one" }))).toBe("tabTitleTaken");
  });

  test("tab lifecycle folds into the plan: new tab (seeded from another), rename, move, delete", async () => {
    const g = fake({
      d1: [
        { blocks: [para("a")], tabId: "t.0", title: "One" },
        { blocks: [para("b")], tabId: "t.1", title: "Two" },
        { blocks: [para("c")], tabId: "t.2", title: "Three" },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const doc = await session.docOpen("d1");
    session.stepBegin(0);
    const created = doc.tabCreate({ from: doc.tab("One"), position: { afterTab: "One" }, title: "Copy" });
    expect(created.markdown({ skipFrontmatter: true }).markdown).toBe("a\n");
    expect(doc.tab("Two").rename("Deux").changed).toBe(true);
    expect(doc.tab("Deux").rename("Deux").changed).toBe(false);
    doc.tab("Three").move({ index: 0 });
    doc.tab("One").delete();
    expect(doc.tabs().map((t) => t.title)).toEqual(["Three", "Copy", "Deux"]);
    const plan = await planBuild(session);
    expect(plan.docs[0].plan.tabsToAdd).toMatchObject([{ title: "Copy" }]);
    expect(plan.docs[0].plan.tabOps.map((op) => Object.keys(op)[0])).toContain("deleteTab");
  });

  test("text edits, styles with where, tables, and changed flags", async () => {
    const gray = { color: { rgbColor: { blue: 0.2, green: 0.2, red: 0.2 } } };
    const g = fake({
      d1: [
        {
          blocks: [
            { content: [{ style: { foregroundColor: gray }, text: "gray" }, " plain"], kind: "paragraph" },
            para("pigeon and pigeon"),
            {
              cells: [
                [[{ content: ["h1"] }], [{ content: ["h2"] }]],
                [[{ content: ["a"] }], [{ content: ["b"] }]],
              ],
              kind: "table",
            },
            para("z"),
          ],
          title: "Main",
        },
      ],
    });
    const session = new CoreSession({ client: g, drive: g });
    const tab = (await session.docOpen("d1")).tab();
    session.stepBegin(0);
    expect(tab.editText("pigeon", "falcon")).toEqual({ changed: true, count: 2 });
    expect(tab.editText("pigeon", "falcon")).toEqual({ changed: false, count: 0 });
    expect(
      tab.textStyleSet({ kind: "tab" }, { foregroundColor: null }, { where: { foregroundColor: gray } }).changed,
    ).toBe(true);
    const tableAnchor = tab.nodes().find((n) => n.kind === "table")?.anchor as string;
    tab.table(tableAnchor).rowsInsert(2, 1, [["c", "d"]]);
    tab.table(tableAnchor).columnWidthsSet([{ col: 0, widthPt: 100 }]);
    expect(tab.markdown({ skipFrontmatter: true }).markdown).toContain("| c | d |");
    const plan = await planBuild(session);
    expect(plan.docs[0].check.equal).toBe(true);
    expect(plan.diffs[0].text).toContain("+falcon and falcon");
  });

  test("copying a section from another document", async () => {
    const g = fake({
      src: [{ blocks: [heading("Goals", "h.g"), para("win"), heading("Other", "h.o"), para("x")], title: "S" }],
      dst: [{ blocks: [para("start")], title: "D" }],
    });
    const session = new CoreSession({ client: g, drive: g });
    const src = await session.docOpen("src");
    const dst = await session.docOpen("dst");
    session.stepBegin(0);
    const report = await dst
      .tab()
      .copyFrom(
        { range: { heading: "Goals", includeHeading: true, kind: "section" }, tab: src.tab() },
        { kind: "append" },
      );
    expect(report.createdKeys).toHaveLength(2);
    expect(dst.tab().markdown({ skipFrontmatter: true }).markdown).toBe("start\n\n# Goals\n\nwin\n");
    expect((await planBuild(session)).docs.find((d) => d.docId === "dst")?.check.equal).toBe(true);
  });

  test("a new document from scratch", async () => {
    const g = fake({});
    const session = new CoreSession({ client: g, drive: g });
    session.stepBegin(0);
    const doc = await session.docCreate({ alias: "plan", title: "Plan" });
    expect(doc.docId).toBe("new:plan");
    await doc.tab().writeMarkdown("# Title\n\nbody", { kind: "append" });
    const plan = await planBuild(session);
    expect(plan.docs[0]).toMatchObject({ create: { title: "Plan" }, isNew: true });
    expect(plan.docs[0].plan.contentRequests.length).toBeGreaterThan(0);
  });

  test("the plan reports what the guard finds (deleting commented text) and the step's force waives it", async () => {
    const g = fake({ d1: [{ blocks: [para("keep"), para("commented words"), para("z")], title: "Main" }] });
    g.seedComments("d1", [{ id: "c1", quotedFileContent: { value: "commented" } }]);
    for (const force of [false, true]) {
      const session = new CoreSession({ client: g, drive: g });
      const tab = (await session.docOpen("d1")).tab();
      session.stepBegin(3, { force });
      const node = tab.nodes().find((n) => n.text.startsWith("commented"))?.anchor as string;
      tab.remove({ anchor: node, kind: "node" });
      const plan = await planBuild(session);
      expect(plan.findings.map((f) => [f.kind, f.stepIndex, f.waived])).toEqual([["comment", 3, force]]);
    }
  });
});
