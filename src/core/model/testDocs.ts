/* Test-only synthetic Docs API JSON builder. Computes indices with its own logic (never calls layout.ts), so layout.test.ts can cross-check two independent implementations. */

import type { GoogleDoc } from "~/core/types.ts";
import type { JsonObject } from "./rawJson.ts";
import type { AtomType } from "./types.ts";

/** One visible text run inside a synthetic paragraph. */
export interface ParagraphTextSpec {
  /** Explicit text style. */ style?: JsonObject;
  /** Suggested-deletion ids. */ sugDel?: string[];
  /** Suggested-insertion ids. */ sugIns?: string[];
  /** Run text (no newline). */ text: string;
}

/** One non-text atom inside a synthetic paragraph. */
export interface ParagraphAtomSpec {
  /** JSON index-span length (defaults to 1, or 3 for `"equation"`). */ atomLen?: number;
  /** Which atom kind to emit. */ type: AtomType;
}

/** One element of a synthetic paragraph's visible content (newline is always appended separately). */
export type ParagraphContentSpec = ParagraphAtomSpec | ParagraphTextSpec | string;

/** A synthetic paragraph. */
export interface ParagraphSpec {
  /** List membership. */ bullet?: { listId: string; nestingLevel?: number };
  /** Visible content, in order (excludes the trailing newline, which this builder always appends). */ content: ParagraphContentSpec[];
  /** Heading id (folded into `style.headingId`). */ headingId?: string;
  /** Explicit paragraph style. */ style?: JsonObject;
}

/** A synthetic top-level (or in-cell) content block. */
export type BlockSpec =
  | ({ kind: "paragraph" } & ParagraphSpec)
  | { cells: ParagraphSpec[][][]; kind: "table" }
  | { kind: "sectionBreak"; sectionStyle?: JsonObject }
  | { kind: "toc"; length: number };

/** A synthetic tab. */
export interface TabSpec {
  /** Body content blocks. */ blocks: BlockSpec[];
  /** Parent tab id, for nested tabs. */ parentTabId?: string;
  /** Tab id (defaults to `"t.0"`). */ tabId?: string;
  /** Tab title. */ title?: string;
}

/** A synthetic document. */
export interface DocSpec {
  /** Revision id. */ revisionId?: string;
  /** Tabs, in document order (all top-level; no nested `childTabs` support needed by these tests). */ tabs: TabSpec[];
  /** Document title. */ title?: string;
}

/** Builds a synthetic `GoogleDoc` (Docs `documents.get` shape) from a compact spec, computing every JSON index itself. */
export function docJsonBuild(
  /** Document spec. */
  spec: DocSpec,
): GoogleDoc {
  const tabs = spec.tabs.map((tab, i) => tabJsonBuild(tab, tab.tabId ?? `t.${i}`));
  return {
    documentId: "synthetic-doc",
    revisionId: spec.revisionId ?? "rev-1",
    tabs,
    title: spec.title ?? "",
  } as unknown as GoogleDoc;
}

const RANDOM_WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const RANDOM_ATOM_TYPES: AtomType[] = [
  "person",
  "richLink",
  "image",
  "footnoteRef",
  "horizontalRule",
  "pageBreak",
  "equation",
];

/** Generates a random sequence of top-level blocks (paragraphs, tables, TOCs, section breaks) for round-trip/shape tests, driven by an injected PRNG for determinism. */
export function randomBlockSpecs(
  /** PRNG (see `rngCreate`). */
  rng: () => number,
  /** Number of blocks to generate. */
  count: number,
): BlockSpec[] {
  const blocks: BlockSpec[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng();
    if (roll < 0.15) blocks.push({ kind: "sectionBreak" });
    else if (roll < 0.3) blocks.push({ kind: "toc", length: 2 + Math.floor(rng() * 8) });
    else if (roll < 0.55) {
      const rows = 1 + Math.floor(rng() * 2);
      const cols = 1 + Math.floor(rng() * 2);
      blocks.push({
        cells: Array.from({ length: rows }, () =>
          Array.from({ length: cols }, () => [
            { content: randomParagraphContentSpecs(rng), kind: "paragraph" as const },
          ]),
        ),
        kind: "table",
      });
    } else blocks.push({ content: randomParagraphContentSpecs(rng), kind: "paragraph" });
  }
  return blocks;
}

/** Generates a random paragraph's visible content (a mix of words and atoms). */
export function randomParagraphContentSpecs(
  /** PRNG (see `rngCreate`). */
  rng: () => number,
): ParagraphContentSpec[] {
  const n = 1 + Math.floor(rng() * 3);
  const content: ParagraphContentSpec[] = [];
  for (let i = 0; i < n; i++) {
    if (rng() < 0.3) content.push({ type: RANDOM_ATOM_TYPES[Math.floor(rng() * RANDOM_ATOM_TYPES.length)] });
    else content.push(RANDOM_WORDS[Math.floor(rng() * RANDOM_WORDS.length)]);
  }
  return content;
}

