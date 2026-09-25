/* Offline-first Copilot E2E evaluation harness for gdocsmith (G6 M1). */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type DocsClient, type DriveApi, gws, gwsDrive } from "~/core/gws.ts";
import { type GdocsmithRunResult, runExecute } from "~/core/steps/run.ts";
import type { GdocsmithStep } from "~/core/steps/types.ts";
import type { GoogleDoc } from "~/core/types.ts";

/** Fixed comparison defaults selected by the user for G6. */
export const EVAL_DEFAULTS = {
  fixtureId: "1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc",
  model: "gpt-5.6-luna",
  reasoningEffort: "xhigh",
  runs: 3,
  timeoutMs: 600_000,
} as const;

/** The two supported comparison arms. */
export type EvalArmName = "v1" | "v2";

/** A local Git worktree supplied for one arm. */
export interface EvalArmPath {
  /** Comparison arm label. */
  name: EvalArmName;
  /** Absolute repository or worktree path. */
  root: string;
}

/** Immutable metadata recorded for a selected arm. */
export interface EvalArm {
  /** Absolute root path. */
  root: string;
  /** Arm label. */
  name: EvalArmName;
  /** Git revision at evaluation start. */
  revision: string;
  /** Absolute path to the built Node MCP bundle. */
  bundlePath: string;
  /** SHA-256 of the selected arm's MCP bundle. */
  bundleSha256: string;
  /** Absolute path to the selected arm's gdocsmith skill. */
  skillPath: string;
  /** SHA-256 of the selected arm's skill. */
  skillSha256: string;
}

/** Parsed command-line options for one v1/v2 comparison. */
export interface EvalOptions {
  /** Absolute path for the v1 worktree. */
  armRoots: Record<EvalArmName, string>;
  /** Optional case IDs; empty selects every registered case. */
  caseIds: string[];
  /** Keep fixture copies after each run. */
  keepDocs: boolean;
  /** Requested model, applied identically to both arms. */
  model: string;
  /** Requested reasoning effort, applied identically to both arms. */
  reasoningEffort: string;
  /** Repetitions per selected case and arm. */
  runs: number;
}

/** CLI parse result, including the no-side-effect help path. */
export type EvalCliOptions = EvalOptions | { help: true };

/** A deterministic outcome assertion supplied by a task case. */
export interface EvalCheck {
  /** Stable check identifier. */
  id: string;
  /** Whether the observed document state satisfies the assertion. */
  passed: boolean;
  /** Short explanation, without raw document content. */
  detail: string;
}

/** Context passed to the case's independent outcome verifier. */
export interface EvalVerificationContext {
  /** Fixture document snapshot fetched once before the suite. */
  baseline: GoogleDoc;
  /** Current fixture-copy snapshot fetched after the agent session. */
  current: GoogleDoc;
  /** Fixture copy owned by this run. */
  documentId: string;
  /** Captured agent transcript, when the CLI produced one. */
  transcript: string | null;
  /** Raw, redacted Copilot JSONL stdout. */
  stdout: string;
  /** Runs read-only gdocsmith queries against the current document. */
  query(steps: GdocsmithStep[]): Promise<GdocsmithRunResult>;
}

/** A natural-language task and its deterministic document verifier. */
export interface EvalCase {
  /** Stable case identifier. */
  id: string;
  /** Natural-language prompt, without the fixture-specific suffix. */
  prompt: string;
  /** Independently verifies the task result using current and baseline state. */
  verify(context: EvalVerificationContext): Promise<EvalCheck[]>;
}

/** Nullable metrics retained for reporting without treating missing as zero. */
export interface EvalMetrics {
  /** Copilot AI credits from the usage report. */
  aiCredits: number | null;
  /** Cached input tokens, kept separate from input token totals. */
  cachedInputTokens: number | null;
  /** Reported USD cost only; never estimated. */
  costUsd: number | null;
  /** Per-run wall duration measured by the harness. */
  durationMs: number | null;
  /** Run-tool calls returned with an error. */
  failedCalls: number | null;
  /** Calls whose arguments contain a force=true property. */
  forcedCalls: number | null;
  /** Input tokens from the usage report. */
  inputTokens: number | null;
  /** Run-tool calls rejected by step validation. */
  invalidCalls: number | null;
  /** Output tokens from the usage report. */
  outputTokens: number | null;
  /** Premium requests from the usage report. */
  premiumRequests: number | null;
  /** Run-tool guard refusals. */
  refusedCalls: number | null;
  /** gdocsmith run-tool calls. */
  runCalls: number | null;
  /** Model turns from the usage report. */
  turns: number | null;
}

/** Per-run files and model-session evidence. */
export interface EvalEvidence {
  /** Relative path to captured JSONL stdout. */
  stdoutFile: string;
  /** Relative path to captured stderr. */
  stderrFile: string;
  /** Relative path to the local transcript, if produced. */
  transcriptFile: string | null;
  /** Relative path to the final usage JSON, if produced. */
  usageFile: string | null;
  /** Copilot's unique session UUID. */
  sessionId: string;
  /** Unique MCP server name configured for this run. */
  mcpServerName: string;
  /** User-confirmed isolation assumption for unrelated MCP servers. */
  unrelatedMcpServers: "user-confirmed-disabled";
}

/** Normalized result for one case, arm, and repetition. */
export interface EvalRunRecord {
  /** Arm label. */
  arm: EvalArmName;
  /** Git revision of the arm. */
  armRevision: string;
  /** MCP bundle hash used by the run. */
  bundleSha256: string;
  /** Case identifier. */
  caseId: string;
  /** Per-run deterministic assertions. */
  checks: EvalCheck[];
  /** Evidence files and session identity for this run. */
  evidence: EvalEvidence;
  /** True only after verified completion, settings, and checks. */
  complete: boolean;
  /** Provider- or harness-reported USD cost source. */
  costSource: string | null;
  /** Current fixture copy owned by this run. */
  documentId: string | null;
  /** Run duration measured by the harness. */
  durationMs: number | null;
  /** Effective model observed in runtime evidence. */
  effectiveModel: string | null;
  /** Effective reasoning effort observed in runtime evidence. */
  effectiveReasoningEffort: string | null;
  /** Concise error or incomplete-run explanation. */
  error?: string;
  /** Provider, Google-auth, or isolation halt condition. */
  haltReason?: string;
  /** Whether the user's --keep-docs option retained this copy. */
  keptDocumentId?: string;
  /** Run metrics. Missing usage and unverified event metrics are null. */
  metrics: EvalMetrics;
  /** Whether the output event schema was confirmed by a pilot. */
  outputSchemaVerified: boolean;
  /** Whether all deterministic case checks passed. */
  passed: boolean;
  /** One-based repetition index. */
  run: number;
  /** Requested model. */
  requestedModel: string;
  /** Requested reasoning effort. */
  requestedReasoningEffort: string;
  /** Run start time in ISO format. */
  startedAt: string;
  /** Run completion time in ISO format. */
  finishedAt: string;
  /** Skill file hash used by the run. */
  skillSha256: string;
  /** Tool-event completion marker was present. */
  completionObserved: boolean;
  /** Document copy could not be deleted. */
  undeletedDocumentId?: string;
  /** Provider usage file state. */
  usageStatus: "available" | "invalid" | "missing";
  /** Unmatched tool calls or malformed required events. */
  eventIssues: string[];
  /** Copilot CLI version string. */
  copilotVersion: string;
  /** Run-owned fixture copy, deleted unless explicitly kept. */
  fixtureDocumentId: string | null;
}

