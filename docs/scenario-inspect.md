# Scenario inspect

Korean version: [scenario-inspect_ko.md](./scenario-inspect_ko.md)

`DX-03` adds `idk inspect <scenario> --format json|md`. It explains the resolved run plan. It is not `doctor`. The default path does not tick, does not call Jev, and does not use the network.

The explanation and the run that would start share `prepareResolvedRun` `planFor`. That reads the stage plan and does not call `fresh`. `scenario.engine` stays metadata. The default engine is `number`. `breakInfinity` is an explicit flag and is not passed through `Number`. `breakEternity` is rejected. The JSON report is still written, and the process exits non-zero.

A fixed duration counts every tick, including a shorter last tick, through `nextBoundary`. An until-only clock with no `durationSec` reports step count `unknown`. A count past one million ticks is `unknown`, and so is a session stage, which runs its schedule rather than the scenario duration. A planner expansion is an upper bound from the horizon, beam, and branch caps, with a wait branch beside each node's actions, up to the rollout budget of 256. `measuredDurationSec` is null. The warning is a budget proposal, not a measured duration. An omitted `sim.eventLog` is the runner's enabled, unbounded log, and a trace without a cadence is traced every step. Each stage reports the fast mode it runs and whether it came from the command or the scenario. Inspect reads stage plans without compiling the scenario, so no model or strategy factory is created. It takes the same `--session-pattern` and `--days` flags as experience, and `--step` must be finite and positive. A plugin that replaces a built-in id is reported as loaded, and plugin strategies and analyzers are listed as `strategy:<id>` and `analyzer:<id>@<version>`. A scenario whose model or strategy only a skipped plugin provides still gets a report, and `plugin-skipped` names it. A plugin `planner` gets no built-in planner bound. Decimal warnings read only sections whose literals enter the engine, not `meta`. A traced run supplies observation windows as fine as its trace cadence. Model and strategy ids are identifiers, so only their params are read for decimals. A custom engine reports `numericDomain.exact: "unknown"` and still gets the decimal warning. The report includes the ltv stage that evaluate and ltv open, with an unknown count. Planning rejects initial money and an `untilExpr` that compileScenario would reject. `untilExpr` literals are checked for decimal range, the initial wallet unit and model vars are not, and plugin objectives are listed as `objective:<id>`. A trace cadence that is not a positive integer supplies no cadence. Planning also rejects a step or duration the runner rejects, such as an infinite YAML step, for the step each stage runs. Strategy params are read from the strategy each stage runs, so an override replaces the scenario params. A `t` or `prestige.count` literal in `untilExpr`, and any other numeric comparison, goes through `Number` whatever the engine, so it warns under `breakInfinity` too. Each stage reports its action log. A session keeps every action, and ltv forces an uncapped action log, so both report `unlimited: true`. A skipped plugin strategy is recognized only by the typed unknown-strategy error.

Builtin model capabilities are `unknown` when no analysis adapter is registered. `unsupported` is a declared no. An unloaded plugin stays `unknown`. `--resolve-plugins` is the only path that imports a plugin, and only after the existing allow, root, and sha256 checks. That mode warns that user code may run. The report lists factory ids and versions. It does not include plugin source, secrets, or environment values.

Diagnostics use a code and evidence values. Invalid engine is an error. Decimal range, missing reset, insufficient observation, unit mismatch, unlimited trace, and planner cost are warnings and exit 0.

Registered analyzers from `DX-02` are attached with their observation demand and whether the configured supply meets it. The analyzer body does not run.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. `contracts:check` is unrun.

| Command | Exit |
|---|---|
| `bun test --timeout 120000 src/sim/analysis/inspect.test.ts` in `packages/core` | 0 |
| `bun run generate` and `bun run generate:check` in `packages/cli` | 0 |
| `bun test --timeout 60000 src/commands/inspect.test.ts` in `packages/cli` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |

The first core run exited 1. The first two CLI runs exited 1. The first `evidence:check` exited 2 on placeholder reviews. Those reruns exited 0. `graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0. `contracts:check` is unrun.
