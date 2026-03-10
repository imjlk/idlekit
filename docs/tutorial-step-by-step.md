# Tutorial: Two Tracks

Korean version: [tutorial-step-by-step_ko.md](./tutorial-step-by-step_ko.md)

This tutorial has two tracks:

- Intro track (about 15 minutes): learn the basic validation / simulation / report loop
- Plugin track (about 60 minutes): use a plugin model, compare variants, and tune a strategy

## Quick routing

- Want to scaffold your own game first? Start with [start-here-cli-designer.md](./start-here-cli-designer.md)
- Want to learn the command flow first? Stay here with `01-cafe-baseline.json`
- Want a worked idle design example first? Jump to [virtual-scenario-design.md](./virtual-scenario-design.md)

## Intro track

```bash
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/01-cafe-baseline.json
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/01-cafe-baseline.json --format json
bun run --cwd packages/cli dev -- eta ../../examples/tutorials/01-cafe-baseline.json --target-worth 1e5 --mode analytic --format json
bun run --cwd packages/cli dev -- compare ../../examples/tutorials/01-cafe-baseline.json ../../examples/tutorials/03-cafe-compare-b.json --metric etaToTargetWorth --target-worth 1e5 --max-duration 7200 --format json
bun run --cwd packages/cli dev -- tune ../../examples/tutorials/01-cafe-baseline.json --tune ../../examples/tutorials/04-cafe-tune.json --format json
```

Success conditions:

- `compare.detail.source === "measured"`
- `tune.report.best` exists

## Plugin track

```bash
bun run --cwd packages/cli dev -- models list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- tune ../../examples/plugins/plugin-scenario.json --tune ../../examples/plugins/plugin-tune.json --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true --format json
```

Success conditions:

- plugin registries list custom entries
- plugin tune returns `report.best`
