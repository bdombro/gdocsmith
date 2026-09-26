/* Natural-language v1/v2 comparison cases and deterministic Google Docs verifiers (G6 M2). */

import { headingLevel, textStyleEffective } from "~/core/model/effectiveStyle.ts";
import { docModelParse } from "~/core/model/fromJson.ts";
import { KeyAllocator } from "~/core/model/keys.ts";
import { listKind } from "~/core/model/lists.ts";
import { colorHexFromOptional } from "~/core/model/styleValues.ts";
import type { Block, DocModel, ParagraphBlock, TableBlock, TabModel } from "~/core/model/types.ts";
import type { GoogleDoc } from "~/core/types.ts";
import type { EvalCase, EvalCheck, EvalVerificationContext } from "./eval.ts";

const SPEC_TAB = "Spec Template";
const MISSION_TAB = "Mission Brief";
const SYSTEM_ARCHITECTURE = "System Architecture";
const ARCHITECTURAL_DECISIONS = "Architectural Decisions";
const GOALS_SECTION = "Goals & Non-Goals";
const MATRIX_SECTION = "Roost Capacity Matrix";
const WORKFLOW_TAB = "Workflow Manual";
const WORKFLOW_SECTION = "Step-by-Step Instructions";
const LINK_COLOR = "#1155CC";

const SPEC_HEADINGS = [
  "[TEMPLATE] Spec Title",
  "Overview & Problem Statement",
  SYSTEM_ARCHITECTURE,
  "Avionics Personnel & Timeline",
  "Network Topology Diagram",
  MATRIX_SECTION,
  ARCHITECTURAL_DECISIONS,
];

const ARCHITECTURE_CHILD_HEADINGS = ["Avionics Personnel & Timeline", "Network Topology Diagram", MATRIX_SECTION];

const ARCHITECTURE_PLAN = [
  "Separate flight control, messaging, and capsule modules.",
  "Document their interfaces, launch order, and recovery risks.",
];

const DECISION_BULLETS = [
  "D1: The flight core is modular and replaceable.",
  "D2: Messages are signed with rotating fleet keys.",
  "D3: Each capsule retries through an independent route.",
];

/** The natural-language tasks and state verifiers used for the G6 comparison. */
export const evalCases: EvalCase[] = [
  {
    id: "outline-headings",
    prompt: `Read the "${SPEC_TAB}" tab and list its headings from top to bottom. Do not change the document.`,
    verify: outlineHeadingsVerify,
  },
  {
    id: "placeholder-fill",
    prompt: `In the "${SPEC_TAB}" tab, replace the placeholder directly under "${SYSTEM_ARCHITECTURE}" with a two-item numbered implementation plan: "${ARCHITECTURE_PLAN[0]}" and "${ARCHITECTURE_PLAN[1]}". Preserve the three child headings and all existing rich content and tables.`,
    verify: placeholderFillVerify,
  },
  {
    id: "section-rewrite",
    prompt: `In "${SPEC_TAB}", replace the content under "${ARCHITECTURAL_DECISIONS}" with these three bullet points, preserving the heading and everything else:\n- ${DECISION_BULLETS[0]}\n- ${DECISION_BULLETS[1]}\n- ${DECISION_BULLETS[2]}`,
    verify: sectionRewriteVerify,
  },
  {
    id: "find-replace",
    prompt: `In the "${MISSION_TAB}" tab only, change every lowercase occurrence of "pigeon" to "falcon". Keep all other tabs unchanged and report the number of replacements.`,
    verify: findReplaceVerify,
  },
  {
    id: "copy-section",
    prompt: `Copy the complete "${GOALS_SECTION}" section from "${MISSION_TAB}" to the end of "${SPEC_TAB}". Keep its heading, nested headings, list formatting, and emphasis.`,
    verify: copySectionVerify,
  },
  {
    id: "table-row",
    prompt: `In "${SPEC_TAB}", add a final row to "${MATRIX_SECTION}" with values "Jitter", "< 5ms", and "Nominal", leaving any remaining cell blank. Preserve the existing header row.`,
    verify: tableRowVerify,
  },
  {
    id: "new-tab",
    prompt: `Create a tab named "Architecture" immediately after "${SPEC_TAB}", using "${MISSION_TAB}" as its starting content. Leave the existing tabs alone.`,
    verify: newTabVerify,
  },
  {
    id: "style-cleanup",
    prompt: `In "${WORKFLOW_TAB}", under "${WORKFLOW_SECTION}", change the bright blue text to the default text color. Keep the phrase and its hyperlink unchanged.`,
    verify: styleCleanupVerify,
  },
  {
    id: "guard-respect",
    prompt: `Replace the whole "${SYSTEM_ARCHITECTURE}" section in "${SPEC_TAB}" with "TBD". If this would remove rich content and requires confirmation, stop and explain instead of proceeding.`,
    verify: guardRespectVerify,
  },
  {
    id: "pageless",
    prompt: "Change every tab in the document to pageless and report what changed.",
    verify: pagelessVerify,
  },
];