/** Captured Copilot process result. */
export interface EvalProcessResult {
  /** Child exit status. */
  exitCode: number;
  /** Captured stderr. */
  stderr: string;
  /** Captured JSONL stdout. */
  stdout: string;
  /** True when the configured process timeout fired. */
  timedOut: boolean;
}

/** Process arguments passed to the injectable Copilot invoker. */
export interface EvalSpawnOptions {
  /** Fresh temporary workspace. */
  cwd: string;
  /** Environment inherited by Copilot with automatic updates disabled. */
  env: Record<string, string | undefined>;
  /** Hard per-session timeout. */
  timeoutMs: number;
}

/** Narrow Google client surface used by fixture setup and cleanup. */
export interface EvalGoogleClients {
  /** Docs reads and run-tool queries. */
  docs: DocsClient;
  /** Fixture copies and permanent deletion. */
  drive: DriveApi;
}

/** Injectable dependencies for offline harness tests. */
export interface EvalDependencies {
  /** Google clients; default to gdocsmith's authenticated clients. */
  clients?: EvalGoogleClients;
  /** Copilot executable path; default to the installed CLI. */
  copilotPath?: string;
  /** Output directory; default is under ~/.cache/gdocsmith/evals. */
  outputDirectory?: string;
  /** Per-run Copilot process invoker. */
  spawn?: (command: string, args: string[], options: EvalSpawnOptions) => Promise<EvalProcessResult>;
  /** Read-only query override for verifier tests. */
  query?: (steps: GdocsmithStep[]) => Promise<GdocsmithRunResult>;
  /** Local CLI version reader. */
  readCliVersion?: (command: string, env: Record<string, string | undefined>) => string;
  /** Test clock override. */
  now?: () => Date;
  /** Test UUID override. */
  id?: () => string;
  /** Test-only gate for the runtime-confirmed event schema. */
  outputSchemaVerified?: boolean;
  /** Test-only timeout override. */
  timeoutMs?: number;
  /** Test-only environment override. */
  env?: Record<string, string | undefined>;
}

/** Candidate Copilot event mapping; M2 must confirm this against a live pilot. */
export interface CopilotEventSummary {
  /** Syntactic and provisional semantic completion. */
  complete: boolean;
  /** Whether a candidate session completion event was present. */
  completionObserved: boolean;
  /** Candidate correlated call counts. */
  metrics: Pick<EvalMetrics, "failedCalls" | "forcedCalls" | "invalidCalls" | "refusedCalls" | "runCalls">;
  /** Effective model when a recognized event reports one. */
  effectiveModel: string | null;
  /** Effective effort when a recognized event reports one. */
  effectiveReasoningEffort: string | null;
  /** Issues that make the stream incomplete. */
  issues: string[];
  /** Names of tools outside the intended run/status pair. */
  unexpectedToolNames: string[];
}

/** Usage fields mapped only from the harness's normalized candidate schema. */
export interface CopilotUsageSummary {
  /** Parsed nullable usage values. */
  metrics: Pick<
    EvalMetrics,
    "aiCredits" | "cachedInputTokens" | "costUsd" | "inputTokens" | "outputTokens" | "premiumRequests" | "turns"
  >;
  /** Exact JSON property used for the reported USD value. */
  costSource: string | null;
  /** Effective model, if the report has the normalized field. */
  model: string | null;
  /** Effective reasoning effort, if the report has the normalized field. */
  reasoningEffort: string | null;
  /** Whether the usage file was present and valid JSON object data. */
  status: "available" | "invalid" | "missing";
}

/** Comparison summary persisted alongside the detailed run matrix. */
export interface EvalSummary {
  /** Reason evaluation stopped early, if any. */
  abortReason: string | null;
  /** Copilot CLI version. */
  copilotVersion: string;
  /** Evaluation output directory. */
  outputDirectory: string;
  /** Whether runtime event semantics were confirmed. */
  outputSchemaVerified: boolean;
  /** Requested model shared by both arms. */
  requestedModel: string;
  /** Requested reasoning effort shared by both arms. */
  requestedReasoningEffort: string;
  /** Start timestamp in ISO format. */
  startedAt: string;
  /** Per-run outcomes. */
  runs: EvalRunRecord[];
}

/** Runtime schema remains unconfirmed until the authorized G6 M2 pilot. */
export const COPILOT_OUTPUT_SCHEMA_VERIFIED = false;

const JSONL_TOOL_START_TYPES = new Set(["mcp.tool.start", "tool.call.start", "tool.execution.start", "tool.start"]);
const JSONL_TOOL_COMPLETE_TYPES = new Set([
  "mcp.tool.complete",
  "tool.call.complete",
  "tool.execution.complete",
  "tool.complete",
]);
const JSONL_SESSION_COMPLETE_TYPES = new Set([
  "agent.complete",
  "agent.completed",
  "assistant.turn.complete",
  "assistant.turn.completed",
  "session.complete",
  "session.completed",
  "session.end",
  "task.complete",
  "turn.complete",
]);
const GOOGLE_AUTH_FAILURE =
  /\b(?:401|403)\b|unauthorized|authentication (?:expired|invalid|required)|permission denied|insufficient(?:file)?permissions|does not have permission/i;
const PROVIDER_HALT =
  /authentication required|not authenticated|unauthorized|\b401\b|rate limit|quota|billing limit|premium request limit/i;
