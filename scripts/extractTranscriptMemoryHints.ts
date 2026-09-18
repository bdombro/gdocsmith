/* Batch-scan Cursor agent transcripts for memory authoring hints (paths touched, argsbarg edits). */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const transcriptDir =
  "/Users/briandombrowski/.cursor/projects/Users-briandombrowski-dev-bdombro-gdocsmith/agent-transcripts";
const outPath = join(import.meta.dir, "../.agents/memories/_transcript-hints.json");

/** First user query text from transcript opener. */
function parseFirstQuery(text: string): string {
  const q = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  return (q ? q[1] : text).trim().slice(0, 200);
}

/** ISO date YYYY-MM-DD from transcript timestamp line. */
function dayFromTimestamp(text: string): string {
  const m = text.match(/<timestamp>\w+, (\w+) (\d+), (\d+),/);
  if (!m) {
    return "unknown";
  }
  const months: Record<string, string> = {
    January: "01",
    February: "02",
    March: "03",
    April: "04",
    May: "05",
    June: "06",
    July: "07",
    August: "08",
    September: "09",
    October: "10",
    November: "11",
    December: "12",
  };
  const mon = months[m[1]] ?? "??";
  return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
}

/** Repo-relative paths written in gdocsmith during a transcript. */
function collectGdocsmithWrites(content: string): string[] {
  const paths = new Set<string>();
  for (const line of content.split("\n")) {
    if (!line) {
      continue;
    }
    try {
      const obj = JSON.parse(line) as {
        message?: { content?: Array<{ type?: string; name?: string; input?: { path?: string } }> };
        role?: string;
      };
      if (obj.role !== "assistant") {
        continue;
      }
      for (const c of obj.message?.content ?? []) {
        if (
          c.type === "tool_use" &&
          (c.name === "Write" || c.name === "StrReplace") &&
          c.input?.path?.includes("gdocsmith")
        ) {
          paths.add(c.input.path.replace(/.*\/gdocsmith\//, ""));
        }
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return [...paths].slice(0, 50);
}

/** Repo-relative paths written in bun-argsbarg during a transcript. */
function collectArgsbargWrites(content: string): string[] {
  const paths = new Set<string>();
  for (const line of content.split("\n")) {
    if (!line) {
      continue;
    }
    try {
      const obj = JSON.parse(line) as {
        message?: { content?: Array<{ type?: string; name?: string; input?: { path?: string } }> };
        role?: string;
      };
      if (obj.role !== "assistant") {
        continue;
      }
      for (const c of obj.message?.content ?? []) {
        if (
          c.type === "tool_use" &&
          (c.name === "Write" || c.name === "StrReplace") &&
          c.input?.path?.includes("bun-argsbarg")
        ) {
          paths.add(c.input.path.replace(/.*\/bun-argsbarg\//, ""));
        }
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return [...paths];
}

const rows: Array<{
  argsbargPaths: string[];
  day: string;
  gdocsmithPaths: string[];
  id: string;
  query: string;
  size: number;
}> = [];

for (const d of readdirSync(transcriptDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  const p = join(transcriptDir, d.name, `${d.name}.jsonl`);
  try {
    const content = readFileSync(p, "utf8");
    const first = content.split("\n")[0];
    const firstObj = JSON.parse(first) as {
      message?: { content?: Array<{ text?: string }> };
    };
    const text = firstObj.message?.content?.[0]?.text ?? "";
    rows.push({
      argsbargPaths: collectArgsbargWrites(content),
      day: dayFromTimestamp(text),
      gdocsmithPaths: collectGdocsmithWrites(content),
      id: d.name,
      query: parseFirstQuery(text),
      size: content.length,
    });
  } catch {
    /* skip unreadable transcripts */
  }
}

rows.sort((a, b) => a.day.localeCompare(b.day) || b.size - a.size);
writeFileSync(outPath, JSON.stringify(rows, null, 2));
console.log(`wrote ${rows.length} rows to ${outPath}`);