/** Verifies the read-only outline task against both the fixture and the agent response. */
async function outlineHeadingsVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const outlineResult = await context.query([
    { doc: context.documentId, kind: "query", output: "outline", tab: SPEC_TAB },
  ]);
  const observedTabs = dataOf<{ tabs?: Array<{ headings?: Array<{ level: number; text: string }>; title: string }> }>(
    outlineResult,
  )?.tabs;
  const headings = observedTabs?.find((tab) => tab.title === SPEC_TAB)?.headings ?? [];
  const headingTexts = headings.map((heading) => heading.text);
  const answer = `${context.transcript ?? ""}\n${context.stdout}`;

  return [
    check("fixture-outline", equal(headingTexts, SPEC_HEADINGS), `${headingTexts.length} headings returned in order.`),
    check(
      "answer-lists-headings",
      textContainsInOrder(answer, SPEC_HEADINGS),
      "The final response lists the headings in order.",
    ),
    check(
      "read-only",
      equal(documentSnapshot(baseline), documentSnapshot(current)),
      "The copied document is unchanged.",
    ),
  ];
}

/** Verifies the placeholder edit and preservation of nested headings and fragile content. */
async function placeholderFillVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const beforeTab = tabByTitle(baseline, SPEC_TAB);
  const afterTab = tabByTitle(current, SPEC_TAB);
  const beforeSection = beforeTab ? sectionBlocks(beforeTab, SYSTEM_ARCHITECTURE) : undefined;
  const afterSection = afterTab ? sectionBlocks(afterTab, SYSTEM_ARCHITECTURE) : undefined;
  const numbered =
    afterSection?.blocks
      .filter((block): block is ParagraphBlock => block.kind === "paragraph" && Boolean(block.bullet))
      .filter((paragraph) => afterTab && paragraph.bullet && blockListKind(afterTab, paragraph) === "number")
      .map(paragraphText) ?? [];
  const childHeadings =
    afterSection?.blocks
      .filter(
        (block): block is ParagraphBlock => block.kind === "paragraph" && paragraphHeadingLevel(block) !== undefined,
      )
      .slice(1)
      .map(paragraphText) ?? [];
  const beforeTable = beforeSection?.blocks.find((block): block is TableBlock => block.kind === "table");
  const afterTable = afterSection?.blocks.find((block): block is TableBlock => block.kind === "table");
  const beforeAtoms = beforeTab ? atomCounts(beforeTab.blocks) : {};
  const afterAtoms = afterTab ? atomCounts(afterTab.blocks) : {};
  const visible = afterSection?.blocks.map(blockText).join("\n") ?? "";

  return [
    check(
      "placeholder-replaced",
      Boolean(afterSection && !visible.includes("Placeholder: Replace with architectural specification")),
      "The architecture placeholder is gone.",
    ),
    check(
      "numbered-plan",
      equal(numbered, ARCHITECTURE_PLAN),
      `${numbered.length} numbered plan items are present in order.`,
    ),
    check(
      "child-headings",
      equal(childHeadings, ARCHITECTURE_CHILD_HEADINGS) &&
        equal(beforeSection?.blocks.filter(isHeading).slice(1).map(paragraphText), ARCHITECTURE_CHILD_HEADINGS),
      `${childHeadings.length} child headings remain unchanged.`,
    ),
    check(
      "rich-content-counts",
      atomCount(beforeAtoms, "person") === 1 &&
        atomCount(beforeAtoms, "date") === 1 &&
        atomCount(beforeAtoms, "richLink") === 1 &&
        atomCount(beforeAtoms, "image") === 1 &&
        equal(beforeAtoms, afterAtoms),
      "Person, date, rich-link, and image counts are unchanged.",
    ),
    check(
      "capacity-matrix-preserved",
      Boolean(
        beforeTable &&
          afterTable &&
          equal(blockSnapshot(beforeTab!, beforeTable), blockSnapshot(afterTab!, afterTable)),
      ),
      "The original capacity matrix remains unchanged.",
    ),
  ];
}

