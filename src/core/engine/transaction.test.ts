/* Tests for transactions and the phased flush (FakeGoogle). */

import { describe, expect, test } from "bun:test";
import { FakeGoogle } from "../emulator/fakeGoogle.ts";
import blankTab from "../model/blankTab.json";
import type { JsonObject } from "../model/rawJson.ts";
import { docJsonBuild, type TabSpec } from "../model/testDocs.ts";
import { contentSend, MAX_REQUESTS_PER_BATCH } from "./flush.ts";
import type { PlannedDoc } from "./plan.ts";
import { transactionRun } from "./transaction.ts";
import type { Session } from "./types.ts";

function seed(g: FakeGoogle, id: string, tabs: TabSpec[]): void {
  const json = docJsonBuild({ tabs, title: id }) as unknown as {
    tabs: Array<{ documentTab: Record<string, unknown> }>;
  };
  for (const t of json.tabs) t.documentTab.namedStyles = structuredClone(blankTab.namedStyles);
  g.seedDocument(id, json as never);
}
const para = (text: string) => ({ content: [text], kind: "paragraph" as const });
const run = <T>(
  g: FakeGoogle,
  program: (s: Session) => Promise<T>,
  extra: { dryRun?: boolean; force?: boolean } = {},
) =>
  transactionRun(program, {
    client: g,
    drive: g,
    dryRun: !!extra.dryRun,
    force: !!extra.force,
    retryDelaysMs: [0, 0, 0, 0, 0],
  });
const markdownOf = async (g: FakeGoogle, id: string) => {
  let md = "";
  await run(
    g,
    async (s) => {
      md = (await s.docOpen(id)).tab().markdown({ skipFrontmatter: true }).markdown;
    },
    { dryRun: true },
  );
  return md;
};
const batches = (g: FakeGoogle) => g.callLog.filter((c) => c.method === "batchUpdate").length;

