/* Static cross-field validation for v2 steps (G4 D4). */

import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Anchor, GdocsmithStep, StepKind } from "./types.ts";

const DOC_ID_REGEX = /^[A-Za-z0-9_-]{25,}$/;
const ALIAS_REGEX = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

/** A single cross-field validation violation. */
export interface StepViolation {
  /** Step kind. */
  kind: StepKind;
  /** Violation description. */
  message: string;
  /** 0-based step index. */
  stepIndex: number;
}

/** Error thrown when static validation finds one or more violations. */
export class StepValidationError extends Error {
  readonly violations: StepViolation[];

  constructor(violations: StepViolation[]) {
    const lines = violations.map((v) => `- steps[${v.stepIndex}] ${v.kind}: ${v.message}`);
    super(`Invalid steps (${violations.length}):\n${lines.join("\n")}`);
    this.name = "StepValidationError";
    this.violations = violations;
  }
}

/**
 * Validates an array of run steps statically before any document is opened or modified.
 * Collects every violation and throws `StepValidationError` if any violations are found.
 */
export function stepsAssertValid(steps: GdocsmithStep[]): void {
  const violations: StepViolation[] = [];
  const aliases = new Set<string>();
  const deletedDocs = new Map<string, number>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const addViolation = (message: string) => {
      violations.push({ kind: step.kind, message, stepIndex: i });
    };

    // First validate doc references if present on this step
    validateDocRef(step, i, aliases, deletedDocs, addViolation);

    switch (step.kind) {
      case "doc":
        validateDocStep(step, aliases, deletedDocs, i, addViolation);
        break;
      case "edit":
        validateEditStep(step, addViolation);
        break;
      case "page":
        validatePageStep(step, addViolation);
        break;
      case "query":
        validateQueryStep(step, addViolation);
        break;
      case "remove":
        validateRemoveStep(step, addViolation);
        break;
      case "share":
        validateShareStep(step, addViolation);
        break;
      case "style":
        validateStyleStep(step, addViolation);
        break;
      case "tab":
        validateTabStep(step, aliases, deletedDocs, addViolation);
        break;
      case "table":
        validateTableStep(step, addViolation);
        break;
      case "write":
        validateWriteStep(step, aliases, deletedDocs, addViolation);
        break;
    }
  }

  if (violations.length > 0) {
    throw new StepValidationError(violations);
  }
}

/** Validates doc reference on a step. */
function validateDocRef(
  step: GdocsmithStep,
  _stepIndex: number,
  aliases: Set<string>,
  deletedDocs: Map<string, number>,
  addViolation: (msg: string) => void,
): void {
  if (step.kind === "doc" && step.action === "create") {
    // doc is forbidden on doc create; checked in validateDocStep
    return;
  }
  const doc = "doc" in step ? step.doc : undefined;
  if (doc === undefined) {
    return;
  }
  checkDocIdentifier(doc, "doc", aliases, deletedDocs, addViolation);
}

/** Validates a document identifier (raw ID or bound alias). */
function checkDocIdentifier(
  doc: string,
  field: string,
  aliases: Set<string>,
  deletedDocs: Map<string, number>,
  addViolation: (msg: string) => void,
): void {
  if (doc.includes("/") || doc.startsWith("http")) {
    addViolation(`${field} must be a document ID (the part between /d/ and /edit), not a URL`);
    return;
  }
  if (deletedDocs.has(doc)) {
    addViolation(`${field} "${doc}" was deleted/trashed at steps[${deletedDocs.get(doc)}]`);
    return;
  }
  if (!DOC_ID_REGEX.test(doc) && !aliases.has(doc)) {
    addViolation(`unknown doc alias "${doc}": bind it with as on an earlier doc step, or pass a raw document ID`);
  }
}

/** Validates an Anchor object. */
function validateAnchor(
  anchor: Anchor | undefined,
  field: string,
  allowedBody: boolean,
  addViolation: (msg: string) => void,
): void {
  if (!anchor) {
    addViolation(`${field} must set exactly one of body, node, section, text`);
    return;
  }
  const count =
    (anchor.body !== undefined ? 1 : 0) +
    (anchor.node !== undefined ? 1 : 0) +
    (anchor.section !== undefined ? 1 : 0) +
    (anchor.text !== undefined ? 1 : 0);
  if (count !== 1) {
    addViolation(`${field} must set exactly one of body, node, section, text`);
    return;
  }
  if (anchor.body && !allowedBody) {
    addViolation(`${field}.body is not allowed here`);
  }
}

