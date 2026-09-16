import { describe, expect, test } from "bun:test";
import { auditDocNodes, type ExportTabInput, exportDocumentToMarkdown, exportTabToMarkdown } from "./export.ts";
import type { DocNode } from "./types.ts";

describe("auditDocNodes & exportTabToMarkdown", () => {
  const sampleNodes: DocNode[] = [
    {
      end: 10,
      tapeIndex: 1,
      kind: "paragraph",
      namedStyleType: "HEADING_1",
      start: 0,
      text: "Project Title",
    },
    {
      end: 40,
      tapeIndex: 2,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 10,
      style: {
        fontSize: 10,
        foregroundColor: "#999999",
      },
      text: "Owner: Brian · Spec: Composite",
    },
    {
      end: 60,
      tapeIndex: 3,
      images: [{ end: 60, heightPt: 100, objectId: "img-1", start: 40, widthPt: 100 }],
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: 40,
      text: "Paragraph with photo",
    },
  ];

  test("auditDocNodes flags issues concisely without dumping styles by default", () => {
    const summary = auditDocNodes(sampleNodes);
    expect(summary.lossless).toBe(false);
    expect(summary.nodeCount).toBe(3);
    expect(summary.styledNodesCount).toBe(1);
    expect(summary.issues).toEqual(["Node 3: 1 image(s) replaced with [Image] placeholder"]);
    expect(summary.styles).toBeUndefined();
  });

  test("auditDocNodes includes styles when includeStyles is true", () => {
    const summary = auditDocNodes(sampleNodes, { includeStyles: true });
    expect(summary.styles).toEqual({
      "2": {
        fontSize: 10,
        foregroundColor: "#999999",
      },
    });
  });

  test("exportTabToMarkdown generates frontmatter styles and directive markup", () => {
    const { audit, markdown } = exportTabToMarkdown(sampleNodes);
    expect(audit.lossless).toBe(false);
    expect(markdown).toContain("---");
    expect(markdown).toContain("styles:");
    expect(markdown).toContain("fontSize: 10");
    expect(markdown).toContain('foregroundColor: "#999999"');
    expect(markdown).toContain("omissions:");
    expect(markdown).toContain("Node 3: 1 image(s) replaced with [Image] placeholder");
    expect(markdown).toContain("# Project Title");
    expect(markdown).toContain("::style1[Owner: Brian · Spec: Composite]::");
    expect(markdown).toContain("Paragraph with photo [Image]");
  });

  test("exportDocumentToMarkdown exports multiple tabs with unified frontmatter, deduplicated headings, and tab dividers", () => {
    const tabs: ExportTabInput[] = [
      {
        tabId: "t.overview",
        tabTitle: "Overview",
        nodes: [
          {
            end: 8,
            kind: "paragraph",
            namedStyleType: "HEADING_1",
            start: 0,
            tapeIndex: 1,
            text: "Overview",
          },
          {
            end: 30,
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            start: 8,
            tapeIndex: 2,
            text: "This is the overview tab.",
          },
        ],
      },
      {
        tabId: "t.arch",
        tabTitle: "Architecture",
        nodes: [
          {
            end: 25,
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            start: 0,
            tapeIndex: 1,
            text: "Microservices design.",
          },
          {
            end: 50,
            images: [{ end: 50, heightPt: 50, objectId: "img-arch", start: 25, widthPt: 50 }],
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            start: 25,
            tapeIndex: 2,
            text: "Diagram below",
          },
        ],
      },
      {
        tabId: "t.db",
        tabTitle: "Database",
        nodes: [
          {
            end: 20,
            kind: "paragraph",
            namedStyleType: "NORMAL_TEXT",
            start: 0,
            style: {
              fontSize: 9,
              foregroundColor: "#333333",
            },
            tapeIndex: 1,
            text: "PostgreSQL 16",
          },
        ],
      },
    ];

    const { audit, markdown } = exportDocumentToMarkdown(tabs, {
      documentId: "doc-123",
      includeStyles: true,
    });

    expect(audit.tabCount).toBe(3);
    expect(audit.nodeCount).toBe(5);
    expect(audit.lossless).toBe(false);
    expect(audit.issues).toEqual(["[Architecture] Node 2: 1 image(s) replaced with [Image] placeholder"]);
    expect(audit.tabs).toHaveLength(3);
    expect(audit.tabs?.[0]?.tabTitle).toBe("Overview");
    expect(audit.tabs?.[0]?.nodeCount).toBe(2);
    expect(audit.tabs?.[1]?.tabTitle).toBe("Architecture");
    expect(audit.tabs?.[1]?.nodeCount).toBe(2);
    expect(audit.tabs?.[2]?.tabTitle).toBe("Database");
    expect(audit.tabs?.[2]?.nodeCount).toBe(1);

    // Frontmatter check
    expect(markdown).toMatch(/^---\n/);
    expect(markdown).toContain('styles:\n  style1:\n    fontSize: 9\n    foregroundColor: "#333333"');
    expect(markdown).toContain('omissions:\n  - "[Architecture] Node 2: 1 image(s) replaced with [Image] placeholder"');

    // Tab 1: "Overview" already had `# Overview`, so it should NOT be duplicated
    expect(markdown).toContain("# Overview\n\nThis is the overview tab.");
    expect(markdown).not.toContain("# Overview\n\n# Overview");

    // Divider between tabs
    expect(markdown).toContain("\n\n---\n\n");

    // Tab 2: "Architecture" did not have `# Architecture`, so it should be automatically prepended
    expect(markdown).toContain("# Architecture\n\nMicroservices design.\n\nDiagram below [Image]");

    // Tab 3: "Database" did not have `# Database`, so it should be automatically prepended with styled text
    expect(markdown).toContain("# Database\n\n::style1[PostgreSQL 16]::");
  });

  test("exportTabToMarkdown groups consecutive code nodes into a single fenced code block without frontmatter style pollution", () => {
    const nodes: DocNode[] = [
      {
        end: 20,
        tapeIndex: 1,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 0,
        style: { fontSize: 10 },
        text: "const a = 1;",
      },
      {
        end: 40,
        tapeIndex: 2,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        style: { fontSize: 10 },
        text: "const b = 2;",
      },
    ];

    const { audit, markdown } = exportTabToMarkdown(nodes);
    expect(audit.styledNodesCount).toBe(0);
    expect(markdown).not.toContain("styles:");
    expect(markdown).not.toContain("::style");
    expect(markdown).toBe("```\nconst a = 1;\nconst b = 2;\n```\n");
  });

  test("exportTabToMarkdown preserves indentation and bridges internal blank lines in code blocks", () => {
    const nodes: DocNode[] = [
      {
        end: 20,
        tapeIndex: 1,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 0,
        text: "function test() {",
      },
      {
        end: 21,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "",
      },
      {
        end: 45,
        tapeIndex: 3,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 21,
        text: "    return true;",
      },
      {
        end: 50,
        tapeIndex: 4,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 45,
        text: "}",
      },
    ];

    const { markdown } = exportTabToMarkdown(nodes);
    expect(markdown).toBe("```\nfunction test() {\n\n    return true;\n}\n```\n");
  });

  test("exportTabToMarkdown does not swallow trailing empty paragraphs after code blocks", () => {
    const nodes: DocNode[] = [
      {
        end: 20,
        tapeIndex: 1,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 0,
        text: "const x = 1;",
      },
      {
        end: 21,
        tapeIndex: 2,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 20,
        text: "",
      },
      {
        end: 45,
        tapeIndex: 3,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 21,
        text: "Following explanation.",
      },
    ];

    const { markdown } = exportTabToMarkdown(nodes);
    expect(markdown).toContain("```\nconst x = 1;\n```");
    expect(markdown).toContain("Following explanation.");
    // The code block itself should NOT contain a trailing empty line
    expect(markdown).not.toContain("const x = 1;\n\n```");
  });

  test("exportTabToMarkdown uses 4-backtick fence when code contains triple backticks", () => {
    const nodes: DocNode[] = [
      {
        end: 30,
        tapeIndex: 1,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 0,
        text: "```typescript",
      },
      {
        end: 50,
        tapeIndex: 2,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 30,
        text: "const a = 1;",
      },
      {
        end: 55,
        tapeIndex: 3,
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 50,
        text: "```",
      },
    ];

    const { markdown } = exportTabToMarkdown(nodes);
    expect(markdown).toBe("````\n```typescript\nconst a = 1;\n```\n````\n");
  });

  test("exportTabToMarkdown prefixes blockquote on code block when indentStart is present", () => {
    const nodes: DocNode[] = [
      {
        end: 20,
        tapeIndex: 1,
        indentStart: { magnitude: 18, unit: "PT" },
        isCode: true,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: 0,
        text: "git status",
      },
    ];

    const { markdown } = exportTabToMarkdown(nodes);
    expect(markdown).toBe("> ```\n> git status\n> ```\n");
  });
});
