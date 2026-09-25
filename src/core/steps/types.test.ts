/* Tests for v2 step types and standard recipes (G4 D1, D10). */

import { describe, expect, test } from "bun:test";
import { type GdocsmithRun, STEP_KINDS } from "./types.ts";

/** R1: outline + section read. */
export const recipeR1: GdocsmithRun = {
  steps: [
    {
      doc: "doc-1234567890123456789012345",
      kind: "query",
      output: "outline",
    },
    {
      at: { section: "Overview" },
      doc: "doc-1234567890123456789012345",
      kind: "query",
      output: "markdown",
    },
  ],
};

/** R2: section rewrite. */
export const recipeR2: GdocsmithRun = {
  steps: [
    {
      at: { section: "Deprecated Notes" },
      doc: "doc-1234567890123456789012345",
      kind: "remove",
    },
    {
      doc: "doc-1234567890123456789012345",
      kind: "write",
      markdown: "## Overview\n\nRewritten section content.",
      replace: { section: "Overview" },
    },
  ],
};

/** R3: placeholder via {text}. */
export const recipeR3: GdocsmithRun = {
  steps: [
    {
      doc: "doc-1234567890123456789012345",
      kind: "write",
      markdown: "Concrete implementation notes.",
      replace: { text: "TODO: Add implementation notes" },
    },
  ],
};

/** R4: edit with expectCount. */
export const recipeR4: GdocsmithRun = {
  steps: [
    {
      at: { section: "Mission Brief" },
      doc: "doc-1234567890123456789012345",
      expectCount: 2,
      find: "pigeon",
      kind: "edit",
      matchCase: true,
      replace: "falcon",
    },
  ],
};

/** R5: new doc (doc create, tab rename t.0, write from + append, tab create from). */
export const recipeR5: GdocsmithRun = {
  steps: [
    {
      action: "create",
      as: "target",
      kind: "doc",
      title: "New Specification",
    },
    {
      action: "rename",
      doc: "target",
      kind: "tab",
      tab: "t.0",
      title: "Summary",
    },
    {
      append: true,
      doc: "target",
      from: {
        doc: "source-123456789012345678901234",
        tab: "t.0",
      },
      kind: "write",
    },
    {
      action: "create",
      doc: "target",
      from: {
        doc: "source-123456789012345678901234",
        tab: "Details",
      },
      kind: "tab",
      title: "Details",
    },
  ],
};

/** R6: cross-doc section copy (after {section} + from). */
export const recipeR6: GdocsmithRun = {
  steps: [
    {
      after: { section: "Background" },
      doc: "doc-1234567890123456789012345",
      from: {
        doc: "source-123456789012345678901234",
        section: "Goals & Non-Goals",
      },
      kind: "write",
    },
  ],
};

/** R7: table insertRow + row-0 style. */
export const recipeR7: GdocsmithRun = {
  steps: [
    {
      action: "insertRow",
      at: { section: "Capacity Matrix" },
      cells: ["Jitter", "< 5ms", "Nominal"],
      doc: "doc-1234567890123456789012345",
      kind: "table",
      position: "below",
      row: 0,
    },
    {
      action: "style",
      at: { section: "Capacity Matrix" },
      doc: "doc-1234567890123456789012345",
      kind: "table",
      row: 0,
      style: {
        background: "#F3F4F6",
        pinnedHeaderRows: 1,
      },
    },
  ],
};

/** R8: style where {foregroundColor:"#333333"} → text {foregroundColor:null}. */
export const recipeR8: GdocsmithRun = {
  steps: [
    {
      at: { section: "Overview" },
      doc: "doc-1234567890123456789012345",
      kind: "style",
      text: {
        foregroundColor: null,
      },
      where: {
        foregroundColor: "#333333",
      },
    },
  ],
};

/** R9: share domain commenter + page pageless. */
export const recipeR9: GdocsmithRun = {
  steps: [
    {
      action: "add",
      doc: "doc-1234567890123456789012345",
      domain: "example.com",
      kind: "share",
      role: "commenter",
      scope: "domain",
    },
    {
      doc: "doc-1234567890123456789012345",
      kind: "page",
      pageless: true,
    },
  ],
};

/** R10: saveTo export → markdownFile write-back. */
export const recipeR10: GdocsmithRun = {
  steps: [
    {
      doc: "doc-1234567890123456789012345",
      kind: "query",
      output: "markdown",
      saveTo: "/tmp/gdocsmith-export",
    },
    {
      doc: "doc-1234567890123456789012345",
      kind: "write",
      markdownFile: "/tmp/gdocsmith-export/overview.md",
      replace: { section: "Overview" },
    },
  ],
};

/** All standard recipes. */
export const recipes: GdocsmithRun[] = [
  recipeR1,
  recipeR2,
  recipeR3,
  recipeR4,
  recipeR5,
  recipeR6,
  recipeR7,
  recipeR8,
  recipeR9,
  recipeR10,
];

describe("v2 step types", () => {
  test("recipes type-check as runs", () => {
    expect(recipes).toHaveLength(10);
    for (const recipe of recipes) {
      expect(Array.isArray(recipe.steps)).toBe(true);
      expect(recipe.steps.length).toBeGreaterThan(0);
    }
  });

  test("every kind has a recipe", () => {
    const presentKinds = new Set(recipes.flatMap((r) => r.steps.map((s) => s.kind)));
    for (const kind of STEP_KINDS) {
      expect(presentKinds.has(kind)).toBe(true);
    }
    expect(STEP_KINDS.every((k) => recipes.some((r) => r.steps.some((s) => s.kind === k)))).toBe(true);
  });
});
