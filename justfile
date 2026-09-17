# bash (not sh); -e bail on errors, -u error on unset vars, pipefail halts on errors
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export PATH := "./node_modules/.bin:" + env_var("PATH")

brew_prefix := `brew --prefix`
tap_parent := brew_prefix + "/Library/Taps/bdombro"
tap_path := tap_parent + "/homebrew-gdocsmith"

# List available recipes (default)
_:
    @just --list

agent_e2e_prompt_default := '''Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc is an engineering planning workflow and spec template for the Intergalactic Pigeon Post project.

Task: Follow the instructions in the "Workflow Manual" tab of that document to author a new planning doc titled "[TEST] Intergalactic Pigeon Post". Document tab titles must be unique across the document—name the epic child tab "Quantum Breadcrumb Telemetry" rather than reusing the parent project title. It is okay (and preferred) to copy/preserve text exactly if they match the destination. Use /gdocsmith.

Rules:
- The goal is to surface issues with the gdocsmith MCP and stop immediately, not to force completion.
- If you have ANY concerns, issues, unexpected errors, or bugs with gdocsmith, halt immediately without attempting workarounds. Report what failed and why.'''

# Run headless Cursor agent E2E test with dev MCP server in isolated workspace
agent-e2e +PROMPT=agent_e2e_prompt_default: install-mcp-dev
    rm -rf "/tmp/agentE2e" && mkdir -p "/tmp/agentE2e"
    agent -p --trust --approve-mcps --force --model "${MODEL:-composer-2.5}" --workspace "/tmp/agentE2e" {{quote(PROMPT)}}

# Compile the CLI binary to dist/gdocsmith
build:
    bun build ./src/index.ts --compile --outfile=dist/gdocsmith
    @rm -f .*.bun-build

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

# Default Homebrew dev install
install: install-brew-local

# Dev ~/.agents MCP (bun + src) and skill symlink
install-agents-dev: install-mcp-dev install-skill-dev

# Dev install: build, stage dev formula, brew install, dev agent artifacts
install-brew-local: install-brew-uninstall build
    mkdir -p {{tap_parent}}
    ln -sfn "$(pwd)" {{tap_path}}
    bun scripts/devFormula.ts install
    HOMEBREW_NO_ASK=1 brew reinstall --formula bdombro/gdocsmith/gdocsmith || HOMEBREW_NO_ASK=1 brew install --force --formula bdombro/gdocsmith/gdocsmith
    bun scripts/devFormula.ts reset
    just install-agents-dev

# Remove local dev install, then install from GitHub tap (requires gh auth login)
install-brew-production: install-brew-uninstall
    brew tap bdombro/gdocsmith git@github.com:bdombro/gdocsmith.git
    brew install --formula bdombro/gdocsmith/gdocsmith
    gdocsmith configure install

# Rebuild binary and swap into Cellar (run install-brew-local first; `just install-agents-dev` for MCP/skill only)
install-brew-reinstall: build
    install -m 755 dist/gdocsmith "$(brew --prefix gdocsmith)/bin/gdocsmith"

# Undo dev/Homebrew install (remove agent artifacts, then keg + untap)
install-brew-uninstall:
    @gdocsmith configure uninstall --yes 2>/dev/null || just run configure uninstall --yes
    @HOMEBREW_NO_ASK=1 brew uninstall --formula bdombro/gdocsmith/gdocsmith 2>/dev/null || true
    @HOMEBREW_NO_ASK=1 brew uninstall --formula bdombro/gdocsmith/gdocsmith-local 2>/dev/null || true
    @HOMEBREW_NO_ASK=1 brew untap bdombro/gdocsmith 2>/dev/null || true

# Run gdocsmith configure install (prod MCP entry; Homebrew binary on PATH)
install-configure:
    gdocsmith configure install

# Upsert gdocsmith in ~/.agents/mcp.json (prod)
install-mcp:
    @echo Installing MCP production...
    @test -f ~/.agents/mcp.json || echo '{}' > ~/.agents/mcp.json
    @jq --argjson e '{"command":"gdocsmith","args":["mcp"]}' '.mcpServers = ({gdocsmith: $e} + ((.mcpServers // {}) | del(.gdocsmith)))' ~/.agents/mcp.json > ~/.agents/mcp.json.tmp && mv ~/.agents/mcp.json.tmp ~/.agents/mcp.json

# Upsert gdocsmith in ~/.agents/mcp.json (bun + repo src)
install-mcp-dev:
    @echo Installing MCP dev...
    @test -f ~/.agents/mcp.json || echo '{}' > ~/.agents/mcp.json
    @jq --arg src "$(pwd)/src/index.ts" '.mcpServers = ({gdocsmith: {command:"bun",args:[$src,"mcp"]}} + ((.mcpServers // {}) | del(.gdocsmith)))' ~/.agents/mcp.json > ~/.agents/mcp.json.tmp && mv ~/.agents/mcp.json.tmp ~/.agents/mcp.json

# Alias for install-brew-reinstall
install-reinstall: install-brew-reinstall

# Copy skills/gdocsmith into ~/.agents/skills (prod)
install-skill:
    @echo Installing skill via copy.../skills
    @rm -rf ~/.agents/skills/gdocsmith
    @cp -R skills/gdocsmith ~/.agents/skills/

# Symlink repo skills/gdocsmith into ~/.agents/skills (dev)
install-skill-dev:
    @echo Installing skill via symlink.../skills
    @ln -sfn "$(pwd)/skills/gdocsmith" ~/.agents/skills/

# Lint sources without writing
lint:
    bun run biome check ./src ./scripts

# Bump version, build, publish; or pass --purge to delete stale GitHub releases
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

# Install release formula from tap and run formula test
test-release:
    HOMEBREW_NO_ASK=1 brew untap bdombro/gdocsmith 2>/dev/null || true
    mkdir -p {{tap_parent}}
    ln -sfn "$(pwd)" {{tap_path}}
    HOMEBREW_NO_ASK=1 brew uninstall --formula bdombro/gdocsmith/gdocsmith 2>/dev/null || true
    brew install --formula bdombro/gdocsmith/gdocsmith
    brew test gdocsmith

# Typecheck without emitting build artifacts
typecheck:
    bun run tsc --noEmit
