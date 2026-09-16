#!/usr/bin/env bun
/** Bump version, build, publish zip release; optional `--purge` to drop stale GitHub releases. */

import * as fs from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { $ } from "bun";
import { createIdentity } from "./create-identity.ts";
import {
  buildReleaseArchive,
  type ReleaseTag,
  releaseRepoSlug,
  renderReleaseFormula,
  selectStaleReleaseTags,
} from "./formula-shared.ts";

const { key } = createIdentity;
const formulaPath = `Formula/${key}.rb`;
const binaryPath = `dist/${key}`;
const programPath = "src/program.ts";

/** Allowed semver bump kinds for `scripts/release.ts`. */
type Bump = "major" | "minor" | "patch";

interface ReleaseOptions {
  bump?: Bump;
  purge: boolean;
  yes: boolean;
  dryRun: boolean;
}

/** Entry point: release bump, purge-only, or release then purge. */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.purge && !options.bump) {
    await purgeStaleReleases(options);
    return;
  }
  if (!options.bump) {
    usage();
  }
  await runRelease(options.bump, options);
}

/** Prints usage and exits. */
function usage(): never {
  process.stderr.write(
    "Usage:\n" +
      "  bun scripts/release.ts <major|minor|patch> [--purge]\n" +
      "  bun scripts/release.ts --purge [--yes] [--dry-run]\n",
  );
  process.exit(1);
}

/** Parses argv into release options. */
function parseOptions(argv: string[]): ReleaseOptions {
  const yes = argv.includes("--yes");
  const dryRun = argv.includes("--dry-run");
  const purge = argv.includes("--purge");
  const bump = argv.find((a): a is Bump => a === "major" || a === "minor" || a === "patch");
  for (const arg of argv) {
    if (arg.startsWith("--") && arg !== "--purge" && arg !== "--yes" && arg !== "--dry-run") {
      usage();
    }
  }
  if (!purge && !bump) {
    usage();
  }
  return { bump, purge, yes, dryRun };
}

/** Full release pipeline for a semver bump. */
async function runRelease(bump: Bump, options: ReleaseOptions): Promise<void> {
  const testResult = await $`just test`.nothrow();
  if (testResult.exitCode !== 0) process.exit(testResult.exitCode);

  const currentVersion = readCurrentVersion();
  const newVersion = applyBump(currentVersion, bump);
  console.log(`Releasing ${currentVersion} → ${newVersion}`);

  updateVersion(newVersion);
  updateChangelog(newVersion);

  const buildResult = await $`just build`.nothrow();
  if (buildResult.exitCode !== 0) process.exit(buildResult.exitCode);

  const archivePath = await updateReleaseFormula(newVersion);

  const docgenResult = await $`just docgen`.nothrow();
  if (docgenResult.exitCode !== 0) process.exit(docgenResult.exitCode);

  await commitAndTag(newVersion);
  await createGithubRelease(`v${newVersion}`, archivePath);

  console.log(`Released v${newVersion}`);

  if (options.purge) {
    await purgeStaleReleases(options);
  }
}

/** Applies a semver bump to `current` and returns the new version string. */
function applyBump(current: string, bump: Bump): string {
  const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Commits all staged changes, creates an annotated tag, and pushes both to origin. */
async function commitAndTag(newVersion: string): Promise<void> {
  await $`git add -A`;
  await $`git commit -m ${`chore: release v${newVersion}`}`;
  await $`git tag v${newVersion}`;
  await $`git push`;
  await $`git push origin v${newVersion}`;
}

/** Creates a GitHub release for `tag` with the zip archive attached. */
async function createGithubRelease(tag: string, archivePath: string): Promise<void> {
  await $`gh release create ${tag} ${archivePath} --title ${tag} --generate-notes`;
}

/** Reads the CLI version from `src/program.ts`. */
function readCurrentVersion(): string {
  const content = fs.readFileSync(programPath, "utf-8");
  const match = /version:\s*"([^"]+)"/.exec(content);
  if (!match) {
    process.stderr.write(`Could not read version from ${programPath}\n`);
    process.exit(1);
  }
  const version = match[1];
  if (!version) {
    process.stderr.write(`Could not read version from ${programPath}\n`);
    process.exit(1);
  }
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    process.stderr.write(`Invalid semver in ${programPath}: ${version}\n`);
    process.exit(1);
  }
  return version;
}

/** Promotes `[Unreleased]` to a dated version section in `CHANGELOG.md`. */
function updateChangelog(newVersion: string): void {
  const changelogPath = "CHANGELOG.md";
  const content = fs.readFileSync(changelogPath, "utf-8");
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    changelogPath,
    content.replace(/^## \[Unreleased\]/m, `## [Unreleased]\n\n## [${newVersion}] - ${date}`),
  );
}

/** Overwrites the version literal in `src/program.ts`. */
function updateVersion(newVersion: string): void {
  const content = fs.readFileSync(programPath, "utf-8");
  fs.writeFileSync(programPath, content.replace(/version:\s*"[^"]+"/, `version: "${newVersion}"`));
}

/** Writes the release formula with zip URL and archive sha256; returns the archive path. */
async function updateReleaseFormula(version: string): Promise<string> {
  const { archivePath, sha256 } = await buildReleaseArchive(binaryPath);
  fs.writeFileSync(formulaPath, renderReleaseFormula(version, sha256));
  return archivePath;
}

/** Deletes all GitHub releases except the most recent. */
async function purgeStaleReleases(options: ReleaseOptions): Promise<void> {
  const list = await $`gh release list -R ${releaseRepoSlug} --json tagName,publishedAt`.nothrow();
  if (list.exitCode !== 0) process.exit(list.exitCode);

  const releases = JSON.parse(list.stdout.toString()) as ReleaseTag[];
  const toDelete = selectStaleReleaseTags(releases);

  if (toDelete.length === 0) {
    console.log("No stale releases to delete.");
    return;
  }

  console.log(`Will delete ${toDelete.length} release(s):`);
  for (const tag of toDelete) {
    console.log(`  ${tag}`);
  }

  if (options.dryRun) {
    return;
  }

  if (!options.yes) {
    if (!input.isTTY) {
      process.stderr.write("Not a TTY; pass --yes to confirm purge.\n");
      process.exit(1);
    }
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("Delete these releases? [y/N] ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  for (const tag of toDelete) {
    const del = await $`gh release delete ${tag} -R ${releaseRepoSlug} --yes`.nothrow();
    if (del.exitCode !== 0) process.exit(del.exitCode);
    console.log(`Deleted ${tag}`);
  }
}

await main();
