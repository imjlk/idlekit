# Start Here: CLI Designer Workflow

Korean version: [start-here-cli-designer_ko.md](./start-here-cli-designer_ko.md)

This is the shortest path for a designer who wants to turn an idle game idea into a runnable scenario.

## Base assumptions

- commands are run from the repository root
- development entrypoint: `bun run --cwd packages/cli dev -- ...`
- installed equivalent: `idk ...`

## 1. Generate your own bundle

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json --name "Space Miner"
```

The `personal` track always creates three files:

- `space-miner-v1.json`
- `space-miner-v1-compare-b.json`
- `space-miner-v1-tune.json`

## 2. Validate and simulate

```bash
bun run --cwd packages/cli dev -- validate ../../tmp/space-miner-v1.json
bun run --cwd packages/cli dev -- simulate ../../tmp/space-miner-v1.json --format json
bun run --cwd packages/cli dev -- experience ../../tmp/space-miner-v1.json --format json
```

Success condition:

- validation prints `OK:`
- simulation JSON includes `endMoney`, `endNetWorth`, and `stats`
- experience JSON includes `growth`, `milestones`, and `perceived`

## 3. Change the first three things

Start by editing only:

- `unit.code` / `unit.symbol`
- `model.params`
- `clock.durationSec`
- `design.intent` / `design.sessionPattern`

That is enough to turn the starter template into a first game-specific balance draft.

## 4. Check the play feel, not just the economy

`experience` is the shortest design-facing command. It answers questions like:

- how often does the player see visible progression?
- how long is the worst no-reward stretch?
- when does the first upgrade or milestone show up?

```bash
bun run --cwd packages/cli dev -- experience ../../tmp/space-miner-v1.json \
  --session-pattern short-bursts \
  --days 7 \
  --format json
```

Success condition:

- JSON includes `design.sessionPattern`, `milestones.milestones`, and `perceived.visibleChangesPerMinute`

## 5. Add long-horizon checks

```bash
bun run --cwd packages/cli dev -- ltv ../../tmp/space-miner-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --format json
```

Success condition:

- `summary.at30m`, `summary.at24h`, `summary.at7d`, `summary.at30d`, and `summary.at90d` exist

## 6. Compare and tune

```bash
bun run --cwd packages/cli dev -- compare ../../tmp/space-miner-v1.json ../../tmp/space-miner-v1-compare-b.json --metric endNetWorth --format json
bun run --cwd packages/cli dev -- compare ../../tmp/space-miner-v1.json ../../tmp/space-miner-v1-compare-b.json --metric visibleChangesPerMinute --session-pattern short-bursts --days 7 --format json
bun run --cwd packages/cli dev -- tune ../../tmp/space-miner-v1.json --tune ../../tmp/space-miner-v1-tune.json --format json
```

Success condition:

- compare JSON reports `detail.source === "measured"`
- tune JSON includes `report.best`, `insights.patterns`, and `insights.scoreSpread`

Next reading:

- [tutorial-step-by-step.md](./tutorial-step-by-step.md)
- [virtual-scenario-design.md](./virtual-scenario-design.md)