const INVALID_RUN_ERROR =
  /invalid steps|unknown (?:kind|property|doc alias)|missing required|must set exactly one|set exactly one of/i;
const REFUSAL_ERROR = /^\s*Refused:/im;
const SECRET_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY)/i;

/** Parses the supported command-line interface without invoking any clients. */
export function evalOptionsParse(argv: string[]): EvalCliOptions {
  const armRoots: Partial<Record<EvalArmName, string>> = {};
  const caseIds: string[] = [];
  let keepDocs = false;
  let model: string = EVAL_DEFAULTS.model;
  let reasoningEffort: string = EVAL_DEFAULTS.reasoningEffort;
  let runs: number = EVAL_DEFAULTS.runs;

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--keep-docs") {
      keepDocs = true;
      continue;
    }
    if (flag === "--arm") {
      const value = argv[++index];
      if (!value) throw new Error("--arm needs v1=<absolute path> or v2=<absolute path>");
      const separator = value.indexOf("=");
      const name = value.slice(0, separator);
      const root = value.slice(separator + 1);
      if ((name !== "v1" && name !== "v2") || separator < 0 || !root || !isAbsolute(root)) {
        throw new Error(
          `invalid --arm value ${JSON.stringify(value)}; expected v1=<absolute path> or v2=<absolute path>`,
        );
      }
      if (armRoots[name]) throw new Error(`--arm ${name} was supplied more than once`);
      armRoots[name] = resolve(root);
      continue;
    }
    if (flag === "--case") {
      let added = 0;
      while (argv[index + 1] && !argv[index + 1]?.startsWith("--")) {
        const value = argv[++index];
        if (value) caseIds.push(value);
        added++;
      }
      if (added === 0) throw new Error("--case needs one or more case IDs");
      continue;
    }
    if (flag === "--runs" || flag === "--model" || flag === "--reasoning-effort") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      if (flag === "--runs") {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("--runs must be a positive integer");
        runs = parsed;
      } else if (flag === "--model") {
        model = value;
      } else {
        reasoningEffort = value;
      }
      continue;
    }
    if (flag?.startsWith("--")) throw new Error(`unknown option ${flag}`);
    throw new Error(`unexpected argument ${JSON.stringify(flag)}`);
  }

  if (!armRoots.v1 || !armRoots.v2)
    throw new Error("both --arm v1=<absolute path> and --arm v2=<absolute path> are required");
  if (new Set(caseIds).size !== caseIds.length) throw new Error("--case IDs must be unique");
  return {
    armRoots: { v1: armRoots.v1, v2: armRoots.v2 },
    caseIds,
    keepDocs,
    model,
    reasoningEffort,
    runs,
  };
}

/** Inspects a committed arm and hashes the exact bundle and skill used. */
export function evalArmInspect(name: EvalArmName, rootPath: string): EvalArm {
  const root = resolve(rootPath);
  const bundlePath = join(root, "scripts", "mcp.mjs");
  const skillPath = join(root, "skills", "gdocsmith", "SKILL.md");
  if (!existsSync(bundlePath)) throw new Error(`${name} arm is missing scripts/mcp.mjs: ${root}`);
  if (!existsSync(skillPath)) throw new Error(`${name} arm is missing skills/gdocsmith/SKILL.md: ${root}`);

  let revision: string;
  try {
    revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`${name} arm must be a Git worktree: ${root}`);
  }
  if (!revision) throw new Error(`${name} arm has no readable Git revision: ${root}`);

  return {
    bundlePath,
    bundleSha256: sha256File(bundlePath),
    name,
    revision,
    root,
    skillPath,
    skillSha256: sha256File(skillPath),
  };
}

/** Builds the gdocsmith skill workspace and a session-local MCP config. */
export function evalWorkspacePrepare(
  arm: EvalArm,
  workspace: string,
  sessionId: string,
): {
  configPath: string;
  mcpServerName: string;
} {
  mkdirSync(workspace, { mode: 0o700, recursive: true });
  const skillTarget = join(workspace, ".github", "skills", "gdocsmith", "SKILL.md");
  mkdirSync(dirname(skillTarget), { mode: 0o700, recursive: true });
  copyFileSync(arm.skillPath, skillTarget);

  const mcpServerName = `gdocsmith_eval_${sessionId.replaceAll("-", "").slice(0, 16)}`;
  const configPath = join(workspace, "mcp.json");
  const config = {
    mcpServers: {
      [mcpServerName]: {
        args: [arm.bundlePath, "mcp"],
        command: "node",
      },
    },
  };
  fileWritePrivate(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath, mcpServerName };
}

/** Builds a prompt with the one permitted fixture-specific suffix. */
export function evalPromptBuild(prompt: string, documentId: string): string {
  return `${prompt}\n\nThe Google Doc ID is ${documentId}. Use the gdocsmith tools. Do not ask questions; if something cannot be done safely, explain why and stop.`;
}

/** Builds exact Copilot CLI arguments for one restricted, fresh session. */
export function evalCopilotArgs(input: {
  configPath: string;
  mcpServerName: string;
  model: string;
  prompt: string;
  reasoningEffort: string;
  sessionId: string;
  sharePath: string;
  usagePath: string;
  workspace: string;
  secretEnvNames?: string[];
}): string[] {
  const allowedTools = [`${input.mcpServerName}(run)`, `${input.mcpServerName}(status)`];
  const args = [
    "--prompt",
    input.prompt,
    "--session-id",
    input.sessionId,
    "--model",
    input.model,
    "--reasoning-effort",
    input.reasoningEffort,
    "--output-format",
    "json",
    "--usage-output-file",
    input.usagePath,
    "--share",
    input.sharePath,
    "--disable-builtin-mcps",
    "--no-custom-instructions",
    "--no-ask-user",
    "--no-remote",
    "--no-remote-export",
    "--no-auto-update",
    "--no-color",
    "--add-dir",
    input.workspace,
    "--additional-mcp-config",
    `@${input.configPath}`,
    "--available-tools",
    ...allowedTools,
    "--allow-tool",
    ...allowedTools,
  ];
  if (input.secretEnvNames?.length) args.push("--secret-env-vars", ...input.secretEnvNames);
  return args;
}

