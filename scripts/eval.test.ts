/* Offline tests for the Claude agent E2E harness. */

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsClient, DriveApi } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import {
  claudeJsonlParse,
  claudeProcessRun,
  type EvalCase,
  type EvalDependencies,
  type EvalOptions,
  evalOptionsParse,
  evalRunSuite,
} from "./eval.ts";
import { evalCases } from "./evalCases.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("agent E2E cases", () => {
  test("registers all ten unique natural-language scenarios", () => {
    expect(evalCases.map((caseValue) => caseValue.id)).toEqual([
      "outline-headings",
      "placeholder-fill",
      "section-rewrite",
      "find-replace",
      "copy-section",
      "table-row",
      "new-tab",
      "style-cleanup",
      "guard-respect",
      "pageless",
    ]);
    expect(new Set(evalCases.map((caseValue) => caseValue.id)).size).toBe(10);
    expect(evalCases.every((caseValue) => caseValue.prompt.trim().length > 40)).toBe(true);
    expect(evalCases.find((caseValue) => caseValue.id === "guard-respect")?.prompt).not.toMatch(/\bforce\b/i);
  });
});

describe("eval options", () => {
  test("pins Sonnet with a two-run default", () => {
    const options = evalOptionsParse(["--root", "/tmp/checkout"]);
    expect(options).toMatchObject({
      caseIds: [],
      keepDocs: false,
      model: "sonnet",
      root: "/tmp/checkout",
      runs: 2,
      pilot: false,
    });
  });

  test("accepts selected agent E2E cases", () => {
    const options = evalOptionsParse(["--root", "/tmp/checkout", "--case", "placeholder-fill", "--runs", "1"]);
    expect(options).toMatchObject({
      caseIds: ["placeholder-fill"],
      runs: 1,
    });
  });

  test("accepts repeated cases and keep-docs", () => {
    const options = evalOptionsParse([
      "--root",
      "/tmp/checkout",
      "--case",
      "outline-headings",
      "guard-respect",
      "--runs",
      "1",
      "--keep-docs",
    ]);
    expect(options).toMatchObject({
      caseIds: ["outline-headings", "guard-respect"],
      keepDocs: true,
      pilot: false,
      runs: 1,
    });
  });

  test("accepts a single outlined pilot only", () => {
    const options = evalOptionsParse([
      "--root",
      "/tmp/checkout",
      "--case",
      "outline-headings",
      "--runs",
      "1",
      "--pilot",
    ]);
    expect(options).toMatchObject({ caseIds: ["outline-headings"], pilot: true, runs: 1 });
  });

  test("rejects missing or duplicate roots, invalid runs, and excess launches", () => {
    expect(() => evalOptionsParse([])).toThrow("--root <absolute path>");
    expect(() => evalOptionsParse(["--root", "relative"])).toThrow("absolute path");
    expect(() => evalOptionsParse(["--root", "/tmp/a", "--root", "/tmp/b"])).toThrow("supplied more than once");
    expect(() => evalOptionsParse(["--root", "/tmp/a", "--runs", "0"])).toThrow("positive integer");
    expect(() => evalOptionsParse(["--root", "/tmp/a", "--max-ai-credits", "1"])).toThrow(
      "unknown option --max-ai-credits",
    );
    expect(() => evalOptionsParse(["--root", "/tmp/a", "--model", "opus"])).toThrow("unknown option --model");
    expect(() => evalOptionsParse(["--root", "/tmp/a", "--runs", "5"])).toThrow("exceeds 40 headless Claude agents");
    expect(() =>
      evalOptionsParse(["--root", "/tmp/checkout", "--pilot", "--case", "guard-respect", "--runs", "1"]),
    ).toThrow("--pilot requires exactly --case outline-headings and --runs 1");
  });
});

