# Performance budgets

Korean version: [performance-budget_ko.md](./performance-budget_ko.md)

`DX-04` keeps the simulate benchmark and splits compiler prepare from simulation runtime. A slow artifact shows which phase moved. A performance claim names the host and the corpus.

Phases are `install`, `prepare-cold`, `prepare-warm`, `check`, `build`, and `runtime`. The first simulate process is `prepare-cold` because it includes the first native plugin prepare. The next warmup processes are `prepare-warm`. Later processes are `runtime`. `stepsPerSec` divides the workload count by the median runtime seconds. Prepare time is not part of that rate.

The artifact contract is `idlekit.performance-budget`, schemaVersion 1. It is a tools record, not an npm export. The config hash covers engine, seed, model, model version, step, trace, observer, worker, and planner. Only artifacts with the same config are compared. Full trace is not the default scoring mode. The representative scenario is [examples/bench/representative.json](../examples/bench/representative.json) and leaves trace off.

Metrics are total time median and p95, steps/sec, planner expanded nodes and nodes/sec, draws/sec, RSS and heap delta, and observation retained samples. `allocPerStep` is `unsupported`. A missing counter is `absent`. A measured 0 stays `measured` 0. Planner node counts and Monte Carlo draw counts are recorded only when the caller supplies them. `tools/bench-planner.ts` and `tools/bench-monte-carlo.ts` do not enter the rollout or the draw loop. Worker `startupMs` and `serializationMs` stay `absent`.

The hard gate needs a minimum repeat count, a relative slowdown, and an absolute median floor. It fails only when the repeat count is sufficient and the current median exceeds both limits. A small absolute jitter can pass. Too few repeats fail and do not pass. A config hash mismatch is rejected. The gate does not write a new baseline.

Pull request CI runs `bench:sim:check` on the representative scenario. The long linear corpus runs from [.github/workflows/performance-corpus.yml](../.github/workflows/performance-corpus.yml) via `bench:sim:suite:check`. `kpi:report` and `kpi:regress` stay the economic gate.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Commands

```bash
bun run bench:sim
bun run bench:sim:check
bun run bench:planner -- --runtime-ms 100,200 --nodes 32 --workload 30
bun run bench:monte-carlo -- --runtime-ms 100,200 --draws 1000 --workload 30
bun run bench:sim:suite
bun run bench:sim:suite:check
```

`bench:sim:check` is the representative gate. `bench:sim:suite:check` is the scheduled long corpus. `--baseline` compares and does not rewrite the file.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `dbe31ae0cdbeb5d919065a13f53145ddf3c42dea631e2b1334aa4ad44e17ef27`. `contracts:check`, `bench:sim:check`, and `bench:sim:suite:check` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test tools/performanceBudget.test.ts` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/bench-planner.ts --runtime-ms 100,200 --nodes 32 --workload 30` | 0 |
| `bun tools/bench-monte-carlo.ts --runtime-ms 100,200 --draws 0 --workload 30` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |
| `bun run contracts:check` | unrun |
| `bun run bench:sim:check` | unrun |
| `bun run bench:sim:suite:check` | unrun |

`graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0. The first `evidence:check` exited 2 because the disk could not finish a cold plugin build. The next exited 2 on placeholder reviews. The rerun after those reviews exited 0.