/** Verifies the decision rewrite while comparing all content outside that section. */
async function sectionRewriteVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const tab = tabByTitle(current, SPEC_TAB);
  const decisionSection = tab ? sectionBlocks(tab, ARCHITECTURAL_DECISIONS) : undefined;
  const bulletTexts =
    decisionSection?.blocks
      .filter((block): block is ParagraphBlock => block.kind === "paragraph" && Boolean(block.bullet))
      .map(paragraphText) ?? [];
  const decisionHeadingCount =
    tab?.blocks.filter(isHeading).filter((heading) => paragraphText(heading) === ARCHITECTURAL_DECISIONS).length ?? 0;

  return [
    check(
      "decision-bullets",
      equal(bulletTexts, DECISION_BULLETS),
      `${bulletTexts.length} decision bullets are present.`,
    ),
    check("heading-once", decisionHeadingCount === 1, "The Architectural Decisions heading appears exactly once."),
    check(
      "unrelated-content",
      equal(
        documentSnapshotWithoutSection(baseline, SPEC_TAB, ARCHITECTURAL_DECISIONS),
        documentSnapshotWithoutSection(current, SPEC_TAB, ARCHITECTURAL_DECISIONS),
      ),
      "Content outside Architectural Decisions is unchanged.",
    ),
  ];
}

/** Verifies the exact, case-sensitive replacement and confirms other tabs did not change. */
async function findReplaceVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const beforeTab = tabByTitle(baseline, MISSION_TAB);
  const afterTab = tabByTitle(current, MISSION_TAB);
  const beforeText = beforeTab ? tabText(beforeTab) : "";
  const afterText = afterTab ? tabText(afterTab) : "";
  const replacements = occurrenceCount(beforeText, "pigeon");
  const replacedSnapshot = documentSnapshot(baseline, (tab) =>
    tab.title === MISSION_TAB ? tabSnapshot(tab, ["pigeon", "falcon"]) : tabSnapshot(tab),
  );

  return [
    check(
      "exact-replacement-count",
      replacements === 4 && occurrenceCount(afterText, "pigeon") === 0,
      `${replacements} lowercase occurrences were present and none remain.`,
    ),
    check(
      "replacement-content",
      Boolean(
        afterTab && occurrenceCount(afterText, "falcon") === occurrenceCount(beforeText, "falcon") + replacements,
      ),
      "The replacement text count increased by the expected amount.",
    ),
    check(
      "other-tabs-unchanged",
      equal(replacedSnapshot, documentSnapshot(current)),
      "Only Mission Brief content changed.",
    ),
  ];
}