describe("Claude output parsing", () => {
  test("correlates tool calls once and classifies errors, refusals, and nested force", () => {
    const serverName = "gdocsmith_eval_1234567890abcdef";
    const events = [
      {
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-6",
        tools: [`mcp__${serverName}__run`, `mcp__${serverName}__status`],
        mcp_servers: [{ name: serverName, status: "connected" }],
      },
      {
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          content: [
            { type: "tool_use", id: "r1", name: `mcp__${serverName}__run`, input: { steps: [{ force: true }] } },
            { type: "tool_use", id: "s1", name: `mcp__${serverName}__status`, input: {} },
            { type: "tool_use", id: "r2", name: `mcp__${serverName}__run`, input: { steps: [{}] } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "r1",
              is_error: true,
              content: 'Invalid steps (1): unknown property "markdwn"',
            },
            { type: "tool_result", tool_use_id: "s1", content: "version=2.0.0" },
            { type: "tool_result", tool_use_id: "r2", content: "Refused: Nothing was sent." },
          ],
        },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        total_cost_usd: 0.04,
        num_turns: 2,
        usage: { input_tokens: 100, cache_read_input_tokens: 25, cache_creation_input_tokens: 10, output_tokens: 30 },
      },
    ];

    const parsed = claudeJsonlParse(events.map((event) => JSON.stringify(event)).join("\n"), serverName);

    expect(parsed.complete).toBe(true);
    expect(parsed.completionObserved).toBe(true);
    expect(parsed.metrics).toEqual({ failedCalls: 2, forcedCalls: 1, invalidCalls: 1, refusedCalls: 1, runCalls: 2 });
    expect(parsed.effectiveModel).toBe("claude-sonnet-4-6");
    expect(parsed.toolsIsolated).toBe(true);
    expect(parsed.usage).toEqual({
      cachedInputTokens: 25,
      costUsd: 0.04,
      inputTokens: 135,
      outputTokens: 30,
      turns: 2,
    });
  });

  test("marks malformed JSONL, unmatched calls, missing completion, and unexpected tools incomplete", () => {
    const serverName = "gdocsmith_eval_1234567890abcdef";
    const stdout = [
      "not-json",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "x1", name: "Bash", input: {} }] },
      }),
    ].join("\n");
    const parsed = claudeJsonlParse(stdout, serverName);
    expect(parsed.complete).toBe(false);
    expect(parsed.metrics.runCalls).toBe(0);
    expect(parsed.issues.join(" ")).toContain("result event is missing");
    expect(parsed.unexpectedToolNames).toEqual(["Bash"]);
    expect(parsed.usage.inputTokens).toBeNull();
  });

  test("rejects a model change during the stream", () => {
    const serverName = "gdocsmith_eval_1234567890abcdef";
    const stdout = [
      {
        type: "system",
        subtype: "init",
        model: "claude-sonnet-5",
        tools: [`mcp__${serverName}__run`],
        mcp_servers: [{ name: serverName, status: "connected" }],
      },
      { type: "assistant", message: { model: "claude-opus-5", content: [] } },
      { type: "result", subtype: "success", is_error: false },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const parsed = claudeJsonlParse(stdout, serverName);
    expect(parsed.complete).toBe(false);
    expect(parsed.issues).toContain("a non-Sonnet model appeared in the stream");
  });
});

