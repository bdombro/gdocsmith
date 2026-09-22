# gdocsmith

## Tooling

- Bun only (`bun`, `bunx`, `bun test`). No Node/npm/pnpm.

## Documentation

- `README.md` — user-facing install/commands
- `docs/architecture.md` — maintainer internals (create if missing)
- Generated: `just docgen` → `docs/cli.md`, `docs/cli-schema.json`
- `skills/gdocsmith/SKILL.md` — agent skill router (scaffolded from template; customize as needed)

<!-- argsbarg:managed -->

## Argsbarg schema

When adding or changing argsbarg schema, leaf handlers, or MCP exposure:

1. **Read** `node_modules/argsbarg/docs/cli-program.md` (required — authoritative guide).
2. MCP tools, varargs, `inputSchema` → also `node_modules/argsbarg/docs/mcp.md`.
3. JSON stdout / `outputSchema` guide and codegen → `node_modules/argsbarg/docs/output-schema.md`.
4. App config / `program.appConfig` guide and codegen → `node_modules/argsbarg/docs/config-schema.md`.
5. `configure`, `configure.targets`, Homebrew distribution → `node_modules/argsbarg/docs/configure.md` and `distribution-homebrew.md`.
6. Bundled `docs` built-in → `node_modules/argsbarg/docs/bundled-docs.md`.
7. **Examples** (shipped under `node_modules/argsbarg/examples/`):
   - **Copy template** (all builtins, `@sg` schemagen, Homebrew justfile, `outputSchema`) → `examples/full-example/`

**Hard rules** (details and examples are in the docs above — do not contradict them):

- Reserved root commands: `completion`, `configure`, `mcp`, `version`, `docs`.
- `satisfies CliProgram` / `CliLeaf`; action-oriented `description` on root, commands, options, and positionals.
- Omit `mcpTool` unless genuinely CLI-only (`enabled: false`) or an irreducible wire limit — fix schema and headless handlers first.
- Interactive leaves: one headless path for MCP, non-TTY CLI, and `--yes` / `--dry-run` / `--json` (`shouldRunHeadless*`, `requireYesInNonTty`); not raw `isTTY`.
- String options: `format` / `default` / `pattern` per `cli-program.md`; `readLeafInputs()` for multi-flag leaves.
- Varargs (`argMax: 0`): CLI space-separated; MCP JSON array only — no comma-splitting positionals.
- Multi-surface leaves (Ink + headless + MCP): one **`read*Flags(ctx)`** per command (or shared family helper + extensions); one **`resolve*Input(flags)`** for cross-field rules — handler reads ctx once, all paths share the struct.
- JSON stdout: `import { StatusJsonOutputSchema } from "./__generated__"` — declare `/** @sg */` on the type in `types.ts`; handlers import types from the same module.
- App config (optional): `import { AppConfigSchema } from "./config/__generated__"` — `/** @sg */` on `AppConfig` in `src/config/types.ts`.

## Code conventions

### JSDoc

Add doc comments for exported surfaces that are not obvious from the name alone: JSON output schemas, public types, and non-trivial algorithms. Skip comments on short test callbacks and pure re-export files.

### Names

Use names that describe the domain role, not generic placeholders like `data` or `handler`, except in very small scopes.

### Structure

After imports, put **exported** symbols first (alphabetical within each kind), then **module-private** helpers at the bottom. Use `~/…` only where you would otherwise use `../` (or deeper) to reach another module under `src/`. Same-directory (`./`) and child (`./foo/…`) imports stay relative. Use `.ts` extensions. TypeScript module **file names** are camelCase (e.g. `applyScript.ts`, `markdownParser.ts`), not kebab-case.

### Module boundaries

| Path | Owns | Must not |
| --- | --- | --- |
| `src/index.ts` | Thin entry: `new Cli(program).run()` | Inline leaf handlers, business logic |
| `src/types/` | Global type declarations and module augmentations (e.g. `argsbarg.d.ts`, `md.d.ts`) | Runtime logic, imports from outside `types/` |
| `src/program.ts` | `CliProgram` assembly: `docs`, `commands: […]` | Inline leaf handlers, business logic |
| `src/core/` | Google Docs domain engine (parse, apply, query, Drive/Docs clients) | Command handlers |
| `src/cli/` | Shared CLI adapters (format, ctx, options) | Leaf `handler` bodies |
| `src/commands/<name>/` | One user-facing command: `command.ts`, optional `types.ts` with `/** @sg */` | Shared helpers (lift to `src/core/`) |
| `src/**/__generated__/` | Generated JSON Schema + `index.ts` re-exports | Hand-edited generated files |
| `scripts/` | Dev tooling (formula helpers) | Production command paths |

When adding commands: `src/commands/<name>/command.ts` + `types.ts` when schemas are needed; register in `program.ts` **alphabetically by command key**.

**Argsbarg schema:** see Argsbarg schema section above.

### Execution

- **Runtime:** Bun (`just test`, `just dev`).
- **Tests:** colocate `*.test.ts` next to the module.
- **Schemagen:** after changing `/** @sg */` types in `src/`, run `just schemagen` (`__generated__/` is gitignored).
- **Repository skill:** When adding, renaming, or removing commands, update `skills/<key>/SKILL.md` so the intent-based router remains accurate for end-user agents. (`just docgen` updates `./docs/` only and never overwrites `skills/`).

