/* Dev tooling: resolves scenario prompts from scenarios.md or passes custom prompts. */

import * as fs from "node:fs";
import * as path from "node:path";

/** Relative path to scenario catalog markdown file. */
const SCENARIOS_FILE_PATH = path.join(".cursor", "skills", "gdocsmith-e2e", "scenarios.md");

/** Default scenario ID used when no argument is supplied. */
const DEFAULT_SCENARIO_ID = "full-workflow";

/** Parsed scenario metadata and prompt text. */
interface ScenarioEntry {
  /** Brief description or goal of the scenario. */
  description: string;
  /** Unique scenario identifier matching a markdown section header. */
  id: string;
  /** Full prompt string extracted from the prompt codeblock. */
  prompt: string;
  /** Expected turn budget. */
  targetTurns?: string;
}

/** Parses scenarios.md and extracts all scenario entries. */
function scenariosParse(
  /** Absolute or relative path to the scenarios markdown file. */
  filePath: string,
): Map<string, ScenarioEntry> {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Scenarios catalog file not found at: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const scenarios = new Map<string, ScenarioEntry>();

  // Match ## <scenario-id> followed by metadata and ```prompt <content> ```
  const sectionRegex = /^##\s+([a-zA-Z0-9_-]+)\s*$/gm;
  const sections: Array<{ id: string; startIndex: number }> = [];

  let match: RegExpExecArray | null = sectionRegex.exec(content);
  while (match !== null) {
    if (match[1] !== "Scenarios") {
      sections.push({ id: match[1]!, startIndex: match.index });
    }
    match = sectionRegex.exec(content);
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const nextStart = i + 1 < sections.length ? sections[i + 1]!.startIndex : content.length;
    const body = content.slice(section.startIndex, nextStart);

    const promptMatch = body.match(/```prompt\n([\s\S]*?)\n```/);
    if (!promptMatch?.[1]) continue;

    const goalMatch = body.match(/\*\*Goal\*\*:\s*([^\n]+)/);
    const turnsMatch = body.match(/\*\*Target Turn Budget\*\*:\s*([^\n]+)/);

    scenarios.set(section.id, {
      description: goalMatch ? goalMatch[1]!.trim() : "",
      id: section.id,
      prompt: promptMatch[1]!.trim(),
      targetTurns: turnsMatch ? turnsMatch[1]!.trim() : undefined,
    });
  }

  return scenarios;
}

/** Resolves an input string to either a scenario prompt or returns the custom prompt as-is. */
function scenarioResolve(
  /** Scenario ID or raw custom prompt string. */
  input?: string,
): string {
  const scenarios = scenariosParse(SCENARIOS_FILE_PATH);
  const targetId = input?.trim() || DEFAULT_SCENARIO_ID;

  if (scenarios.has(targetId)) {
    return scenarios.get(targetId)!.prompt;
  }

  // If not a known scenario ID, treat the input as a custom raw prompt
  return input || scenarios.get(DEFAULT_SCENARIO_ID)!.prompt;
}

/** Lists all available scenarios with their IDs and descriptions. */
function scenariosList(): string {
  const scenarios = scenariosParse(SCENARIOS_FILE_PATH);
  const lines: string[] = ["Available E2E Scenarios:", ""];
  for (const [id, entry] of scenarios) {
    lines.push(`  • ${id.padEnd(26)} ${entry.description}`);
  }
  return lines.join("\n");
}

/** CLI entrypoint resolving scenario arguments for agent invocation. */
function main(): void {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (firstArg === "--list" || firstArg === "-l") {
    console.log(scenariosList());
    process.exit(0);
  }

  const prompt = scenarioResolve(firstArg);
  process.stdout.write(prompt);
}

main();