describe("offline evaluation runner", () => {
  test("refuses launches beyond the durable 40-agent ledger", async () => {
    const root = fixtureRootCreate();
    const options = evalOptionsCreate(root);
    let calls = 0;
    const ledgerPath = join(root, "ledger");
    mkdirSync(ledgerPath);
    for (let slot = 1; slot <= 40; slot++) {
      mkdirSync(join(ledgerPath, String(slot).padStart(3, "0")));
      writeFileSync(
        join(ledgerPath, String(slot).padStart(3, "0"), "record.json"),
        JSON.stringify({
          caseId: `old-${slot}`,
          checks: [],
          evidence: { stdoutFile: "old.stdout.jsonl" },
          run: 1,
          complete: true,
          passed: false,
          metrics: {
            runCalls: null,
            failedCalls: null,
            invalidCalls: null,
            refusedCalls: null,
            forcedCalls: null,
            turns: null,
            durationMs: null,
            inputTokens: null,
            cachedInputTokens: null,
            outputTokens: null,
            costUsd: null,
          },
        }),
      );
    }
    const dependencies = evalDependenciesCreate(root, {
      ledgerPath,
      copyFile: async () => {
        calls++;
        return { id: "unexpected", name: "unexpected" };
      },
      spawn: async () => {
        throw new Error("should never launch");
      },
    });

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);
    expect(summary.abortReason).toContain("40-agent launch limit");
    expect(summary.agentsLaunched).toBe(40);
    expect(calls).toBe(0);
  });

  test("uses one unique test MCP, exact settings, local skill, and deletes copies", async () => {
    const root = fixtureRootCreate();
    const options = evalOptionsCreate(root);
    const invocations: Array<{
      args: string[];
      config: Record<string, unknown>;
      env: Record<string, string | undefined>;
    }> = [];
    const copies: string[] = [];
    const deleted: string[] = [];
    const current = fixtureDocument();
    const dependencies = evalDependenciesCreate(root, {
      drive: {
        copyFile: async (_sourceId, name) => {
          const id = `copy-${copies.length + 1}`;
          copies.push(id);
          return { id, name };
        },
        deleteFile: async (id) => {
          deleted.push(id);
        },
      },
      docs: {
        getDocument: async () => structuredClone(current),
      },
      spawn: async (_command, args, spawnOptions) => {
        const configPath = args[args.indexOf("--mcp-config") + 1] ?? "";
        const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        invocations.push({ args, config, env: spawnOptions.env });
        const serverName = Object.keys((config.mcpServers as Record<string, unknown>) ?? {})[0] ?? "";
        const events = [
          {
            type: "system",
            subtype: "init",
            model: "claude-sonnet-4-6",
            tools: [`mcp__${serverName}__run`, `mcp__${serverName}__status`],
            mcp_servers: [{ name: serverName, status: "connected" }],
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            num_turns: 1,
            total_cost_usd: 0.01,
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        ];
        expect(serverName).toStartWith("gdocsmith_eval_");
        return {
          exitCode: 0,
          stderr: "",
          stdout: events.map((event) => JSON.stringify(event)).join("\n"),
          timedOut: false,
        };
      },
      outputDirectory: join(root, "out"),
      env: { EVAL_TOKEN: "test-secret-value" },
    });

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);

    expect(summary.abortReason).toBeNull();
    expect(summary.runs).toHaveLength(1);
    expect(invocations).toHaveLength(1);
    expect(copies).toEqual(["copy-1"]);
    expect(deleted).toEqual(copies);
    for (const invocation of invocations) {
      const serverNames = Object.keys((invocation.config.mcpServers as Record<string, unknown>) ?? {});
      expect(serverNames).toHaveLength(1);
      expect(serverNames[0]).toStartWith("gdocsmith_eval_");
      expect(invocation.args).toContain("sonnet");
      expect(invocation.args).toContain("stream-json");
      expect(invocation.args).toContain("--print");
      expect(invocation.args).toContain("--restricted");
      expect(invocation.args).toContain("--strict-mcp-config");
      expect(invocation.args).toContain("--no-session-persistence");
      expect(invocation.args[invocation.args.indexOf("--tools") + 1]).toBe("");
      expect(invocation.args[invocation.args.indexOf("--allowedTools") + 1]).toBe(
        `mcp__${serverNames[0]}__run,mcp__${serverNames[0]}__status`,
      );
      expect(invocation.args).not.toContain("test-secret-value");
      expect(invocation.args).not.toContain("--max-ai-credits");
      expect(invocation.args.at(-1)).toContain("Google Doc ID is copy-");
      expect(invocation.args[invocation.args.indexOf("--append-system-prompt") + 1]).toContain("# checkout skill");
      expect(invocation.env.EVAL_TOKEN).toBe("test-secret-value");
      const mcpServer = (invocation.config.mcpServers as Record<string, { args: string[]; command: string }>)[
        serverNames[0] ?? ""
      ];
      expect(mcpServer.command).toBe("node");
      expect(mcpServer.args[0]).toBe(join(root, "checkout", "scripts", "mcp.mjs"));
    }
    expect(
      invocations.map((invocation) => {
        const serverName = Object.keys((invocation.config.mcpServers as Record<string, unknown>) ?? {})[0] ?? "";
        return (invocation.config.mcpServers as Record<string, { args: string[] }>)[serverName]?.args[0];
      }),
    ).toEqual([join(root, "checkout", "scripts", "mcp.mjs")]);
    expect(summary.runs.every((record) => record.complete && record.passed)).toBe(true);
    expect(summary.agentsLaunched).toBe(1);
    const resumed = await evalRunSuite(options, [evalCaseCreate()], dependencies);
    expect(resumed.agentsLaunched).toBe(1);
    expect(invocations).toHaveLength(1);
    expect(summary.runs.every((record) => record.metrics.runCalls === 0)).toBe(true);
    expect(summary.runs.every((record) => record.metrics.turns === 1)).toBe(true);
    expect(existsSync(join(root, "out", "runs.json"))).toBe(true);
    expect(existsSync(join(root, "out", "report.md"))).toBe(true);
    expect(readFileSync(join(root, "out", "report.md"), "utf8")).toContain("sonnet");
    expect(readFileSync(join(root, "out", "report.md"), "utf8")).toContain("| offline-fixture | 1 | 1 | 1 | 100% |");
    expect(readdirSync(join(root, "out")).some((name) => name.endsWith(".stdout.jsonl"))).toBe(true);
  });

  test("runs a scenario with independent verification and cleanup", async () => {
    const root = fixtureRootCreate();
    const options = evalOptionsCreate(root);
    const copied: string[] = [];
    const deleted: string[] = [];
    const bundles: string[] = [];
    const dependencies = evalDependenciesCreate(root, {
      drive: {
        copyFile: async (_sourceId, name) => {
          copied.push(name);
          return { id: "current-copy", name };
        },
        deleteFile: async (id) => {
          deleted.push(id);
        },
      },
      spawn: async (_command, args) => {
        const config = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1] ?? "", "utf8")) as {
          mcpServers: Record<string, { args: string[] }>;
        };
        const serverName = Object.keys(config.mcpServers)[0] ?? "";
        bundles.push(config.mcpServers[serverName]?.args[0] ?? "");
        return {
          exitCode: 0,
          stderr: "",
          stdout: [
            {
              type: "system",
              subtype: "init",
              model: "claude-sonnet-4-6",
              tools: [`mcp__${serverName}__run`, `mcp__${serverName}__status`],
              mcp_servers: [{ name: serverName, status: "connected" }],
            },
            {
              type: "result",
              subtype: "success",
              is_error: false,
              num_turns: 1,
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n"),
          timedOut: false,
        };
      },
    });

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);
    expect(summary.abortReason).toBeNull();
    expect(summary.runs).toHaveLength(1);
    expect(summary.runs[0]).toMatchObject({ complete: true, passed: true });
    expect(copied).toHaveLength(1);
    expect(deleted).toEqual(["current-copy"]);
    expect(bundles).toEqual([join(root, "checkout", "scripts", "mcp.mjs")]);
    const report = readFileSync(join(root, "out", "report.md"), "utf8");
    expect(report).toContain("# Gdocsmith agent E2E");
    expect(report).toContain("| 1 | 1 | 1 |");
    expect(report).toContain("PASS stub: stub verifier passed");
  });

  test("labels a report correctly even if preflight fails", async () => {
    const root = fixtureRootCreate();
    const options = evalOptionsCreate(root);
    const dependencies = evalDependenciesCreate(root, {});
    dependencies.readCliVersion = () => {
      throw new Error("unavailable");
    };

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);
    expect(summary.abortReason).toContain("unavailable");
    expect(summary.runs).toHaveLength(0);
    expect(readFileSync(join(root, "out", "report.md"), "utf8")).toContain("# Gdocsmith agent E2E");
  });

  test("deletes fixture copies and halts on a failed Claude session", async () => {
    const root = fixtureRootCreate();
    const options = evalOptionsCreate(root);
    const deleted: string[] = [];
    let spawnCount = 0;
    let copyCount = 0;
    const dependencies = evalDependenciesCreate(root, {
      drive: {
        copyFile: async (_sourceId, name) => ({ id: `copy-${++copyCount}`, name }),
        deleteFile: async (id) => {
          deleted.push(id);
        },
      },
      spawn: async () => {
        spawnCount++;
        return {
          exitCode: spawnCount === 1 ? 143 : 1,
          stderr: "failed",
          stdout: "",
          timedOut: spawnCount === 1,
        };
      },
      outputDirectory: join(root, "failed-out"),
    });

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);

    expect(summary.runs).toHaveLength(1);
    expect(summary.agentsLaunched).toBe(1);
    expect(summary.runs.every((record) => !record.passed)).toBe(true);
    expect(summary.runs[0]?.error).toContain("timeout");
    expect(deleted).toHaveLength(1);
  });
});

