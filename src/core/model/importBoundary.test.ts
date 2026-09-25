/* Enforces the G3 import boundary: v2 production code never imports a v1-only module, and never calls a Bun-only API (v2 runs under node; see plan §X1). */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const V2_DIRS = [
  "src/core/model",
  "src/core/emulator",
  "src/core/diff",
  "src/core/reconcile",
  "src/core/lens",
  "src/core/engine",
];

const FORBIDDEN_MODULE_SUBSTRINGS = [
  "core/dom/",
  "core/inline.ts",
  "core/markdown.ts",
  "core/replace.ts",
  "core/applyScript.ts",
  "core/actions/",
  "core/revisions.ts",
  "core/paragraph.ts",
  "core/workflowTypes.ts",
  "core/images",
  "core/appsScriptImages.ts",
  "core/imageStore.ts",
  "core/styles.ts",
];

describe("import boundary", () => {
  test("v2 dirs import no v1-only module", () => {
    const violations = productionFiles()
      .flatMap((file) => importSpecifiers(file).map((spec) => ({ file, spec })))
      .filter(({ spec }) => FORBIDDEN_MODULE_SUBSTRINGS.some((forbidden) => spec.includes(forbidden)))
      .map(({ file, spec }) => `${file}: imports "${spec}"`);
    expect(violations).toEqual([]);
  });

  test("v2 production files use no Bun.* APIs", () => {
    const violations = productionFiles()
      .filter((file) => /\bBun\./.test(readFileSync(file, "utf8")))
      .map((file) => file);
    expect(violations).toEqual([]);
  });
});

/** Every `.ts` file under a v2 dir, excluding `*.test.ts`. */
function productionFiles(): string[] {
  return V2_DIRS.flatMap((dir) => (existsSync(dir) ? tsFilesUnder(dir) : [])).filter(
    (file) => !file.endsWith(".test.ts"),
  );
}

/** Recursively collects `.ts` file paths under `dir`. */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Extracts every `from "..."` module specifier in a file's `import`/`export ... from` lines. */
function importSpecifiers(file: string): string[] {
  const specifiers: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/from\s+["']([^"']+)["']/);
    if (match) specifiers.push(match[1]);
  }
  return specifiers;
}