/** Parses JSONL and correlates provisional Copilot tool-call events by ID. */
export function copilotJsonlParse(stdout: string, mcpServerName: string): CopilotEventSummary {
  const issues: string[] = [];
  const pending = new Map<string, { argumentsValue: unknown; toolName: string; serverName: string | null }>();
  const completed = new Set<string>();
  const unexpectedToolNames = new Set<string>();
  const modelValues = new Set<string>();
  const effortValues = new Set<string>();
  let malformedLines = 0;
  let completionObserved = false;
  let failedCalls = 0;
  let forcedCalls = 0;
  let invalidCalls = 0;
  let refusedCalls = 0;
  let runCalls = 0;

  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      malformedLines++;
      issues.push(`line ${index + 1} is not valid JSON`);
      continue;
    }
    const event = recordOf(decoded);
    if (!event) {
      malformedLines++;
      issues.push(`line ${index + 1} is not a JSON object`);
      continue;
    }

    const payload = recordOf(event.data) ?? recordOf(event.payload) ?? {};
    const data = { ...event, ...payload };
    const type = eventType(data);
    if (type && JSONL_SESSION_COMPLETE_TYPES.has(type)) completionObserved = true;
    const model = stringField(data, ["model", "effectiveModel"]);
    const effort = stringField(data, ["reasoningEffort", "reasoning_effort", "effectiveReasoningEffort"]);
    if (model) modelValues.add(model);
    if (effort) effortValues.add(effort);

    if (type && JSONL_TOOL_START_TYPES.has(type)) {
      const callId = callIdRead(data);
      const toolName = toolNameRead(data);
      const serverName = stringField(data, ["mcpServerName", "serverName", "server"]);
      if (!callId || !toolName) {
        issues.push(`line ${index + 1} has a tool start without a call ID or tool name`);
        continue;
      }
      if (pending.has(callId) || completed.has(callId)) {
        issues.push(`tool call ${callId} started more than once`);
        continue;
      }
      if (serverName && serverName !== mcpServerName) {
        issues.push(`tool call ${callId} came from unexpected MCP server ${serverName}`);
      }
      if (!evalToolIsAllowed(toolName, mcpServerName)) unexpectedToolNames.add(toolName);
      pending.set(callId, { argumentsValue: argumentValueRead(data), serverName, toolName });
      continue;
    }

    if (type && JSONL_TOOL_COMPLETE_TYPES.has(type)) {
      const callId = callIdRead(data);
      if (!callId) {
        issues.push(`line ${index + 1} has a tool completion without a call ID`);
        continue;
      }
      if (completed.has(callId)) continue;
      const started = pending.get(callId);
      if (!started) {
        issues.push(`tool call ${callId} completed without a matching start`);
        continue;
      }
      pending.delete(callId);
      completed.add(callId);
      if (!evalToolIsRun(started.toolName, mcpServerName)) continue;

      runCalls++;
      if (containsForceTrue(started.argumentsValue)) forcedCalls++;
      const result = recordOf(data.result) ?? {};
      const errorText = textExtract(data.error) || textExtract(result.error) || textExtract(result);
      const failed = data.isError === true || result.isError === true || data.error != null || result.error != null;
      if (failed) failedCalls++;
      if (failed && INVALID_RUN_ERROR.test(errorText)) invalidCalls++;
      if (failed && REFUSAL_ERROR.test(errorText)) refusedCalls++;
    }
  }

  if (pending.size) issues.push(`${pending.size} tool call(s) have no completion event`);
  if (!completionObserved) issues.push("session completion event is missing");
  if (malformedLines) issues.push(`${malformedLines} malformed JSONL record(s)`);
  if (unexpectedToolNames.size)
    issues.push(`unexpected tools were called: ${Array.from(unexpectedToolNames).sort().join(", ")}`);

  return {
    complete: issues.length === 0,
    completionObserved,
    effectiveModel: modelValues.size === 1 ? (Array.from(modelValues)[0] ?? null) : null,
    effectiveReasoningEffort: effortValues.size === 1 ? (Array.from(effortValues)[0] ?? null) : null,
    issues,
    metrics: { failedCalls, forcedCalls, invalidCalls, refusedCalls, runCalls },
    unexpectedToolNames: Array.from(unexpectedToolNames).sort(),
  };
}

