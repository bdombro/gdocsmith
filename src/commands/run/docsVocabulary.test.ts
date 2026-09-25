/* Guards v2 user-facing documentation against legacy run vocabulary (G4 M8). */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const LEGACY_VOCABULARY =
  /\b(docOpen|docCreate|docClose|docDelete|docTrash|docRename|docPermission(Add|List|Remove)|markdownInsert|replaceMarkdown|replaceSection|sectionCopy|surgical|tabCreate|tabDelete|tabMove|tabReorder|tabRename|tabPopulate|textReplace|innerText|dangerousRemoveSection|pageSetup|markdownStyles|nodeAt|nodeAfter|nodeBefore|nodeUnder|forceFetch|fromSection|dumped|stepsCount|highlights)\b/i;

const USER_DOCS = [
  new URL("../../../AGENTS.md", import.meta.url),
  new URL("../../../README.md", import.meta.url),
  new URL("../../../skills/gdocsmith/SKILL.md", import.meta.url),
  ...readdirSync(new URL("../../../docs/", import.meta.url))
    .filter((name) => name.endsWith(".md") && name !== "cli.md" && name !== "mcp.md")
    .map((name) => new URL(`../../../docs/${name}`, import.meta.url)),
];

describe("v2 documentation vocabulary", () => {
  test("contains no legacy run vocabulary", () => {
    const hits = USER_DOCS.flatMap((url) => {
      const text = readFileSync(url, "utf8");
      const match = text.match(LEGACY_VOCABULARY);
      return match ? [`${url.pathname}: ${match[0]}`] : [];
    });
    expect(hits).toEqual([]);
  });

  test("keeps the skill concise and names every v2 kind", () => {
    const skill = readFileSync(new URL("../../../skills/gdocsmith/SKILL.md", import.meta.url), "utf8");
    expect(Buffer.byteLength(skill, "utf8")).toBeLessThanOrEqual(9_000);
    for (const kind of ["doc", "edit", "page", "query", "remove", "share", "style", "tab", "table", "write"]) {
      expect(skill).toContain(`\`${kind}\``);
    }
  });
});
