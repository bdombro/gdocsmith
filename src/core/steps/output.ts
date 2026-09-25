/* Large output spill-to-file management and cleanup (G4 D8, M5). */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepKind } from "./types.ts";

export const INLINE_STEP_CHARS_MAX = 12_000;
export const INLINE_RUN_CHARS_MAX = 40_000;
export const INLINE_DIFF_CHARS_MAX = 8_000;
export const SPILL_RETENTION_MS = 86_400_000; // 24 hours

/** Base directory for gdocsmith temporary run spill files. */
export function spillBaseDir(): string {
  return join(tmpdir(), "gdocsmith", "runs");
}

/** Creates a fresh unique run directory for spilling large payloads. */
export function spillDirCreate(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = randomUUID().slice(0, 8);
  const dir = join(spillBaseDir(), `${stamp}-${rand}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Generates a file slug from a tab title, falling back to tab ID. */
export function tabSlug(title: string, tabId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || tabId;
}

/** Spills a step's data payload to files in the spill directory. */
export function stepDataSpill(
  spillDir: string,
  stepIndex: number,
  kind: StepKind,
  data: unknown,
  outline?: unknown,
): { files: string[]; inlineData?: unknown; outline?: unknown } {
  const files: string[] = [];

  if (data && typeof data === "object" && "tabs" in data && Array.isArray((data as { tabs: unknown[] }).tabs)) {
    const tabs = (data as { tabs: Array<{ markdown?: string; tabId: string; title: string }> }).tabs;
    if (tabs[0]?.markdown !== undefined) {
      // Markdown export
      const seenSlugs = new Map<string, number>();
      for (const t of tabs) {
        let slug = tabSlug(t.title, t.tabId);
        const count = seenSlugs.get(slug) ?? 0;
        seenSlugs.set(slug, count + 1);
        if (count > 0) slug = `${slug}-${t.tabId}`;
        const filePath = join(spillDir, `s${stepIndex}-${slug}.md`);
        writeFileSync(filePath, t.markdown ?? "", "utf8");
        files.push(filePath);
      }
      return { files, inlineData: undefined, outline };
    }
    // Outline query
    const filePath = join(spillDir, `s${stepIndex}-outline.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    files.push(filePath);
    return { files, inlineData: undefined, outline };
  }

  if (data && typeof data === "object" && "nodes" in data) {
    const filePath = join(spillDir, `s${stepIndex}-nodes.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    files.push(filePath);
    return { files, inlineData: undefined, outline };
  }

  if (data && typeof data === "object" && "permissions" in data) {
    const filePath = join(spillDir, `s${stepIndex}-permissions.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    files.push(filePath);
    return { files, inlineData: undefined, outline };
  }

  const filePath = join(spillDir, `s${stepIndex}-${kind}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  files.push(filePath);
  return { files, inlineData: undefined, outline };
}

/** Spills a large unified diff to diff.patch in the spill directory. */
export function diffSpill(spillDir: string, diffText: string): string {
  const filePath = join(spillDir, "diff.patch");
  writeFileSync(filePath, diffText, "utf8");
  return filePath;
}

/** Prunes spill directories older than 24 hours. */
export function spillPrune(now = Date.now()): void {
  const base = spillBaseDir();
  if (!existsSync(base)) return;

  const entries = readdirSync(base);
  for (const entry of entries) {
    const dirPath = join(base, entry);
    try {
      const stats = statSync(dirPath);
      if (stats.isDirectory() && now - stats.mtimeMs > SPILL_RETENTION_MS) {
        rmSync(dirPath, { force: true, recursive: true });
      }
    } catch {
      // Ignore errors during directory cleanup
    }
  }
}
