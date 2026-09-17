#!/usr/bin/env bun
/* CLI script to print identity fields for consumption by justfile recipes. */

import { identityCreate } from "./createIdentity.ts";

const field = process.argv[2];
if (!field) {
  console.error("Usage: bun scripts/printIdentity.ts <key|className|tap|tapOrg|tapRepo|releaseRepo|envPrefix>");
  process.exit(1);
}

const [tapOrg, tapRepo] = identityCreate.tap.split("/");

/** Dictionary of supported identity property getters. */
const values: Record<string, string> = {
  /** PascalCase identity class name. */
  className: identityCreate.className,
  /** Environment variable prefix. */
  envPrefix: identityCreate.envPrefix,
  /** Package canonical key. */
  key: identityCreate.key,
  /** GitHub release repository slug. */
  releaseRepo: identityCreate.releaseRepo,
  /** Homebrew tap identifier. */
  tap: identityCreate.tap,
  /** Homebrew tap owner organization. */
  tapOrg: tapOrg ?? "",
  /** Homebrew tap repository name. */
  tapRepo: tapRepo ?? "",
};

const value = values[field];
if (value === undefined) {
  console.error(`Unknown field: ${field}`);
  process.exit(1);
}
process.stdout.write(value);
