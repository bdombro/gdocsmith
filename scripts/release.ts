/* Release management script: bumps version, builds bundle, tags, pushes, and creates GitHub releases. */

import * as fs from "node:fs";
import { $ } from "bun";

/** Path to Claude Code plugin manifest. */
const claudeManifestPath = ".claude-plugin/plugin.json";

/** Path to Cursor plugin manifest. */
const cursorManifestPath = ".cursor-plugin/plugin.json";

/** Path to package.json defining package metadata. */
const packagePath = "package.json";

/** Path to program entrypoint defining the version. */
const programPath = "src/program.ts";

/** Allowed semver bump kinds for release automation. */
type Bump = "major" | "minor" | "patch";

/** Parsed command-line options for release. */
interface ReleaseOptions {
  /** Semver segment to increment. */
  bump?: Bump;
  /** Whether to simulate actions without mutating. */
  dryRun: boolean;
  /** Whether to skip interactive confirmation prompts. */
  yes: boolean;
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
 * Parses argv into ReleaseOptions.
 */
function optionsParse(
  /** Command line arguments excluding runtime binary. */
  argv: string[],
): ReleaseOptions {
  const bump = argv.find((a): a is Bump => a === "major" || a === "minor" || a === "patch");
  const dryRun = argv.includes("--dry-run");
  const yes = argv.includes("--yes");
  for (const arg of argv) {
    if (arg.startsWith("--") && arg !== "--yes" && arg !== "--dry-run") {
      usage();
    }
  }
  if (!bump) {
    usage();
  }
  return { bump, dryRun, yes };
}

/**
 * Creates a release on GitHub using release notes.
 */
async function releaseGithubCreate(
  /** Release tag name. */
  tag: string,
): Promise<void> {
  await $`gh release create ${tag} --title ${tag} --generate-notes`;
}

/**
 * Orchestrates the full release process: test, bump, build, tag, push, release.
 */
async function releaseRun(
  /** Semver segment to increment. */
  bump: Bump,
  /** Options controlling execution. */
  options: ReleaseOptions,
): Promise<void> {
  const currentVersion = versionCurrentRead();
  const newVersion = semverBumpApply(currentVersion, bump);

  if (options.dryRun) {
    console.log(
      `Releasing ${currentVersion} → ${newVersion}\n` +
        "[dry-run] Would run just check, bump the version and changelog, build, generate docs, " +
        `commit all changes with git add -A, tag v${newVersion}, push, and create the GitHub release.`,
    );
    return;
  }

  const checkResult = await $`just check`.nothrow();
  if (checkResult.exitCode !== 0) process.exit(checkResult.exitCode);

  console.log(`Releasing ${currentVersion} → ${newVersion}`);
  versionUpdate(newVersion);
  changelogUpdate(newVersion);

  const buildResult = await $`just build`.nothrow();
  if (buildResult.exitCode !== 0) process.exit(buildResult.exitCode);

  const docgenResult = await $`just docgen`.nothrow();
  if (docgenResult.exitCode !== 0) process.exit(docgenResult.exitCode);

  await gitCommitAndTag(newVersion);
  await releaseGithubCreate(`v${newVersion}`);

  console.log(`Released v${newVersion}`);
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
 * Prints usage guidance and exits.
 */
function usage(): never {
  process.stderr.write("Usage:\n" + "  bun scripts/release.ts <major|minor|patch> [--yes] [--dry-run]\n");
  process.exit(1);
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
 * Updates version strings across package.json, src/program.ts, and plugin manifests.
 */
function versionUpdate(
  /** Newly incremented version string. */
  newVersion: string,
): void {
  const pkgContent = fs.readFileSync(packagePath, "utf-8");
  fs.writeFileSync(packagePath, pkgContent.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`));

  const progContent = fs.readFileSync(programPath, "utf-8");
  fs.writeFileSync(programPath, progContent.replace(/version:\s*"[^"]+"/, `version: "${newVersion}"`));

  if (fs.existsSync(cursorManifestPath)) {
    const cursorContent = fs.readFileSync(cursorManifestPath, "utf-8");
    fs.writeFileSync(cursorManifestPath, cursorContent.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`));
  }

  if (fs.existsSync(claudeManifestPath)) {
    const claudeContent = fs.readFileSync(claudeManifestPath, "utf-8");
    fs.writeFileSync(claudeManifestPath, claudeContent.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`));
  }
}

/**
 * Main entry point for release automation.
 */
async function main(): Promise<void> {
  const options = optionsParse(process.argv.slice(2));
  if (!options.bump) {
    usage();
  }
  await releaseRun(options.bump, options);
}

await main();