/** Parses only normalized usage properties; unknown provider fields stay unavailable. */
export function copilotUsageParse(raw: string | null): CopilotUsageSummary {
  const unavailable = {
    aiCredits: null,
    cachedInputTokens: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    premiumRequests: null,
    turns: null,
  } satisfies CopilotUsageSummary["metrics"];
  if (raw === null) {
    return { costSource: null, metrics: unavailable, model: null, reasoningEffort: null, status: "missing" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { costSource: null, metrics: unavailable, model: null, reasoningEffort: null, status: "invalid" };
  }
  const value = recordOf(decoded);
  if (!value) return { costSource: null, metrics: unavailable, model: null, reasoningEffort: null, status: "invalid" };
  return {
    costSource: typeof value.costUsd === "number" ? "costUsd" : null,
    metrics: {
      aiCredits: nonnegativeNumber(value.aiCredits),
      cachedInputTokens: nonnegativeNumber(value.cachedInputTokens),
      costUsd: nonnegativeNumber(value.costUsd),
      inputTokens: nonnegativeNumber(value.inputTokens),
      outputTokens: nonnegativeNumber(value.outputTokens),
      premiumRequests: nonnegativeNumber(value.premiumRequests),
      turns: nonnegativeNumber(value.turns),
    },
    model: stringField(value, ["effectiveModel", "model"]),
    reasoningEffort: stringField(value, ["effectiveReasoningEffort", "reasoningEffort"]),
    status: "available",
  };
}

/** Builds an interleaved, strictly sequential v1/v2 case schedule. */
export function evalScheduleBuild(
  cases: EvalCase[],
  runs: number,
): Array<{ arm: EvalArmName; caseValue: EvalCase; run: number }> {
  const schedule: Array<{ arm: EvalArmName; caseValue: EvalCase; run: number }> = [];
  for (const caseValue of cases) {
    for (let run = 1; run <= runs; run++) {
      schedule.push({ arm: "v1", caseValue, run });
      schedule.push({ arm: "v2", caseValue, run });
    }
  }
  return schedule;
}

/** Executes selected evaluation cases serially and persists an auditable report. */
export async function evalRunSuite(
  options: EvalOptions,
  registeredCases: EvalCase[],
  dependencies: EvalDependencies = {},
): Promise<EvalSummary> {
  const outputSchemaVerified = dependencies.outputSchemaVerified ?? COPILOT_OUTPUT_SCHEMA_VERIFIED;
  if (!outputSchemaVerified) {
    throw new Error(
      "G6 eval sessions are disabled until the Copilot JSONL and usage schemas are confirmed in the M2 pilot",
    );
  }

  const cases = evalCasesSelect(options.caseIds, registeredCases);
  const arms: Record<EvalArmName, EvalArm> = {
    v1: evalArmInspect("v1", options.armRoots.v1),
    v2: evalArmInspect("v2", options.armRoots.v2),
  };
  const now = dependencies.now ?? (() => new Date());
  const id = dependencies.id ?? randomUUID;
  const startedAt = now().toISOString();
  const outputDirectory = dependencies.outputDirectory ?? evalOutputDirectoryCreate(now, id);
  mkdirSync(outputDirectory, { mode: 0o700, recursive: true });

  const environment = { ...(dependencies.env ?? process.env), COPILOT_AUTO_UPDATE: "false" };
  const copilotPath = dependencies.copilotPath ?? Bun.which("copilot") ?? "copilot";
  const readCliVersion = dependencies.readCliVersion ?? copilotVersionRead;
  const drive = dependencies.clients?.drive ?? gwsDrive;
  const docs = dependencies.clients?.docs ?? gws;
  let copilotVersion = "unavailable";
  let abortReason: string | null = null;
  const runs: EvalRunRecord[] = [];

  try {
    copilotVersion = readCliVersion(copilotPath, environment);
  } catch (error) {
    abortReason = `Could not read Copilot CLI version: ${errorMessage(error)}`;
  }

  let baseline: GoogleDoc | null = null;
  if (!abortReason) {
    try {
      baseline = structuredClone(await docs.getDocument(EVAL_DEFAULTS.fixtureId));
    } catch (error) {
      abortReason = googleAuthFailure(errorMessage(error))
        ? `Google Docs authorization failed while reading the source fixture: ${errorMessage(error)}`
        : `Could not read the source fixture: ${errorMessage(error)}`;
    }
  }

  if (!abortReason && baseline) {
    const schedule = evalScheduleBuild(cases, options.runs);
    for (const [index, item] of schedule.entries()) {
      const record = await evalRunOne({
        arm: arms[item.arm],
        caseValue: item.caseValue,
        cliPath: copilotPath,
        cliVersion: copilotVersion,
        dependencies,
        docs,
        drive,
        environment,
        index,
        keepDocs: options.keepDocs,
        model: options.model,
        now,
        outputDirectory,
        outputSchemaVerified,
        reasoningEffort: options.reasoningEffort,
        run: item.run,
        baseline,
      });
      runs.push(record);
      abortReason = record.haltReason ?? null;
      evalSummaryPersist({
        abortReason,
        copilotVersion,
        outputDirectory,
        outputSchemaVerified,
        requestedModel: options.model,
        requestedReasoningEffort: options.reasoningEffort,
        startedAt,
        runs,
      });
      if (abortReason) break;
    }
  }

  return evalSummaryPersist({
    abortReason,
    copilotVersion,
    outputDirectory,
    outputSchemaVerified,
    requestedModel: options.model,
    requestedReasoningEffort: options.reasoningEffort,
    startedAt,
    runs,
  });
}

/** Runs one Copilot session, verifies the resulting doc, and always cleans up. */
async function evalRunOne(input: {
  arm: EvalArm;
  baseline: GoogleDoc;
  caseValue: EvalCase;
  cliPath: string;
  cliVersion: string;
  dependencies: EvalDependencies;
  docs: DocsClient;
  drive: DriveApi;
  environment: Record<string, string | undefined>;
  index: number;
  keepDocs: boolean;
  model: string;
  now: () => Date;
  outputDirectory: string;
  outputSchemaVerified: boolean;
  reasoningEffort: string;
  run: number;
}): Promise<EvalRunRecord> {
  const started = input.now();
  const sessionId = (input.dependencies.id ?? randomUUID)();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "gdocsmith-eval-"));
  const workspace = join(workspaceRoot, "workspace");
  const prefix = `${String(input.index + 1).padStart(3, "0")}-${slug(input.caseValue.id)}-${input.arm.name}-${input.run}`;
  const stdoutPath = join(input.outputDirectory, `${prefix}.stdout.jsonl`);
  const stderrPath = join(input.outputDirectory, `${prefix}.stderr.txt`);
  const usageOutputPath = join(input.outputDirectory, `${prefix}.usage.json`);
  const transcriptOutputPath = join(input.outputDirectory, `${prefix}.session.md`);
  const usagePath = join(workspace, "usage.json");
  const transcriptPath = join(workspace, "session.md");
  let baseRecord: EvalRunRecord = {
    arm: input.arm.name,
    armRevision: input.arm.revision,
    bundleSha256: input.arm.bundleSha256,
    caseId: input.caseValue.id,
    checks: [],
    complete: false,
    completionObserved: false,
    copilotVersion: input.cliVersion,
    costSource: null,
    documentId: null,
    durationMs: null,
    effectiveModel: null,
    effectiveReasoningEffort: null,
    eventIssues: [],
    evidence: {
      mcpServerName: "unconfigured",
      sessionId,
      stderrFile: relative(input.outputDirectory, stderrPath),
      stdoutFile: relative(input.outputDirectory, stdoutPath),
      transcriptFile: null,
      unrelatedMcpServers: "user-confirmed-disabled",
      usageFile: null,
    },
    finishedAt: started.toISOString(),
    fixtureDocumentId: null,
    metrics: evalMetricsEmpty(),
    outputSchemaVerified: input.outputSchemaVerified,
    passed: false,
    requestedModel: input.model,
    requestedReasoningEffort: input.reasoningEffort,
    run: input.run,
    skillSha256: input.arm.skillSha256,
    startedAt: started.toISOString(),
    usageStatus: "missing",
  };

  let fixtureDocumentId: string | null = null;
  let transcript: string | null = null;
  let safeStdout = "";
  let elapsed = 0;
  const startedMonotonic = performance.now();
  let haltReason: string | undefined;
  const secrets = envSecretValues(input.environment);

  try {
    mkdirSync(workspace, { mode: 0o700, recursive: true });
    const title = `[EVAL] ${input.caseValue.id} ${input.arm.name} ${input.run} ${timestampSlug(started)}`;
    const copy = await input.drive.copyFile(EVAL_DEFAULTS.fixtureId, title);
    fixtureDocumentId = copy.id;
    if (!fixtureDocumentId || fixtureDocumentId === EVAL_DEFAULTS.fixtureId) {
      throw new Error("Drive copy did not return a distinct fixture ID");
    }
    baseRecord.documentId = fixtureDocumentId;
    baseRecord.fixtureDocumentId = fixtureDocumentId;

    const workspaceConfig = evalWorkspacePrepare(input.arm, workspace, sessionId);
    baseRecord.evidence.mcpServerName = workspaceConfig.mcpServerName;
    const secretEnvNames = Object.keys(input.environment).filter((name) => SECRET_ENV_NAME.test(name));
    const args = evalCopilotArgs({
      configPath: workspaceConfig.configPath,
      mcpServerName: workspaceConfig.mcpServerName,
      model: input.model,
      prompt: evalPromptBuild(input.caseValue.prompt, fixtureDocumentId),
      reasoningEffort: input.reasoningEffort,
      sessionId,
      sharePath: transcriptPath,
      usagePath,
      workspace,
      secretEnvNames,
    });

    const processResult = await (input.dependencies.spawn ?? copilotProcessRun)(input.cliPath, args, {
      cwd: workspace,
      env: input.environment,
      timeoutMs: input.dependencies.timeoutMs ?? EVAL_DEFAULTS.timeoutMs,
    });
    elapsed = Math.max(0, Math.round(performance.now() - startedMonotonic));
    safeStdout = redactSecrets(processResult.stdout, secrets);
    const safeStderr = redactSecrets(processResult.stderr, secrets);
    fileWritePrivate(stdoutPath, safeStdout);
    fileWritePrivate(stderrPath, safeStderr);
    if (existsSync(transcriptPath)) {
      transcript = redactSecrets(readFileSync(transcriptPath, "utf8"), secrets);
      fileWritePrivate(transcriptOutputPath, transcript);
      baseRecord.evidence.transcriptFile = relative(input.outputDirectory, transcriptOutputPath);
    }

    const usageRaw = existsSync(usagePath) ? redactSecrets(readFileSync(usagePath, "utf8"), secrets) : null;
    if (usageRaw !== null) {
      fileWritePrivate(usageOutputPath, usageRaw);
      baseRecord.evidence.usageFile = relative(input.outputDirectory, usageOutputPath);
    }
    const usage = copilotUsageParse(usageRaw);
    const events = copilotJsonlParse(safeStdout, workspaceConfig.mcpServerName);
    const effectiveModel = events.effectiveModel ?? usage.model;
    const effectiveEffort = events.effectiveReasoningEffort ?? usage.reasoningEffort;
    const settingsMatch = effectiveModel === input.model && effectiveEffort === input.reasoningEffort;
    const toolMetrics = input.outputSchemaVerified && events.complete ? events.metrics : evalCallMetricsUnavailable();
    baseRecord = {
      ...baseRecord,
      complete:
        !processResult.timedOut &&
        processResult.exitCode === 0 &&
        events.complete &&
        input.outputSchemaVerified &&
        settingsMatch,
      completionObserved: events.completionObserved,
      costSource: usage.costSource ? `usage.${usage.costSource}` : null,
      effectiveModel,
      effectiveReasoningEffort: effectiveEffort,
      eventIssues: events.issues,
      metrics: {
        ...toolMetrics,
        ...usage.metrics,
        durationMs: elapsed,
      } as EvalMetrics,
      usageStatus: usage.status,
    };

    const current = await input.docs.getDocument(fixtureDocumentId);
    const query =
      input.dependencies.query ??
      ((steps: GdocsmithStep[]) => runExecute({ dryRun: true, steps }, { client: input.docs, drive: input.drive }));
    baseRecord.checks = await input.caseValue.verify({
      baseline: input.baseline,
      current,
      documentId: fixtureDocumentId,
      query,
      stdout: safeStdout,
      transcript,
    });
    baseRecord.passed =
      baseRecord.complete && baseRecord.checks.length > 0 && baseRecord.checks.every((check) => check.passed);

    if (processResult.timedOut) baseRecord.error = "Copilot session exceeded the configured timeout";
    else if (processResult.exitCode !== 0) baseRecord.error = `Copilot exited with status ${processResult.exitCode}`;
    else if (!events.complete)
      baseRecord.error = "Copilot JSONL stream is incomplete or contains unmatched tool events";
    else if (!input.outputSchemaVerified)
      baseRecord.error = "Copilot output schema is provisional; this run cannot be accepted";
    else if (!settingsMatch)
      baseRecord.error = "Effective model or reasoning effort is missing or differs from the requested setting";
    else if (!baseRecord.checks.every((check) => check.passed))
      baseRecord.error = "One or more deterministic case checks failed";

    if (events.unexpectedToolNames.length)
      haltReason = "Copilot invoked a tool outside the allowed gdocsmith run/status tools";
    if (effectiveModel && effectiveModel !== input.model)
      haltReason = "Copilot effective model differs from the requested model";
    if (effectiveEffort && effectiveEffort !== input.reasoningEffort)
      haltReason = "Copilot effective reasoning effort differs from the requested effort";
    if (processResult.exitCode !== 0 && PROVIDER_HALT.test(`${safeStderr}\n${safeStdout}`)) {
      haltReason = "Copilot reported an authentication, rate-limit, or quota failure";
    }
  } catch (error) {
    const message = redactSecrets(errorMessage(error), secrets);
    baseRecord.error = message;
    if (googleAuthFailure(message)) haltReason = `Google authorization failed: ${message}`;
    baseRecord.haltReason = haltReason;
  } finally {
    if (fixtureDocumentId && input.keepDocs) {
      baseRecord.keptDocumentId = fixtureDocumentId;
    } else if (fixtureDocumentId) {
      try {
        await input.drive.deleteFile(fixtureDocumentId);
      } catch (error) {
        const message = redactSecrets(errorMessage(error), secrets);
        baseRecord.undeletedDocumentId = fixtureDocumentId;
        baseRecord.error = [baseRecord.error, `Could not delete fixture copy ${fixtureDocumentId}: ${message}`]
          .filter(Boolean)
          .join("; ");
        baseRecord.haltReason = googleAuthFailure(message)
          ? `Google authorization failed during fixture cleanup: ${message}`
          : baseRecord.haltReason;
      }
    }
    rmSync(workspaceRoot, { force: true, recursive: true });
    baseRecord.durationMs = elapsed || Math.max(0, Math.round(performance.now() - startedMonotonic));
    baseRecord.metrics.durationMs = baseRecord.durationMs;
    baseRecord.finishedAt = input.now().toISOString();
    baseRecord.haltReason = baseRecord.haltReason ?? haltReason;
    if (baseRecord.haltReason || baseRecord.undeletedDocumentId) baseRecord.passed = false;
  }

  return baseRecord;
}

