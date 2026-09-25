/* Offline tests for the Copilot v1/v2 evaluation harness. */

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsClient, DriveApi } from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import {
  copilotJsonlParse,
  copilotProcessRun,
  copilotUsageParse,
  type EvalCase,
  type EvalDependencies,
  type EvalOptions,
  evalOptionsParse,
  evalRunSuite,
} from "./eval.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("eval options", () => {
  test("uses the selected model and effort defaults with a three-run matrix", () => {
    const options = evalOptionsParse(["--arm", "v1=/tmp/v1", "--arm", "v2=/tmp/v2"]);
    expect(options).toMatchObject({
      armRoots: { v1: "/tmp/v1", v2: "/tmp/v2" },
      caseIds: [],
      keepDocs: false,
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
      runs: 3,
    });
  });

  test("accepts explicit settings, repeated cases, and keep-docs", () => {
    const options = evalOptionsParse([
      "--arm",
      "v1=/tmp/v1",
      "--arm",
      "v2=/tmp/v2",
      "--case",
      "outline-headings",
      "guard-respect",
      "--runs",
      "1",
      "--model",
      "gpt-5.6-luna",
      "--reasoning-effort",
      "xhigh",
      "--keep-docs",
    ]);
    expect(options).toMatchObject({ caseIds: ["outline-headings", "guard-respect"], keepDocs: true, runs: 1 });
  });

  test("rejects missing arms, relative roots, duplicate labels, invalid runs, and credit caps", () => {
    expect(() => evalOptionsParse([])).toThrow("both --arm v1=");
    expect(() => evalOptionsParse(["--arm", "v1=relative", "--arm", "v2=/tmp/v2"])).toThrow("absolute path");
    expect(() => evalOptionsParse(["--arm", "v1=/tmp/a", "--arm", "v1=/tmp/b", "--arm", "v2=/tmp/v2"])).toThrow(
      "supplied more than once",
    );
    expect(() => evalOptionsParse(["--arm", "v1=/tmp/v1", "--arm", "v2=/tmp/v2", "--runs", "0"])).toThrow(
      "positive integer",
    );
    expect(() => evalOptionsParse(["--arm", "v1=/tmp/v1", "--arm", "v2=/tmp/v2", "--max-ai-credits", "1"])).toThrow(
      "unknown option --max-ai-credits",
    );
  });
});

describe("Copilot output parsing", () => {
  test("correlates tool calls once and classifies errors, refusals, and nested force", () => {
    const serverName = "gdocsmith_eval_1234567890abcdef";
    const events = [
      {
        type: "tool.start",
        data: { callId: "r1", toolName: "run", serverName, arguments: { steps: [{ force: true }] } },
      },
      {
        type: "tool.complete",
        data: {
          callId: "r1",
          result: { isError: true, content: [{ text: 'Invalid steps (1): unknown property "markdwn"' }] },
        },
      },
      { type: "tool.complete", data: { callId: "r1", result: { isError: true, content: [{ text: "duplicate" }] } } },
      { type: "tool.start", data: { callId: "s1", toolName: "status", serverName, arguments: {} } },
      { type: "tool.complete", data: { callId: "s1", result: { content: [{ text: "version=2.0.0" }] } } },
      {
        type: "tool.start",
        data: { callId: "r2", toolName: `${serverName}(run)`, serverName, arguments: { steps: [{}] } },
      },
      {
        type: "tool.complete",
        data: { callId: "r2", result: { isError: true, content: [{ text: "Refused: Nothing was sent." }] } },
      },
      { type: "session.complete", data: { model: "gpt-5.6-luna", reasoningEffort: "xhigh" } },
    ];

    const parsed = copilotJsonlParse(events.map((event) => JSON.stringify(event)).join("\n"), serverName);

    expect(parsed.complete).toBe(true);
    expect(parsed.completionObserved).toBe(true);
    expect(parsed.metrics).toEqual({ failedCalls: 2, forcedCalls: 1, invalidCalls: 1, refusedCalls: 1, runCalls: 2 });
    expect(parsed.effectiveModel).toBe("gpt-5.6-luna");
    expect(parsed.effectiveReasoningEffort).toBe("xhigh");
  });

  test("marks malformed JSONL, unmatched calls, missing completion, and unexpected tools incomplete", () => {
    const serverName = "gdocsmith_eval_1234567890abcdef";
    const stdout = [
      "not-json",
      JSON.stringify({ type: "tool.start", data: { callId: "x1", toolName: "shell", serverName, arguments: {} } }),
    ].join("\n");
    const parsed = copilotJsonlParse(stdout, serverName);
    expect(parsed.complete).toBe(false);
    expect(parsed.metrics.runCalls).toBe(0);
    expect(parsed.issues.join(" ")).toContain("no completion event");
    expect(parsed.unexpectedToolNames).toEqual(["shell"]);
  });

  test("keeps missing usage nullable and ignores unverified Claude-style cost fields", () => {
    expect(copilotUsageParse(null)).toMatchObject({ status: "missing", metrics: { costUsd: null, inputTokens: null } });
    expect(copilotUsageParse("{broken").status).toBe("invalid");
    const parsed = copilotUsageParse(
      JSON.stringify({
        aiCredits: 1.5,
        cachedInputTokens: 25,
        costUsd: 0.04,
        inputTokens: 100,
        outputTokens: 30,
        premiumRequests: 1,
        reasoningEffort: "xhigh",
        total_cost_usd: 999,
        turns: 2,
      }),
    );
    expect(parsed).toMatchObject({
      costSource: "costUsd",
      metrics: {
        aiCredits: 1.5,
        cachedInputTokens: 25,
        costUsd: 0.04,
        inputTokens: 100,
        outputTokens: 30,
        premiumRequests: 1,
        turns: 2,
      },
      reasoningEffort: "xhigh",
      status: "available",
    });
  });
});

