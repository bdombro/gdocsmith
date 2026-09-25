/* Tests for FakeGoogle. */

import { describe, expect, test } from "bun:test";
import { docJsonBuild } from "../model/testDocs.ts";
import { FakeGoogle } from "./fakeGoogle.ts";

describe("FakeGoogle", () => {
  test("batchUpdate throws on a revision mismatch", async () => {
    const fake = new FakeGoogle();
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    fake.seedDocument("d1", json);
    await expect(
      fake.batchUpdate("d1", [{ insertText: { location: { index: 1 }, text: "x" } }], { requiredRevisionId: "rev-99" }),
    ).rejects.toThrow(/revision/i);
  });

  test("batchUpdate's response carries writeControl with the new revision", async () => {
    const fake = new FakeGoogle();
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    fake.seedDocument("d1", json);
    const res = JSON.parse(
      await fake.batchUpdate("d1", [{ insertText: { location: { index: 1 }, text: "x" } }], {
        requiredRevisionId: "rev-1",
      }),
    );
    expect(res.documentId).toBe("d1");
    expect(res.writeControl).toEqual({ requiredRevisionId: "rev-2" });
    expect(res.replies).toEqual([{}]);
  });

  test("externalEdit bumps the revision without a batchUpdate revision check", async () => {
    const fake = new FakeGoogle();
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    fake.seedDocument("d1", json, { revision: 5 });
    expect(await fake.revisionIdGet("d1")).toBe("rev-5");
    fake.externalEdit("d1", [{ insertText: { location: { index: 1 }, text: "x" } }]);
    expect(await fake.revisionIdGet("d1")).toBe("rev-6");
    const after = await fake.getDocument("d1");
    expect(JSON.stringify(after)).toContain("xa");
  });

  test("createDocument seeds a blank single-tab document", async () => {
    const fake = new FakeGoogle();
    const { documentId, title } = await fake.createDocument("My Doc");
    expect(title).toBe("My Doc");
    const doc = await fake.getDocument(documentId);
    expect(doc.title).toBe("My Doc");
    expect(doc.tabs?.[0]?.tabProperties?.tabId).toBe("t.0");
  });

  test("copyFile creates an independent copy with a new id and title", async () => {
    const fake = new FakeGoogle();
    const { documentId } = await fake.createDocument("Original");
    const copy = await fake.copyFile(documentId, "Copy");
    expect(copy.id).not.toBe(documentId);
    fake.externalEdit(copy.id, [{ insertText: { location: { index: 1 }, text: "z" } }]);
    const original = await fake.getDocument(documentId);
    expect(JSON.stringify(original)).not.toContain('"z');
  });

  test("permissions: create, list, delete", async () => {
    const fake = new FakeGoogle();
    const { documentId } = await fake.createDocument("Doc");
    const perm = await fake.createPermission(documentId, { role: "reader", type: "anyone" });
    expect(await fake.listPermissions(documentId)).toEqual([perm]);
    await fake.deletePermission(documentId, perm.id);
    expect(await fake.listPermissions(documentId)).toEqual([]);
  });

  test("comments: seed and list", async () => {
    const fake = new FakeGoogle();
    fake.seedComments("d1", [{ id: "c1", quotedFileContent: { value: "hello" }, resolved: false }]);
    expect(await fake.commentsList("d1")).toEqual([
      { id: "c1", quotedFileContent: { value: "hello" }, resolved: false },
    ]);
  });

  test("callLog records every call", async () => {
    const fake = new FakeGoogle();
    await fake.createDocument("Doc");
    expect(fake.callLog.map((c) => c.method)).toEqual(["createDocument"]);
  });

  test("beforeBatchUpdate hook fires before requests apply", async () => {
    const fake = new FakeGoogle();
    const json = docJsonBuild({ tabs: [{ blocks: [{ content: ["a"], kind: "paragraph" }] }] });
    fake.seedDocument("d1", json);
    let fired = false;
    fake.beforeBatchUpdate = () => {
      fired = true;
    };
    await fake.batchUpdate("d1", [{ insertText: { location: { index: 1 }, text: "x" } }]);
    expect(fired).toBe(true);
  });
});