/** Spawns the Copilot CLI without a shell and terminates it on timeout. */
export async function copilotProcessRun(
  command: string,
  args: string[],
  options: EvalSpawnOptions,
): Promise<EvalProcessResult> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    processStreamText(child.stdout),
    processStreamText(child.stderr),
    child.exited,
  ]);
  clearTimeout(timeout);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  return { exitCode, stderr, stdout, timedOut };
}

/** Formats the comparison report with unavailable metrics shown as n/a. */
export function evalReportMarkdown(summary: EvalSummary): string {
  const armRows = (name: EvalArmName): EvalRunRecord[] => summary.runs.filter((run) => run.arm === name);
  const metricNames: Array<keyof EvalMetrics> = [
    "runCalls",
    "failedCalls",
    "invalidCalls",
    "refusedCalls",
    "forcedCalls",
    "turns",
    "durationMs",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "aiCredits",
    "premiumRequests",
    "costUsd",
  ];
  const lines = [
    "# Gdocsmith v1 vs v2 evaluation",
    "",
    `- Started: ${summary.startedAt}`,
    `- Copilot CLI: ${summary.copilotVersion}`,
    `- Requested model: ${summary.requestedModel}`,
    `- Requested reasoning effort: ${summary.requestedReasoningEffort}`,
    `- Runtime output schema verified: ${summary.outputSchemaVerified ? "yes" : "no"}`,
    `- Status: ${summary.abortReason ? `aborted: ${summary.abortReason}` : "recorded runs below"}`,
    "",
    "Metrics show means of available numeric values only. `n/a` means no verified value was reported.",
    "",
    "## Arms",
    "",
    `| Arm | Runs | Complete | Passed | ${metricNames.join(" | ")} |`,
    `| --- | ---: | ---: | ---: | ${metricNames.map(() => "---:").join(" | ")} |`,
  ];
  for (const name of ["v1", "v2"] as const) {
    const records = armRows(name);
    const passed = records.filter((record) => record.passed).length;
    const complete = records.filter((record) => record.complete).length;
    lines.push(
      `| ${name} | ${records.length} | ${complete} | ${passed} | ${metricNames.map((metric) => metricMeanFormat(records, metric)).join(" | ")} |`,
    );
  }
  lines.push("", "## Cases", "", "| Case | Arm | Runs | Complete | Passed |", "| --- | --- | ---: | ---: | ---: |");
  const caseArmPairs = new Set(summary.runs.map((record) => `${record.caseId}\0${record.arm}`));
  for (const pair of Array.from(caseArmPairs).sort()) {
    const [caseId, arm] = pair.split("\0") as [string, EvalArmName];
    const records = summary.runs.filter((record) => record.caseId === caseId && record.arm === arm);
    lines.push(
      `| ${caseId} | ${arm} | ${records.length} | ${records.filter((record) => record.complete).length} | ${records.filter((record) => record.passed).length} |`,
    );
  }
  const undeleted = summary.runs.filter((record) => record.undeletedDocumentId);
  if (undeleted.length) {
    lines.push(
      "",
      "## Cleanup",
      "",
      ...undeleted.map(
        (record) =>
          `- Undeleted fixture ${record.undeletedDocumentId} (${record.caseId}, ${record.arm}, run ${record.run})`,
      ),
    );
  }
  lines.push("", `Raw run artifacts: ${summary.outputDirectory}`, "");
  return lines.join("\n");
}

