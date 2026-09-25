/* Tests for static step validation (G4 D4, M2). */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { recipes } from "./types.test.ts";
import type { GdocsmithStep } from "./types.ts";
import { stepsAssertValid } from "./validate.ts";

const VALID_DOC_ID = "doc-1234567890123456789012345";
const _VALID_DOC_ID_2 = "doc-abcdefghijklmnopqrstuvwxy";

describe("static step validation", () => {
  beforeAll(() => {
    mkdirSync("/tmp/gdocsmith-export", { recursive: true });
    writeFileSync("/tmp/gdocsmith-export/overview.md", "# Overview\n");
  });

  afterAll(() => {
    rmSync("/tmp/gdocsmith-export", { force: true, recursive: true });
  });

  test("all standard recipes pass validation", () => {
    for (const recipe of recipes) {
      expect(() => stepsAssertValid(recipe.steps)).not.toThrow();
    }
  });

  const fixtures: Array<{
    expectedMessage: string;
    name: string;
    step: GdocsmithStep;
    setup?: GdocsmithStep[];
  }> = [
    // Anchor tests
    {
      expectedMessage: "at must set exactly one of body, node, section, text",
      name: "anchor empty",
      step: {
        at: {},
        doc: VALID_DOC_ID,
        kind: "remove",
      },
    },
    {
      expectedMessage: "at must set exactly one of body, node, section, text",
      name: "anchor multiple keys",
      step: {
        at: { node: "n1", section: "H1" },
        doc: VALID_DOC_ID,
        kind: "remove",
      },
    },
    {
      expectedMessage: "after.body is not allowed here",
      name: "anchor body not allowed in write after",
      step: {
        after: { body: true },
        doc: VALID_DOC_ID,
        kind: "write",
        markdown: "text",
      },
    },
    // Doc identifier tests
    {
      expectedMessage: "doc must be a document ID (the part between /d/ and /edit), not a URL",
      name: "doc is a URL",
      step: {
        at: { section: "H1" },
        doc: "https://docs.google.com/document/d/123/edit",
        kind: "remove",
      },
    },
    {
      expectedMessage: 'unknown doc alias "unbound": bind it with as on an earlier doc step, or pass a raw document ID',
      name: "unknown doc alias",
      step: {
        at: { section: "H1" },
        doc: "unbound",
        kind: "remove",
      },
    },
    // Write step tests
    {
      expectedMessage: "set exactly one of markdown, markdownFile, from",
      name: "write: no content set",
      step: {
        append: true,
        doc: VALID_DOC_ID,
        kind: "write",
      },
    },
    {
      expectedMessage: "set exactly one of after, before, replace, append",
      name: "write: multiple placements",
      step: {
        after: { section: "H1" },
        append: true,
        doc: VALID_DOC_ID,
        kind: "write",
        markdown: "content",
      },
    },
    {
      expectedMessage: "markdownFile must be an absolute path",
      name: "write: relative markdownFile",
      step: {
        append: true,
        doc: VALID_DOC_ID,
        kind: "write",
        markdownFile: "relative/path.md",
      },
    },
    {
      expectedMessage: "markdownFile not found: /nonexistent/file/path.md",
      name: "write: nonexistent markdownFile",
      step: {
        append: true,
        doc: VALID_DOC_ID,
        kind: "write",
        markdownFile: "/nonexistent/file/path.md",
      },
    },
    {
      expectedMessage: "from: set at most one of node, section",
      name: "write: from sets both node and section",
      step: {
        append: true,
        doc: VALID_DOC_ID,
        from: { node: "n1", section: "H1" },
        kind: "write",
      },
    },
    {
      expectedMessage: "from.bodyOnly needs from.section",
      name: "write: from.bodyOnly without section",
      step: {
        append: true,
        doc: VALID_DOC_ID,
        from: { bodyOnly: true, node: "n1" },
        kind: "write",
      },
    },
    // Edit step tests
    {
      expectedMessage: "find must not be empty",
      name: "edit: empty find",
      step: {
        doc: VALID_DOC_ID,
        find: "",
        kind: "edit",
        replace: "bar",
      },
    },
    {
      expectedMessage: "expectCount must be a positive integer",
      name: "edit: non-positive expectCount",
      step: {
        doc: VALID_DOC_ID,
        expectCount: -1,
        find: "foo",
        kind: "edit",
        replace: "bar",
      },
    },
    // Style step tests
    {
      expectedMessage: "set text or paragraph",
      name: "style: neither text nor paragraph set",
      step: {
        at: { section: "H1" },
        doc: VALID_DOC_ID,
        kind: "style",
      },
    },
    {
      expectedMessage: "where needs text",
      name: "style: where without text",
      step: {
        at: { section: "H1" },
        doc: VALID_DOC_ID,
        kind: "style",
        paragraph: { lineSpacing: 100 },
        where: { bold: true },
      },
    },
    {
      expectedMessage: "text must set at least one property",
      name: "style: empty text patch",
      step: {
        at: { section: "H1" },
        doc: VALID_DOC_ID,
        kind: "style",
        text: {},
      },
    },
    {
      expectedMessage: "text.foregroundColor must be #RRGGBB",
      name: "style: invalid text color",
      step: {
        at: { section: "H1" },
        doc: VALID_DOC_ID,
        kind: "style",
        text: { foregroundColor: "blue" },
      },
    },
    {
      expectedMessage: "paragraph.shading must be #RRGGBB",
      name: "style: invalid paragraph shading",
      step: {
        at: { section: "H1" },
        doc: VALID_DOC_ID,
        kind: "style",
        paragraph: { shading: "#12345" },
      },
    },
    {
      expectedMessage: "where.backgroundColor must be #RRGGBB",
      name: "style: invalid where color",
      step: {
        at: { section: "H1" },
        doc: VALID_DOC_ID,
        kind: "style",
        text: { bold: true },
        where: { backgroundColor: "bad" },
      },
    },
    // Table step tests
    {
      expectedMessage: "at.body is not a table target",
      name: "table: at.body is rejected",
      step: {
        action: "deleteRow",
        at: { body: true },
        doc: VALID_DOC_ID,
        kind: "table",
        row: 0,
      },
    },
    {
      expectedMessage: "deleteRow needs row",
      name: "table: deleteRow needs row",
      step: {
        action: "deleteRow",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
      },
    },
    {
      expectedMessage: "deleteColumn needs column",
      name: "table: deleteColumn needs column",
      step: {
        action: "deleteColumn",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
      },
    },
    {
      expectedMessage: "merge needs row",
      name: "table: merge needs row",
      step: {
        action: "merge",
        at: { section: "TableSec" },
        column: 0,
        columnSpan: 2,
        doc: VALID_DOC_ID,
        kind: "table",
      },
    },
    {
      expectedMessage: "merge needs column",
      name: "table: merge needs column",
      step: {
        action: "merge",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
        row: 0,
        rowSpan: 2,
      },
    },
    {
      expectedMessage: "merge needs rowSpan * columnSpan > 1",
      name: "table: merge with 1x1 span",
      step: {
        action: "merge",
        at: { section: "TableSec" },
        column: 0,
        columnSpan: 1,
        doc: VALID_DOC_ID,
        kind: "table",
        row: 0,
        rowSpan: 1,
      },
    },
    {
      expectedMessage: "widths needs non-empty widths",
      name: "table: widths needs non-empty widths",
      step: {
        action: "widths",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
        widths: [],
      },
    },
    {
      expectedMessage: "style needs style",
      name: "table: style needs style",
      step: {
        action: "style",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
      },
    },
    {
      expectedMessage: "position above/below only with insertRow",
      name: "table: invalid position on insertRow",
      step: {
        action: "insertRow",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
        position: "left",
      },
    },
    {
      expectedMessage: "position left/right only with insertColumn",
      name: "table: invalid position on insertColumn",
      step: {
        action: "insertColumn",
        at: { section: "TableSec" },
        doc: VALID_DOC_ID,
        kind: "table",
        position: "above",
      },
    },
    {
      expectedMessage: 'column is not used by action "deleteRow"',
      name: "table: unused column in deleteRow",
      step: {
        action: "deleteRow",
        at: { section: "TableSec" },
        column: 1,
        doc: VALID_DOC_ID,
        kind: "table",
        row: 0,
      },
    },
    // Tab step tests
    {
      expectedMessage: "create needs title",
      name: "tab: create needs title",
      step: {
        action: "create",
        doc: VALID_DOC_ID,
        kind: "tab",
      },
    },
    {
      expectedMessage: "create forbids tab",
      name: "tab: create forbids tab",
      step: {
        action: "create",
        doc: VALID_DOC_ID,
        kind: "tab",
        tab: "t.0",
        title: "T",
      },
    },
    {
      expectedMessage: "create accepts at most one of after, before",
      name: "tab: create with both after and before",
      step: {
        action: "create",
        after: "t.1",
        before: "t.2",
        doc: VALID_DOC_ID,
        kind: "tab",
        title: "T",
      },
    },
    {
      expectedMessage: "rename needs tab + title",
      name: "tab: rename missing title",
      step: {
        action: "rename",
        doc: VALID_DOC_ID,
        kind: "tab",
        tab: "t.0",
      },
    },
    {
      expectedMessage: 'action "move" needs exactly one of after, before',
      name: "tab: move missing after and before",
      step: {
        action: "move",
        doc: VALID_DOC_ID,
        kind: "tab",
        tab: "t.0",
      },
    },
    {
      expectedMessage: "delete needs tab",
      name: "tab: delete missing tab",
      step: {
        action: "delete",
        doc: VALID_DOC_ID,
        kind: "tab",
      },
    },
    // Doc step tests
    {
      expectedMessage: "open needs doc",
      name: "doc: open missing doc",
      step: {
        action: "open",
        kind: "doc",
      },
    },
    {
      expectedMessage: "create needs title + as",
      name: "doc: create missing title",
      step: {
        action: "create",
        as: "newDoc",
        kind: "doc",
      },
    },
    {
      expectedMessage: "create forbids doc",
      name: "doc: create forbids doc",
      step: {
        action: "create",
        as: "newDoc",
        doc: VALID_DOC_ID,
        kind: "doc",
        title: "T",
      },
    },
    {
      expectedMessage: "copy needs doc, title, as",
      name: "doc: copy missing title",
      step: {
        action: "copy",
        as: "copied",
        doc: VALID_DOC_ID,
        kind: "doc",
      },
    },
    {
      expectedMessage: "rename needs doc + title",
      name: "doc: rename missing title",
      step: {
        action: "rename",
        doc: VALID_DOC_ID,
        kind: "doc",
      },
    },
    {
      expectedMessage: "trash needs doc",
      name: "doc: trash missing doc",
      step: {
        action: "trash",
        kind: "doc",
      },
    },
    {
      expectedMessage: "delete needs doc",
      name: "doc: delete missing doc",
      step: {
        action: "delete",
        kind: "doc",
      },
    },
    {
      expectedMessage: "fresh only with open",
      name: "doc: fresh with create",
      step: {
        action: "create",
        as: "myDoc",
        fresh: true,
        kind: "doc",
        title: "T",
      },
    },
    // Share step tests
    {
      expectedMessage: "add needs role + scope",
      name: "share: add missing role",
      step: {
        action: "add",
        doc: VALID_DOC_ID,
        kind: "share",
        scope: "anyone",
      },
    },
    {
      expectedMessage: "email required for user/group",
      name: "share: add user scope missing email",
      step: {
        action: "add",
        doc: VALID_DOC_ID,
        kind: "share",
        role: "reader",
        scope: "user",
      },
    },
    {
      expectedMessage: "domain only for domain",
      name: "share: add domain set on user scope",
      step: {
        action: "add",
        doc: VALID_DOC_ID,
        domain: "example.com",
        email: "user@example.com",
        kind: "share",
        role: "reader",
        scope: "user",
      },
    },
    {
      expectedMessage: "owner needs scope user",
      name: "share: owner role with domain scope",
      step: {
        action: "add",
        doc: VALID_DOC_ID,
        domain: "example.com",
        kind: "share",
        role: "owner",
        scope: "domain",
      },
    },
    {
      expectedMessage: "list takes no other fields",
      name: "share: list with extra fields",
      step: {
        action: "list",
        doc: VALID_DOC_ID,
        email: "user@example.com",
        kind: "share",
      },
    },
    {
      expectedMessage: "remove needs one of permissionId, email, or scope anyone/domain",
      name: "share: remove without identifier",
      step: {
        action: "remove",
        doc: VALID_DOC_ID,
        kind: "share",
      },
    },
    // Page step tests
    {
      expectedMessage: "at least one setting",
      name: "page: no setting provided",
      step: {
        doc: VALID_DOC_ID,
        kind: "page",
      },
    },
    {
      expectedMessage: "size excludes width/height",
      name: "page: size with width",
      step: {
        doc: VALID_DOC_ID,
        kind: "page",
        size: "LETTER",
        width: 612,
      },
    },
    {
      expectedMessage: "width and height together",
      name: "page: width without height",
      step: {
        doc: VALID_DOC_ID,
        kind: "page",
        width: 612,
      },
    },
    {
      expectedMessage: "margins >= 0",
      name: "page: negative margins",
      step: {
        doc: VALID_DOC_ID,
        kind: "page",
        margins: { top: -5 },
      },
    },
    // Query step tests
    {
      expectedMessage: "where only with nodes",
      name: "query: where with outline output",
      step: {
        doc: VALID_DOC_ID,
        kind: "query",
        output: "outline",
        where: { contains: "foo" },
      },
    },
    {
      expectedMessage: "skipFrontmatter only with markdown",
      name: "query: skipFrontmatter with nodes output",
      step: {
        doc: VALID_DOC_ID,
        kind: "query",
        output: "nodes",
        skipFrontmatter: true,
      },
    },
    {
      expectedMessage: "saveTo absolute",
      name: "query: relative saveTo path",
      step: {
        doc: VALID_DOC_ID,
        kind: "query",
        saveTo: "relative/dir",
      },
    },
  ];

  for (const f of fixtures) {
    test(`fixture: ${f.name}`, () => {
      const steps = [...(f.setup ?? []), f.step];
      expect(() => stepsAssertValid(steps)).toThrow(f.expectedMessage);
    });
  }

  test("collects every violation across steps (3 bad -> Invalid steps (3):)", () => {
    const badSteps: GdocsmithStep[] = [
      {
        action: "create",
        as: "doc1",
        doc: VALID_DOC_ID, // create forbids doc
        kind: "doc",
        title: "T",
      },
      {
        doc: VALID_DOC_ID,
        find: "", // find must not be empty
        kind: "edit",
        replace: "x",
      },
      {
        doc: VALID_DOC_ID,
        kind: "page", // at least one setting
      },
    ];

    expect(() => stepsAssertValid(badSteps)).toThrow(/Invalid steps \(3\):/);
  });

  test("aliases must be bound before use", () => {
    // Using unbound alias throws
    expect(() =>
      stepsAssertValid([
        {
          at: { section: "H1" },
          doc: "myAlias",
          kind: "remove",
        },
      ]),
    ).toThrow('unknown doc alias "myAlias": bind it with as on an earlier doc step, or pass a raw document ID');

    // Using bound alias succeeds
    expect(() =>
      stepsAssertValid([
        {
          action: "create",
          as: "myAlias",
          kind: "doc",
          title: "Title",
        },
        {
          at: { section: "H1" },
          doc: "myAlias",
          kind: "remove",
        },
      ]),
    ).not.toThrow();
  });

  test("uses after delete are rejected", () => {
    const steps: GdocsmithStep[] = [
      {
        action: "create",
        as: "tempDoc",
        kind: "doc",
        title: "Temp",
      },
      {
        action: "delete",
        doc: "tempDoc",
        kind: "doc",
      },
      {
        at: { section: "H1" },
        doc: "tempDoc",
        kind: "remove",
      },
    ];

    expect(() => stepsAssertValid(steps)).toThrow('doc "tempDoc" was deleted/trashed at steps[1]');
  });
});