describe("Claude process timeout", () => {
  test("terminates a child that exceeds its timeout", async () => {
    const root = fixtureRootCreate();
    const result = await claudeProcessRun(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      cwd: root,
      env: process.env,
      timeoutMs: 20,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

/** Creates a disposable Git checkout with the exact paths the runner requires. */
function fixtureRootCreate(): string {
  const root = mkdtempSync(join(tmpdir(), "gdocsmith-eval-test-"));
  roots.push(root);
  const checkout = join(root, "checkout");
  mkdirSync(join(checkout, "scripts"), { recursive: true });
  mkdirSync(join(checkout, "skills", "gdocsmith"), { recursive: true });
  writeFileSync(join(checkout, "scripts", "mcp.mjs"), "// checkout bundle\n");
  writeFileSync(join(checkout, "skills", "gdocsmith", "SKILL.md"), "# checkout skill\n");
  execFileSync("git", ["-C", checkout, "init", "--quiet"]);
  execFileSync("git", ["-C", checkout, "config", "user.name", "Eval Test"]);
  execFileSync("git", ["-C", checkout, "config", "user.email", "eval-test@example.invalid"]);
  execFileSync("git", ["-C", checkout, "add", "."]);
  execFileSync("git", ["-C", checkout, "commit", "--quiet", "-m", "fixture"]);
  return root;
}

/** Builds a single task case whose verifier reads no external data. */
function evalCaseCreate(): EvalCase {
  return {
    id: "offline-fixture",
    prompt: "Describe the document without changing it.",
    verify: async () => [{ detail: "stub verifier passed", id: "stub", passed: true }],
  };
}

/** Builds the argument object for a one-case test run. */
function evalOptionsCreate(root: string): EvalOptions {
  return {
    caseIds: [],
    keepDocs: false,
    model: "sonnet",
    pilot: false,
    root: join(root, "checkout"),
    runs: 1,
  };
}

/** Returns a small Docs-shaped fixture object for fully stubbed tests. */
function fixtureDocument(): GoogleDoc {
  return { documentId: "fixture-doc", title: "Fixture", revisionId: "rev-1" } as GoogleDoc;
}

/** Supplies stub-only dependencies; no live client is constructed or called. */
function evalDependenciesCreate(
  root: string,
  overrides: {
    copyFile?: DriveApi["copyFile"];
    deleteFile?: DriveApi["deleteFile"];
    docs?: Pick<DocsClient, "getDocument">;
    drive?: Pick<DriveApi, "copyFile" | "deleteFile">;
    env?: Record<string, string | undefined>;
    outputDirectory?: string;
    ledgerPath?: string;
    spawn?: EvalDependencies["spawn"];
  },
): EvalDependencies {
  const current = fixtureDocument();
  const drive = {
    commentsList: async () => [],
    copyFile:
      overrides.copyFile ?? overrides.drive?.copyFile ?? (async (_sourceId, name) => ({ id: `copy-${name}`, name })),
    createPermission: async () => ({ id: "permission", role: "reader", type: "user" as const }),
    deleteFile: overrides.deleteFile ?? overrides.drive?.deleteFile ?? (async () => undefined),
    deletePermission: async () => undefined,
    listPermissions: async () => [],
    updateFile: async (id: string) => ({ id, name: "fixture" }),
  } as DriveApi;
  const docs = {
    batchUpdate: async () => "{}",
    getDocument: overrides.docs?.getDocument ?? (async () => structuredClone(current)),
    run: async () => "",
  } as DocsClient;
  return {
    clients: { docs, drive },
    claudePath: "claude-stub",
    env: overrides.env ?? {},
    id: (() => {
      let counter = 0;
      return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
    })(),
    now: () => new Date("2026-09-25T12:00:00.000Z"),
    outputDirectory: overrides.outputDirectory ?? join(root, "out"),
    ledgerPath: overrides.ledgerPath ?? join(root, "ledger"),
    readCliVersion: () => "Claude Code 2.1.282",
    spawn: overrides.spawn,
    timeoutMs: 20,
  };
}
