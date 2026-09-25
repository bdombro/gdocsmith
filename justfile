# bash (not sh); -e bail on errors, -u error on unset vars, pipefail halts on errors
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export PATH := "./node_modules/.bin:" + env_var("PATH")

# List available recipes (default)
_:
    @just --list

# Sync argsbarg to a local checkout (file: snapshot; re-run after each argsbarg edit)
argsbarg-local:
    rm -rf ../bun-argsbarg/examples/*/node_modules
    bun add argsbarg@file:../bun-argsbarg
    ln -sf ../argsbarg/bin/argsbarg node_modules/.bin/argsbarg
    just schemagen

# Switch back to a published argsbarg version, e.g. `just argsbarg-published 7.1.1`
argsbarg-published VERSION:
    bun add argsbarg@^{{VERSION}}
    ln -sf ../argsbarg/bin/argsbarg node_modules/.bin/argsbarg
    just schemagen

# Bundle the standalone Node MCP server script for Cursor and Claude plugins
build: schemagen
    bun build ./src/index.ts --target=node --outfile=./scripts/mcp.mjs

# Schemagen, format, lint, typecheck, unit tests
check: format lint typecheck test

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
    bun run biome check ./src ./scripts ./tests --write --unsafe

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
    bun run biome check ./src ./scripts ./tests

# Refresh the installed Claude Code plugin from this repo (restart Claude Code afterwards)
plugin-claude-update: build
    claude plugin marketplace update gdocsmith
    claude plugin update gdocsmith@gdocsmith
    @just _plugin-claude-check || (claude plugin uninstall gdocsmith@gdocsmith && claude plugin install gdocsmith@gdocsmith && just _plugin-claude-check)

# Verify the installed Claude plugin's bundle matches the current build (used by plugin-claude-update)
_plugin-claude-check:
    @p="$(jq -r '.plugins["gdocsmith@gdocsmith"][0].installPath' ~/.claude/plugins/installed_plugins.json)"; cmp -s "$p/scripts/mcp.mjs" scripts/mcp.mjs && echo "installed plugin matches build: $p" || { echo "installed plugin is stale: $p" >&2; exit 1; }

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

# Run all tests
test-all: test test-live test-wire

# Run live integration tests against Google Docs/Drive APIs (requires gws auth)
test-live *ARGS: build
    bun test tests/integration {{ARGS}}

alias test-integration := test-live

# Run offline MCP wire integration tests over stdio (source and bundled server)
test-wire *ARGS: build
    bun test tests/integration/mcpWire.test.ts {{ARGS}}

# Typecheck without emitting build artifacts
typecheck: schemagen
    bun run tsc --noEmit