/** Verifies the copied section's structure, list membership, and emphasis counts. */
async function copySectionVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const sourceTab = tabByTitle(baseline, MISSION_TAB);
  const sourceSection = sourceTab ? sectionBlocks(sourceTab, GOALS_SECTION) : undefined;
  const targetTab = tabByTitle(current, SPEC_TAB);
  const targetSection = targetTab ? sectionBlocks(targetTab, GOALS_SECTION) : undefined;
  const targetHeadingCount =
    targetTab?.blocks.filter(isHeading).filter((heading) => paragraphText(heading) === GOALS_SECTION).length ?? 0;
  const sourceCounts =
    sourceSection && sourceTab ? sectionCounts(sourceTab, sourceSection.blocks) : { boldCharacters: 0, bulletItems: 0 };
  const targetCounts =
    targetSection && targetTab ? sectionCounts(targetTab, targetSection.blocks) : { boldCharacters: 0, bulletItems: 0 };

  return [
    check(
      "section-copied",
      Boolean(
        sourceTab &&
          sourceSection &&
          targetTab &&
          targetSection &&
          equal(
            sourceSection.blocks.map((block) => semanticBlockSnapshot(sourceTab, block)),
            targetSection.blocks.map((block) => semanticBlockSnapshot(targetTab, block)),
          ),
      ),
      "The copied section matches its source structure and content.",
    ),
    check("heading-once", targetHeadingCount === 1, "The copied section heading appears once in Spec Template."),
    check(
      "list-and-bold-counts",
      sourceCounts.bulletItems === targetCounts.bulletItems &&
        sourceCounts.boldCharacters === targetCounts.boldCharacters,
      `Source and copy have ${sourceCounts.bulletItems} list items and matching bold-character counts.`,
    ),
    check(
      "existing-spec-preserved",
      equal(
        documentSnapshotWithoutSection(baseline, SPEC_TAB, GOALS_SECTION),
        documentSnapshotWithoutSection(current, SPEC_TAB, GOALS_SECTION),
      ),
      "The original Spec Template content is unchanged.",
    ),
    check(
      "section-appended",
      Boolean(targetTab && targetSection && targetTab.blocks.slice(targetSection.end).every(isEmptyParagraph)),
      "The copied section is at the end of Spec Template.",
    ),
  ];
}

/** Verifies the inserted capacity-matrix row and preservation of the original header. */
async function tableRowVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const beforeTab = tabByTitle(baseline, SPEC_TAB);
  const afterTab = tabByTitle(current, SPEC_TAB);
  const beforeTable = beforeTab ? tableInSection(beforeTab, MATRIX_SECTION) : undefined;
  const afterTable = afterTab ? tableInSection(afterTab, MATRIX_SECTION) : undefined;
  const lastRow = afterTable?.rows.at(-1);
  const lastValues = lastRow?.cells.map((cell) => cell.blocks.map(paragraphText).join(" ")) ?? [];

  return [
    check(
      "row-added",
      Boolean(
        beforeTable &&
          afterTable &&
          afterTable.rows.length === beforeTable.rows.length + 1 &&
          afterTable.columns.length === beforeTable.columns.length,
      ),
      `${afterTable?.rows.length ?? 0} rows and ${afterTable?.columns.length ?? 0} columns are present.`,
    ),
    check(
      "last-row-values",
      equal(lastValues, ["Jitter", "< 5ms", "Nominal", ""]),
      "The final row contains the requested values and a blank remaining cell.",
    ),
    check(
      "header-style-preserved",
      Boolean(beforeTable && afterTable && equal(tableHeaderStyle(beforeTable), tableHeaderStyle(afterTable))),
      "The original header row and cell styles are unchanged.",
    ),
  ];
}

/** Verifies new tab placement, seeding, and preservation of all previous tabs. */
async function newTabVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const baselineTitles = baseline.tabs.map((tab) => tab.title);
  const expectedTitles = [...baselineTitles];
  const specIndex = expectedTitles.indexOf(SPEC_TAB);
  if (specIndex >= 0) expectedTitles.splice(specIndex + 1, 0, "Architecture");
  const architectureTabs = current.tabs.filter((tab) => tab.title === "Architecture");
  const sourceTab = tabByTitle(baseline, MISSION_TAB);
  const architectureTab = architectureTabs[0];

  return [
    check(
      "tab-order",
      architectureTabs.length === 1 &&
        equal(
          current.tabs.map((tab) => tab.title),
          expectedTitles,
        ),
      "Architecture appears once immediately after Spec Template.",
    ),
    check(
      "tab-seeded",
      Boolean(
        sourceTab &&
          architectureTab &&
          equal(
            sourceTab.blocks.map((block) => blockSnapshot(sourceTab, block)),
            architectureTab.blocks.map((block) => blockSnapshot(architectureTab, block)),
          ),
      ),
      "Architecture starts with the Mission Brief content.",
    ),
    check(
      "previous-tabs-preserved",
      equal(documentSnapshot(baseline), documentSnapshotWithoutTab(current, "Architecture")),
      "Existing tabs and their content remain unchanged.",
    ),
  ];
}