/** Validates doc step. */
function validateDocStep(
  step: import("./types.ts").StepDoc,
  aliases: Set<string>,
  deletedDocs: Map<string, number>,
  stepIndex: number,
  addViolation: (msg: string) => void,
): void {
  if (step.fresh && step.action !== "open") {
    addViolation("fresh only with open");
  }

  switch (step.action) {
    case "open":
      if (!step.doc) addViolation("open needs doc");
      break;
    case "create":
      if (step.doc !== undefined) addViolation("create forbids doc");
      if (!step.title || !step.as) addViolation("create needs title + as");
      break;
    case "copy":
      if (!step.doc || !step.title || !step.as) addViolation("copy needs doc, title, as");
      break;
    case "rename":
      if (!step.doc || !step.title) addViolation("rename needs doc + title");
      break;
    case "trash":
    case "delete":
      if (!step.doc) addViolation(`${step.action} needs doc`);
      else if (DOC_ID_REGEX.test(step.doc) || aliases.has(step.doc)) {
        deletedDocs.set(step.doc, stepIndex);
      }
      break;
  }

  if (step.as) {
    if (!ALIAS_REGEX.test(step.as)) {
      addViolation(`as must be an alias (1-24 alphanumeric or _-, starting with a letter)`);
    } else if (aliases.has(step.as)) {
      addViolation(`doc alias "${step.as}" is already bound`);
    } else {
      aliases.add(step.as);
    }
  }
}

/** Validates edit step. */
function validateEditStep(step: import("./types.ts").StepEdit, addViolation: (msg: string) => void): void {
  if (step.find === "") {
    addViolation("find must not be empty");
  }
  if (step.expectCount !== undefined && (!Number.isInteger(step.expectCount) || step.expectCount <= 0)) {
    addViolation("expectCount must be a positive integer");
  }
  if (step.at !== undefined) {
    validateAnchor(step.at, "at", true, addViolation);
  }
}

/** Validates page step. */
function validatePageStep(step: import("./types.ts").StepPage, addViolation: (msg: string) => void): void {
  const hasSetting =
    step.height !== undefined ||
    step.margins !== undefined ||
    step.orientation !== undefined ||
    step.pageless !== undefined ||
    step.size !== undefined ||
    step.width !== undefined;

  if (!hasSetting) {
    addViolation("at least one setting");
  }

  if (step.size !== undefined && (step.width !== undefined || step.height !== undefined)) {
    addViolation("size excludes width/height");
  }

  const hasWidth = step.width !== undefined;
  const hasHeight = step.height !== undefined;
  if ((hasWidth && !hasHeight) || (!hasWidth && hasHeight)) {
    addViolation("width and height together");
  }

  if (step.margins) {
    const m = step.margins;
    if (
      (m.bottom !== undefined && m.bottom < 0) ||
      (m.left !== undefined && m.left < 0) ||
      (m.right !== undefined && m.right < 0) ||
      (m.top !== undefined && m.top < 0)
    ) {
      addViolation("margins >= 0");
    }
  }
}

/** Validates query step. */
function validateQueryStep(step: import("./types.ts").StepQuery, addViolation: (msg: string) => void): void {
  if (step.at !== undefined) {
    validateAnchor(step.at, "at", true, addViolation);
  }
  if (step.where !== undefined && step.output !== "nodes") {
    addViolation("where only with nodes");
  }
  if (step.skipFrontmatter !== undefined && step.output !== "markdown") {
    addViolation("skipFrontmatter only with markdown");
  }
  if (step.saveTo !== undefined && !isAbsolute(step.saveTo)) {
    addViolation("saveTo absolute");
  }
}

/** Validates remove step. */
function validateRemoveStep(step: import("./types.ts").StepRemove, addViolation: (msg: string) => void): void {
  validateAnchor(step.at, "at", true, addViolation);
}

