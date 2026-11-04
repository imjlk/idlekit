# Advanced analysis

Korean version: [advanced-analysis_ko.md](./advanced-analysis_ko.md)

This page covers seeded luck, confidence intervals, global sensitivity, parameter search, and reset-policy reports. Every one of them is deterministic for a given seed. `Math.random` is never read.

## Seeded stochastic events

The `exponential` and `prestige` models take an optional `stochastic` block in their params (for `prestige`, under `generator`):

```json
"stochastic": {
  "crit": { "chance": 0.05, "multiplier": 10 },
  "drops": [{ "id": "chest", "ratePerSec": 0.01, "rewardIncomeSec": 120 }],
  "events": [{ "id": "frenzy", "windowSec": 600, "chance": 0.5, "durationSec": 60, "incomeMultiplier": 7 }]
}
```

- `crit`: each tick rolls once. A critical tick multiplies that tick's income.
- `drops`: a Poisson drop. A tick of `dt` seconds fires with `1 - exp(-ratePerSec * dt)` and grants `rewardIncomeSec` seconds of the tick's base income.
- `events`: each window of `windowSec` rolls once. A running event multiplies income for its first `durationSec` seconds.

Each draw is a hash of the run seed, the stream id, and the tick (or window) index. No state is carried, so a planner preview, a resumed run, and a fresh run that reach the same tick see the same luck. Changing the seed, as Monte Carlo draws do, changes the luck. While a `stochastic` block is active the model reports no `analytic` hints, so the exact ETA falls back to simulation. `expectedStochasticIncomeFactor(spec, dt)` in core gives the long-run mean factor as a design check.

[`30-lucky-forge-v1.json`](../examples/tutorials/30-lucky-forge-v1.json) is a worked example with 16 Monte Carlo draws.

## Quantiles and confidence intervals

`idk experience` with more than one draw now adds `monteCarlo.intervals` with `endNetWorthLog10`, `visibleChangesPerMinute`, and `maxNoRewardGapSec`. Each is a `SampleSummaryV1`: `n`, mean, sd, min, max, a normal-approximation interval of the mean, and quantiles 0.1, 0.5, and 0.9 with distribution-free order-statistic intervals. An interval is `null` when the sample is too small for the requested confidence. A field is `null` when no draw was finite. Markdown prints the 95% intervals under `## Monte Carlo`.

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/30-lucky-forge-v1.json --seed 7 --format md
```

Core exports `summarizeSamples`, `quantileInterval`, and `normalQuantile` for other reports.

## Design-study spec

`idk sensitivity` and `idk optimize` read the same spec (JSON or YAML), for example [`examples/design-study/forge-study.json`](../examples/design-study/forge-study.json):

- `parameters`: 1 to 32 rows of `{ path, min, max, scale?: "linear" | "log", integer? }`. `path` is a dotted path into the scenario, such as `model.params.costGrowth`. The parent must exist. Prototype segments are refused. A string leaf stays a string.
- `objectives`: 1 to 8 terms, each with a `weight`. The score is the weighted sum, lower is better:
  - `milestoneTime`: `log10(sec + 1)` to the first milestone, or to `milestoneKey`. A censored draw counts as horizon + 1.
  - `sessionPacing`: `|log10(pace / targetVisibleChangesPerMinute)| + max(0, gap / maxNoRewardGapSec - 1)`.
  - `endNetWorthLog10`: negated, so more is better.
  - `ltv`: estimated LTV per user from the monetization config over `horizonDays`, negated.
- `evaluation`: `sessionPattern`, `days`, and `draws` (1 to 64). Each evaluation compiles the patched scenario and runs `experience` once per draw, then averages.

## Global sensitivity: `idk sensitivity`

```bash
bun run --cwd packages/cli dev -- sensitivity ../../examples/tutorials/26-exponential-forge-v1.json \
  --spec ../../examples/design-study/forge-study.json --method morris --max-runs 40 --format md
```

- `--method morris` (default): elementary-effects screening with `levels` (default 4) and `floor(maxRuns / (k + 1))` trajectories. It reports `mu`, `muStar`, and `sigma` per parameter, in unit coordinates so parameters with different ranges compare.
- `--method sobol`: Saltelli first-order `S1` and Jansen total-order `ST` with `N = floor(maxRuns / (k + 2))` base rows and bootstrap percentile intervals (`--bootstrap`, default 200).
- Default budgets are `10 (k + 1)` for Morris and `64 (k + 2)` for Sobol. `--seed` fixes the design points.
- Indices are computed for the score and for each objective from the same cached runs, so a per-objective ranking costs no extra simulation.
- Hints name the top parameter, parameters that can be frozen, and strong interactions. `idk experiment` stays the one-at-a-time sweep around one point.

## Parameter search: `idk optimize`

```bash
bun run --cwd packages/cli dev -- optimize ../../examples/tutorials/26-exponential-forge-v1.json \
  --spec ../../examples/design-study/forge-study.json --method ga --max-runs 60 --seed 1 --format md
```

- `--method grid | random | ga` (default `ga`). Grid uses `floor(maxRuns^(1/k))` levels per parameter. GA uses tournament selection, BLX-0.5 crossover, gaussian mutation, and one elite, with `--population`.
- Budget: `--max-runs` (default 60, at most 10000) and `--time-limit` in seconds. The output records `stoppedBy` (`max-runs`, `time-limit`, or `exhausted`), the seed, and the runs used. A run stopped by the time limit is not reproducible across machines. A run stopped by `max-runs` is.
- Output: the baseline evaluation of the unpatched scenario, the best values, the improvement, the top `--top` candidates, and the convergence trace. A best value on the edge of its range gets a hint to widen the range.
- `--write-best <path>` writes the input scenario with the best values patched in. It refuses to overwrite the scenario or the spec.

## Reset policy: `idk reset-policy`

```bash
bun run --cwd packages/cli dev -- reset-policy ../../examples/tutorials/27-prestige-loop-v1.json \
  --scan 600..1800 --step 600 --horizon 5000 --format md
```

This wraps `analyzeResetPolicies` (see [Reset policy analysis](./reset-cycle-analysis.md)) and adds `insights` from `summarizeResetPolicy`:

- per interval: reward per hour, reward per cycle, recovery, stability, and `roiVsNoReset`, the horizon net worth against a run that never resets (`--skip-baseline` skips that run)
- `optimalIntervalSec` and a `timingWindow` of intervals within `--plateau` (default 5%) of the best reward rate
- hints for a narrow window, an unstable winner, and a reset that does not pay back

`roiVsNoReset` is `null` when the horizon ends on a committed reset, because that net worth belongs to a fresh cycle and would read as -100%. Pick a horizon that leaves a tail after the last reset.

`analyzeResetLayers` in core is the multi-layer hook: it runs one reset-policy request per layer (1 to 8, unique ids) and returns the layers side by side. A model with nested prestige layers builds each request.

`idk prestige-cycle` now counts the reset available at the end of each interval in `pointsPerHour`, so a scan where no reset is committed inside the interval no longer reads 0.

Node.js and browser runtimes are not part of the v1 compatibility contract.
