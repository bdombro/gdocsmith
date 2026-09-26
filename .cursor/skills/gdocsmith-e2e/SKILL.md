---
name: gdocsmith-e2e
description: Run current-version agent E2E scenarios on disposable copies of a complex Google Doc fixture, then diagnose task failures and opportunities to improve gdocsmith.
---

# gdocsmith-e2e

Use `just test-e2e --case outline-headings --runs 1 --pilot` for a read-only pilot, then choose tasks from [scenarios.md](scenarios.md) and run `just test-e2e --case <id> --runs 1`. The runner builds the current checkout, launches an isolated Claude session per fresh fixture copy, verifies document outcomes independently, stores a report and JSONL traces under `~/.cache/gdocsmith/evals/`, and deletes the copies. Inspect failures for agent, skill, tool, or guard improvements. Never force a refused change or claim comments were preserved without live verification.