/** Validates share step. */
function validateShareStep(step: import("./types.ts").StepShare, addViolation: (msg: string) => void): void {
  switch (step.action) {
    case "add": {
      if (!step.role || !step.scope) {
        addViolation("add needs role + scope");
      }
      if ((step.scope === "user" || step.scope === "group") && !step.email) {
        addViolation("email required for user/group");
      }
      if (step.scope !== "domain" && step.domain !== undefined) {
        addViolation("domain only for domain");
      }
      if (step.role === "owner" && step.scope !== "user") {
        addViolation("owner needs scope user");
      }
      break;
    }
    case "list": {
      const extraFields = [
        step.domain !== undefined ? "domain" : undefined,
        step.email !== undefined ? "email" : undefined,
        step.message !== undefined ? "message" : undefined,
        step.notify !== undefined ? "notify" : undefined,
        step.permissionId !== undefined ? "permissionId" : undefined,
        step.role !== undefined ? "role" : undefined,
        step.scope !== undefined ? "scope" : undefined,
      ].filter(Boolean);
      if (extraFields.length > 0) {
        addViolation("list takes no other fields");
      }
      break;
    }
    case "remove": {
      const hasPerm = step.permissionId !== undefined;
      const hasEmail = step.email !== undefined;
      const hasScope = step.scope === "anyone" || step.scope === "domain";
      if (!hasPerm && !hasEmail && !hasScope) {
        addViolation("remove needs one of permissionId, email, or scope anyone/domain");
      }
      break;
    }
  }
}

/** Validates style step. */
function validateStyleStep(step: import("./types.ts").StepStyle, addViolation: (msg: string) => void): void {
  validateAnchor(step.at, "at", true, addViolation);

  if (!step.text && !step.paragraph) {
    addViolation("set text or paragraph");
  }
  if (step.where && !step.text) {
    addViolation("where needs text");
  }

  if (step.text) {
    if (Object.keys(step.text).length === 0) {
      addViolation("text must set at least one property");
    }
    if (step.text.backgroundColor && !HEX_COLOR_REGEX.test(step.text.backgroundColor)) {
      addViolation("text.backgroundColor must be #RRGGBB");
    }
    if (step.text.foregroundColor && !HEX_COLOR_REGEX.test(step.text.foregroundColor)) {
      addViolation("text.foregroundColor must be #RRGGBB");
    }
  }

  if (step.paragraph) {
    if (Object.keys(step.paragraph).length === 0) {
      addViolation("paragraph must set at least one property");
    }
    if (step.paragraph.shading && !HEX_COLOR_REGEX.test(step.paragraph.shading)) {
      addViolation("paragraph.shading must be #RRGGBB");
    }
  }

  if (step.where) {
    if (step.where.backgroundColor && !HEX_COLOR_REGEX.test(step.where.backgroundColor)) {
      addViolation("where.backgroundColor must be #RRGGBB");
    }
    if (step.where.foregroundColor && !HEX_COLOR_REGEX.test(step.where.foregroundColor)) {
      addViolation("where.foregroundColor must be #RRGGBB");
    }
  }
}

/** Validates tab step. */
function validateTabStep(
  step: import("./types.ts").StepTab,
  aliases: Set<string>,
  deletedDocs: Map<string, number>,
  addViolation: (msg: string) => void,
): void {
  switch (step.action) {
    case "create": {
      if (!step.title) addViolation("create needs title");
      if (step.tab !== undefined) addViolation("create forbids tab");
      if (step.after !== undefined && step.before !== undefined) {
        addViolation("create accepts at most one of after, before");
      }
      if (step.from) {
        validateCopySource(step.from, aliases, deletedDocs, addViolation);
      }
      break;
    }
    case "rename":
      if (!step.tab || !step.title) addViolation("rename needs tab + title");
      break;
    case "move":
      if (
        !step.tab ||
        (step.after === undefined && step.before === undefined) ||
        (step.after !== undefined && step.before !== undefined)
      ) {
        addViolation('action "move" needs exactly one of after, before');
      }
      break;
    case "delete":
      if (!step.tab) addViolation("delete needs tab");
      break;
  }
}