/** Verifies the explicit color was removed while the linked text and link target remain. */
async function styleCleanupVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const beforeTab = tabByTitle(baseline, WORKFLOW_TAB);
  const afterTab = tabByTitle(current, WORKFLOW_TAB);
  const beforeSection = beforeTab ? sectionBlocks(beforeTab, WORKFLOW_SECTION) : undefined;
  const afterSection = afterTab ? sectionBlocks(afterTab, WORKFLOW_SECTION) : undefined;
  const beforeColorCount = beforeSection ? explicitColorCharacters(beforeSection.blocks, LINK_COLOR) : 0;
  const afterColorCount = afterSection ? explicitColorCharacters(afterSection.blocks, LINK_COLOR) : 0;
  const queryResult = await context.query([
    { doc: context.documentId, kind: "query", output: "nodes", tab: WORKFLOW_TAB, at: { section: WORKFLOW_SECTION } },
  ]);
  const nodes = dataOf<{ nodes?: Array<{ fontColors?: string[] }> }>(queryResult)?.nodes ?? [];
  const queryColorCount = nodes.filter((node) => node.fontColors?.includes(LINK_COLOR)).length;

  return [
    check(
      "color-cleared",
      beforeColorCount > 0 && afterColorCount === 0 && queryColorCount === 0,
      "The explicit blue text color is cleared in the target section.",
    ),
    check(
      "text-and-link-preserved",
      Boolean(
        beforeSection &&
          afterSection &&
          equal(sectionText(beforeSection.blocks), sectionText(afterSection.blocks)) &&
          equal(sectionLinks(beforeSection.blocks), sectionLinks(afterSection.blocks)),
      ),
      "The linked phrase and its target are unchanged.",
    ),
  ];
}

/** Verifies the unrecreatable section was refused and the copy remains unchanged. */
async function guardRespectVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const output = `${context.transcript ?? ""}\n${context.stdout}`;
  const hasRefusal = /\bRefused:/i.test(output);
  const explainsLoss = /confirm|force|chip|image|cannot be (?:restored|recreated)/i.test(output);

  return [
    check(
      "refusal-visible",
      hasRefusal && explainsLoss,
      "The agent reports the guard refusal and explains the protected content.",
    ),
    check(
      "no-content-change",
      equal(documentSnapshot(baseline), documentSnapshot(current)),
      "No document content changed after the refusal.",
    ),
    check(
      "rich-content-preserved",
      atomCount(atomCounts(tabByTitle(baseline, SPEC_TAB)?.blocks ?? []), "person") === 1 &&
        atomCount(atomCounts(tabByTitle(baseline, SPEC_TAB)?.blocks ?? []), "date") === 1 &&
        atomCount(atomCounts(tabByTitle(baseline, SPEC_TAB)?.blocks ?? []), "richLink") === 1 &&
        atomCount(atomCounts(tabByTitle(baseline, SPEC_TAB)?.blocks ?? []), "image") === 1 &&
        equal(
          atomCounts(tabByTitle(baseline, SPEC_TAB)?.blocks ?? []),
          atomCounts(tabByTitle(current, SPEC_TAB)?.blocks ?? []),
        ),
      "The person, date, rich link, and image remain present.",
    ),
  ];
}

/** Verifies every tab became pageless without altering its content. */
async function pagelessVerify(context: EvalVerificationContext): Promise<EvalCheck[]> {
  const baseline = modelParse(context.baseline, context.baseline.documentId ?? "baseline");
  const current = modelParse(context.current, context.documentId);
  const modes = current.tabs.map((tab) => documentMode(tab.documentStyle));

  return [
    check(
      "all-tabs-pageless",
      modes.length === baseline.tabs.length && modes.every((mode) => mode === "PAGELESS"),
      `${modes.filter((mode) => mode === "PAGELESS").length} tabs are pageless.`,
    ),
    check(
      "content-preserved",
      equal(documentBlocksSnapshot(baseline), documentBlocksSnapshot(current)),
      "Tab content and order are unchanged.",
    ),
  ];
}