describe("transactionRun", () => {
  test("dry and live runs return the same shape and request counts", async () => {
    const program = async (s: Session) => {
      await (await s.docOpen("d1")).tab().writeMarkdown("hello\n\nworld", { kind: "append" });
    };
    const g1 = new FakeGoogle();
    seed(g1, "d1", [{ blocks: [para("start")] }]);
    const dry = await run(g1, program, { dryRun: true });
    expect(batches(g1)).toBe(0);
    const g2 = new FakeGoogle();
    seed(g2, "d1", [{ blocks: [para("start")] }]);
    const live = await run(g2, program);
    expect(Object.keys(dry).sort()).toEqual(Object.keys(live).sort());
    const count = (r: typeof dry, phase: string) =>
      r.phases
        .filter((p) => p.phase === phase)
        .flatMap((p) => p.docs)
        .reduce((n, d) => n + d.requestCount, 0);
    expect(count(live, "content")).toBe(count(dry, "content"));
    expect(live.verification).toEqual([{ docId: "d1", status: "match" }]);
    expect(await markdownOf(g2, "d1")).toBe("start\n\nhello\n\nworld\n");
  });

  test("a new document is created, then the program re-runs to fill it", async () => {
    const g = new FakeGoogle();
    const result = await run(g, async (s) => {
      const doc = await s.docCreate({ alias: "plan", title: "Plan" });
      await doc.tab().writeMarkdown("# Title\n\nbody", { kind: "append" });
      return doc.docId;
    });
    const id = result.newIds.docs["new:plan"];
    expect(result.output).toBe(id);
    expect(g.callLog.filter((c) => c.method === "createDocument")).toHaveLength(1);
    expect(result.verification).toEqual([{ docId: id, status: "match" }]);
    expect(await markdownOf(g, id)).toBe("# Title\n\nbody\n");
  });

  test("a copy is made with Drive, and the re-run edits the real copy", async () => {
    const g = new FakeGoogle();
    seed(g, "src", [{ blocks: [para("template")] }]);
    const result = await run(g, async (s) => {
      const copy = await s.docCreate({ alias: "c", from: await s.docOpen("src"), title: "Copy" });
      await copy.tab().writeMarkdown("filled", { kind: "append" });
    });
    const id = result.newIds.docs["new:c"];
    expect(g.callLog.filter((c) => c.method === "copyFile")).toHaveLength(1);
    expect(await markdownOf(g, id)).toBe("template\n\nfilled\n");
    expect(await markdownOf(g, "src")).toBe("template\n");
  });

  test("a new tab is added first, then filled by its creation order", async () => {
    const g = new FakeGoogle();
    seed(g, "d1", [{ blocks: [para("main")], tabId: "t.0", title: "Main" }]);
    const result = await run(g, async (s) => {
      const doc = await s.docOpen("d1");
      const tab = doc.tabCreate({ title: "Notes" });
      await tab.writeMarkdown("note text", { kind: "append" });
    });
    const tabId = result.newIds.tabs["d1/new:tab:1"];
    expect(tabId).toBeDefined();
    let md = "";
    await run(
      g,
      async (s) => {
        md = (await s.docOpen("d1")).tab("Notes").markdown({ skipFrontmatter: true }).markdown;
      },
      { dryRun: true },
    );
    expect(md).toBe("note text\n");
  });

  test("a conflict before anything lands reloads and re-applies the steps to the new content", async () => {
    const g = new FakeGoogle();
    seed(g, "d1", [{ blocks: [para("one"), para("two")] }]);
    let calls = 0;
    const result = await run(g, async (s) => {
      const tab = (await s.docOpen("d1")).tab();
      if (calls++ === 0) g.externalEdit("d1", [{ insertText: { location: { index: 1 }, text: "EXTERNAL " } }]);
      await tab.writeMarkdown("added", { kind: "append" });
    });
    expect(result.attempts).toBe(2);
    expect(await markdownOf(g, "d1")).toBe("EXTERNAL one\n\ntwo\n\nadded\n");
  });

  test("a conflict after one document landed pins it and re-runs only the rest", async () => {
    const g = new FakeGoogle();
    seed(g, "a", [{ blocks: [para("a")] }]);
    seed(g, "b", [{ blocks: [para("b")] }]);
    let injected = false;
    g.beforeBatchUpdate = (docId) => {
      if (docId === "a" && !injected) {
        injected = true;
        g.externalEdit("b", [{ insertText: { location: { index: 1 }, text: "X" } }]);
      }
    };
    await run(g, async (s) => {
      await (await s.docOpen("a")).tab().writeMarkdown("a2", { kind: "append" });
      await (await s.docOpen("b")).tab().writeMarkdown("b2", { kind: "append" });
    });
    expect(await markdownOf(g, "a")).toBe("a\n\na2\n");
    expect(await markdownOf(g, "b")).toBe("Xb\n\nb2\n");
    expect(g.callLog.filter((c) => c.method === "batchUpdate" && c.args[0] === "a")).toHaveLength(1);
  });

  test("a link to a heading created in the same run points at its real id", async () => {
    const g = new FakeGoogle();
    seed(g, "d1", [{ blocks: [para("start")] }]);
    const result = await run(g, async (s) => {
      await (await s.docOpen("d1")).tab().writeMarkdown("# New Part\n\n[see](<#New Part>)", { kind: "append" });
    });
    // The link, plus restoring the newline style (the link covers the whole paragraph).
    expect(result.phases.find((p) => p.phase === "links")?.docs[0].requestCount).toBe(2);
    expect(result.verification).toEqual([{ docId: "d1", status: "match" }]);
    const json = (await g.getDocument("d1")) as unknown as {
      tabs: Array<{ documentTab: { body: { content: JsonObject[] } } }>;
    };
    const content = json.tabs[0].documentTab.body.content;
    const heading = content.find(
      (e) => ((e.paragraph as JsonObject)?.paragraphStyle as JsonObject)?.headingId,
    ) as JsonObject;
    const headingId = ((heading.paragraph as JsonObject).paragraphStyle as JsonObject).headingId;
    expect(JSON.stringify(content)).toContain(`"heading":{"id":"${headingId}"`);
    expect(Object.values(result.newIds.headings)).toContain(headingId as string);
  });

  test("verification is skipped when someone edited after our last write", async () => {
    const g = new FakeGoogle();
    seed(g, "d1", [{ blocks: [para("start")] }]);
    const get = g.getDocument.bind(g);
    let batches = 0;
    g.beforeBatchUpdate = () => {
      batches++;
    };
    g.getDocument = async (id: string) => {
      if (batches > 0) g.externalEdit(id, [{ insertText: { location: { index: 1 }, text: "late " } }]);
      batches = 0;
      return get(id);
    };
    const result = await run(g, async (s) => {
      await (await s.docOpen("d1")).tab().writeMarkdown("x", { kind: "append" });
    });
    expect(result.verification).toEqual([{ docId: "d1", status: "skipped" }]);
  });

  test("blocking findings send nothing; force sends", async () => {
    const g = new FakeGoogle();
    seed(g, "d1", [{ blocks: [para("keep"), para("commented"), para("z")] }]);
    g.seedComments("d1", [{ id: "c1", quotedFileContent: { value: "commented" } }]);
    const program = async (s: Session) => {
      const tab = (await s.docOpen("d1")).tab();
      const anchor = tab.nodes().find((n) => n.text === "commented")?.anchor as string;
      tab.remove({ anchor, kind: "node" });
    };
    const refused = await run(g, program);
    expect(refused.refused).toBe(true);
    expect(batches(g)).toBe(0);
    const forced = await run(g, program, { force: true });
    expect(forced.refused).toBe(false);
    expect(batches(g)).toBe(1);
  });

  test("permissions and lifecycle go last", async () => {
    const g = new FakeGoogle();
    seed(g, "d1", [{ blocks: [para("x")] }]);
    await run(g, async (s) => {
      const doc = await s.docOpen("d1");
      doc.permissionAdd({ emailAddress: "a@b.test", role: "reader", type: "user" });
      await doc.tab().writeMarkdown("y", { kind: "append" });
      doc.rename("Renamed");
    });
    const methods = g.callLog.map((c) => c.method).filter((m) => m !== "getDocument" && m !== "commentsList");
    expect(methods).toEqual(["batchUpdate", "updateFile", "createPermission"]);
  });

  test("content is chained in chunks, each locked to the previous response's revision; a failed request names its step", async () => {
    const sent: Array<{ count: number; revision?: string }> = [];
    let revision = 1;
    const client = {
      batchUpdate: async (_id: string, requests: object[], opts?: { requiredRevisionId?: string }) => {
        sent.push({ count: requests.length, revision: opts?.requiredRevisionId });
        if (sent.length === 3) throw new Error("Invalid requests[7]: bad");
        return JSON.stringify({ writeControl: { requiredRevisionId: `rev-${++revision}` } });
      },
    };
    const doc = {
      docId: "d",
      input: { originalJson: { revisionId: "rev-1" } },
      plan: {
        contentRequests: Array.from({ length: 2 * MAX_REQUESTS_PER_BATCH + 10 }, () => ({})),
        origins: Array.from({ length: 2 * MAX_REQUESTS_PER_BATCH + 10 }, (_, i) => ({
          stepIndex: i === 2 * MAX_REQUESTS_PER_BATCH + 7 ? 4 : 0,
        })),
      },
    } as unknown as PlannedDoc;
    await expect(contentSend(client as never, doc)).rejects.toMatchObject({ stepIndex: 4 });
    expect(sent).toEqual([
      { count: MAX_REQUESTS_PER_BATCH, revision: "rev-1" },
      { count: MAX_REQUESTS_PER_BATCH, revision: "rev-2" },
      { count: 10, revision: "rev-3" },
    ]);
  });
});
