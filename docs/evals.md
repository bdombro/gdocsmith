# v1 vs v2 Google Docs evaluation

## Method

On 2026-09-25 and 2026-09-26, `bun scripts/eval.ts` compared the v1 baseline at `f94df90d6eb2fc685a1ff917a97a231ecdbd6c7e` with v2 at `9420bd2e4ccbb17ba6484a0e0942baa860b4c76c` using Claude Code 2.1.282 and Sonnet (`claude-sonnet-5`). Each arm used its own committed Node MCP bundle and gdocsmith skill. The ten prompts asked for document outcomes without naming either version's step kinds. The two read-only outline pilots counted as the first outline attempts.

Each attempt used a fresh copy of the same source fixture. Claude ran in a disposable workspace with `--restricted --strict-mcp-config`, one arm-specific MCP server, and only its `run` and `status` tools. The harness verified document state independently with Google clients, permanently deleted the copies, and preserved stream JSONL and provider-reported usage in a private cache. Pilots, failures, and incomplete attempts count toward the durable maximum of 40 headless agent launches.

## Partial results

The first sweep finished with 20 complete attempts: v1 passed 5/10, v2 passed 9/10. The second sweep stopped after 14 launches: v1 passed 4/7 complete attempts; v2 passed 6/6 complete attempts, with one further attempt incomplete. In total, 34/40 slots were used, 33 attempts completed, 24 passed, and 9 completed with failed outcome checks. Six slots remain unused. These are partial, unequal-sample results, not a completed 40-attempt comparison or evidence of a causal performance difference.

| Case | v1 passed/complete | v2 passed/complete |
| --- | ---: | ---: |
| outline-headings | 2/2 | 2/2 |
| placeholder-fill | 2/2 | 2/2 |
| section-rewrite | 2/2 | 2/2 |
| find-replace | 2/2 | 2/2 |
| copy-section | 0/2 | 2/2 |
| table-row | 0/2 | 2/2 |
| new-tab | 0/2 | 0/1 (+1 incomplete) |
| style-cleanup | 0/1 | 1/1 |
| guard-respect | 0/1 | 1/1 |
| pageless | 1/1 | 1/1 |
| **Total** | **9/17 (53%)** | **15/16 (94%)** |

Completed outcome failures are not infrastructure aborts. Both arms failed the `new-tab` seeding check on completed attempts; after the first sweep, the verifier removed an overstrict page-style assertion, so the two sweeps did not use an identical seeding rubric. The other completed failures were v1 `copy-section`, `table-row`, `style-cleanup`, and `guard-respect`. No v2 case had a lower observed pass rate among completed attempts, but the missing v2 `new-tab` completion and single attempts for several cases limit the comparison.

## Usage and halt

The following figures exclude the incomplete attempt; means are per completed attempt, using available values. All 33 completed attempts reported usage and cost. `inputTokens` includes cached input, which is shown separately and must not be added again. These are Claude stream-result measurements, not independently audited billing.

| Arm | Mean input tokens | Mean cached input | Mean output tokens | Mean turns | Mean run calls | Mean failed calls | Total reported USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v1 (17 complete) | 132,934 | 101,733 | 2,135 | 4.29 | 3.29 | 0.76 | $2.830237 |
| v2 (16 complete) | 53,258 | 34,391 | 1,355 | 3.00 | 2.00 | 0.25 | $1.534116 |

Across completed attempts, invalid calls were 0 on both arms; v1 recorded 1 forced call and 0 refused calls, while v2 recorded 0 forced and 1 refused call. The incomplete attempt additionally reported $0.092142 and token usage, excluded from the table because its call metrics could not be confirmed. Missing usage is unavailable rather than zero; reported USD is `result.total_cost_usd`, not an inferred charge.

Launch 34 (`new-tab`, v2, second attempt) emitted `mcp__gdocsmith_eval_655fe77ed8b847d__run` when the configured server was `gdocsmith_eval_655fe77ed8b847de`. Claude reported `No such tool available` for that call, then used the correctly named tool and returned a final response. The unexpected name still fails the exact tool-isolation check, so the harness marked the attempt incomplete and halted on model/event/isolation confirmation. The final response does not override that gate; no further Claude sessions were launched. No run-owned fixture copies remain undeleted according to the recorded cleanup fields.

Raw records, per-run checks, usage, and the aborted stream: `~/.cache/gdocsmith/evals/g6-sonnet/runs.json`, `report.md`, and `034-new-tab-v2-2.stdout.jsonl`. The ledger at `~/.cache/gdocsmith/evals/g6-sonnet-launches` records all 34 launches.