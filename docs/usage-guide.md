# idlekit CLI Reference

Korean version: [usage-guide_ko.md](./usage-guide_ko.md)

Choose your entrypoint first:

1. Start your own game: [start-here-cli-designer.md](./start-here-cli-designer.md)
2. Study the canonical real-game example: [virtual-scenario-design.md](./virtual-scenario-design.md)
3. Learn the command loop: [tutorial-step-by-step.md](./tutorial-step-by-step.md)

## Environment

- Bun 1.3+
- repository workflow: `bun install`, `bun run typecheck`, `bun run test`, `bun run build`

## CLI modes

Development:

```bash
bun run --cwd packages/cli dev -- --help
```

Built output:

```bash
bun run --cwd packages/cli build
bun packages/cli/dist/main.js --help
```

Installed CLI:

```bash
bun add -g @idlekit/cli
idk --help
```

## Common commands

```bash
idk init scenario --wizard true --track personal --preset builder --out ./my-game-v1.json
idk validate <scenario>
idk simulate <scenario> --format json
idk experience <scenario> --format json
idk evaluate <scenario> --format md
idk review evaluate <scenario> --image-mode auto
idk review compare <a> <b> --image-mode auto
idk review doctor
idk compare <a> <b> --metric endNetWorth --format json
idk compare <a> <b> --bundle design --format json
idk compare <a> <b> --metric visibleChangesPerMinute --session-pattern short-bursts --days 7 --format json
idk tune <scenario> --wizard true
idk tune <scenario> --tune <tunespec> --format json
idk setup completions --shell zsh
idk setup plugin-trust --plugin ./custom-econ-plugin.ts --out ./.idk/plugin-trust.json
idk ltv <scenario> --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --format json
idk doctor --format md
idk doctor --fix true --shell zsh
idk completions zsh
idk replay verify <artifact> --format json
```

## Design evaluation commands

- `experience`: session-pattern simulation, growth, milestones, and perceived progression
- `compare`: deterministic or design-facing A/B comparison
- `evaluate`: one-shot workflow for validate + simulate + experience + ltv
- `review evaluate`: interactive design dashboard built on top of `evaluate`
- `review compare`: interactive design comparison dashboard built on top of `compare`
- `review doctor`: interactive setup-health dashboard built on top of `doctor`
- `tune`: strategy search against economy or experience-oriented objectives
- `ltv`: long-horizon monetization and value proxy estimation

## Run configuration flags

`validate` checks the selected model and strategy against the loaded registries, including strategy parameters and factory defaults. It validates schemas without constructing the strategy. Load a custom strategy plugin explicitly with `--plugin` and `--allow-plugin true`. The core `validateScenarioV1(input, modelRegistry?, strategyRegistry?)` API keeps registry checks optional.

`evaluate` compiles the scenario once. Simulate, experience, and ltv each open a fresh model and strategy from that plan.

- `--strategy` on `evaluate`, `simulate`, `experience`, `ltv`, and `review evaluate` is a registered strategy id. `greedy`, `planner`, and `scripted` remain built in. An unknown id is rejected. A plugin is not loaded just because the flag names it. `compare` and `review compare` still accept only those three builtins. The flag replaces the scenario strategy, which is then not built, so a scenario strategy that is not registered or has invalid params does not stop the run. Without the flag it still fails.
- `--engine` defaults to `number`. `scenario.engine` is recorded metadata and does not select the runtime. `breakInfinity` is an explicit engine. `breakEternity` is an unsupported error. A custom engine runs only from a trusted factory the caller already holds.
- `--step` and `--fast` apply to simulate and ltv. On `evaluate` they reach experience only with `--consistent-overrides true`. The standalone `experience` command does not take `--step` or `--fast`. Session pattern and `--days` stay on experience.
- `scenarioHash` is still the original scenario object. `effectiveRunHash`, `effectiveEngine`, and `stageScope` are optional `_meta` fields. The hash ignores `generatedAt`, the working directory, and absolute paths. It keeps `--plugin` order, because a later plugin replaces an earlier one with the same model or strategy id. Each `pluginDigest` value covers the plugin file and the files it reaches through local imports (`./`, `../`, absolute paths, `file:` URLs), keyed by their path from the plugin directory. A plugin without local imports keeps its file sha256. Installed packages and other bare specifiers are not hashed. `--plugin-sha256` and the trust file pin the plugin file alone. `idlekit.resolved-run-configuration` is not registered with a contract generator until TC-05.
- Amount goals such as `money >= 1aa` use `parseMoney` on the amount path for both the number engine and `breakInfinity`. `1e400` stays on `breakInfinity` and is not converted with `Number` first.
- Strategy parameter checks default to legacy raw. The internal schema adapter is not the external Standard Schema package.

`simulate.durationSec` counts online tick seconds. `totalElapsedSec` also includes credited offline tick seconds and elapsed time retained in a resumed save. New saves preserve this total in `meta.totalElapsedSec`; older saves fall back to their timestamp offset for the saved portion. Action-log `elapsedSec` counts tick seconds before the action (including prior credited session segments), while `t` remains the absolute timestamp. LTV uses that elapsed clock for `timeToFirstUpgradeSec`, so large initial timestamps do not round this KPI.

Recommended interactive order:

1. `idk init scenario --wizard`
2. `idk review doctor`
3. `idk review evaluate`
4. `idk review compare`
5. `idk tune --wizard`

## Completions and metadata

- `idk completions zsh|bash|fish|powershell`: emit shell completion script
- `idk complete -- <args...>`: dynamic completion protocol endpoint
- `idk doctor`: validate generated metadata, completions wiring, and Bun runtime assumptions
- `idk doctor --fix`: apply the managed completions block and optionally generate plugin trust output
- `idk doctor --format md|json`: automation/setup report path
- `idk review doctor`: human setup review path
- `idk setup completions`: install the managed completions block directly
- `idk setup plugin-trust`: generate a sha256 trust file for plugin-based runs

## Wizard flows

- `idk init scenario --wizard`: interactive scenario scaffold generation
- `idk tune --wizard`: interactive TuneSpec generation before the tune run
- `idk doctor --wizard`: interactive setup for completions and plugin trust

## More guides

- [scenario-and-tuning.md](./scenario-and-tuning.md)
- [plugin-and-adapter.md](./plugin-and-adapter.md)
- [testing.md](./testing.md)