/** Deterministic mulberry32 PRNG; same seed always produces the same sequence in `[0, 1)`. */
export function rngCreate(
  /** Seed. */
  seed: number,
): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds one tab's `documentTab`, laying out its body content sequentially starting after the leading section break. */
function tabJsonBuild(spec: TabSpec, tabId: string): JsonObject {
  const content: JsonObject[] = [{ endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 }];
  let index = 1;
  for (const block of spec.blocks) {
    const built = blockJsonBuild(block, index);
    content.push(built.element);
    index = built.end;
  }
  return {
    documentTab: { body: { content }, lists: {}, namedStyles: { styles: [] } },
    tabProperties: { parentTabId: spec.parentTabId, tabId, title: spec.title ?? "" },
  };
}

/** Builds one block starting at `start`, returning its JSON element and the index right after it. */
function blockJsonBuild(block: BlockSpec, start: number): { element: JsonObject; end: number } {
  if (block.kind === "paragraph") return paragraphJsonBuild(block, start);
  if (block.kind === "sectionBreak") {
    return {
      element: { endIndex: start + 1, sectionBreak: { sectionStyle: block.sectionStyle ?? {} }, startIndex: start },
      end: start + 1,
    };
  }
  if (block.kind === "toc") {
    return {
      element: { endIndex: start + block.length, startIndex: start, tableOfContents: { content: [] } },
      end: start + block.length,
    };
  }
  return tableJsonBuild(block, start);
}

/** Builds one paragraph starting at `start`: its visible content elements plus a trailing newline-only text run. */
function paragraphJsonBuild(
  spec: { content: ParagraphContentSpec[] } & ParagraphSpec,
  start: number,
): { element: JsonObject; end: number } {
  const elements: JsonObject[] = [];
  let index = start;
  for (const item of spec.content) {
    if (typeof item === "string" || "text" in item) {
      const t = typeof item === "string" ? { text: item } : item;
      const end = index + t.text.length;
      elements.push({
        endIndex: end,
        startIndex: index,
        textRun: {
          content: t.text,
          suggestedDeletionIds: t.sugDel,
          suggestedInsertionIds: t.sugIns,
          textStyle: t.style ?? {},
        },
      });
      index = end;
      continue;
    }
    const len = item.atomLen ?? (item.type === "equation" ? 3 : 1);
    elements.push({ endIndex: index + len, ...atomJsonBuild(item.type), startIndex: index });
    index += len;
  }
  elements.push({ endIndex: index + 1, startIndex: index, textRun: { content: "\n", textStyle: {} } });
  index += 1;
  const style = { ...(spec.style ?? {}) } as JsonObject;
  if (spec.headingId) style.headingId = spec.headingId;
  return {
    element: {
      endIndex: index,
      paragraph: {
        bullet: spec.bullet ? { listId: spec.bullet.listId, nestingLevel: spec.bullet.nestingLevel } : undefined,
        elements,
        paragraphStyle: style,
      },
      startIndex: start,
    },
    end: index,
  };
}

/** Builds the JSON key/value for a non-text atom variant. */
function atomJsonBuild(type: AtomType): JsonObject {
  const variantKey: Record<AtomType, string> = {
    autoText: "autoText",
    columnBreak: "columnBreak",
    date: "dateElement",
    equation: "equation",
    footnoteRef: "footnoteReference",
    horizontalRule: "horizontalRule",
    image: "inlineObjectElement",
    pageBreak: "pageBreak",
    person: "person",
    richLink: "richLink",
  };
  return { [variantKey[type]]: {} };
}

/** Builds a table starting at `start`: start/end markers, each row's marker, each cell's marker plus its paragraphs. */
function tableJsonBuild(block: { cells: ParagraphSpec[][][] }, start: number): { element: JsonObject; end: number } {
  let index = start + 1;
  const tableRows: JsonObject[] = [];
  for (const row of block.cells) {
    const rowStart = index;
    index += 1;
    const tableCells: JsonObject[] = [];
    for (const cellParagraphs of row) {
      const cellStart = index;
      index += 1;
      const content: JsonObject[] = [];
      for (const p of cellParagraphs) {
        const built = paragraphJsonBuild(p, index);
        content.push(built.element);
        index = built.end;
      }
      tableCells.push({ content, endIndex: index, startIndex: cellStart, tableCellStyle: {} });
    }
    tableRows.push({ endIndex: index, startIndex: rowStart, tableCells, tableRowStyle: {} });
  }
  index += 1;
  return {
    element: {
      endIndex: index,
      startIndex: start,
      table: { columns: block.cells[0]?.length ?? 0, rows: block.cells.length, tableRows, tableStyle: {} },
    },
    end: index,
  };
}
