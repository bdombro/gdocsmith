/*

Unit tests for InlineMarkup parse, serialize, and mergeRuns.

*/
import { describe, expect, test } from "bun:test";
import { InlineMarkup } from "./inline.ts";

describe("InlineMarkup", () => {
  test("parse bold and link", () => {
    const { runs, text } = InlineMarkup.parse("See [AUTO-778](https://jira.example/AUTO-778) for **details**.");
    expect(text).toBe("See AUTO-778 for details.");
    expect(runs.some((r) => r.link)).toBe(true);
    expect(runs.some((r) => r.bold)).toBe(true);
  });

  test("parse code span", () => {
    const { runs, text } = InlineMarkup.parse("Use `linkUrl` field");
    expect(text).toBe("Use linkUrl field");
    expect(runs.some((r) => r.code)).toBe(true);
  });

  test("serialize bold and link", () => {
    const text = InlineMarkup.serialize([
      {
        textRun: {
          content: "details",
          textStyle: { bold: true, link: { url: "https://x.test" } },
        },
      },
    ]);
    expect(text).toBe("**[details](https://x.test)**");
  });

  test("serialize smart-chip richLink as a markdown link", () => {
    const text = InlineMarkup.serialize([
      { textRun: { content: "From " } },
      {
        richLink: {
          richLinkProperties: {
            title: "Unit template",
            uri: "https://docs.google.com/document/d/abc/edit",
          },
          textStyle: { italic: true },
        },
      },
    ]);
    expect(text).toBe("From *[Unit template](https://docs.google.com/document/d/abc/edit)*");
  });

  test("mergeRuns combines adjacent identical runs", () => {
    const merged = InlineMarkup.mergeRuns([
      { end: 3, start: 0, bold: true },
      { bold: true, end: 6, start: 3 },
    ]);
    expect(merged).toEqual([{ bold: true, end: 6, start: 0 }]);
  });

  test("parse strikethrough", () => {
    const { runs, text } = InlineMarkup.parse("This is ~~deprecated~~ text");
    expect(text).toBe("This is deprecated text");
    expect(runs.some((r) => r.strikethrough)).toBe(true);
  });

  test("resolveRuns merges explicit custom runs by substring match", () => {
    const { runs: parsedRuns, text } = InlineMarkup.parse("The variable queueState is 9pt Courier.");
    const resolved = InlineMarkup.resolveRuns(text, parsedRuns, [{ code: true, fontSize: 9, text: "queueState" }]);
    const custom = resolved.find((r) => r.code && r.fontSize === 9);
    expect(custom).toBeDefined();
    expect(custom?.start).toBe(13);
    expect(custom?.end).toBe(23);
  });

  test("parse nested bold link", () => {
    const { runs, text } = InlineMarkup.parse("Click **[here](https://example.com)** now.");
    expect(text).toBe("Click here now.");
    const run = runs.find((r) => r.link === "https://example.com");
    expect(run).toBeDefined();
    expect(run?.bold).toBe(true);
    expect(run?.start).toBe(6);
    expect(run?.end).toBe(10);
  });

  test("parse nested bold code", () => {
    const { runs, text } = InlineMarkup.parse("Run **`bun test`** now.");
    expect(text).toBe("Run bun test now.");
    const run = runs.find((r) => r.code);
    expect(run).toBeDefined();
    expect(run?.bold).toBe(true);
    expect(run?.start).toBe(4);
    expect(run?.end).toBe(12);
  });

  test("parse nested bold italic", () => {
    const { runs, text } = InlineMarkup.parse("This is ***bold and italic***.");
    expect(text).toBe("This is bold and italic.");
    const run = runs.find((r) => r.bold && r.italic);
    expect(run).toBeDefined();
    expect(run?.start).toBe(8);
    expect(run?.end).toBe(23);
  });

  test("parse directive style with custom style dictionary", () => {
    const { runs, text } = InlineMarkup.parse("Here is ::myStyle[subtle italic copy]:: and regular text.", {
      myStyle: {
        fontSize: 10,
        foregroundColor: "#999999",
        italic: true,
      },
    });
    expect(text).toBe("Here is subtle italic copy and regular text.");
    const run = runs.find((r) => r.foregroundColor === "#999999");
    expect(run).toBeDefined();
    expect(run?.italic).toBe(true);
    expect(run?.fontSize).toBe(10);
    expect(run?.start).toBe(8);
    expect(run?.end).toBe(26);
  });

  test("parse directive style with nested formatting inside brackets", () => {
    const { runs, text } = InlineMarkup.parse(
      "Notice ::alert[critical warning with **bold** and [link](https://example.com)]:: here.",
      {
        alert: {
          bold: true,
          foregroundColor: "#e11d48",
        },
      },
    );
    expect(text).toBe("Notice critical warning with bold and link here.");
    // The alert text and bold text share bold + color, so mergeRuns merges them from 7..38
    const mergedAlertRun = runs.find((r) => r.start === 7 && r.end === 38);
    expect(mergedAlertRun?.foregroundColor).toBe("#e11d48");
    expect(mergedAlertRun?.bold).toBe(true);

    // The link adds link property, starting at 38..42
    const linkRun = runs.find((r) => r.link === "https://example.com");
    expect(linkRun?.start).toBe(38);
    expect(linkRun?.end).toBe(42);
    expect(linkRun?.foregroundColor).toBe("#e11d48");
    expect(linkRun?.bold).toBe(true);
  });

  test("directive style falls back to plain content when unmapped", () => {
    const { runs, text } = InlineMarkup.parse("Here is ::unknownStyle[unmapped content]:: and text.");
    expect(text).toBe("Here is unmapped content and text.");
    expect(runs).toHaveLength(0);
  });

  test("InlineMarkup.withStyles scopes styles dynamically", () => {
    InlineMarkup.withStyles(
      {
        badge: {
          backgroundColor: "#f3f4f6",
          fontFamily: "Courier New",
          fontSize: 9,
        },
      },
      () => {
        const { runs, text } = InlineMarkup.parse("Status: ::badge[ACTIVE]::");
        expect(text).toBe("Status: ACTIVE");
        const run = runs.find((r) => r.backgroundColor === "#f3f4f6");
        expect(run).toBeDefined();
        expect(run?.fontFamily).toBe("Courier New");
        expect(run?.fontSize).toBe(9);
      },
    );
    // After withStyles, scoped styles are reset
    const { runs } = InlineMarkup.parse("Status: ::badge[ACTIVE]::");
    expect(runs).toHaveLength(0);
  });
});
