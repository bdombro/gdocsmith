/*

Unit tests for Paragraph read helpers.

*/
import { describe, expect, test } from "bun:test";
import { Paragraph } from "./paragraph.ts";

describe("Paragraph", () => {
  test("text joins text runs", () => {
    expect(
      Paragraph.text({
        elements: [{ textRun: { content: "Hello\n" } }],
      }),
    ).toBe("Hello\n");
  });

  test("text includes smart-chip titles between runs", () => {
    expect(
      Paragraph.text(
        {
          elements: [
            { textRun: { content: "From " } },
            {
              richLink: {
                richLinkProperties: { title: "Unit template", uri: "https://example.com/t" },
              },
            },
            { textRun: { content: "\n" } },
          ],
        },
        true,
      ),
    ).toBe("From Unit template");
  });

  test("bulletNestingLevel uses nestingLevel when present", () => {
    expect(Paragraph.bulletNestingLevel({ bullet: { nestingLevel: 2 } })).toBe(2);
    expect(
      Paragraph.bulletNestingLevel({
        bullet: { listId: "kix.x" },
        paragraphStyle: { indentStart: { magnitude: 72 } },
      }),
    ).toBe(0);
  });

  test("isArtifactRun detects private-use paste glyphs", () => {
    expect(
      Paragraph.isArtifactRun({
        textRun: { content: "\uE907" },
      }),
    ).toBe(true);
    expect(
      Paragraph.isArtifactRun({
        textRun: { content: "plain" },
      }),
    ).toBe(false);
  });

  test("isGlyphOnlyText and stripArtifacts handle paste glyphs", () => {
    expect(Paragraph.isGlyphOnlyText("\uE907")).toBe(true);
    expect(Paragraph.stripArtifacts("\uE907The three templates")).toBe("The three templates");
  });
});
