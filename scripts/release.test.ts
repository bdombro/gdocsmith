/* Tests release previews and stubbed release command ordering. */

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative, resolve } from "node:path";

/** Repository root containing this test. */
const repoRoot = resolve(import.meta.dir, "..");
/** Release script exercised by the fixtures. */
const releaseScriptPath = join(repoRoot, "scripts", "release.ts");
/** Temporary fixture roots removed after each test. */
const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("release dry run", () => {
  test("direct script previews a dirty tree without commands or file changes", async () => {
    const root = fixtureCreate();
    const { env, logPath } = commandStubsCreate(root);
    const before = fileSnapshot(root);

    const result = await commandRun([process.execPath, releaseScriptPath, "patch", "--dry-run"], root, env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Releasing 1.2.3 → 1.2.4");
    expect(result.stdout).toContain("Would run just check");
    expect(result.stdout).toContain("commit all changes with git add -A");
    expect(existsSync(logPath)).toBe(false);
    expect(fileSnapshot(root)).toEqual(before);
  });

  test("just release skips schema generation and leaves the fixture unchanged", async () => {
    const root = fixtureCreate();
    const { env, logPath } = commandStubsCreate(root);
    const before = fileSnapshot(root);
    const justPath = Bun.which("just");
    if (!justPath) throw new Error("just is required for the recipe test");

    const result = await commandRun([justPath, "release", "patch", "--dry-run"], root, env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Releasing 1.2.3 → 1.2.4");
    expect(existsSync(logPath)).toBe(false);
    expect(fileSnapshot(root)).toEqual(before);
  });
});

describe("stubbed real release", () => {
  test("checks before bumping and stages all changes after build and docgen", async () => {
    const root = fixtureCreate();
    const { env, logPath } = commandStubsCreate(root);
    const result = await commandRun([process.execPath, releaseScriptPath, "patch"], root, env);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"version": "1.2.4"');
    expect(readFileSync(join(root, "src", "program.ts"), "utf8")).toContain('version: "1.2.4"');
    expect(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")).toContain('"version": "1.2.4"');
    expect(readFileSync(join(root, ".cursor-plugin", "plugin.json"), "utf8")).toContain('"version": "1.2.4"');
    expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toMatch(/## \[1\.2\.4\] - \d{4}-\d{2}-\d{2}/);
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
      "just check",
      "just build",
      "just docgen",
      "git add -A",
      "git commit -m chore: release v1.2.4",
      "git tag v1.2.4",
      "git push",
      "git push origin v1.2.4",
      "gh release create v1.2.4 --title v1.2.4 --generate-notes",
    ]);
  });
});

/** Creates a disposable release fixture with dirty tracked and untracked files. */
function fixtureCreate(): string {
  const root = mkdtempSync(join(tmpdir(), "gdocsmith-release-test-"));
  fixtureRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
  mkdirSync(join(root, "untracked"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"1.2.3"}\n');
  writeFileSync(join(root, "src", "program.ts"), 'export const program = { version: "1.2.3" };\n');
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), '{"version":"1.2.3"}\n');
  writeFileSync(join(root, ".cursor-plugin", "plugin.json"), '{"version":"1.2.3"}\n');
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n- Fixture\n");
  writeFileSync(join(root, "DIRTY.md"), "Existing user change\n");
  writeFileSync(join(root, "untracked", "fixture.txt"), "Untracked user change\n");
  copyFileSync(releaseScriptPath, join(root, "scripts", "release.ts"));
  copyFileSync(join(repoRoot, "justfile"), join(root, "justfile"));
  return root;
}

/** Installs command stubs that record release operations without external effects. */
function commandStubsCreate(root: string): { env: Record<string, string>; logPath: string } {
  const binPath = join(root, "bin");
  const logPath = join(root, "commands.log");
  mkdirSync(binPath);
  for (const command of ["argsbarg", "gh", "git", "just"]) {
    const stateCheck =
      command === "just"
        ? `case "$1" in
  check)
    grep -F 'version: "1.2.3"' src/program.ts >/dev/null
    grep -F '## [Unreleased]' CHANGELOG.md >/dev/null
    ;;
  build|docgen)
    grep -F 'version: "1.2.4"' src/program.ts >/dev/null
    grep -F '## [1.2.4] -' CHANGELOG.md >/dev/null
    ;;
  *) exit 88 ;;
esac`
        : "exit 0";
    const content = `#!/bin/sh
set -eu
printf '%s %s\\n' '${command}' "$*" >> "$RELEASE_LOG"
${stateCheck}
`;
    const stubPath = join(binPath, command);
    writeFileSync(stubPath, content);
    chmodSync(stubPath, 0o755);
  }
  return {
    env: {
      ...process.env,
      PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
      RELEASE_LOG: logPath,
    },
    logPath,
  };
}

/** Runs a child command in a fixture and collects both output streams. */
async function commandRun(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn(command, { cwd, env, stderr: "pipe", stdout: "pipe" });
  const stdout =
    child.stdout && typeof child.stdout !== "number" ? new Response(child.stdout).text() : Promise.resolve("");
  const stderr =
    child.stderr && typeof child.stderr !== "number" ? new Response(child.stderr).text() : Promise.resolve("");
  const [stdoutText, stderrText, exitCode] = await Promise.all([stdout, stderr, child.exited]);
  return { exitCode, stderr: stderrText, stdout: stdoutText };
}

/** Returns every fixture file and its contents for mutation checks. */
function fileSnapshot(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else snapshot[relative(root, path)] = readFileSync(path, "base64");
    }
  };
  visit(root);
  return snapshot;
}
