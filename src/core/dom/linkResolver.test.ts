/* Unit tests for symbolic link resolution. */

import { describe, expect, test } from "bun:test";
import { InlineMarkup } from "~/core/inline.ts";
import type { GoogleDoc } from "~/core/types.ts";
import { createSymbolicLinkResolver, resolveSymbolicLink } from "./linkResolver.ts";
import { parseMarkdownToElements } from "./markdownParser.ts";
import { tapeMutationsApply } from "./ops.ts";
import { DomWriter } from "./write.ts";

function paraWithHeading(
  text: string,
  headingId: string,
  start = 1,
): NonNullable<GoogleDoc["body"]>["content"][number] {
  return {
    endIndex: start + text.length + 1,
    paragraph: {
      elements: [{ textRun: { content: `${text}\n` } }],
      paragraphStyle: {
        headingId,
        namedStyleType: "HEADING_1",
      },
    },
    startIndex: start,
  };
}

const mockDoc: GoogleDoc = {
  tabs: [
    {
      documentTab: {
        body: {
          content: [paraWithHeading("Overview", "h.overview")],
        },
      },
      tabProperties: { tabId: "t.0", title: "Main" },
    },
    {
      documentTab: {
        body: {
          content: [
            paraWithHeading("Architecture Decisions", "h.arch_dec"),
            paraWithHeading("Legacy Migration", "h.migration"),
          ],
        },
      },
      tabProperties: { tabId: "t.dec", title: "Decisions" },
    },
  ],
};

describe("symbolicLinkResolve", () => {
  test("passes through external URLs and existing Docs deep links unchanged", () => {
    expect(resolveSymbolicLink("https://google.com")).toBe("https://google.com");
    expect(resolveSymbolicLink("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(resolveSymbolicLink("?tab=t.dec#heading=h.arch_dec")).toBe("?tab=t.dec#heading=h.arch_dec");
    expect(resolveSymbolicLink("#heading=h.overview")).toBe("#heading=h.overview");
  });

  test("resolves tab-only link to ?tab=<tabId>", () => {
    const resolver = createSymbolicLinkResolver({ doc: mockDoc });
    expect(resolver("tab:Decisions")).toBe("?tab=t.dec");
    expect(resolver("tab:Main")).toBe("?tab=t.0");
  });

  test("resolves tab and heading link to ?tab=<tabId>#heading=<headingId>", () => {
    const resolver = createSymbolicLinkResolver({ doc: mockDoc });
    expect(resolver("tab:Decisions#Architecture Decisions")).toBe("?tab=t.dec#heading=h.arch_dec");
    expect(resolver("tab:Decisions#Legacy Migration")).toBe("?tab=t.dec#heading=h.migration");
  });

  test("resolves tab and raw heading ID link", () => {
    const resolver = createSymbolicLinkResolver({ doc: mockDoc });
    expect(resolver("tab:Decisions#h.arch_dec")).toBe("?tab=t.dec#heading=h.arch_dec");
  });

  test("resolves local heading link within active tab", () => {
    const resolver = createSymbolicLinkResolver({ currentTabId: "t.dec", doc: mockDoc });
    expect(resolver("#Legacy Migration")).toBe("?tab=t.dec#heading=h.migration");
  });

  test("resolves heading link across tabs when not in active tab", () => {
    const resolver = createSymbolicLinkResolver({ currentTabId: "t.0", doc: mockDoc });
    expect(resolver("#Architecture Decisions")).toBe("?tab=t.dec#heading=h.arch_dec");
  });

  test("throws error when tab does not exist", () => {
    const resolver = createSymbolicLinkResolver({ doc: mockDoc });
    expect(() => resolver("tab:Nonexistent")).toThrow(/Unknown tab Nonexistent/);
  });

  test("throws error when heading does not exist in target tab", () => {
    const resolver = createSymbolicLinkResolver({ doc: mockDoc });
    expect(() => resolver("tab:Decisions#Nonexistent Heading")).toThrow(
      /heading "Nonexistent Heading" not found in tab "Decisions"/,
    );
  });

  test("integrates with parseMarkdownToElements", () => {
    const linkResolver = createSymbolicLinkResolver({ doc: mockDoc });
    const elements = parseMarkdownToElements("See the [Migration Plan](tab:Decisions#Legacy Migration) for details.", {
      linkResolver,
    });

    const el = elements[0];
    expect(el?.kind).toBe("paragraph");
    if (el?.kind === "paragraph") {
      expect(el.text).toBe("See the [Migration Plan](?tab=t.dec#heading=h.migration) for details.");
      const parsed = InlineMarkup.parse(el.text ?? "");
      expect(parsed.runs.some((r) => r.link === "?tab=t.dec#heading=h.migration")).toBe(true);
    }
  });

  test("resolves symbolic links in replaceSection via DomWriter", () => {
    const nodes = [
      {
        end: 23,
        headingId: "h.arch_dec",
        kind: "paragraph" as const,
        namedStyleType: "HEADING_1" as const,
        start: 1,
        tapeIndex: 1,
        text: "Architecture Decisions",
      },
    ];
    const writer = new DomWriter(nodes, { doc: mockDoc, tabId: "t.dec" });
    tapeMutationsApply(
      writer,
      [
        {
          at: 1,
          replaceSection: "## Architecture Decisions\n\nSee [Overview](tab:Main#Overview).",
        },
      ],
      0,
    );

    const inserted = writer.nodes.find((n) => n.text?.includes("See [Overview]"));
    expect(inserted?.text).toBe("See [Overview](?tab=t.0#heading=h.overview).");
  });

  test("preserves symbolic links inside code blocks and inline code spans", () => {
    const linkResolver = createSymbolicLinkResolver({ doc: mockDoc });
    const md =
      "Prose link: [Overview](tab:Main#Overview)\n\n" +
      "Inline code: `[Overview](tab:Main#Overview)`\n\n" +
      "```markdown\n[Overview](tab:Main#Overview)\n```";

    const elements = parseMarkdownToElements(md, { linkResolver });
    expect(elements[0]?.kind === "paragraph" && elements[0].text).toBe(
      "Prose link: [Overview](?tab=t.0#heading=h.overview)",
    );
    expect(elements[1]?.kind === "paragraph" && elements[1].text).toContain("`[Overview](tab:Main#Overview)`");
    expect(elements[2]?.kind === "paragraph" && elements[2].text).toBe("[Overview](tab:Main#Overview)");
  });
});