/** Parses one fetched Docs document into an immutable model for deterministic comparison. */
function modelParse(document: GoogleDoc, documentId: string): DocModel {
  return docModelParse(document, { docId: documentId, keys: new KeyAllocator() });
}

/** Returns a check record with a concise, content-free detail string. */
function check(id: string, passed: boolean, detail: string): EvalCheck {
  return { detail, id, passed };
}

/** Reads one query step's structured data. */
function dataOf<T>(result: { steps: Array<{ data?: unknown }> }): T | undefined {
  return result.steps[0]?.data as T | undefined;
}

/** Finds a tab by its stable human-readable title. */
function tabByTitle(model: DocModel, title: string): TabModel | undefined {
  return model.tabs.find((tab) => tab.title === title);
}

/** Resolves a named heading and all blocks up to the next heading of equal or higher rank. */
function sectionBlocks(tab: TabModel, title: string): { blocks: Block[]; end: number; start: number } | undefined {
  const start = tab.blocks.findIndex((block) => isHeading(block) && paragraphText(block).trim() === title);
  if (start < 0) return undefined;
  const startBlock = tab.blocks[start];
  if (startBlock?.kind !== "paragraph") return undefined;
  const startLevel = paragraphHeadingLevel(startBlock);
  if (startLevel === undefined) return undefined;
  let end = start + 1;
  while (end < tab.blocks.length) {
    const block = tab.blocks[end];
    if (
      block &&
      isHeading(block) &&
      paragraphHeadingLevel(block) !== undefined &&
      paragraphHeadingLevel(block)! <= startLevel
    )
      break;
    end++;
  }
  return { blocks: tab.blocks.slice(start, end), end, start };
}

/** Tests whether a top-level block is a heading paragraph. */
function isHeading(block: Block): block is ParagraphBlock {
  return block.kind === "paragraph" && paragraphHeadingLevel(block) !== undefined;
}

/** Reads a paragraph heading level after narrowing the model's JSON style value. */
function paragraphHeadingLevel(paragraph: ParagraphBlock): number | undefined {
  const namedStyleType = paragraph.style.namedStyleType;
  return headingLevel(typeof namedStyleType === "string" ? namedStyleType : undefined);
}

/** Returns visible text, using type markers for chips without exposing chip payloads. */
function paragraphText(paragraph: ParagraphBlock): string {
  return paragraph.inlines.map((inline) => (inline.kind === "text" ? inline.text : `<${inline.type}>`)).join("");
}

/** Returns visible text for any top-level block. */
function blockText(block: Block): string {
  if (block.kind === "paragraph") return paragraphText(block);
  if (block.kind === "table")
    return block.rows
      .map((row) => row.cells.map((cell) => cell.blocks.map(paragraphText).join(" ")).join("\t"))
      .join("\n");
  return block.kind;
}

/** Returns the text in a sequence of blocks. */
function sectionText(blocks: Block[]): string[] {
  return blocks.map(blockText);
}

/** Counts exact, case-sensitive occurrences in a string. */
function occurrenceCount(value: string, search: string): number {
  return value ? value.split(search).length - 1 : 0;
}

/** Counts visible text and chip markers across a tab. */
function tabText(tab: TabModel): string {
  return tab.blocks.map(blockText).join("\n");
}

/** Recursively counts atom kinds in body and table cells. */
function atomCounts(blocks: Block[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      for (const inline of block.inlines) {
        if (inline.kind === "atom") counts[inline.type] = (counts[inline.type] ?? 0) + 1;
      }
    } else if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const [type, count] of Object.entries(atomCounts(cell.blocks)))
            counts[type] = (counts[type] ?? 0) + count;
        }
      }
    }
  }
  return counts;
}

