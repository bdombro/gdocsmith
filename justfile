set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export PATH := justfile_directory() + "/node_modules/.bin:" + env_var("PATH")

cli_key := `bun scripts/printIdentity.ts key`
tap_org := `bun scripts/printIdentity.ts tapOrg`
tap_repo := `bun scripts/printIdentity.ts tapRepo`
tap := `bun scripts/printIdentity.ts tap`
release_repo := `bun scripts/printIdentity.ts releaseRepo`
tap_git_url := "git@github.com:" + release_repo + ".git"
brew_prefix := `brew --prefix`
tap_parent := brew_prefix + "/Library/Taps/" + tap_org
tap_path := tap_parent + "/homebrew-" + tap_repo

# List available recipes (default)
_:
    @just --list

# Compile the CLI binary to dist/gdocsmith
build:
    bun build ./src/index.ts --compile --outfile=dist/{{cli_key}}
    @rm -f .*.bun-build

# Run schemagen, typecheck, and format
check: schemagen format typecheck

# demo a CLI command
demo-cli:
    @just run status

# demo a CLI command
demo-help:
    @just run {{cli_key}} --help

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

# Alias for backward compatibility
install: install-local

# Dev install: build, stage dev formula, brew install, refresh agent artifacts
install-local: uninstall build
    mkdir -p {{tap_parent}}
    ln -sfn '{{justfile_directory()}}' {{tap_path}}
    bun scripts/devFormula.ts install
    HOMEBREW_NO_ASK=1 brew reinstall --formula {{tap}}/{{cli_key}} || HOMEBREW_NO_ASK=1 brew install --force --formula {{tap}}/{{cli_key}}
    bun scripts/devFormula.ts reset
    {{cli_key}} configure install

# Remove local dev install, then install from GitHub tap (requires gh auth login)
install-production: uninstall
    brew tap {{release_repo}} {{tap_git_url}}
    brew install --formula {{release_repo}}/{{cli_key}}
    {{cli_key}} configure install

# Alias for backward compatibility
reinstall: reinstall-local

# Rebuild binary and swap into Cellar (run install-local first; run `just refresh` for skills/MCP)
reinstall-local: build
    install -m 755 dist/{{cli_key}} "$(brew --prefix {{cli_key}})/bin/{{cli_key}}"

# Refresh agent skills/MCP without reinstalling the binary
refresh:
    {{cli_key}} configure install

# Lint sources without writing
lint:
    bun run biome check ./src ./scripts

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

# Bump version, build, publish; or pass --purge to delete stale GitHub releases
release *ARGS:
    bun scripts/release.ts {{ARGS}}

# Install release formula from tap and run formula test
test-release:
    HOMEBREW_NO_ASK=1 brew untap {{tap}} 2>/dev/null || true
    mkdir -p {{tap_parent}}
    ln -sfn '{{justfile_directory()}}' {{tap_path}}
    HOMEBREW_NO_ASK=1 brew uninstall --formula {{tap}}/{{cli_key}} 2>/dev/null || true
    brew install --formula {{tap}}/{{cli_key}}
    brew test {{cli_key}}

# Typecheck without emitting build artifacts
typecheck:
    bun run tsc --noEmit

# Undo dev/Homebrew install (remove agent artifacts, then keg + untap)
uninstall:
    @{{cli_key}} configure uninstall --yes 2>/dev/null || just run configure uninstall --yes
    @HOMEBREW_NO_ASK=1 brew uninstall --formula {{tap}}/{{cli_key}} 2>/dev/null || true
    @HOMEBREW_NO_ASK=1 brew uninstall --formula {{tap}}/{{cli_key}}-local 2>/dev/null || true
    @HOMEBREW_NO_ASK=1 brew untap {{tap}} 2>/dev/null || true