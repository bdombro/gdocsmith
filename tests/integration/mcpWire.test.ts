/* Integration tests for MCP JSON-RPC protocol wire transport over stdio. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/** Timeout in milliseconds for MCP subprocess requests. */
const MCP_TIMEOUT_MS = 10_000;

/** Minimal response structure for a JSON-RPC 2.0 response. */
interface JsonRpcResponse {
  error?: {
    code: number;
    data?: unknown;
    message: string;
  };
  id?: number | string | null;
  jsonrpc: string;
  result?: {
    capabilities?: Record<string, unknown>;
    content?: Array<{ text?: string; type: string }>;
    isError?: boolean;
    protocolVersion?: string;
    resources?: Array<{
      description?: string;
      mimeType?: string;
      name: string;
      uri: string;
    }>;
    serverInfo?: {
      name: string;
      version: string;
    };
    structuredContent?: Record<string, unknown>;
    tools?: Array<{
      description?: string;
      inputSchema?: Record<string, unknown>;
      name: string;
      outputSchema?: Record<string, unknown>;
    }>;
  };
}

/** Helper client that wraps a spawned subprocess running argsbarg MCP over stdio. */
class McpWireClient {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private stderrOutput = "";

  constructor(proc: ReturnType<typeof Bun.spawn>) {
    this.proc = proc;
    if (!proc.stdout || typeof proc.stdout === "number") {
      throw new Error("proc.stdout is not a readable stream");
    }
    this.reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();

    if (proc.stderr && typeof proc.stderr !== "number") {
      const stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      (async () => {
        try {
          while (true) {
            const { done, value } = await stderrReader.read();
            if (done) break;
            this.stderrOutput += this.decoder.decode(value, { stream: true });
          }
        } catch {
          // Stream closed
        }
      })();
    }
  }

  /** Shuts down the subprocess by closing stdin and waiting for exit. */
  async close(): Promise<void> {
    try {
      if (this.proc.stdin && typeof this.proc.stdin !== "number") {
        this.proc.stdin.end();
      }
    } catch {
      // Ignore stdin close errors
    }
    await this.proc.exited;
  }

