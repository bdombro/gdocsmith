/* Offline-first Claude Code agent E2E harness for gdocsmith. */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

/** Agent E2E defaults. */
export const EVAL_DEFAULTS = {
  fixtureId: "1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc",
  model: "sonnet",
  runs: 2,
  maxAgents: 40,
  timeoutMs: 600_000,
} as const;

/** Immutable metadata recorded for the checkout under test. */
export interface EvalCheckout {
  /** Absolute root path. */
  root: string;
  /** Git revision at E2E start. */
  revision: string;
  /** Absolute path to the checkout's built Node MCP bundle. */
  bundlePath: string;
  /** SHA-256 of the checkout's MCP bundle. */
  bundleSha256: string;
  /** Absolute path to the checkout's gdocsmith skill. */
  skillPath: string;
  /** SHA-256 of the checkout's skill. */
  skillSha256: string;
}

/** Parsed command-line options for an E2E run. */
export interface EvalOptions {
  /** Absolute path to the checkout under test. */
  root: string;
  /** Optional case IDs; empty selects every registered case. */
  caseIds: string[];
  /** Keep fixture copies after each run. */
  keepDocs: boolean;
  /** Run one read-only outline attempt. */
  pilot: boolean;
  /** Requested model. */
  model: string;
  /** Repetitions per selected case. */
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
  /** Raw, redacted Claude JSONL stdout. */
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
  /** Run-tool guard refusals. */
  refusedCalls: number | null;
  /** gdocsmith run-tool calls. */
  runCalls: number | null;
  /** Model turns from Claude's result. */
  turns: number | null;
}

/** Per-run files and model-session evidence. */
export interface EvalEvidence {
  /** Relative path to captured JSONL stdout. */
  stdoutFile: string;
  /** Relative path to captured stderr. */
  stderrFile: string;
  /** Claude's unique session UUID. */
  sessionId: string;
  /** Unique MCP server name configured for this run. */
  mcpServerName: string;
}

/** Normalized result for one case and repetition. */
export interface EvalRunRecord {
  /** Git revision of the checkout. */
  revision: string;
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
  /** Concise error or incomplete-run explanation. */
  error?: string;
  /** Provider, Google-auth, or isolation halt condition. */
  haltReason?: string;
  /** Whether the user's --keep-docs option retained this copy. */
  keptDocumentId?: string;
  /** Run metrics. Missing usage and unverified event metrics are null. */
  metrics: EvalMetrics;
  /** Whether all deterministic case checks passed. */
  passed: boolean;
  /** One-based repetition index. */
  run: number;
  /** Requested model. */
  requestedModel: string;
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
  /** Provider usage state. */
  usageStatus: "available" | "missing";
  /** Unmatched tool calls or malformed required events. */
  eventIssues: string[];
  /** Claude CLI version string. */
  claudeVersion: string;
  /** Run-owned fixture copy, deleted unless explicitly kept. */
  fixtureDocumentId: string | null;
}

/** Captured Claude process result. */
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

/** Process arguments passed to the injectable Claude invoker. */
export interface EvalSpawnOptions {
  /** Fresh temporary workspace. */
  cwd: string;
  /** Environment inherited by Claude. */
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
  /** Claude executable path; default to the installed CLI. */
  claudePath?: string;
  /** Output directory; default is under ~/.cache/gdocsmith/evals. */
  outputDirectory?: string;
  /** Shared launch ledger path; default is under ~/.cache/gdocsmith/evals. */
  ledgerPath?: string;
  /** Per-run Claude process invoker. */
  spawn?: (command: string, args: string[], options: EvalSpawnOptions) => Promise<EvalProcessResult>;
  /** Read-only query override for verifier tests. */
  query?: (steps: GdocsmithStep[]) => Promise<GdocsmithRunResult>;
  /** Local CLI version reader. */
  readCliVersion?: (command: string, env: Record<string, string | undefined>) => string;
  /** Test clock override. */
  now?: () => Date;
  /** Test UUID override. */
  id?: () => string;
  /** Test-only timeout override. */
  timeoutMs?: number;
  /** Test-only environment override. */
  env?: Record<string, string | undefined>;
}

