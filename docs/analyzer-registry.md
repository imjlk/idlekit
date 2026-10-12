# Analyzer registry

Korean version: [analyzer-registry_ko.md](./analyzer-registry_ko.md)

`DX-02` adds `AnalyzerRegistry` beside `ModelAnalysisAdapter`. The model adapter says what one model version can provide. The analyzer registry says which algorithm runs, which observation it needs, and which budget it may spend. They do not share a name or a method list. `Model` does not grow a method.

`growth` and `eta` are adapters. `growth` calls `analyzeGrowth` and keeps the legacy speed-bucket report. Its adapter version is `growth-report-v1`. It does not call `fitGrowth`. `eta` calls `etaSimulate` or `etaAnalytic`. Its algorithm version stays `eta-estimate-v1`. A judge, including Jev, is not an analyzer.

A postprocess analyzer reads an existing run. If the observation coverage, window, cadence, or metric ids are short, the result is `insufficient-data` and a rerun plan; the registry checks this before every postprocess body. It does not start a simulation. An execution analyzer receives a `RunFactory` and an explicit budget. `idk analyze eta` is a request to run. A horizon past `budget-duration`, or `budget-runs` of `0`, does not call the body. Fresh runs and samples are reserved across the whole batch, and only for analyzers whose capabilities and metrics allow them to run. A body's own rerun reason, such as `missing-scenario`, is kept. `cost.freshRuns` is `0` or `1`, and `resolveCost` can set it per request: analytic ETA costs no fresh run. Simulated ETA is checked against the duration it actually runs, `maxDurationSec`.

Analyzers share one fresh run only when the session, strategy, horizon, step, seed, and observation demand match. A different horizon is a separate run. The grant's `run()` opens that run once through the caller `RunFactory`, and every member of the group gets the same `RunResult`. A definition with `sharesRun: false`, such as ETA, is always its own group, and a blocked analyzer is not reported as a peer. The traced cadence rounds down so it is never coarser than the demand; a demand finer than one step is `insufficient-data`. An unrequested dependency runs under the semantics of the analyzer that pulled it in. A dependent does not run when its dependency is blocked or does not finish `ok`. Duplicate ids, dependency cycles, missing dependencies, incomplete definitions, and bad params fail before a body runs. Results are sorted by id, then version.

`idk analyze <id>` is a new command. `--analyzer-version` selects the analyzer version, default `1`; `--version` stays the CLI version. A registered execution analyzer runs with the compiled scenario and the `--budget-*` flags. A registered postprocess analyzer, or an analyzer with a postprocess dependency, gets one run of the scenario traced every `--trace-every` steps as `input`, with a trace supply at that cadence; `--trace-every` is a whole number of steps. That run takes one fresh run and must fit `--budget-duration`; the registry gets the runs left over, and with none left the analyzer is `insufficient-data`. The run is counted in the result's `provenance.freshRuns`, an until-only scenario is bounded by `--max-duration`, and no run is made when every reachable postprocess demand is empty. `idk analyze growth` takes this same path, with `--series` and `--window` as its params. Params are validated before any run. The observation run and each analyzer run compile the scenario separately, so a stateful plugin model or strategy never carries one run's state into another. The supply lists `money` and `netWorth` only. Provenance semantics come from the compiled scenario: its strategy, step, and seed, and its duration (ETA uses `--max-duration`). JSON `_meta` records the plugin digests and hashes the scenario that was compiled, not a second read of the file. `idk eta`, `idk growth`, and `idk prestige-cycle` stay. A custom analyzer is registered by the caller or by a plugin. Plugin modules still require `--allow-plugin` and the existing root and sha256 checks. One rejected analyzer does not drop the builtins. Core does not import the CLI, Jev, the filesystem, or the network for this registry.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. `contracts:check` is unrun.

| Command | Exit |
|---|---|
| `bun test src/sim/analysis/analyzers.test.ts` in `packages/core` | 0 |
| `bun test --timeout 60000 src/commands/analyze.test.ts src/plugin/load.test.ts` in `packages/cli` | 0 |
| `bun run generate` and `bun run generate:check` in `packages/cli` | 0 |
| `bun run evidence:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run format:check` | 0 |
| `bun run public:check` | 0 |
