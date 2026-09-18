/* Unit tests for createElement guards, code block generation, and alias refusal. */

import { describe, expect, test } from "bun:test";
import { createCodeBlock, createElement } from "./element.ts";
import { DOUBLE_NUMBER_MSG, EMPTY_BULLET_MSG, FAKE_BULLET_MSG, HEADING_BULLET_MSG } from "./guards.ts";

describe("createElement", () => {
  test("builds a NORMAL_TEXT paragraph spec", () => {
    const el = createElement("paragraph", {
      namedStyleType: "NORMAL_TEXT",
      text: "Hello",
    });
    expect(el).toEqual({
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      text: "Hello",
    });
  });

  test("builds a codeBlock paragraph spec with default Courier New 10pt", () => {
    const el = createElement("codeBlock", {
      text: "const x = 1;\n",
    });
    expect(el).toEqual({
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        lineSpacing: 100,
      },
      text: "const x = 1;",
    });
  });

  test("builds a codeBlock paragraph spec with custom style override", () => {
    const el = createElement("codeBlock", {
      style: { fontSize: 11, foregroundColor: "#123456" },
      text: "const y = 2;",
    });
    expect(el).toEqual({
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        foregroundColor: "#123456",
        lineSpacing: 100,
      },
      text: "const y = 2;",
    });
  });

  test("createCodeBlock splits multiline text into consecutive paragraphs with spaceBelow: 0", () => {
    const specs = createCodeBlock({
      text: "line 1\nline 2\nline 3\n",
    });
    expect(specs).toHaveLength(3);
    expect(specs[0]?.text).toBe("line 1");
    expect(specs[0]?.style?.spaceBelow).toBe(0);
    expect(specs[0]?.style?.lineSpacing).toBe(100);
    expect(specs[0]?.style?.fontFamily).toBe("Courier New");

    expect(specs[1]?.text).toBe("line 2");
    expect(specs[1]?.style?.spaceBelow).toBe(0);

    expect(specs[2]?.text).toBe("line 3");
    expect(specs[2]?.style?.spaceBelow).toBeUndefined();
    expect(specs[2]?.style?.lineSpacing).toBe(100);
  });

  test("strips a trailing newline from text", () => {
    const el = createElement("paragraph", {
      namedStyleType: "NORMAL_TEXT",
      text: "Hello\n",
    });
    expect(el.text).toBe("Hello");
  });

  test("defaults bullet preset and nestingLevel", () => {
    const el = createElement("paragraph", {
      bullet: {},
      namedStyleType: "NORMAL_TEXT",
      text: "Item",
    });
    expect(el.bullet).toEqual({
      nestingLevel: 0,
      preset: "BULLET_DISC_CIRCLE_SQUARE",
    });
  });

  test("accepts bullet: true as default bullet preset and nestingLevel", () => {
    const el = createElement("paragraph", {
      bullet: true,
      namedStyleType: "NORMAL_TEXT",
      text: "Item",
    });
    expect(el.bullet).toEqual({
      nestingLevel: 0,
      preset: "BULLET_DISC_CIRCLE_SQUARE",
    });
  });

  test("refuses p/q/ul/ol aliases", () => {
    expect(() =>
      createElement("p" as "paragraph", {
        namedStyleType: "NORMAL_TEXT",
        text: "x",
      }),
    ).toThrow(/No p\/q\/ul\/ol aliases/);
  });

  test("hyphen-prefix refuse", () => {
    expect(() =>
      createElement("paragraph", {
        namedStyleType: "NORMAL_TEXT",
        text: "- not a real bullet",
      }),
    ).toThrow(FAKE_BULLET_MSG);
    expect(() =>
      createElement("paragraph", {
        bullet: { preset: "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "• also fake",
      }),
    ).toThrow(FAKE_BULLET_MSG);
  });

  test("empty bullet refuse", () => {
    expect(() =>
      createElement("paragraph", {
        bullet: {},
        namedStyleType: "NORMAL_TEXT",
        text: "",
      }),
    ).toThrow(EMPTY_BULLET_MSG);
    expect(() =>
      createElement("paragraph", {
        bullet: {},
        namedStyleType: "NORMAL_TEXT",
        text: "-",
      }),
    ).toThrow(EMPTY_BULLET_MSG);
    expect(() =>
      createElement("paragraph", {
        bullet: {},
        namedStyleType: "NORMAL_TEXT",
        text: "–",
      }),
    ).toThrow(EMPTY_BULLET_MSG);
  });

  test("refuses numbered prefix on bullets", () => {
    expect(() =>
      createElement("paragraph", {
        bullet: { preset: "NUMBERED_DECIMAL_NESTED" },
        namedStyleType: "NORMAL_TEXT",
        text: "1. already numbered",
      }),
    ).toThrow(DOUBLE_NUMBER_MSG);
  });

  test("refuses bullet on headings", () => {
    expect(() =>
      createElement("paragraph", {
        bullet: {},
        namedStyleType: "HEADING_2",
        text: "Nope",
      }),
    ).toThrow(HEADING_BULLET_MSG);
  });

  test("force overrides empty bullet", () => {
    const el = createElement("paragraph", { bullet: {}, namedStyleType: "NORMAL_TEXT", text: "" }, { force: true });
    expect(el.text).toBe("");
  });

  test("accepts numbered alpha-roman preset and style.indentStart", () => {
    const el = createElement("paragraph", {
      bullet: { preset: "NUMBERED_DECIMAL_ALPHA_ROMAN" },
      namedStyleType: "NORMAL_TEXT",
      style: { indentFirstLine: 0, indentStart: 18 },
      text: "Step",
    });
    expect(el.bullet?.preset).toBe("NUMBERED_DECIMAL_ALPHA_ROMAN");
    expect(el.indentStart).toEqual({ magnitude: 18, unit: "PT" });
  });

  test("passes paragraph specials through", () => {
    const el = createElement("paragraph", {
      namedStyleType: "NORMAL_TEXT",
      specials: [{ email: "a@x.com", kind: "person", offset: 0 }],
      text: "Hi",
    });
    expect(el.kind).toBe("paragraph");
    if (el.kind === "paragraph") {
      expect(el.specials).toEqual([{ email: "a@x.com", kind: "person", offset: 0 }]);
    }
  });

  test("refuses unknown bullet preset", () => {
    expect(() =>
      createElement("paragraph", {
        bullet: { preset: "NOT_A_PRESET" as "BULLET_DISC_CIRCLE_SQUARE" },
        namedStyleType: "NORMAL_TEXT",
        text: "Item",
      }),
    ).toThrow(/Unknown bullet preset/);
  });

  test("creates new element kinds: sectionBreak, person, richLink, date, footnote, inlineImage", () => {
    const sb = createElement("sectionBreak", { sectionType: "CONTINUOUS" });
    expect(sb).toEqual({ kind: "sectionBreak", sectionType: "CONTINUOUS" });

    const person = createElement("person", { email: "user@example.com" });
    expect(person).toEqual({ email: "user@example.com", kind: "person" });

    const link = createElement("richLink", { title: "Test", uri: "https://example.com" });
    expect(link).toEqual({ kind: "richLink", title: "Test", uri: "https://example.com" });

    const date = createElement("date", { displayText: "Today", timestamp: "2026-09-15" });
    expect(date).toEqual({ displayText: "Today", kind: "date", timestamp: "2026-09-15" });

    const fn = createElement("footnote", { text: "Citation" });
    expect(fn).toEqual({ kind: "footnote", text: "Citation" });

    const img = createElement("inlineImage", { uri: "https://example.com/img.png", widthPt: 100 });
    expect(img).toEqual({ kind: "inlineImage", uri: "https://example.com/img.png", widthPt: 100 });
  });

  test("refuses unsupported element kinds with descriptive errors", () => {
    expect(() => createElement("columnBreak" as any)).toThrow(
      'Cannot create "columnBreak": columnBreak cannot be inserted via REST API',
    );
    expect(() => createElement("horizontalRule" as any)).toThrow(
      'Cannot create "horizontalRule": Horizontal rules cannot be inserted via REST API',
    );
    expect(() => createElement("equation" as any)).toThrow(
      'Cannot create "equation": Math equations cannot be inserted via REST API',
    );
    expect(() => createElement("tableOfContents" as any)).toThrow(
      'Cannot create "tableOfContents": Table of Contents cannot be created or updated via REST API',
    );
    expect(() => createElement("bookmark" as any)).toThrow(
      'Cannot create "bookmark": Bookmarks cannot be inserted via REST API',
    );
  });
});
