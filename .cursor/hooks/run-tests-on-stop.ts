#!/usr/bin/env bun
/* Cursor stop hook: run `just test` on agent completion; follow up if it fails. */

try {
  const empty = () => {
    console.log("{}");
    process.exit(0);
  };

  const input = JSON.parse(await Bun.stdin.text()) as {
    status?: string;
    loop_count?: number;
    workspace_roots?: string[];
  };

  if (input.status !== "completed") empty();

  const cwd = input.workspace_roots?.[0] ?? process.cwd();
  if (!(await Bun.file(`${cwd}/justfile`).exists())) empty();

  const diff = Bun.spawnSync(["git", "diff", "--name-only", "HEAD"], { cwd, stdout: "pipe" });
  const CODE_FILE = /\.(t|j)sx?$/i;
  const SKIP_PREFIX = /^(node_modules|dist|\.cursor)\//;
  const changed = new TextDecoder()
    .decode(diff.stdout)
    .split("\n")
    .some(
      (path) =>
        path &&
        (path === "justfile" || (CODE_FILE.test(path) && !SKIP_PREFIX.test(path))),
    );
  if (!changed) empty();

  const proc = Bun.spawnSync(["just", "test"], {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const output =
    new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);

  if (proc.exitCode === 0) empty();

  const lines = output.trimEnd().split("\n");
  const tail = lines.length > 80 ? lines.slice(-80).join("\n") : output.trimEnd();
  const n = (input.loop_count ?? 0) + 1;

  console.log(
    JSON.stringify({
      followup_message: `Tests failed (auto-retry ${n}/20). Fix and ensure \`just test\` passes.\n\n\`\`\`\n${tail}\n\`\`\``,
    }),
  );
} catch {
  console.log("{}");
}
