#!/usr/bin/env bun
/* Release management script: bumps version, builds binary, tags, pushes, and publishes GitHub releases. */

import * as fs from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { $ } from "bun";
import { identityCreate } from "./createIdentity.ts";
import {
  type ReleaseTag,
  releaseArchiveBuild,
  releaseFormulaRender,
  releaseRepoSlug,
  releaseTagsSelectStale,
} from "./formulaShared.ts";

/** Allowed semver bump kinds for release automation. */
type Bump = "major" | "minor" | "patch";

/** Parsed command-line options for release. */
interface ReleaseOptions {
  /** Semver segment to increment. */
  bump?: Bump;
  /** Whether to simulate actions without mutating. */
  dryRun: boolean;
  /** Whether to delete older GitHub releases. */
  purge: boolean;
  /** Whether to skip interactive confirmation prompts. */
  yes: boolean;
}

/**
 * Calculates a new semver string by incrementing the requested segment.
 */
function semverBumpApply(
  /** Current semantic version string. */
  current: string,
  /** Segment to increment. */
  bump: Bump,
): string {
  const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Commits staged changes, creates an annotated git tag, and pushes to origin.
 */
async function gitCommitAndTag(
  /** Newly incremented version string. */
  newVersion: string,
): Promise<void> {
  await $`git add -A`;
  await $`git commit -m ${`chore: release v${newVersion}`}`;
  await $`git tag v${newVersion}`;
  await $`git push`;
  await $`git push origin v${newVersion}`;
}

/**
 * Creates a release on GitHub and attaches the compiled zip archive.
 */
async function githubReleaseCreate(
  /** Release tag name. */
  tag: string,
  /** File path to the zip archive asset. */
  archivePath: string,
): Promise<void> {
  await $`gh release create ${tag} ${archivePath} --title ${tag} --generate-notes`;
}

/**
 * Reads the current semantic version from src/program.ts.
 */
function versionCurrentRead(): string {
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

/**
 * Appends the new release section with date under [Unreleased] in CHANGELOG.md.
 */
function changelogUpdate(
  /** Newly incremented version string. */
  newVersion: string,
): void {
  const changelogPath = "CHANGELOG.md";
  const content = fs.readFileSync(changelogPath, "utf-8");
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    changelogPath,
    content.replace(/^## \[Unreleased\]/m, `## [Unreleased]\n\n## [${newVersion}] - ${date}`),
  );
}

/**
 * Updates the version literal in src/program.ts.
 */
function programVersionUpdate(
  /** Newly incremented version string. */
  newVersion: string,
): void {
  const content = fs.readFileSync(programPath, "utf-8");
  fs.writeFileSync(programPath, content.replace(/version:\s*"[^"]+"/, `version: "${newVersion}"`));
}

/**
 * Re-renders the Homebrew formula file with updated release URL and sha256 checksum.
 */
async function releaseFormulaUpdate(
  /** Newly incremented version string. */
  version: string,
): Promise<string> {
  const { archivePath, sha256 } = await releaseArchiveBuild(binaryPath);
  fs.writeFileSync(formulaPath, releaseFormulaRender(version, sha256));
  return archivePath;
}

/**
 * Deletes older releases from GitHub, retaining only the most recent.
 */
async function staleReleasesPurge(
  /** Options configuring purge behavior. */
  options: ReleaseOptions,
): Promise<void> {
  const list = await $`gh release list -R ${releaseRepoSlug} --json tagName,publishedAt`.nothrow();
  if (list.exitCode !== 0) process.exit(list.exitCode);

  const releases = JSON.parse(list.stdout.toString()) as ReleaseTag[];
  const toDelete = releaseTagsSelectStale(releases);

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

/**
 * Prints usage guidance and exits.
 */
function usage(): never {
  process.stderr.write(
    "Usage:\n" +
      "  bun scripts/release.ts <major|minor|patch> [--purge]\n" +
      "  bun scripts/release.ts --purge [--yes] [--dry-run]\n",
  );
  process.exit(1);
}

/**
 * Parses argv into ReleaseOptions.
 */
function optionsParse(
  /** Command line arguments excluding runtime binary. */
  argv: string[],
): ReleaseOptions {
  const bump = argv.find((a): a is Bump => a === "major" || a === "minor" || a === "patch");
  const dryRun = argv.includes("--dry-run");
  const purge = argv.includes("--purge");
  const yes = argv.includes("--yes");
  for (const arg of argv) {
    if (arg.startsWith("--") && arg !== "--purge" && arg !== "--yes" && arg !== "--dry-run") {
      usage();
    }
  }
  if (!purge && !bump) {
    usage();
  }
  return { bump, dryRun, purge, yes };
}

/**
 * Orchestrates the full release process: test, bump, build, formula, tag, push, release.
 */
async function releaseRun(
  /** Semver segment to increment. */
  bump: Bump,
  /** Options controlling purge and execution. */
  options: ReleaseOptions,
): Promise<void> {
  const testResult = await $`just test`.nothrow();
  if (testResult.exitCode !== 0) process.exit(testResult.exitCode);

  const currentVersion = versionCurrentRead();
  const newVersion = semverBumpApply(currentVersion, bump);
  console.log(`Releasing ${currentVersion} → ${newVersion}`);

  programVersionUpdate(newVersion);
  changelogUpdate(newVersion);

  const buildResult = await $`just build`.nothrow();
  if (buildResult.exitCode !== 0) process.exit(buildResult.exitCode);

  const archivePath = await releaseFormulaUpdate(newVersion);

  const docgenResult = await $`just docgen`.nothrow();
  if (docgenResult.exitCode !== 0) process.exit(docgenResult.exitCode);

  await gitCommitAndTag(newVersion);
  await githubReleaseCreate(`v${newVersion}`, archivePath);

  console.log(`Released v${newVersion}`);

  if (options.purge) {
    await staleReleasesPurge(options);
  }
}

/**
 * Main command entry point.
 */
async function main(): Promise<void> {
  const options = optionsParse(process.argv.slice(2));
  if (options.purge && !options.bump) {
    await staleReleasesPurge(options);
    return;
  }
  if (!options.bump) {
    usage();
  }
  await releaseRun(options.bump, options);
}

const { key } = identityCreate;
const formulaPath = `Formula/${key}.rb`;
const binaryPath = `dist/${key}`;
const programPath = "src/program.ts";

await main();