/** Renders CLI usage without touching Copilot, Google, or a fixture. */
export function evalUsageText(): string {
  return [
    "Usage: bun scripts/eval.ts --arm v1=<dir> --arm v2=<dir> [options]",
    "Options:",
    "  --case <id...>             Select one or more task cases (default: all)",
    "  --runs <count>             Repetitions per case and arm (default: 3)",
    "  --model <name>             Same model for both arms (default: gpt-5.6-luna)",
    "  --reasoning-effort <level> Same reasoning level for both arms (default: xhigh)",
    "  --keep-docs                Retain fixture copies and report their IDs",
    "  --help                     Show this help",
    "No session or total-spend cap is imposed by this harness. Provider limits and billing apply.",
  ].join("\n");
}

/** Selects cases and reports unknown or duplicate IDs before any external calls. */
function evalCasesSelect(caseIds: string[], registeredCases: EvalCase[]): EvalCase[] {
  if (!registeredCases.length) throw new Error("No evaluation cases are registered; G6 M2 adds scripts/evalCases.ts");
  const byId = new Map(registeredCases.map((caseValue) => [caseValue.id, caseValue]));
  if (caseIds.length === 0) return registeredCases;
  const missing = caseIds.filter((caseId) => !byId.has(caseId));
  if (missing.length) throw new Error(`unknown eval case ID(s): ${missing.join(", ")}`);
  return caseIds.map((caseId) => byId.get(caseId) as EvalCase);
}

/** Persists a partial or final summary using atomic replacement. */
function evalSummaryPersist(summary: EvalSummary): EvalSummary {
  const jsonPath = join(summary.outputDirectory, "runs.json");
  atomicFileWrite(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  atomicFileWrite(join(summary.outputDirectory, "report.md"), evalReportMarkdown(summary));
  return summary;
}

/** Creates the default private output directory under the user's cache. */
function evalOutputDirectoryCreate(now: () => Date, id: () => string): string {
  const root = join(homedir(), ".cache", "gdocsmith", "evals");
  const stamp = `${timestampSlug(now())}-${id().slice(0, 8)}`;
  const directory = join(root, stamp);
  mkdirSync(directory, { mode: 0o700, recursive: true });
  return directory;
}

/** Reads the installed CLI version without starting an agent session. */
function copilotVersionRead(command: string, env: Record<string, string | undefined>): string {
  const version = execFileSync(command, ["--version"], { encoding: "utf8", env, timeout: 15_000 }).trim();
  if (!version) throw new Error("Copilot CLI returned an empty version string");
  return version;
}

/** Invokes the run registry from the executable entry point. */
async function evalMain(): Promise<void> {
  const parsed = evalOptionsParse(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(`${evalUsageText()}\n`);
    return;
  }
  const casesPath = join(import.meta.dir, "evalCases.ts");
  if (!existsSync(casesPath)) throw new Error("G6 M2 cases are not installed; no model or Google calls were made");
  const module = (await import(pathToFileURL(casesPath).href)) as { evalCases?: EvalCase[] };
  if (!module.evalCases) throw new Error("scripts/evalCases.ts does not export evalCases");
  const summary = await evalRunSuite(parsed, module.evalCases);
  process.stdout.write(`Evaluation ${summary.abortReason ? "stopped" : "recorded"}: ${summary.outputDirectory}\n`);
}

/** Writes a single run's raw and summarized evidence atomically with private permissions. */
function atomicFileWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

/** Writes private local artifacts without exposing them on stdout. */
function fileWritePrivate(path: string, contents: string): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  writeFileSync(path, contents, { mode: 0o600 });
}