/** Observed Claude Code stream event mapping. */
export interface ClaudeEventSummary {
  /** Syntactic and semantic completion. */
  complete: boolean;
  /** Whether a final result event was present. */
  completionObserved: boolean;
  /** Correlated call counts. */
  metrics: Pick<EvalMetrics, "failedCalls" | "forcedCalls" | "invalidCalls" | "refusedCalls" | "runCalls">;
  /** Effective model reported by init or assistant messages. */
  effectiveModel: string | null;
  /** Issues that make the stream incomplete. */
  issues: string[];
  /** Names of tools outside the intended run/status pair. */
  unexpectedToolNames: string[];
  /** Provider result usage. */
  usage: Pick<EvalMetrics, "cachedInputTokens" | "costUsd" | "inputTokens" | "outputTokens" | "turns">;
  /** Whether the init event advertised only the allowed MCP tools. */
  toolsIsolated: boolean;
}

/** E2E summary persisted alongside the detailed run records. */
export interface EvalSummary {
  /** Reason evaluation stopped early, if any. */
  abortReason: string | null;
  /** Claude CLI version. */
  claudeVersion: string;
  /** Number of launched agents across all invocations. */
  agentsLaunched: number;
  /** Evaluation output directory. */
  outputDirectory: string;
  /** Requested model. */
  requestedModel: string;
  /** Start timestamp in ISO format. */
  startedAt: string;
  /** Per-run outcomes. */
  runs: EvalRunRecord[];
}

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
  let root: string | undefined;
  const caseIds: string[] = [];
  let keepDocs = false;
  let pilot = false;
  const model: string = EVAL_DEFAULTS.model;
  let runs: number = EVAL_DEFAULTS.runs;

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--keep-docs") {
      keepDocs = true;
      continue;
    }
    if (flag === "--pilot") {
      pilot = true;
      continue;
    }
    if (flag === "--root") {
      const value = argv[++index];
      if (root) throw new Error("--root was supplied more than once");
      if (!value || !isAbsolute(value)) throw new Error("--root needs an absolute path");
      root = resolve(value);
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
    if (flag === "--runs") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("--runs must be a positive integer");
      runs = parsed;
      continue;
    }
    if (flag?.startsWith("--")) throw new Error(`unknown option ${flag}`);
    throw new Error(`unexpected argument ${JSON.stringify(flag)}`);
  }

  if (!root) throw new Error("--root <absolute path> is required");
  if (new Set(caseIds).size !== caseIds.length) throw new Error("--case IDs must be unique");
  if (runs * (caseIds.length || 10) > EVAL_DEFAULTS.maxAgents)
    throw new Error(`requested matrix exceeds ${EVAL_DEFAULTS.maxAgents} headless Claude agents`);
  if (pilot && (runs !== 1 || caseIds.length !== 1 || caseIds[0] !== "outline-headings")) {
    throw new Error("--pilot requires exactly --case outline-headings and --runs 1");
  }
  return {
    caseIds,
    keepDocs,
    model,
    pilot,
    root,
    runs,
  };
}

/** Inspects a checkout and hashes the exact bundle and skill used. */
export function evalCheckoutInspect(rootPath: string): EvalCheckout {
  const root = resolve(rootPath);
  const bundlePath = join(root, "scripts", "mcp.mjs");
  const skillPath = join(root, "skills", "gdocsmith", "SKILL.md");
  if (!existsSync(bundlePath)) throw new Error(`checkout is missing scripts/mcp.mjs: ${root}`);
  if (!existsSync(skillPath)) throw new Error(`checkout is missing skills/gdocsmith/SKILL.md: ${root}`);

  let revision: string;
  try {
    revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`checkout must be a Git worktree: ${root}`);
  }
  if (!revision) throw new Error(`checkout has no readable Git revision: ${root}`);

  return {
    bundlePath,
    bundleSha256: sha256File(bundlePath),
    revision,
    root,
    skillPath,
    skillSha256: sha256File(skillPath),
  };
}