/** Counts list items and bold text in a section. */
function sectionCounts(tab: TabModel, blocks: Block[]): { boldCharacters: number; bulletItems: number } {
  let boldCharacters = 0;
  let bulletItems = 0;
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    if (block.bullet) bulletItems++;
    for (const inline of block.inlines) {
      if (inline.kind === "text" && textStyleEffective(tab, block, inline).bold === true)
        boldCharacters += inline.text.length;
    }
  }
  return { boldCharacters, bulletItems };
}

/** Returns a logical content snapshot, excluding document ID, revision, and document title. */
function documentSnapshot(model: DocModel, snapshot: (tab: TabModel) => unknown = (tab) => tabSnapshot(tab)): unknown {
  const titles = new Map(model.tabs.map((tab) => [tab.tabId, tab.title]));
  return model.tabs.map((tab) => ({
    parentTab: tab.parentTabId ? (titles.get(tab.parentTabId) ?? null) : null,
    title: tab.title,
    value: snapshot(tab),
  }));
}

/** Compares all tabs except one newly added tab. */
function documentSnapshotWithoutTab(model: DocModel, excludedTitle: string): unknown {
  return documentSnapshot({ ...model, tabs: model.tabs.filter((tab) => tab.title !== excludedTitle) });
}

/** Returns all tab content and styles, with optional case-sensitive text substitution. */
function tabSnapshot(tab: TabModel, replacement?: [string, string]): unknown {
  return {
    blocks: tab.blocks.map((block) => blockSnapshot(tab, block, replacement)),
    documentStyle: tab.documentStyle,
    leadingSectionStyle: tab.leadingSectionStyle,
  };
}

/** Returns a logical block signature without volatile block, list, or atom IDs. */
function blockSnapshot(tab: TabModel, block: Block, replacement?: [string, string]): unknown {
  if (block.kind === "paragraph") {
    return {
      bullet: block.bullet
        ? {
            kind: listKind(tab.lists[block.bullet.listId]!, block.bullet.nestingLevel),
            nestingLevel: block.bullet.nestingLevel,
            textStyle: block.bullet.textStyle,
          }
        : null,
      inlines: block.inlines.map((inline) => {
        if (inline.kind === "text") {
          const text = replacement ? inline.text.replaceAll(replacement[0], replacement[1]) : inline.text;
          return { kind: inline.kind, style: inline.style, text };
        }
        return { kind: inline.kind, length: inline.length, style: inline.style, type: inline.type };
      }),
      kind: block.kind,
      newline: block.newline.style,
      style: block.style,
    };
  }
  if (block.kind === "table") {
    return {
      columns: block.columns.map((column) => column.props),
      kind: block.kind,
      rows: block.rows.map((row) => ({
        cells: row.cells.map((cell) => ({
          blocks: cell.blocks.map((cellBlock) => blockSnapshot(tab, cellBlock, replacement)),
          style: cell.style,
        })),
        style: row.style,
      })),
    };
  }
  if (block.kind === "sectionBreak") return { kind: block.kind, style: block.sectionStyle };
  return { kind: block.kind };
}

/** Compares tab block sequences without the named section. */
function documentSnapshotWithoutSection(model: DocModel, tabTitle: string, sectionTitle: string): unknown {
  return documentSnapshot(model, (tab) => {
    if (tab.title !== tabTitle) return tabSnapshot(tab);
    const section = sectionBlocks(tab, sectionTitle);
    const blocks = section ? [...tab.blocks.slice(0, section.start), ...tab.blocks.slice(section.end)] : tab.blocks;
    return {
      blocks: blocks.map((block) => blockSnapshot(tab, block)),
      documentStyle: tab.documentStyle,
      leadingSectionStyle: tab.leadingSectionStyle,
    };
  });
}

/** Compares only tab block content, not page setup. */
function documentBlocksSnapshot(model: DocModel): unknown {
  return model.tabs.map((tab) => ({ title: tab.title, blocks: tab.blocks.map((block) => blockSnapshot(tab, block)) }));
}

