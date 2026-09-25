/* Tests for document and comment loading and comment anchoring. */

import { describe, expect, test } from "bun:test";
import { FakeGoogle } from "../emulator/fakeGoogle.ts";
import { KeyAllocator } from "../model/keys.ts";
import { docJsonBuild } from "../model/testDocs.ts";
import { commentAnchorsMatch, commentsLoad, docLoad } from "./load.ts";

const json = docJsonBuild({
  tabs: [
    {
      blocks: [
        { content: ["hello world"], kind: "paragraph" },
        { content: ["again world"], kind: "paragraph" },
      ],
      tabId: "t.0",
    },
    { blocks: [{ content: ["other tab"], kind: "paragraph" }], tabId: "t.1" },
  ],
});

describe("load", () => {
  test("docLoad returns a private copy and its model", async () => {
    const fake = new FakeGoogle();
    fake.seedDocument("d1", json);
    const loaded = await docLoad("d1", { client: fake, keys: new KeyAllocator() });
    expect(loaded.model.tabs.map((t) => t.tabId)).toEqual(["t.0", "t.1"]);
    (loaded.json as unknown as { title: string }).title = "changed";
    expect(((await fake.getDocument("d1")) as unknown as { title: string }).title).not.toBe("changed");
  });

  test("commentsLoad keeps live quoted comments and decodes entities", async () => {
    const fake = new FakeGoogle();
    fake.seedComments("d1", [
      { id: "c1", quotedFileContent: { value: "a &amp; b" } },
      { id: "c2", quotedFileContent: { value: "x" }, resolved: true },
      { deleted: true, id: "c3" },
      { id: "c4", quotedFileContent: { value: "" } },
    ]);
    expect(await commentsLoad("d1", fake)).toEqual([{ id: "c1", quotedFileContent: { value: "a & b" } }]);
  });

  test("quotes map to document ranges, across paragraphs and tabs; duplicates are ambiguous", async () => {
    const fake = new FakeGoogle();
    fake.seedDocument("d1", json);
    const { model } = await docLoad("d1", { client: fake, keys: new KeyAllocator() });
    const [world, cross, other] = commentAnchorsMatch(model, [
      { id: "c1", quotedFileContent: { value: "world" } },
      { id: "c2", quotedFileContent: { value: "world\nagain" } },
      { id: "c3", quotedFileContent: { value: "other" } },
    ]);
    expect(world).toMatchObject({
      ambiguous: true,
      occurrences: [
        { range: { end: 12, start: 7 }, tabId: "t.0" },
        { range: { end: 24, start: 19 }, tabId: "t.0" },
      ],
    });
    expect(cross.occurrences).toEqual([{ range: { end: 18, start: 7 }, tabId: "t.0" }]);
    expect(other.occurrences).toEqual([{ range: { end: 6, start: 1 }, tabId: "t.1" }]);
  });
});
