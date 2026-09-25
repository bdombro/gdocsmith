/* Replays every recorded live conformance fixture through the emulator (G3 M5). */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { conformanceCompare, fixtureExpand } from "./conformance.ts";

/** Directory of compact fixtures recorded by `tests/integration/conformance.test.ts`. */
const FIXTURE_DIR = join(import.meta.dir, "__fixtures__", "conformance");

const files = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("emulator conformance with recorded Docs API behavior", () => {
  test("fixtures exist", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  for (const file of files) {
    const fx = fixtureExpand(JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")));
    test(`${fx.id}: ${fx.name}`, () => {
      expect(conformanceCompare(fx)).toEqual([]);
    });
  }
});