/** Builds the gdocsmith skill workspace and a session-local MCP config. */
export function evalWorkspacePrepare(
  checkout: EvalCheckout,
  workspace: string,
  sessionId: string,
): {
  configPath: string;
  mcpServerName: string;
} {
  mkdirSync(workspace, { mode: 0o700, recursive: true });
  const skillTarget = join(workspace, ".claude", "skills", "gdocsmith", "SKILL.md");
  mkdirSync(dirname(skillTarget), { mode: 0o700, recursive: true });
  copyFileSync(checkout.skillPath, skillTarget);

  const mcpServerName = `gdocsmith_eval_${sessionId.replaceAll("-", "").slice(0, 16)}`;
  const configPath = join(workspace, "mcp.json");
  const config = {
    mcpServers: {
      [mcpServerName]: {
        args: [checkout.bundlePath, "mcp"],
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

/** Builds exact Claude CLI arguments for one restricted, fresh session. */
export function evalClaudeArgs(input: {
  configPath: string;
  mcpServerName: string;
  model: string;
  prompt: string;
  sessionId: string;
  skill: string;
}): string[] {
  return [
    "--print",
    "--session-id",
    input.sessionId,
    "--model",
    input.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    input.configPath,
    "--tools",
    "",
    "--allowedTools",
    `mcp__${input.mcpServerName}__run,mcp__${input.mcpServerName}__status`,
    "--permission-mode",
    "dontAsk",
    "--append-system-prompt",
    `Use only the following gdocsmith skill for this task:\n\n${input.skill}`,
    input.prompt,
  ];
}

/** Parses Claude stream JSONL and correlates MCP tool_use and tool_result blocks. */
export function claudeJsonlParse(stdout: string, mcpServerName: string): ClaudeEventSummary {
  const issues: string[] = [];
  const pending = new Map<string, { argumentsValue: unknown; toolName: string }>();
  const completed = new Set<string>();
  const unexpectedToolNames = new Set<string>();
  const modelValues = new Set<string>();
  let assistantModel: string | null = null;
  const usage: ClaudeEventSummary["usage"] = {
    cachedInputTokens: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    turns: null,
  };
  let initObserved = false;
  let toolsIsolated = false;
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
      issues.push(`line ${index + 1} is not valid JSON`);
      continue;
    }
    const event = recordOf(decoded);
    if (!event) {
      issues.push(`line ${index + 1} is not a JSON object`);
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      initObserved = true;
      const tools = event.tools;
      const servers = event.mcp_servers;
      toolsIsolated =
        Array.isArray(tools) &&
        tools.every((tool) => typeof tool === "string" && evalToolIsAllowed(tool, mcpServerName)) &&
        Array.isArray(servers) &&
        servers.length === 1 &&
        recordOf(servers[0])?.name === mcpServerName &&
        recordOf(servers[0])?.status === "connected";
      if (!toolsIsolated) issues.push("init did not confirm exclusive gdocsmith tools and connected server");
      const model = stringField(event, ["model"]);
      if (model) modelValues.add(model);
    }
    if (event.type === "assistant") {
      const message = recordOf(event.message);
      const model = message && stringField(message, ["model"]);
      if (model) {
        modelValues.add(model);
        assistantModel = model;
      }
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const tool = recordOf(block);
        if (tool?.type !== "tool_use") continue;
        const callId = stringField(tool, ["id"]);
        const toolName = stringField(tool, ["name"]);
        if (!callId || !toolName || pending.has(callId) || completed.has(callId)) {
          issues.push(`line ${index + 1} has an invalid or duplicate tool use`);
          continue;
        }
        if (!evalToolIsAllowed(toolName, mcpServerName)) unexpectedToolNames.add(toolName);
        pending.set(callId, { argumentsValue: tool.input, toolName });
      }
    }
    if (event.type === "user") {
      const content = recordOf(event.message)?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const result = recordOf(block);
        if (result?.type !== "tool_result") continue;
        const callId = stringField(result, ["tool_use_id"]);
        if (!callId || !pending.has(callId)) {
          if (!callId || !completed.has(callId)) issues.push(`line ${index + 1} has an unmatched tool result`);
          continue;
        }
        const started = pending.get(callId)!;
        pending.delete(callId);
        completed.add(callId);
        if (!evalToolIsRun(started.toolName, mcpServerName)) continue;
        runCalls++;
        if (containsForceTrue(started.argumentsValue)) forcedCalls++;
        const text = textExtract(result.content);
        const failed = result.is_error === true || INVALID_RUN_ERROR.test(text) || REFUSAL_ERROR.test(text);
        if (failed) failedCalls++;
        if (failed && INVALID_RUN_ERROR.test(text)) invalidCalls++;
        if (REFUSAL_ERROR.test(text)) refusedCalls++;
      }
    }
    if (event.type === "result") {
      completionObserved = true;
      if (event.is_error === true || event.subtype !== "success") issues.push("Claude result reported an error");
      const stats = recordOf(event.usage);
      const inputTokens = nonnegativeNumber(stats?.input_tokens);
      const cacheRead = nonnegativeNumber(stats?.cache_read_input_tokens);
      const cacheCreated = nonnegativeNumber(stats?.cache_creation_input_tokens);
      usage.inputTokens = inputTokens === null ? null : inputTokens + (cacheRead ?? 0) + (cacheCreated ?? 0);
      usage.cachedInputTokens = cacheRead;
      usage.outputTokens = nonnegativeNumber(stats?.output_tokens);
      usage.turns = nonnegativeNumber(event.num_turns);
      usage.costUsd = nonnegativeNumber(event.total_cost_usd);
    }
  }

  if (!initObserved) issues.push("Claude init event is missing");
  if (Array.from(modelValues).some((model) => model !== "sonnet" && !/^claude-sonnet-/i.test(model)))
    issues.push("a non-Sonnet model appeared in the stream");
  if (pending.size) issues.push(`${pending.size} tool call(s) have no completion event`);
  if (!completionObserved) issues.push("Claude result event is missing");
  if (unexpectedToolNames.size)
    issues.push(`unexpected tools were called: ${Array.from(unexpectedToolNames).sort().join(", ")}`);

  return {
    complete: issues.length === 0,
    completionObserved,
    effectiveModel: assistantModel ?? (modelValues.size === 1 ? (Array.from(modelValues)[0] ?? null) : null),
    issues,
    metrics: { failedCalls, forcedCalls, invalidCalls, refusedCalls, runCalls },
    unexpectedToolNames: Array.from(unexpectedToolNames).sort(),
    usage,
    toolsIsolated,
  };
}

