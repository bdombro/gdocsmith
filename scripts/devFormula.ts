#!/usr/bin/env bun
/* Dev Homebrew formula management script: stages or restores local dev formula for testing. */

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identityCreate } from "./createIdentity.ts";
import { formulaDevRender } from "./formulaShared.ts";

/** Supported subcommands for dev-formula. */
type Command = "install" | "reset";

/**
 * Backs up the production formula to the staging area.
 */
function formulaBackupRelease(): void {
  if (!existsSync(formulaPath)) {
    return;
  }
  mkdirSync(stagingDir, { recursive: true });
  copyFileSync(formulaPath, backupPath);
}

/**
 * Restores the backed up release formula and cleans up the staging file.
 */
function formulaRestoreRelease(): void {
  if (!existsSync(backupPath)) {
    return;
  }
  copyFileSync(backupPath, formulaPath);
  unlinkSync(backupPath);
}

/**
 * Reads the version string from program.ts.
 */
function versionRead(): string {
  const content = readFileSync(programPath, "utf8");
  const match = /version:\s*"([^"]+)"/.exec(content);
  if (!match?.[1]) {
    process.stderr.write(`Could not read version from ${programPath}\n`);
    process.exit(1);
  }
  return match[1];
}

/**
 * Copies the compiled binary to the staging folder and generates the dev formula.
 */
function formulaStageDev(): void {
  const distPath = join(root, "dist", key);
  if (!existsSync(distPath)) {
    process.stderr.write(`Missing binary: ${distPath} (run just build first)\n`);
    process.exit(1);
  }
  mkdirSync(stagingDir, { recursive: true });
  copyFileSync(distPath, stagingPath);
  chmodSync(stagingPath, 0o755);

  const sha256 = createHash("sha256").update(readFileSync(stagingPath)).digest("hex");
  writeFileSync(formulaPath, formulaDevRender(stagingPath, versionRead(), sha256), "utf8");
}

/**
 * Runs the install workflow for dev formula staging.
 */
function devFormulaInstall(): void {
  formulaBackupRelease();
  formulaStageDev();
  console.log(`Wrote dev formula: ${formulaPath}`);
}

/**
 * Runs the reset workflow to restore the release formula.
 */
function devFormulaReset(): void {
  if (!existsSync(backupPath)) {
    console.log("No dev formula backup to restore.");
    return;
  }
  formulaRestoreRelease();
  console.log(`Restored ${formulaPath}`);
}

/**
 * Prints usage guidance and terminates the process with an error code.
 */
function usage(): never {
  process.stderr.write("Usage: bun scripts/devFormula.ts <install|reset>\n");
  process.exit(1);
}

/**
 * Parses argv to determine the command action.
 */
function commandParse(
  /** Command line arguments. */
  argv: string[],
): Command {
  const cmd = argv[2];
  if (cmd === "install" || cmd === "reset") {
    return cmd;
  }
  usage();
}

const { key } = identityCreate;
const root = join(import.meta.dir, "..");
const stagingDir = join(root, "Formula", ".staging");
const stagingPath = join(stagingDir, key);
const formulaPath = join(root, "Formula", `${key}.rb`);
const backupPath = join(stagingDir, `${key}.rb.bak`);
const programPath = join(root, "src/program.ts");

const command = commandParse(process.argv);
if (command === "install") {
  devFormulaInstall();
} else {
  devFormulaReset();
}
