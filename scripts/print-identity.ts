#!/usr/bin/env bun
/** Print a field from scripts/create-identity.ts for justfile backticks. */

import { createIdentity } from "./create-identity.ts";

const field = process.argv[2];
if (!field) {
  console.error("Usage: bun scripts/print-identity.ts <key|className|tap|tapOrg|tapRepo|releaseRepo|envPrefix>");
  process.exit(1);
}

const [tapOrg, tapRepo] = createIdentity.tap.split("/");
const values: Record<string, string> = {
  key: createIdentity.key,
  className: createIdentity.className,
  tap: createIdentity.tap,
  tapOrg: tapOrg ?? "",
  tapRepo: tapRepo ?? "",
  envPrefix: createIdentity.envPrefix,
  releaseRepo: createIdentity.releaseRepo,
};

const value = values[field];
if (value === undefined) {
  console.error(`Unknown field: ${field}`);
  process.exit(1);
}
process.stdout.write(value);
