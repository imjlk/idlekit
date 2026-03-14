# idlekit

Korean version: [README_ko.md](./README_ko.md)

`idlekit` is a Bun-first toolkit for idle game economy design and design-decision evaluation.
It provides three public packages:

- `@idlekit/money`: money primitives, notation, policies, and serialization
- `@idlekit/core`: scenario compilation, simulation, analysis, and reporting
- `@idlekit/cli`: the `idk` CLI for validation, simulation, tuning, and reporting

## What is idlekit?

Use `idlekit` when you want to:

- model an idle or incremental game's economy as JSON scenarios
- evaluate pacing, milestones, perceived progression, and session-pattern outcomes
- compare balance variants with measured simulation results
- tune strategy parameters and replay deterministic runs
- package money/simulation logic as reusable Bun-first libraries

## Packages

```bash
bun add @idlekit/money
bun add @idlekit/core
bun add -g @idlekit/cli
```

## Quick start

Repository examples:

```bash
bun install
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/11-my-game-v1.json
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/11-my-game-v1.json --format json
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/11-my-game-v1.json --format json
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/11-my-game-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --format json
```

Installed CLI flow:

```bash
idk validate ./my-game-v1.json
idk simulate ./my-game-v1.json --format json
idk experience ./my-game-v1.json --format json
```

Use the repository examples while you are inside this checkout. Use your own local scenario files after installing `idk`.

To scaffold your own bundle immediately:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json --name "Space Miner"
```

Then run:

```bash
bun run --cwd packages/cli dev -- validate ../../tmp/space-miner-v1.json
bun run --cwd packages/cli dev -- simulate ../../tmp/space-miner-v1.json --format json
bun run --cwd packages/cli dev -- experience ../../tmp/space-miner-v1.json --format json
```

Worked real-game example:

```bash
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/14-orbital-foundry-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/14-orbital-foundry-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --session-pattern twice-daily \
  --days 7 \
  --format json
```

## Documentation

- Start here: [docs/start-here-cli-designer.md](./docs/start-here-cli-designer.md)
- Step-by-step tutorial: [docs/tutorial-step-by-step.md](./docs/tutorial-step-by-step.md)
- Scenario design workshop: [docs/virtual-scenario-design.md](./docs/virtual-scenario-design.md)
- Command reference: [docs/usage-guide.md](./docs/usage-guide.md)
- Money package guide: [docs/money-library.md](./docs/money-library.md)
- Plugin and adapter guide: [docs/plugin-and-adapter.md](./docs/plugin-and-adapter.md)
- Scenario and tuning spec: [docs/scenario-and-tuning.md](./docs/scenario-and-tuning.md)
- Testing and release operations: [docs/testing.md](./docs/testing.md), [docs/release-process.md](./docs/release-process.md)
- Output schemas: [docs/schemas/README.md](./docs/schemas/README.md)

## Contributing

- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security policy: [SECURITY.md](./SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Release and changeset rules: [.sampo/README.md](./.sampo/README.md)

## Maintainer checks

```bash
bun run typecheck
bun run runtime:check
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run public:check
bun run replay:verify
bun run release:plan
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run release:dry-run
```

## License

[MIT](./LICENSE)