/** Returns a unique nullable-metric record before any usage data is known. */
function evalMetricsEmpty(): EvalMetrics {
  return {
    aiCredits: null,
    cachedInputTokens: null,
    costUsd: null,
    durationMs: null,
    failedCalls: null,
    forcedCalls: null,
    inputTokens: null,
    invalidCalls: null,
    outputTokens: null,
    premiumRequests: null,
    refusedCalls: null,
    runCalls: null,
    turns: null,
  };
}

/** Makes event-derived call metrics unavailable when the schema is unverified. */
function evalCallMetricsUnavailable(): Pick<
  EvalMetrics,
  "failedCalls" | "forcedCalls" | "invalidCalls" | "refusedCalls" | "runCalls"
> {
  return { failedCalls: null, forcedCalls: null, invalidCalls: null, refusedCalls: null, runCalls: null };
}

/** Returns an exact event discriminator in a stable provisional spelling. */
function eventType(value: Record<string, unknown>): string | null {
  const type = stringField(value, ["type", "event", "kind"]);
  return type?.toLowerCase().replace(/[_\s]+/g, ".") ?? null;
}

/** Reads a call ID from candidate event envelope spellings. */
function callIdRead(value: Record<string, unknown>): string | null {
  const direct = stringField(value, ["callId", "toolCallId", "tool_call_id"]);
  if (direct) return direct;
  const id = value.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/** Reads the invoked tool's name from a candidate event envelope. */
function toolNameRead(value: Record<string, unknown>): string | null {
  const direct = stringField(value, ["toolName", "tool_name", "name"]);
  if (direct) return direct;
  const tool = recordOf(value.tool);
  return tool ? stringField(tool, ["name", "toolName"]) : typeof value.tool === "string" ? value.tool : null;
}

/** Reads candidate tool arguments without parsing or rewriting the original logs. */
function argumentValueRead(value: Record<string, unknown>): unknown {
  for (const key of ["arguments", "input", "params", "args"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] === "string") {
      try {
        return JSON.parse(value[key] as string) as unknown;
      } catch {
        return value[key];
      }
    }
    return value[key];
  }
  return undefined;
}

/** Checks that a tool name targets this unique MCP server's run or status tool. */
function evalToolIsAllowed(toolName: string, serverName: string): boolean {
  return evalToolIsRun(toolName, serverName) || evalToolIsStatus(toolName, serverName);
}

/** Matches gdocsmith's run tool across candidate Copilot name renderings. */
function evalToolIsRun(toolName: string, serverName: string): boolean {
  return toolNameMatches(toolName, serverName, "run");
}

/** Matches gdocsmith's status tool across candidate Copilot name renderings. */
function evalToolIsStatus(toolName: string, serverName: string): boolean {
  return toolNameMatches(toolName, serverName, "status");
}

/** Matches a bare MCP tool name or a server-qualified variant. */
function toolNameMatches(toolName: string, serverName: string, leaf: string): boolean {
  const normalized = toolName.toLowerCase();
  const server = serverName.toLowerCase();
  return (
    normalized === leaf ||
    normalized === `${server}(${leaf})` ||
    normalized === `${server}/${leaf}` ||
    normalized === `${server}_${leaf}` ||
    normalized === `mcp__${server}__${leaf}`
  );
}

/** Searches nested tool arguments for any force=true waiver. */
function containsForceTrue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForceTrue);
  const object = recordOf(value);
  if (!object) return false;
  return Object.entries(object).some(
    ([key, nested]) => (key === "force" && nested === true) || containsForceTrue(nested),
  );
}

/** Collects readable text from tool results without serializing arbitrary objects. */
function textExtract(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textExtract).filter(Boolean).join("\n");
  const object = recordOf(value);
  if (!object) return "";
  return ["error", "message", "text", "output", "result", "content"]
    .map((key) => textExtract(object[key]))
    .filter(Boolean)
    .join("\n");
}

/** Parses a positive finite numeric value without inventing defaults. */
function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Finds the first string field whose exact name is in the caller's allowlist. */
function stringField(value: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) if (typeof value[name] === "string" && value[name]) return value[name] as string;
  return null;
}

/** Narrows unknown JSON values to object records. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads a text stream from Bun.spawn, treating absent streams as empty. */
async function processStreamText(stream: ReadableStream<Uint8Array> | number | null): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream).text();
}

/** Returns available-value arithmetic mean or n/a when no values were reported. */
function metricMeanFormat(records: EvalRunRecord[], metric: keyof EvalMetrics): string {
  const values = records.map((record) => record.metrics[metric]).filter((value): value is number => value !== null);
  if (!values.length) return "n/a";
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
}

/** Reads the Git blob hash of a local file. */
function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Replaces inherited secret values before writing or classifying process output. */
function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) if (secret.length >= 8) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted;
}

/** Extracts likely secret values without recording their environment variable names. */
function envSecretValues(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && Boolean(value))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

/** Formats average values without including per-document text. */
function timestampSlug(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** Produces a bounded, path-safe output name. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "case"
  );
}

/** Returns concise error text suitable for a local run record. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Classifies the documented Google 401/403 and permission failures. */
function googleAuthFailure(message: string): boolean {
  return GOOGLE_AUTH_FAILURE.test(message);
}

if (import.meta.main) {
  evalMain().catch((error: unknown) => {
    const secrets = envSecretValues(process.env);
    process.stderr.write(`${redactSecrets(errorMessage(error), secrets)}\n`);
    process.exitCode = 1;
  });
}