/** Returns a semantic signature for copied content, allowing explicit style flattening. */
function semanticBlockSnapshot(tab: TabModel, block: Block): unknown {
  if (block.kind === "paragraph") {
    return {
      boldCharacters: block.inlines.reduce(
        (count, inline) =>
          count +
          (inline.kind === "text" && textStyleEffective(tab, block, inline).bold === true ? inline.text.length : 0),
        0,
      ),
      headingLevel: paragraphHeadingLevel(block),
      inlines: block.inlines.map((inline) =>
        inline.kind === "text" ? { kind: inline.kind, text: inline.text } : { kind: inline.kind, type: inline.type },
      ),
      list: block.bullet
        ? {
            kind: listKind(tab.lists[block.bullet.listId]!, block.bullet.nestingLevel),
            nestingLevel: block.bullet.nestingLevel,
          }
        : null,
      style: block.style.namedStyleType,
    };
  }
  if (block.kind === "table")
    return {
      kind: block.kind,
      rows: block.rows.map((row) =>
        row.cells.map((cell) => cell.blocks.map((cellBlock) => semanticBlockSnapshot(tab, cellBlock))),
      ),
    };
  return { kind: block.kind };
}

/** Counts explicit characters with a selected foreground color. */
function explicitColorCharacters(blocks: Block[], color: string): number {
  let count = 0;
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      for (const inline of block.inlines) {
        if (inline.kind === "text" && colorHexFromOptional(inline.style.foregroundColor as never) === color)
          count += inline.text.length;
      }
    } else if (block.kind === "table") {
      for (const row of block.rows) for (const cell of row.cells) count += explicitColorCharacters(cell.blocks, color);
    }
  }
  return count;
}

/** Returns normalized link targets in text runs, ignoring unrelated formatting. */
function sectionLinks(blocks: Block[]): unknown[] {
  return blocks.flatMap((block) =>
    block.kind === "paragraph"
      ? block.inlines.flatMap((inline) =>
          inline.kind === "text" && inline.style.link ? [{ text: inline.text, link: inline.style.link }] : [],
        )
      : [],
  );
}

/** Returns the styled row data used to ensure the table header was not restyled. */
function tableHeaderStyle(table: TableBlock): unknown {
  const row = table.rows[0];
  if (!row) return undefined;
  return {
    rowStyle: row.style,
    cells: row.cells.map((cell) => ({
      cellStyle: cell.style,
      paragraphStyles: cell.blocks.map((paragraph) => paragraph.style),
    })),
    tableStyle: table.columns.map((column) => column.props),
  };
}

/** Finds the one table within a named section. */
function tableInSection(tab: TabModel, title: string): TableBlock | undefined {
  return sectionBlocks(tab, title)?.blocks.find((block): block is TableBlock => block.kind === "table");
}

/** Extracts the fetched page-mode field from the tab's document style. */
function documentMode(style: TabModel["documentStyle"]): string | undefined {
  const documentFormat = style.documentFormat;
  if (!documentFormat || typeof documentFormat !== "object") return undefined;
  const mode = (documentFormat as Record<string, unknown>).documentMode;
  return typeof mode === "string" ? mode : undefined;
}

/** Compares snapshots via stable JSON with recursively sorted object keys. */
function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

/** Canonicalizes key order for deterministic structural comparisons. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

/** Checks that every expected string appears in order in captured agent output. */
function textContainsInOrder(value: string, expected: string[]): boolean {
  let position = 0;
  for (const text of expected) {
    const found = value.indexOf(text, position);
    if (found < 0) return false;
    position = found + text.length;
  }
  return true;
}

/** Counts one atom kind from a recursive atom-count object. */
function atomCount(counts: Record<string, number>, kind: string): number {
  return counts[kind] ?? 0;
}

/** Returns the list kind of a paragraph, falling back to bullets for unknown list definitions. */
function blockListKind(tab: TabModel, paragraph: ParagraphBlock): "bullet" | "check" | "number" {
  const bullet = paragraph.bullet;
  if (!bullet) return "bullet";
  const definition = tab.lists[bullet.listId];
  return definition ? listKind(definition, bullet.nestingLevel) : "bullet";
}

/** Allows only empty trailing paragraphs after a copied section. */
function isEmptyParagraph(block: Block): boolean {
  return block.kind === "paragraph" && block.inlines.length === 0 && !block.bullet;
}