/** Builds a strictly sequential schedule for the selected cases. */
export function evalScheduleBuild(cases: EvalCase[], runs: number): Array<{ caseValue: EvalCase; run: number }> {
  const schedule: Array<{ caseValue: EvalCase; run: number }> = [];
  for (let run = 1; run <= runs; run++) {
    for (const caseValue of cases) schedule.push({ caseValue, run });
  }
  return schedule;
}

/** Executes selected evaluation cases serially and persists an auditable report. */
export async function evalRunSuite(
  options: EvalOptions,
  registeredCases: EvalCase[],
  dependencies: EvalDependencies = {},
): Promise<EvalSummary> {
  if (
    options.pilot &&
    (options.runs !== 1 || options.caseIds.length !== 1 || options.caseIds[0] !== "outline-headings")
  ) {
    throw new Error("--pilot requires exactly --case outline-headings and --runs 1");
  }

  const cases = evalCasesSelect(options.caseIds, registeredCases);
  if (cases.length * options.runs > EVAL_DEFAULTS.maxAgents)
    throw new Error(`requested matrix exceeds ${EVAL_DEFAULTS.maxAgents} headless Claude agents`);
  const checkout = evalCheckoutInspect(options.root);
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const cacheRoot = join(homedir(), ".cache", "gdocsmith", "evals");
  const outputDirectory =
    dependencies.outputDirectory ??
    join(cacheRoot, `run-${startedAt.replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`);
  const ledgerPath = dependencies.ledgerPath ?? join(outputDirectory, "launches");
  mkdirSync(outputDirectory, { mode: 0o700, recursive: true });
  mkdirSync(ledgerPath, { mode: 0o700, recursive: true });
  const lockPath = join(ledgerPath, "active.lock");
  mkdirSync(lockPath);

  const environment = { ...(dependencies.env ?? process.env) };
  const claudePath = dependencies.claudePath ?? Bun.which("claude") ?? "claude";
  const readCliVersion = dependencies.readCliVersion ?? claudeVersionRead;
  const drive = dependencies.clients?.drive ?? gwsDrive;
  const docs = dependencies.clients?.docs ?? gws;
  let claudeVersion = "unavailable";
  let abortReason: string | null = null;
  try {
    const slots = readdirSync(ledgerPath)
      .filter((name) => /^\d{3}$/.test(name))
      .sort();
    const runs: EvalRunRecord[] = slots.flatMap((name) => {
      const recordPath = join(ledgerPath, name, "record.json");
      return existsSync(recordPath) ? [JSON.parse(readFileSync(recordPath, "utf8")) as EvalRunRecord] : [];
    });
    if (slots.length !== runs.length) abortReason = "Launch ledger has an unrecorded agent; audit before proceeding";
    const summarize = (): EvalSummary =>
      evalSummaryPersist({
        abortReason,
        agentsLaunched: readdirSync(ledgerPath).filter((name) => /^\d{3}$/.test(name)).length,
        claudeVersion,
        outputDirectory,
        requestedModel: options.model,
        startedAt,
        runs,
      });

    if (!abortReason) {
      try {
        claudeVersion = readCliVersion(claudePath, environment);
      } catch (error) {
        abortReason = `Could not read Claude CLI version: ${errorMessage(error)}`;
      }
    }
    let baseline: GoogleDoc | null = null;
    if (!abortReason) {
      try {
        baseline = structuredClone(await docs.getDocument(EVAL_DEFAULTS.fixtureId));
      } catch (error) {
        abortReason = `Could not read the source fixture: ${errorMessage(error)}`;
      }
    }
    if (!abortReason && baseline) {
      const schedule = evalScheduleBuild(cases, options.runs);
      for (const item of schedule) {
        if (runs.some((record) => record.caseId === item.caseValue.id && record.run === item.run)) continue;
        const slotNumber = readdirSync(ledgerPath).filter((name) => /^\d{3}$/.test(name)).length + 1;
        if (slotNumber > EVAL_DEFAULTS.maxAgents) {
          abortReason = `Reached the ${EVAL_DEFAULTS.maxAgents}-agent launch limit`;
          break;
        }
        const slotPath = join(ledgerPath, String(slotNumber).padStart(3, "0"));
        const record = await evalRunOne({
          baseline,
          caseValue: item.caseValue,
          cliPath: claudePath,
          cliVersion: claudeVersion,
          checkout,
          dependencies,
          docs,
          drive,
          environment,
          index: slotNumber - 1,
          keepDocs: options.keepDocs,
          model: options.model,
          now,
          outputDirectory,
          run: item.run,
          reserve: () => {
            mkdirSync(slotPath);
            fileWritePrivate(
              join(slotPath, "launch.json"),
              `${JSON.stringify({ caseId: item.caseValue.id, run: item.run, startedAt: now().toISOString() })}\n`,
            );
          },
        });
        if (existsSync(slotPath))
          atomicFileWrite(join(slotPath, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
        runs.push(record);
        abortReason = record.haltReason ?? null;
        summarize();
        if (abortReason) break;
      }
    }
    return summarize();
  } finally {
    rmSync(lockPath, { recursive: true });
  }
}

/** Runs one Claude session, verifies the resulting doc, and always cleans up. */
async function evalRunOne(input: {
  baseline: GoogleDoc;
  caseValue: EvalCase;
  cliPath: string;
  cliVersion: string;
  checkout: EvalCheckout;
  dependencies: EvalDependencies;
  docs: DocsClient;
  drive: DriveApi;
  environment: Record<string, string | undefined>;
  index: number;
  keepDocs: boolean;
  model: string;
  now: () => Date;
  outputDirectory: string;
  run: number;
  reserve: () => void;
}): Promise<EvalRunRecord> {
  const started = input.now();
  const sessionId = (input.dependencies.id ?? randomUUID)();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "gdocsmith-eval-"));
  const workspace = join(workspaceRoot, "workspace");
  const prefix = `${String(input.index + 1).padStart(3, "0")}-${slug(input.caseValue.id)}-${input.run}`;
  const stdoutPath = join(input.outputDirectory, `${prefix}.stdout.jsonl`);
  const stderrPath = join(input.outputDirectory, `${prefix}.stderr.txt`);
  let baseRecord: EvalRunRecord = {
    revision: input.checkout.revision,
    bundleSha256: input.checkout.bundleSha256,
    caseId: input.caseValue.id,
    checks: [],
    complete: false,
    completionObserved: false,
    claudeVersion: input.cliVersion,
    costSource: null,
    documentId: null,
    durationMs: null,
    effectiveModel: null,
    eventIssues: [],
    evidence: {
      mcpServerName: "unconfigured",
      sessionId,
      stderrFile: relative(input.outputDirectory, stderrPath),
      stdoutFile: relative(input.outputDirectory, stdoutPath),
    },
    finishedAt: started.toISOString(),
    fixtureDocumentId: null,
    metrics: evalMetricsEmpty(),
    passed: false,
    requestedModel: input.model,
    run: input.run,
    skillSha256: input.checkout.skillSha256,
    startedAt: started.toISOString(),
    usageStatus: "missing",
  };

  let fixtureDocumentId: string | null = null;
  let transcript: string | null = null;
  let safeStdout = "";
  let elapsed = 0;
  const startedMonotonic = performance.now();
  let haltReason: string | undefined;
  let launched = false;
  const secrets = envSecretValues(input.environment);

  try {
    mkdirSync(workspace, { mode: 0o700, recursive: true });
    const title = `[E2E] ${input.caseValue.id} ${input.run} ${timestampSlug(started)}`;
    const copy = await input.drive.copyFile(EVAL_DEFAULTS.fixtureId, title);
    fixtureDocumentId = copy.id;
    if (!fixtureDocumentId || fixtureDocumentId === EVAL_DEFAULTS.fixtureId) {
      throw new Error("Drive copy did not return a distinct fixture ID");
    }
    baseRecord.documentId = fixtureDocumentId;
    baseRecord.fixtureDocumentId = fixtureDocumentId;

    const workspaceConfig = evalWorkspacePrepare(input.checkout, workspace, sessionId);
    baseRecord.evidence.mcpServerName = workspaceConfig.mcpServerName;
    const args = evalClaudeArgs({
      configPath: workspaceConfig.configPath,
      mcpServerName: workspaceConfig.mcpServerName,
      model: input.model,
      prompt: evalPromptBuild(input.caseValue.prompt, fixtureDocumentId),
      sessionId,
      skill: readFileSync(input.checkout.skillPath, "utf8"),
    });

    input.reserve();
    launched = true;
    const processResult = await (input.dependencies.spawn ?? claudeProcessRun)(input.cliPath, args, {
      cwd: workspace,
      env: input.environment,
      timeoutMs: input.dependencies.timeoutMs ?? EVAL_DEFAULTS.timeoutMs,
    });
    elapsed = Math.max(0, Math.round(performance.now() - startedMonotonic));
    safeStdout = redactSecrets(processResult.stdout, secrets);
    const safeStderr = redactSecrets(processResult.stderr, secrets);
    fileWritePrivate(stdoutPath, safeStdout);
    fileWritePrivate(stderrPath, safeStderr);
    const events = claudeJsonlParse(safeStdout, workspaceConfig.mcpServerName);
    const effectiveModel = events.effectiveModel;
    const settingsMatch = effectiveModel !== null && /^claude-sonnet-/i.test(effectiveModel);
    const toolMetrics = events.complete ? events.metrics : evalCallMetricsUnavailable();
    transcript = safeStdout;
    baseRecord = {
      ...baseRecord,
      complete:
        !processResult.timedOut &&
        processResult.exitCode === 0 &&
        events.complete &&
        settingsMatch &&
        events.toolsIsolated,
      completionObserved: events.completionObserved,
      costSource: events.usage.costUsd === null ? null : "result.total_cost_usd",
      effectiveModel,
      eventIssues: events.issues,
      metrics: {
        ...toolMetrics,
        ...events.usage,
        durationMs: elapsed,
      } as EvalMetrics,
      usageStatus: events.usage.inputTokens === null ? "missing" : "available",
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

    if (processResult.timedOut) baseRecord.error = "Claude session exceeded the configured timeout";
    else if (processResult.exitCode !== 0) baseRecord.error = `Claude exited with status ${processResult.exitCode}`;
    else if (!events.complete) baseRecord.error = "Claude stream is incomplete or contains unmatched tool events";
    else if (!settingsMatch) baseRecord.error = "Effective model is missing or is not Sonnet";
    else if (!baseRecord.checks.every((check) => check.passed))
      baseRecord.error = "One or more deterministic case checks failed";

    if (events.unexpectedToolNames.length)
      haltReason = "Claude invoked a tool outside the allowed gdocsmith run/status tools";
    if (!events.toolsIsolated || !events.complete || !settingsMatch)
      haltReason = "Claude model, event schema, or tool isolation could not be confirmed";
    if (input.caseValue.id === "outline-headings" && events.metrics.runCalls === 0)
      haltReason = "Read-only pilot did not call the selected gdocsmith run tool";
    if (processResult.exitCode !== 0 && PROVIDER_HALT.test(`${safeStderr}\n${safeStdout}`)) {
      haltReason = "Claude reported an authentication, rate-limit, or quota failure";
    }
  } catch (error) {
    const message = redactSecrets(errorMessage(error), secrets);
    baseRecord.error = message;
    haltReason = googleAuthFailure(message)
      ? `Google authorization failed: ${message}`
      : launched
        ? `Claude launch or verification failed: ${message}`
        : `Evaluation setup failed: ${message}`;
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
        baseRecord.haltReason = `Could not clean up fixture copy: ${message}`;
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

/** Spawns the Claude CLI without a shell and terminates it on timeout. */
export async function claudeProcessRun(
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

/** Formats the scenario report with unavailable metrics shown as n/a. */
export function evalReportMarkdown(summary: EvalSummary): string {
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
    "costUsd",
  ];
  const lines = [
    "# Gdocsmith agent E2E",
    "",
    `- Started: ${summary.startedAt}`,
    `- Claude CLI: ${summary.claudeVersion}`,
    `- Requested model: ${summary.requestedModel}`,
    `- Agents launched: ${summary.agentsLaunched}/${EVAL_DEFAULTS.maxAgents}`,
    `- Status: ${summary.abortReason ? `aborted: ${summary.abortReason}` : "recorded runs below"}`,
    "",
    "Metrics show means of available numeric values only. `n/a` means no verified value was reported.",
    "",
    "## Summary",
    "",
    `| Runs | Complete | Passed | ${metricNames.join(" | ")} |`,
    `| ---: | ---: | ---: | ${metricNames.map(() => "---:").join(" | ")} |`,
  ];
  const records = summary.runs;
  lines.push(
    `| ${records.length} | ${records.filter((record) => record.complete).length} | ${records.filter((record) => record.passed).length} | ${metricNames.map((metric) => metricMeanFormat(records, metric)).join(" | ")} |`,
  );
  lines.push(
    "",
    "## Cases",
    "",
    "| Case | Runs | Complete | Passed | Pass rate |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const caseId of Array.from(new Set(summary.runs.map((record) => record.caseId))).sort()) {
    const caseRecords = summary.runs.filter((record) => record.caseId === caseId);
    const passed = caseRecords.filter((record) => record.passed).length;
    lines.push(
      `| ${caseId} | ${caseRecords.length} | ${caseRecords.filter((record) => record.complete).length} | ${passed} | ${((passed / caseRecords.length) * 100).toFixed(0)}% |`,
    );
  }
  lines.push("", "## Scenario checks", "");
  for (const record of summary.runs) {
    lines.push(
      `- ${record.caseId} (run ${record.run}): ${record.complete ? (record.passed ? "passed" : "failed") : "incomplete"}`,
    );
    for (const check of record.checks) lines.push(`  - ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
    if (record.error) lines.push(`  - Error: ${record.error}`);
    lines.push(`  - Transcript: ${record.evidence.stdoutFile}`);
  }
  const undeleted = summary.runs.filter((record) => record.undeletedDocumentId);
  if (undeleted.length) {
    lines.push(
      "",
      "## Cleanup",
      "",
      ...undeleted.map(
        (record) => `- Undeleted fixture ${record.undeletedDocumentId} (${record.caseId}, run ${record.run})`,
      ),
    );
  }
  lines.push("", `Raw run artifacts: ${summary.outputDirectory}`, "");
  return lines.join("\n");
}

/** Renders CLI usage without touching Claude, Google, or a fixture. */
export function evalUsageText(): string {
  return [
    "Usage: bun scripts/eval.ts --root <absolute path> [options]",
    "Options:",
    "  --case <id...>             Select one or more task cases (default: all)",
    "  --runs <count>             Repetitions per case (default: 2)",
    "  --pilot                    Run one read-only outline attempt",
    "  --keep-docs                Retain fixture copies and report their IDs",
    "  --help                     Show this help",
    "Sonnet is pinned; at most 40 launches per invocation.",
  ].join("\n");
}

/** Selects cases and reports unknown or duplicate IDs before any external calls. */
function evalCasesSelect(caseIds: string[], registeredCases: EvalCase[]): EvalCase[] {
  if (!registeredCases.length) throw new Error("No agent E2E cases are registered in scripts/evalCases.ts");
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

/** Reads the installed CLI version without starting an agent session. */
function claudeVersionRead(command: string, env: Record<string, string | undefined>): string {
  const version = execFileSync(command, ["--version"], { encoding: "utf8", env, timeout: 15_000 }).trim();
  if (!version) throw new Error("Claude CLI returned an empty version string");
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
  if (!existsSync(casesPath)) throw new Error("Agent E2E cases are not installed; no model or Google calls were made");
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
    cachedInputTokens: null,
    costUsd: null,
    durationMs: null,
    failedCalls: null,
    forcedCalls: null,
    inputTokens: null,
    invalidCalls: null,
    outputTokens: null,
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

/** Checks that a tool name targets this unique MCP server's run or status tool. */
function evalToolIsAllowed(toolName: string, serverName: string): boolean {
  return evalToolIsRun(toolName, serverName) || evalToolIsStatus(toolName, serverName);
}

/** Matches gdocsmith's run tool across Claude MCP name renderings. */
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