  /** Reads the next non-empty newline-delimited line from stdout. */
  async readLine(timeoutMs = MCP_TIMEOUT_MS): Promise<string> {
    const start = Date.now();
    while (true) {
      const newlineIdx = this.buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        if (line.length > 0) return line;
        continue;
      }

      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) {
        throw new Error(
          `Timeout waiting for stdout line after ${timeoutMs}ms. Buffer: "${this.buffer}". Stderr: "${this.stderrOutput}"`,
        );
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timeout reading chunk after ${timeoutMs}ms. Buffer: "${this.buffer}". Stderr: "${this.stderrOutput}"`,
              ),
            ),
          remaining,
        );
      });

      try {
        const { done, value } = await Promise.race([this.reader.read(), timeoutPromise]);
        if (done) {
          if (this.buffer.trim().length > 0) {
            const line = this.buffer.trim();
            this.buffer = "";
            return line;
          }
          throw new Error(`Server stdout closed unexpectedly. Stderr: "${this.stderrOutput}"`);
        }
        this.buffer += this.decoder.decode(value, { stream: true });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  /** Sends a JSON-RPC request and waits for matching response by id. */
  async request(req: Record<string, unknown>, timeoutMs = MCP_TIMEOUT_MS): Promise<JsonRpcResponse> {
    const expectedId = req.id;
    await this.send(req);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const remaining = timeoutMs - (Date.now() - start);
      const line = await this.readLine(remaining);
      const parsed = JSON.parse(line) as JsonRpcResponse;
      if (expectedId === undefined || parsed.id === expectedId) {
        return parsed;
      }
    }
    throw new Error(`Timeout waiting for response with id ${expectedId}`);
  }

  /** Sends a JSON-RPC payload line over stdin. */
  async send(msg: Record<string, unknown> | string): Promise<void> {
    const text = typeof msg === "string" ? `${msg}\n` : `${JSON.stringify(msg)}\n`;
    if (!this.proc.stdin || typeof this.proc.stdin === "number") {
      throw new Error("proc.stdin is not writable");
    }
    this.proc.stdin.write(text);
    await this.proc.stdin.flush();
  }
}

/** The two server entry points this suite runs identically against: the TS source and the built Node bundle. */
const MCP_SERVER_VARIANTS: Array<{ label: string; spawnArgs: string[] }> = [
  { label: "source", spawnArgs: ["bun", "src/index.ts", "mcp"] },
  { label: "bundle", spawnArgs: ["node", "scripts/mcp.mjs", "mcp"] },
];

describe("MCP JSON-RPC wire integration", () => {
  for (const { label, spawnArgs } of MCP_SERVER_VARIANTS) {
    describe(label, () => {
      let client: McpWireClient;
      let nextId = 1;

      beforeAll(() => {
        const proc = Bun.spawn(spawnArgs, {
          cwd: process.cwd(),
          env: { ...process.env, NO_COLOR: "1" },
          stderr: "pipe",
          stdin: "pipe",
          stdout: "pipe",
        });
        client = new McpWireClient(proc);
      });

      afterAll(async () => {
        if (client) {
          await client.close();
        }
      });

      test("initialize responds with server info and capabilities", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "initialize",
          params: {},
        });

        expect(res.jsonrpc).toBe("2.0");
        expect(res.id).toBe(id);
        expect(res.result?.protocolVersion).toBe("2024-11-05");
        expect(res.result?.serverInfo?.name).toBe("gdocsmith");
        expect(typeof res.result?.serverInfo?.version).toBe("string");
        expect(res.result?.capabilities?.tools).toBeDefined();
        expect(res.result?.capabilities?.resources).toBeDefined();
      });

      test("notifications/initialized is handled without generating a response", async () => {
        await client.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });

        // Send a ping immediately to verify server is alive and queued cleanly
        const pingId = nextId++;
        const pingRes = await client.request({
          id: pingId,
          jsonrpc: "2.0",
          method: "ping",
          params: {},
        });
        expect(pingRes.id).toBe(pingId);
        expect(pingRes.result).toEqual({});
      });

      test("tools/list exposes run and status with valid schemas", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/list",
          params: {},
        });

        expect(res.jsonrpc).toBe("2.0");
        expect(res.id).toBe(id);
        const tools = res.result?.tools;
        expect(Array.isArray(tools)).toBe(true);

        const toolNames = tools?.map((t) => t.name).sort();
        expect(toolNames).toContain("run");
        expect(toolNames).toContain("status");

        const statusTool = tools?.find((t) => t.name === "status");
        expect(statusTool?.description).toContain("version");
        expect(statusTool?.outputSchema).toBeDefined();

        const runTool = tools?.find((t) => t.name === "run");
        expect(runTool?.description).toContain("Google Docs workflow");
        expect(runTool?.description).toContain("Surgical targeting");
        expect(runTool?.inputSchema).toBeDefined();
        expect(runTool?.inputSchema?.type).toBe("object");

        const inputProps = runTool?.inputSchema?.properties as Record<string, unknown> | undefined;
        expect(inputProps?.steps).toBeDefined();
        expect(inputProps?.dryRun).toBeDefined();
        expect(inputProps?.force).toBeDefined();
        expect(inputProps?.quiet).toBeDefined();

        expect(runTool?.outputSchema).toBeDefined();
      });

      test("resources/list and resources/read return schema and docs", async () => {
        const listId = nextId++;
        const listRes = await client.request({
          id: listId,
          jsonrpc: "2.0",
          method: "resources/list",
          params: {},
        });

        expect(listRes.id).toBe(listId);
        const resources = listRes.result?.resources;
        expect(Array.isArray(resources)).toBe(true);

        const schemaResMeta = resources?.find((r) => r.uri === "gdocsmith://schema");
        expect(schemaResMeta).toBeDefined();
        expect(schemaResMeta?.mimeType).toBe("application/json");

        const readmeResMeta = resources?.find((r) => r.uri === "gdocsmith://docs/readme");
        expect(readmeResMeta).toBeDefined();
        expect(readmeResMeta?.mimeType).toBe("text/markdown");

        // Read the readme resource
        const readId = nextId++;
        const readRes = await client.request({
          id: readId,
          jsonrpc: "2.0",
          method: "resources/read",
          params: { uri: "gdocsmith://docs/readme" },
        });
        expect(readRes.id).toBe(readId);
        const content = (readRes.result as { contents?: Array<{ text?: string; uri?: string }> })?.contents;
        expect(content?.[0]?.uri).toBe("gdocsmith://docs/readme");
        expect(content?.[0]?.text).toContain("gdocsmith");
      });

      test("tools/call executes status tool returning structured content", async () => {
        const id = nextId++;
        const res = await client.request({
          arguments: {},
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {},
            name: "status",
          },
        });

        expect(res.id).toBe(id);
        expect(res.result?.isError).toBeFalsy();
        expect(res.result?.structuredContent).toBeDefined();
        expect(typeof res.result?.structuredContent?.version).toBe("string");
      });

      test("tools/call executes run with empty steps without network calls", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              steps: [],
            },
            name: "run",
          },
        });

        expect(res.id).toBe(id);
        expect(res.result?.isError).toBeFalsy();
        expect(res.result?.structuredContent?.ok).toBe(true);
        expect(res.result?.structuredContent?.stepsCount).toBe(0);
      });

      test("tools/call executes run with dryRun and empty steps", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              dryRun: true,
              steps: [],
            },
            name: "run",
          },
        });

        expect(res.id).toBe(id);
        expect(res.result?.isError).toBeFalsy();
        expect(res.result?.structuredContent?.ok).toBe(true);
        expect(res.result?.structuredContent?.stepsCount).toBe(0);
      });

      test("tools/call returns JSON-RPC error for unknown tool", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {},
            name: "unknown_test_tool",
          },
        });

        expect(res.id).toBe(id);
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe(-32602);
        expect(res.error?.message).toContain("unknown_test_tool");
      });

      test("tools/call returns JSON-RPC error for non-object arguments", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: "not-an-object",
            name: "run",
          },
        });

        expect(res.id).toBe(id);
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe(-32602);
        expect(res.error?.message).toContain("arguments must be an object");
      });

      test("tools/call returns MCP error frame when step validation fails", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              steps: [{ kind: "invalidStepKind" }],
            },
            name: "run",
          },
        });

        expect(res.id).toBe(id);
        expect(res.result?.isError).toBe(true);
        const errorText = res.result?.content?.[0]?.text ?? "";
        expect(errorText.length).toBeGreaterThan(0);
        expect(errorText).toContain('Property "steps" does not match schema');
      });

      test("tools/call returns MCP error frame when step references unopened doc", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              steps: [{ doc: "test-doc-id", kind: "replaceSection", markdown: "hello", nodeAt: "h.intro" }],
            },
            name: "run",
          },
        });

        expect(res.id).toBe(id);
        expect(res.result?.isError).toBe(true);
        const errorText = res.result?.content?.[0]?.text ?? "";
        expect(errorText).toContain('Document "test-doc-id" is not open or was closed');
      });

      test("protocol returns JSON-RPC error for unsupported jsonrpc version", async () => {
        const id = nextId++;
        const res = await client.request({
          id,
          jsonrpc: "1.0",
          method: "ping",
          params: {},
        });

        expect(res.id).toBe(id);
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe(-32600);
        expect(res.error?.message).toContain("Invalid Request");
      });

      test("tools/call surfaces multi-line errors in full", async () => {
        const id = nextId++;
        const overmatchMarkdown = Array.from(
          { length: 400 },
          (_, i) => `- zz item ${i} lorem ipsum dolor sit amet`,
        ).join("\n");
        const res = await client.request({
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              dryRun: true,
              steps: [
                { as: "d", kind: "docCreate", title: "Overmatch" },
                { doc: "d", kind: "markdownInsert", markdown: overmatchMarkdown },
                { as: "q", contains: "zz", doc: "d", full: true, kind: "query", output: "nodes" },
              ],
            },
            name: "run",
          },
        });

        expect(res.id).toBe(id);
        expect(res.result?.isError).toBe(true);
        const errorText = res.result?.content?.[0]?.text ?? "";
        expect(errorText).toContain("is an unanchored substring match");
        expect(errorText.split("\n").length).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
