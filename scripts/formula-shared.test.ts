import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReleaseArchive,
  releaseArchiveName,
  releaseFormulaUrl,
  selectStaleReleaseTags,
} from "./formula-shared.ts";

describe("releaseArchiveName", () => {
  test("returns key.zip", () => {
    expect(releaseArchiveName()).toBe("gdocsmith.zip");
  });
});

describe("releaseFormulaUrl", () => {
  test("points at zip asset on GitHub releases", () => {
    expect(releaseFormulaUrl("1.2.3")).toBe(
      "https://github.com/bdombro/gdocsmith/releases/download/v1.2.3/gdocsmith.zip",
    );
  });
});

describe("selectStaleReleaseTags", () => {
  test("returns empty for zero or one release", () => {
    expect(selectStaleReleaseTags([])).toEqual([]);
    expect(selectStaleReleaseTags([{ tagName: "v1.0.0", publishedAt: "2026-01-01T00:00:00Z" }])).toEqual([]);
  });

  test("keeps newest by publishedAt and returns the rest", () => {
    const releases = [
      { tagName: "v1.0.0", publishedAt: "2026-01-01T00:00:00Z" },
      { tagName: "v1.1.0", publishedAt: "2026-02-01T00:00:00Z" },
      { tagName: "v1.0.1", publishedAt: "2026-01-15T00:00:00Z" },
    ];
    expect(selectStaleReleaseTags(releases)).toEqual(["v1.0.1", "v1.0.0"]);
  });
});

describe("buildReleaseArchive", () => {
  const workDirs: string[] = [];

  afterEach(() => {
    for (const dir of workDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates zip with binary at archive root and matching sha256", async () => {
    const work = mkdtempSync(join(tmpdir(), "argsbarg-release-zip-"));
    workDirs.push(work);
    const binaryPath = join(work, "gdocsmith");
    writeFileSync(binaryPath, "#!/bin/sh\necho hi\n", { mode: 0o755 });

    const { archivePath, sha256 } = await buildReleaseArchive(binaryPath);

    expect(archivePath).toBe(`${binaryPath}.zip`);
    const onDisk = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    expect(sha256).toBe(onDisk);

    const listing = execFileSync("unzip", ["-l", archivePath], { encoding: "utf8" });
    expect(listing).toContain("gdocsmith");
  });
});
