#!/usr/bin/env bun
/**
 * Stage or restore the dev Homebrew formula for `just install-local`.
 * `install` — back up release `Formula/full-example.rb` and write a `file://` dev formula.
 * `reset` — restore the release formula from backup.
 */

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createIdentity } from "./create-identity.ts";
import { renderDevFormula } from "./formula-shared.ts";

const { key } = createIdentity;
const root = join(import.meta.dir, "..");
const stagingDir = join(root, "Formula", ".staging");
const stagingPath = join(stagingDir, key);
const formulaPath = join(root, "Formula", `${key}.rb`);
const backupPath = join(stagingDir, `${key}.rb.bak`);
const programPath = join(root, "src/program.ts");

type Command = "install" | "reset";

function usage(): never {
  process.stderr.write("Usage: bun scripts/dev-formula.ts <install|reset>\n");
  process.exit(1);
}

function parseCommand(argv: string[]): Command {
  const cmd = argv[2];
  if (cmd === "install" || cmd === "reset") {
    return cmd;
  }
  usage();
}

function backupReleaseFormula(): void {
  if (!existsSync(formulaPath)) {
    return;
  }
  mkdirSync(stagingDir, { recursive: true });
  copyFileSync(formulaPath, backupPath);
}

function restoreReleaseFormula(): void {
  if (!existsSync(backupPath)) {
    return;
  }
  copyFileSync(backupPath, formulaPath);
  unlinkSync(backupPath);
}

function readVersion(): string {
  const content = readFileSync(programPath, "utf8");
  const match = /version:\s*"([^"]+)"/.exec(content);
  if (!match?.[1]) {
    process.stderr.write(`Could not read version from ${programPath}\n`);
    process.exit(1);
  }
  return match[1];
}

function stageDevFormula(): void {
  const distPath = join(root, "dist", key);
  if (!existsSync(distPath)) {
    process.stderr.write(`Missing binary: ${distPath} (run just build first)\n`);
    process.exit(1);
  }
  mkdirSync(stagingDir, { recursive: true });
  copyFileSync(distPath, stagingPath);
  chmodSync(stagingPath, 0o755);

  const sha256 = createHash("sha256").update(readFileSync(stagingPath)).digest("hex");
  writeFileSync(formulaPath, renderDevFormula(stagingPath, readVersion(), sha256), "utf8");
}

function install(): void {
  backupReleaseFormula();
  stageDevFormula();
  console.log(`Wrote dev formula: ${formulaPath}`);
}

function reset(): void {
  if (!existsSync(backupPath)) {
    console.log("No dev formula backup to restore.");
    return;
  }
  restoreReleaseFormula();
  console.log(`Restored ${formulaPath}`);
}

const command = parseCommand(process.argv);
if (command === "install") {
  install();
} else {
  reset();
}