describe("offline evaluation runner", () => {
  test("keeps the run disabled until a pilot confirms the output schema", async () => {
    const root = fixtureRootCreate();
    const options = evalOptionsCreate(root);
    let calls = 0;
    const dependencies = evalDependenciesCreate(root, {
      copyFile: async () => {
        calls++;
        return { id: "unexpected", name: "unexpected" };
      },
    });

    await expect(evalRunSuite(options, [evalCaseCreate()], dependencies)).rejects.toThrow(
      "disabled until the Copilot JSONL",
    );
    expect(calls).toBe(0);
  });

  test("uses one unique test MCP, exact settings, local arm skill, and deletes copies", async () => {
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
        const configArgument = args[args.indexOf("--additional-mcp-config") + 1];
        const configPath = configArgument?.startsWith("@") ? configArgument.slice(1) : "";
        const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        invocations.push({ args, config, env: spawnOptions.env });
        const serverName = Object.keys((config.mcpServers as Record<string, unknown>) ?? {})[0] ?? "";
        const events = [{ type: "session.complete", data: { model: "gpt-5.6-luna", reasoningEffort: "xhigh" } }];
        const usagePath = args[args.indexOf("--usage-output-file") + 1];
        if (usagePath) writeFileSync(usagePath, JSON.stringify({ turns: 1 }));
        const sharePath = args[args.indexOf("--share") + 1];
        if (sharePath) writeFileSync(sharePath, "local test transcript");
        expect(serverName).toStartWith("gdocsmith_eval_");
        return {
          exitCode: 0,
          stderr: "",
          stdout: events.map((event) => JSON.stringify(event)).join("\n"),
          timedOut: false,
        };
      },
      outputSchemaVerified: true,
      outputDirectory: join(root, "out"),
      env: { EVAL_TOKEN: "test-secret-value" },
    });

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);

    expect(summary.runs).toHaveLength(2);
    expect(invocations).toHaveLength(2);
    expect(copies).toEqual(["copy-1", "copy-2"]);
    expect(deleted).toEqual(copies);
    for (const invocation of invocations) {
      const serverNames = Object.keys((invocation.config.mcpServers as Record<string, unknown>) ?? {});
      expect(serverNames).toHaveLength(1);
      expect(serverNames[0]).toStartWith("gdocsmith_eval_");
      expect(invocation.args).toContain("gpt-5.6-luna");
      expect(invocation.args).toContain("xhigh");
      expect(invocation.args).toContain("json");
      expect(invocation.args).toContain("--disable-builtin-mcps");
      expect(invocation.args).toContain("--no-auto-update");
      expect(invocation.args).toContain("--no-custom-instructions");
      expect(invocation.args).toContain("--no-ask-user");
      expect(invocation.args).toContain("--no-remote");
      expect(invocation.args).toContain("--no-remote-export");
      expect(invocation.args).toContain("--no-color");
      expect(invocation.args).toContain("--secret-env-vars");
      expect(invocation.args).toContain("EVAL_TOKEN");
      expect(invocation.args).not.toContain("test-secret-value");
      expect(invocation.args).not.toContain("--max-ai-credits");
      expect(invocation.args).not.toContain("--disable-mcp-server");
      const availableToolsIndex = invocation.args.indexOf("--available-tools");
      const allowToolsIndex = invocation.args.indexOf("--allow-tool");
      const secretNamesIndex = invocation.args.indexOf("--secret-env-vars");
      expect(invocation.args.slice(availableToolsIndex + 1, allowToolsIndex)).toEqual([
        `${serverNames[0]}(run)`,
        `${serverNames[0]}(status)`,
      ]);
      expect(invocation.args.slice(allowToolsIndex + 1, secretNamesIndex)).toEqual([
        `${serverNames[0]}(run)`,
        `${serverNames[0]}(status)`,
      ]);
      expect(invocation.args[invocation.args.indexOf("--prompt") + 1]).toContain("Google Doc ID is copy-");
      expect(invocation.env.COPILOT_AUTO_UPDATE).toBe("false");
      expect(invocation.env.EVAL_TOKEN).toBe("test-secret-value");
      const mcpServer = (invocation.config.mcpServers as Record<string, { args: string[]; command: string }>)[
        serverNames[0] ?? ""
      ];
      expect(mcpServer.command).toBe("node");
      expect([join(root, "v1", "scripts", "mcp.mjs"), join(root, "v2", "scripts", "mcp.mjs")]).toContain(
        mcpServer.args[0],
      );
    }
    expect(
      invocations.map((invocation) => {
        const serverName = Object.keys((invocation.config.mcpServers as Record<string, unknown>) ?? {})[0] ?? "";
        return (invocation.config.mcpServers as Record<string, { args: string[] }>)[serverName]?.args[0];
      }),
    ).toEqual([join(root, "v1", "scripts", "mcp.mjs"), join(root, "v2", "scripts", "mcp.mjs")]);
    expect(summary.runs.every((record) => record.complete && record.passed)).toBe(true);
    expect(summary.runs.every((record) => record.metrics.runCalls === 0)).toBe(true);
    expect(summary.runs.every((record) => record.metrics.turns === 1)).toBe(true);
    expect(existsSync(join(root, "out", "runs.json"))).toBe(true);
    expect(existsSync(join(root, "out", "report.md"))).toBe(true);
    const firstRun = summary.runs[0];
    expect(firstRun?.evidence.transcriptFile).not.toBeNull();
    expect(existsSync(join(root, "out", firstRun?.evidence.transcriptFile ?? ""))).toBe(true);
    expect(readFileSync(join(root, "out", "report.md"), "utf8")).toContain("gpt-5.6-luna");
    expect(readdirSync(join(root, "out")).some((name) => name.endsWith(".stdout.jsonl"))).toBe(true);
  });

  test("deletes fixture copies after failed and timed-out Copilot sessions", async () => {
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
      outputSchemaVerified: true,
      outputDirectory: join(root, "failed-out"),
    });

    const summary = await evalRunSuite(options, [evalCaseCreate()], dependencies);

    expect(summary.runs).toHaveLength(2);
    expect(summary.runs.every((record) => !record.passed)).toBe(true);
    expect(summary.runs[0]?.error).toContain("timeout");
    expect(deleted).toHaveLength(2);
  });
});

