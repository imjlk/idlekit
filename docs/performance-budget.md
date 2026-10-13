# Performance budgets

Korean version: [performance-budget_ko.md](./performance-budget_ko.md)

`DX-04` keeps the simulate benchmark and splits compiler prepare from simulation runtime. A slow artifact shows which phase moved. A performance claim names the host and the corpus.

Phases are `install`, `prepare-cold`, `prepare-warm`, `check`, `build`, and `runtime`. In `tools/bench-sim.ts`, `prepare-cold` is the first ttsc bundle build of the CLI (`packages/cli/scripts/cli-bundle.ts`) in the bench process, and `prepare-warm` repeats that build (`--prepare-warm`, default 1). Caches left by earlier commands are not cleared, so cold means the first prepare in this run. Warmup simulate processes are discarded. Measured simulate processes are `runtime`. `stepsPerSec` divides the workload count by the median runtime seconds. Prepare time is not part of that rate.

The artifact contract is `idlekit.performance-budget`, schemaVersion 1. It is a tools record, not an npm export. The config hash covers engine, seed, model, model version, step, trace, observer, worker, and planner. The artifact also records the repository-relative scenario path and `scenarioHash`, the sha256 of the canonical scenario JSON, which covers duration, model params, and strategy inputs. A comparison needs the same config, scenario hash, and workload count. Otherwise it is `workload-mismatch`. The trace mode reads `outputs.report.traceEverySteps`. A cadence above 1 is `bounded`. The engine is the run's `_meta.effectiveEngine`, not `scenario.engine`, which simulate records as metadata. Bun, OS, and arch must also match, or the comparison is `host-mismatch`. CPU brand is recorded and not compared. Full trace is not the default scoring mode. The representative scenario is [examples/bench/representative.json](../examples/bench/representative.json) and leaves trace off.

Metrics are total time median and nearest-rank p95, steps/sec, planner expanded nodes and nodes/sec, draws/sec, RSS and heap delta, peak RSS, and observation retained samples. `allocPerStep` is `unsupported`. A missing counter is `absent`. A measured 0 stays `measured` 0. Planner node counts and Monte Carlo draw counts are recorded only when the caller supplies them. `tools/bench-planner.ts` and `tools/bench-monte-carlo.ts` do not enter the rollout or the draw loop. They reject a negative sample or counter and record `warmup` 0. Worker `startupMs` and `serializationMs` stay `absent`. `tools/bench-sim.ts` records `peakRssBytes` as the largest `maxRSS` of the measured simulate child processes. It leaves RSS and heap delta `absent`, because the harness process does not run the simulation, and leaves observation retained samples `absent`, because simulate output has no observation retention count.

The hard gate needs a minimum repeat count, a relative slowdown, and an absolute median floor. It fails only when the repeat count is sufficient and the current median exceeds both limits. A small absolute jitter can pass. Too few repeats fail and do not pass. A config hash mismatch is rejected. A baseline without an integer `iterations` of at least 1 and an integer `warmup` of at least 0 is not read. The gate does not write a new baseline.

Pull request CI runs `bench:sim:check` on the representative scenario. It compares against [examples/bench/perf-baseline.json](../examples/bench/perf-baseline.json) with a relative slowdown of 0.25 and an absolute median floor of 250ms, on top of the 500ms mean and 900ms p95 limits. The baseline file keeps one entry per scenario and host. Each run selects the entry for its own Bun, OS, and arch. `bun run bench:sim:baseline` replaces this host's entry and keeps the others. The gate never writes it. `bench:sim:suite:check` also limits each simulate child's peak RSS with `--threshold-peak-rss-bytes`. The long linear corpus runs from [.github/workflows/performance-corpus.yml](../.github/workflows/performance-corpus.yml) via `bench:sim:suite:check`. `kpi:report` and `kpi:regress` stay the economic gate.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Commands

```bash
bun run bench:sim
bun run bench:sim:check
bun run bench:sim:baseline
bun run bench:planner -- --runtime-ms 100,200 --nodes 32 --workload 30
bun run bench:monte-carlo -- --runtime-ms 100,200 --draws 1000 --workload 30
bun run bench:sim:suite
bun run bench:sim:suite:check
```

`bench:sim:check` is the representative gate. `bench:sim:suite:check` is the scheduled long corpus. `--baseline` reads one artifact or a `bench-sim --out` result, compares each scenario with the entry of the same scenario hash, and does not rewrite the file.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `da567ec5e27d48c767867a8167878bb5984adec3d24b650f4321eb0025091bf5`. `contracts:check` is unrun. `bench:sim:check` and `bench:sim:suite:check` ran on this macOS host, not on the CI runner.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test tools/performanceBudget.test.ts` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/bench-planner.ts --runtime-ms 100,200 --nodes 32 --workload 30` | 0 |
| `bun tools/bench-monte-carlo.ts --runtime-ms 100,200 --draws 0 --workload 30` | 0 |
| `bun run typecheck` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |
| `bun run docs:verify:quick` | 0 |
| `bun run contracts:check` | unrun |
| `bun run bench:sim:check` | 0 |
| `bun run bench:sim:suite:check` | 0 |

`graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0. The first `evidence:check` exited 2 because the disk could not finish a cold plugin build. The next exited 2 on placeholder reviews. The rerun after those reviews exited 0.
