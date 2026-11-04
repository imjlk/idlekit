# Genre presets

Korean version: [README_ko.md](./README_ko.md)

Each file here is the output of `idk init scenario --preset <genre>`, kept equal to the CLI source by `bun run templates:check`. Every preset runs on a built-in model and needs no plugin.

| Preset | File | Model | What it shows |
| --- | --- | --- | --- |
| `cookie-clicker` | [`cookie-clicker-v1.json`](./cookie-clicker-v1.json) | `exponential` | One fast-scaling generator with seeded golden-cookie drops, frenzy events, and lucky clicks |
| `tycoon` | [`tycoon-v1.json`](./tycoon-v1.json) | `multi-currency` | Several businesses, a capped premium currency, and a market that converts its overflow |
| `prestige-heavy` | [`prestige-heavy-v1.json`](./prestige-heavy-v1.json) | `prestige` | Short runs; the `scripted` strategy takes `prestige.reset` as soon as it is offered |
| `crafting` | [`crafting-v1.json`](./crafting-v1.json) | `production-chain` | Gather wood and stone, craft planks and tools, sell tools; unlock gates and a storage cap |
| `session-arcade` | [`session-arcade-v1.json`](./session-arcade-v1.json) | `exponential` | A 30-minute loop with frequent crits, bonus rounds, and a log soft cap |

## Presets

Each preset lists its design intent, the parameters worth editing first, and the analysis commands that answer its main question.

### `cookie-clicker`

- Intent: `frequent-progression`. Clicks and one auto producer scale fast, and seeded luck keeps short sessions lively.
- Key params: `growthRate` 1.06 and `costGrowth` 1.15 set the buy cadence; `softCap` (`pow`, starts at `1e5`, strength 0.6) bends late growth; `stochastic.crit` (2%, x7), the `golden-cookie` drop (0.005/s, 300s of income), and the `frenzy` event (35% per 15 min, 77s at x7).
- Recommended commands:

```bash
idk experience cookie-clicker-v1.json --format md
idk eta cookie-clicker-v1.json --target-worth 1e6 --format json
idk growth cookie-clicker-v1.json --format json
```

### `tycoon`

- Intent: `scale-fantasy`. Buildings stack up, a premium currency gates the top building, and its overflow sells back.
- Key params: the `generators` ladder (`lemonade` → `newspaper` → `car-wash`, with `costBase`/`incomePerLevel` per rung); `gold` with `cap` 50 and `valueInPrimary` 25; `investor` (gold income, `maxLevel` 20); `bank` paid in gold; the `sell-gold` exchange (rate 20, fee 0.15) on `autoConvert: overflow`.
- Recommended commands:

```bash
idk simulate tycoon-v1.json --format md
idk growth tycoon-v1.json --format json
idk evaluate tycoon-v1.json --format md
```

### `prestige-heavy`

- Intent: `strategic-optimization`. The reset loop is the game: runs are short and every reset adds a permanent multiplier.
- Key params: `prestige.requirement` `5e3`; `formula` `root` with exponent 0.5; `multiplierPerPoint` 0.1 (`additive`); `minRunSec` 300 and `minGain` 2 gate a reset; `starterCash` and `keepLevels` 3 soften the restart. The `scripted` strategy tries `prestige.reset` first on every loop.
- Recommended commands:

```bash
idk simulate prestige-heavy-v1.json --format md
idk reset-policy prestige-heavy-v1.json --scan 300..1800 --step 300 --format md
idk prestige-cycle prestige-heavy-v1.json --format md
```

### `crafting`

- Intent: `strategic-optimization`. Resources flow through recipes, so the bottleneck moves as the chain unlocks.
- Key params: `resources` with `valueInPrimary` (net worth weights) and the `plank` `cap` 150; `recipes` `lumberjack` → `quarry` → `sawmill` → `workshop` → `trader`, each with `inputs`, `outputs`, `timeSec`, `build` cost, and `unlock` gates; `trader` `maxLevel` 20.
- Recommended commands:

```bash
idk simulate crafting-v1.json --format md
idk eta crafting-v1.json --target-worth 1e5 --format json
idk experience crafting-v1.json --format md
```

### `session-arcade`

- Intent: `frequent-progression` in a 30-minute clock. Many small wins per session matter more than the long tail.
- Key params: `clock.durationSec` 1800; cheap `costBase` 5 with `costGrowth` 1.1 and `maxLevel` 120; `softCap` `log` from 5000; `stochastic.crit` (10%, x3); the `bonus-round` event (50% per 3 min, 20s at x4); `design.sessionPattern` `short-bursts`.
- Recommended commands:

```bash
idk experience session-arcade-v1.json --format md
idk evaluate session-arcade-v1.json --horizons 30m,2h --format md
```

## Tutorial

```bash
idk init scenario --preset cookie-clicker --out ./my-clicker.json
idk validate ./my-clicker.json
idk simulate ./my-clicker.json --format md
idk experience ./my-clicker.json --format md
idk evaluate ./my-clicker.json --format md
```

From a clone, use `bun run --cwd packages/cli dev --` in place of `idk`.

- `experience` reads the preset's `design.sessionPattern`. The stochastic presets set `analysis.experience.draws`, so `experience` prints Monte Carlo confidence intervals.
- `prestige-heavy` is the only preset that resets during `simulate`. Use `idk reset-policy` to compare fixed reset intervals on it.
- `--preset <genre>` writes one scenario. It does not take `--wizard`, `--name`, or a track other than `intro`.
- To tune a preset, write a design-study spec and run `idk sensitivity` and `idk optimize`; see [Advanced analysis](../../docs/advanced-analysis.md).