describe("Copilot process timeout", () => {
  test("terminates a child that exceeds its timeout", async () => {
    const root = fixtureRootCreate();
    const result = await copilotProcessRun(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      cwd: root,
      env: process.env,
      timeoutMs: 20,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

/** Creates two disposable Git arms with the exact paths the runner requires. */
function fixtureRootCreate(): string {
  const root = mkdtempSync(join(tmpdir(), "gdocsmith-eval-test-"));
  roots.push(root);
  for (const name of ["v1", "v2"]) {
    const arm = join(root, name);
    mkdirSync(join(arm, "scripts"), { recursive: true });
    mkdirSync(join(arm, "skills", "gdocsmith"), { recursive: true });
    writeFileSync(join(arm, "scripts", "mcp.mjs"), `// ${name} bundle\n`);
    writeFileSync(join(arm, "skills", "gdocsmith", "SKILL.md"), `# ${name} skill\n`);
    execFileSync("git", ["-C", arm, "init", "--quiet"]);
    execFileSync("git", ["-C", arm, "config", "user.name", "Eval Test"]);
    execFileSync("git", ["-C", arm, "config", "user.email", "eval-test@example.invalid"]);
    execFileSync("git", ["-C", arm, "add", "."]);
    execFileSync("git", ["-C", arm, "commit", "--quiet", "-m", "fixture"]);
  }
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

/** Builds the argument object for a two-arm, one-case test run. */
function evalOptionsCreate(root: string): EvalOptions {
  return {
    armRoots: { v1: join(root, "v1"), v2: join(root, "v2") },
    caseIds: [],
    keepDocs: false,
    model: "gpt-5.6-luna",
    reasoningEffort: "xhigh",
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
    outputSchemaVerified?: boolean;
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
    copilotPath: "copilot-stub",
    env: overrides.env ?? {},
    id: (() => {
      let counter = 0;
      return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
    })(),
    now: () => new Date("2026-09-25T12:00:00.000Z"),
    outputDirectory: overrides.outputDirectory ?? join(root, "out"),
    outputSchemaVerified: overrides.outputSchemaVerified,
    readCliVersion: () => "Copilot CLI 1.0.88",
    spawn: overrides.spawn,
    timeoutMs: 20,
  };
}