/** Validates table step. */
function validateTableStep(step: import("./types.ts").StepTable, addViolation: (msg: string) => void): void {
  if (!step.at) {
    addViolation("at must set exactly one of body, node, section, text");
    return;
  }
  if (step.at.body) {
    addViolation("at.body is not a table target");
    return;
  }
  validateAnchor(step.at, "at", false, addViolation);

  const isCellAnchor = Boolean(step.at.node?.includes("/"));

  switch (step.action) {
    case "deleteRow":
      if (step.row === undefined && !isCellAnchor) addViolation("deleteRow needs row");
      if (step.column !== undefined) addViolation('column is not used by action "deleteRow"');
      break;
    case "deleteColumn":
      if (step.column === undefined && !isCellAnchor) addViolation("deleteColumn needs column");
      if (step.row !== undefined) addViolation('row is not used by action "deleteColumn"');
      break;
    case "insertRow":
      if (step.position !== undefined && step.position !== "above" && step.position !== "below") {
        addViolation("position above/below only with insertRow");
      }
      if (step.column !== undefined) addViolation('column is not used by action "insertRow"');
      break;
    case "insertColumn":
      if (step.position !== undefined && step.position !== "left" && step.position !== "right") {
        addViolation("position left/right only with insertColumn");
      }
      if (step.row !== undefined) addViolation('row is not used by action "insertColumn"');
      break;
    case "merge": {
      if (step.row === undefined && !isCellAnchor) addViolation("merge needs row");
      if (step.column === undefined && !isCellAnchor) addViolation("merge needs column");
      const span = (step.rowSpan ?? 1) * (step.columnSpan ?? 1);
      if (span <= 1) addViolation("merge needs rowSpan * columnSpan > 1");
      break;
    }
    case "unmerge":
      if (step.row === undefined && !isCellAnchor) addViolation("unmerge needs row");
      if (step.column === undefined && !isCellAnchor) addViolation("unmerge needs column");
      break;
    case "widths":
      if (!step.widths || step.widths.length === 0) addViolation("widths needs non-empty widths");
      if (step.row !== undefined) addViolation('row is not used by action "widths"');
      break;
    case "style":
      if (!step.style) addViolation("style needs style");
      break;
  }
}

/** Validates write step. */
function validateWriteStep(
  step: import("./types.ts").StepWrite,
  aliases: Set<string>,
  deletedDocs: Map<string, number>,
  addViolation: (msg: string) => void,
): void {
  const contentCount =
    (step.markdown !== undefined ? 1 : 0) +
    (step.markdownFile !== undefined ? 1 : 0) +
    (step.from !== undefined ? 1 : 0);
  if (contentCount !== 1) {
    addViolation("set exactly one of markdown, markdownFile, from");
  }

  const placementCount =
    (step.after !== undefined ? 1 : 0) +
    (step.before !== undefined ? 1 : 0) +
    (step.replace !== undefined ? 1 : 0) +
    (step.append !== undefined ? 1 : 0);
  if (placementCount !== 1) {
    addViolation("set exactly one of after, before, replace, append");
  }

  if (step.markdownFile !== undefined) {
    if (!isAbsolute(step.markdownFile)) {
      addViolation("markdownFile must be an absolute path");
    } else if (!existsSync(step.markdownFile)) {
      addViolation(`markdownFile not found: ${step.markdownFile}`);
    }
  }

  if (step.from !== undefined) {
    validateCopySource(step.from, aliases, deletedDocs, addViolation);
  }

  if (step.after !== undefined) validateAnchor(step.after, "after", false, addViolation);
  if (step.before !== undefined) validateAnchor(step.before, "before", false, addViolation);
  if (step.replace !== undefined) validateAnchor(step.replace, "replace", true, addViolation);
}

/** Validates a CopySource object. */
function validateCopySource(
  from: import("./types.ts").CopySource,
  aliases: Set<string>,
  deletedDocs: Map<string, number>,
  addViolation: (msg: string) => void,
): void {
  if (from.doc !== undefined) {
    checkDocIdentifier(from.doc, "from.doc", aliases, deletedDocs, addViolation);
  }
  if (from.node !== undefined && from.section !== undefined) {
    addViolation("from: set at most one of node, section");
  }
  if (from.bodyOnly && !from.section) {
    addViolation("from.bodyOnly needs from.section");
  }
}