### Abstractions

Avoid needless extraction: keep single-use helpers in the calling file by default. Split only when reused elsewhere, the caller is large or hard to follow, or extraction clarifies a substantial unit. Do not create tiny one-off helpers.
- ❌ `utils/formatX.ts` — 60-line helper used by one command
- ✅ inline helper in that command file

<!-- /argsbarg:managed -->

## gdocsmith conventions

- Primary surface is `gdocsmith run` (CLI + MCP): JSON `{ steps: [{ kind }] }`.
- Domain engine lives in `src/core/`; `dump: true` and `kind: query` extract metadata and matches into `dumped`.
- Auth is `gws auth export` credentials; do not invent Google OAuth in this app.

## Engineering & Triage Principles

### 1. Not All Failures Need Fixing
- Differentiate client agent errors from engine bugs:
  - If an agent hallucinated fields, passed invalid arguments, or violated constraints, **the engine is working correctly by rejecting it**.
  - If a safety guard fired (e.g. `uncreatable-elements` without `force: true`, deleting the only remaining tab, MIME mismatch), verify if the guard performed as designed. Do not remove or bypass guards to force a test pass.
- Fix only genuine engine bugs (crashes, incorrect DOM compilation, character offset drift, false cache hits) or misleading documentation.

### 2. Never Coddle Lazy Agents (No Permissive Fallbacks or Aliases)
- **Let invalid agents fail loudly**: Return crisp, actionable errors pointing to the correct schema/syntax.
- **No argument aliases or loose coercion**: Do not add alternate keys (`doc_id` alongside `doc`, `text` alongside `content`) just because a calling agent guessed wrong. Keep schemas canonical.
- **No backwards compatibility**: Unreleased app. Never maintain compatibility shims or legacy aliases.

### 3. Prevent Schema & Context Bloat (KISS)
- **Do not explode schemas**: Schemas must stay strictly typed, minimal, and discriminated on `kind`. Avoid sprawling optional-field catch-alls.
- **Context efficiency**: Keep tool descriptions, JSON schemas, error messages, and `skills/gdocsmith/SKILL.md` concise. Never bloat them with narrative essays or exhaustive edge-case encyclopedias.
- **Avoid premature abstractions**: Inline single-use logic; do not create helper indirection to solve one-off problems.

### 4. Root-Cause Engineering Over Easiest Fix
- Fix the core model, compiler, or cache logic at the root rather than patching over symptoms with regex hacks or swallow-and-ignore blocks.
- Preserve fail-closed safety and transactional revision locking (`requiredRevisionId`) above all else.

## Agent Decision Boundaries

### Autonomous Fixes (No User Prompt)
Apply immediately, verify with `just check`, and proceed:
- Engine bugs in `src/core/` (DOM compilation, anchor resolution, cache freshness, revision replay).
- Clear typos, omissions, or inaccuracies in `skills/gdocsmith/SKILL.md` (keep it concise).
- Schema fixes in `src/core/workflowTypes.ts` that enforce correctness without adding bloat.
- *Mandatory*: maintain JSDocs, alphabetical imports, single-line file headers, and summarize changes in `CHANGELOG.md` under `[UNRELEASED]`.

### User Decision Required (Stop & Ask)
Present options and wait for input before proceeding:
- Architectural shifts (e.g. session persistence, storage backends).
- Breaking interface changes affecting core workflows.
- Ambiguous Google Docs REST API edge cases or conflicting requirements.
- Changing safety defaults (e.g. relaxing destructive protections).

### Mandatory Halt (Do Not Work Around)
Stop immediately and report to the user without attempting in-repo workarounds, papering over, or substituting a weaker path:
- Issues or shortcomings with `argsbarg` (MCP/CLI framework, error shaping, schema, headless handlers). Fixes belong in `argsbarg`, not compensating shims here.
- Auth failures (`401`, `403`, expired `gws auth export` credentials).
- Network login walls or missing external secrets/tokens.

## Code quality

- Changes must be summarized in CHANGELOG.md under the UNRELEASED section
- JSDocs: Types, interfaces, functions (exported **and** module-private), objects, object properties, classes, class properties, module-level constants  must have a very human-readable JSDoc directly above the symbol. No exceptions in `src/**` or `scripts/**` except tests, generated. When adding JSDoc to functions, favor putting a JSDoc on each arg instead of using `@param`. Skip comments on short test callbacks and pure re-export files
- Prefer naming to be more ref/target oriented/leading. For example, createDoc --> docCreate
- In objects, types, order attrs by key alphabetically by default unless there is reason not to.
- All files should start with a `/* {single-line core-responsibility} */`
- All imports must be ordered alphabetically by their source module path (the `from` clause)
- Avoid needless extraction: keep single-use helpers in the calling file by default. Split only when reused elsewhere, the caller is large or hard to follow, or extraction clarifies a substantial unit. Do not create tiny one-off helpers
  - ❌ `utils/formatX.ts` — 60-line helper used by one command
  - ✅ inline helper in that command file
- When moving features in/out of import barrels, update importers instead of import+export (re-exporting) from the former barrel
- This app is not released yet so do not ever add backwards compat when making breaking changes

<!-- thread-memory:managed -->
Before substantive changes or architectural work, use `/thread-memory` to recall repository context.
If this session is a disposable experiment, call `/thread-memory-ignore` once.
<!-- /thread-memory:managed -->

