# bash (not sh); -e bail on errors, -u error on unset vars, pipefail halts on errors
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export PATH := "./node_modules/.bin:" + env_var("PATH")

# List available recipes (default)
_:
    @just --list

agent_e2e_prompt_default := '''Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc is an engineering planning workflow and spec template for the Intergalactic Pigeon Post project.

Task: Follow the instructions in the "Workflow Manual" tab of that document to author a new planning doc titled "[TEST] Intergalactic Pigeon Post". Document tab titles must be unique across the document—name the epic child tab "Quantum Breadcrumb Telemetry" rather than reusing the parent project title. It is okay (and preferred) to copy/preserve text exactly if they match the destination. Use /gdocsmith.

Rules:
- The goal is to surface issues with the gdocsmith MCP and stop immediately, not to force completion.
- If you have ANY concerns, issues, unexpected errors, or bugs with gdocsmith, halt immediately without attempting workarounds. Report what failed and why.'''

# Run headless Cursor agent E2E test with dev MCP server in isolated workspace
agent-e2e +PROMPT=agent_e2e_prompt_default: install-mcp-dev install-plugin-cursor
    rm -rf "/tmp/agentE2e" && mkdir -p "/tmp/agentE2e"
    agent -p --trust --approve-mcps --force --model "${MODEL:-composer-2.5}" --workspace "/tmp/agentE2e" {{quote(PROMPT)}}

# Bundle the standalone Node MCP server script for Cursor and Claude plugins
build:
    bun build ./src/index.ts --target=node --outfile=./scripts/mcp.mjs

# Schemagen, format, lint, typecheck, and unit tests
check: schemagen format lint typecheck test

# demo a CLI command
demo-cli:
    @bun ./src/index.ts status

# demo a CLI command
demo-help:
    @bun ./src/index.ts --help

# Run the CLI from source with optional args; restarts on file changes
dev *ARGS:
    bun --watch ./src/index.ts {{ARGS}}

# Regenerate consumer docs under ./docs/
docgen: schemagen
    @just run docs cli-schema --save
    @just run docs cli --save
    @just run docs mcp --save

alias fmt := format

# Format and lint sources (auto-fix)
format:
    bun run biome check ./src ./scripts --write --unsafe

# Dev ~/.agents MCP (bun + src) and skill symlink
install-agents-dev: install-mcp-dev install-skill-dev

# Upsert gdocsmith in ~/.agents/mcp.json (bun + repo src)
install-mcp-dev:
    @echo Installing MCP dev...
    @test -f ~/.agents/mcp.json || echo '{}' > ~/.agents/mcp.json
    @jq --arg src "$(pwd)/src/index.ts" '.mcpServers = ({gdocsmith: {command:"bun",args:[$src,"mcp"]}} + ((.mcpServers // {}) | del(.gdocsmith)))' ~/.agents/mcp.json > ~/.agents/mcp.json.tmp && mv ~/.agents/mcp.json.tmp ~/.agents/mcp.json

# Copy repo into ~/.cursor/plugins/local/gdocsmith for local Cursor testing
install-plugin-cursor: build
    @rm -rf ~/.cursor/plugins/local/gdocsmith
    @mkdir -p ~/.cursor/plugins/local/gdocsmith
    @rsync -a --delete --exclude='.git' --exclude='node_modules' ./ ~/.cursor/plugins/local/gdocsmith/
    @echo "Installed Cursor plugin to ~/.cursor/plugins/local/gdocsmith"

# Symlink repo skills/gdocsmith into ~/.agents/skills (dev)
install-skill-dev:
    @echo Installing skill via symlink.../skills
    @ln -sfn "$(pwd)/skills/gdocsmith" ~/.agents/skills/

# Lint sources without writing
lint:
    bun run biome check ./src ./scripts

# Bump version, build, publish release
release *ARGS:
    bun scripts/release.ts {{ARGS}}

# Run the CLI from source once
run *ARGS:
    bun ./src/index.ts {{ARGS}}

# Generate JSON Schema artifacts from TypeScript types
schemagen:
    argsbarg schemagen

# Install bun/npm dependencies and generate schemas
setup:
    bun install
    test -f node_modules/argsbarg/bin/argsbarg && ln -sf ../argsbarg/bin/argsbarg node_modules/.bin/argsbarg
    just schemagen

# Run unit tests
test:
    bun test src

# Typecheck without emitting build artifacts
typecheck:
    bun run tsc --noEmit
