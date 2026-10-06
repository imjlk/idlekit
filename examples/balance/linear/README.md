# Numeric sheet to existing analysis commands

This tiny synthetic example uses the built-in deterministic `linear` model and
`greedy` strategy. It contains no game-specific balance data and needs no plugin.
See the [balance workflow guide](../../../docs/balance-sheets.md) for the complete
schema, limits, publication, and freshness contract.

## Inputs

- `scenario.json`: the model, initial state, strategy, and offline policy
- `schema.json`: one numeric field, `buyCostGrowth`, with unit `ratio`
- `parameters.csv`: authoritative `buyCostGrowth = 1.12`
- `workflow.json`: 60-second pacing, seeds `7` and `11`, an `endNetWorth` target,
  and one-field-at-a-time values `1.05` and `1.25`
- `tune.json`: a separate greedy strategy-parameter search with budget `3`,
  runner seeds `7` and `11`, and a 60-second horizon

Only `buyCostGrowth` is a numeric model parameter here. String-valued money inputs
such as `incomePerSec`, `buyCostBase`, and `buyIncomeDelta` stay unchanged in the
scenario template; the numeric CSV schema cannot edit them.

## Refresh and inspect the export

Run these commands from the repository root with an installed `idk`. For a source
checkout, run `bun run build` once, then replace `idk` below with
`bun packages/cli/dist/main.js`.

```sh
idk balance examples/balance/linear/workflow.json
idk balance examples/balance/linear/workflow.json --check true

# Replace the placeholder with generationPath printed by the refresh command.
GEN='<printed generationPath>'
cat "$GEN/results.csv"
cat "$GEN/variants.json"
```

Do not guess a generation directory name. The workflow's `exportVariants: true`
adds a manifest and sensitivity scenarios to the usual five-file bundle:

- `scenario.json`: baseline growth `1.12`
- `scenario-001.json`: `buyCostGrowth=1.05`
- `scenario-002.json`: `buyCostGrowth=1.25`

`variants.json` records these variant IDs and relative filenames, plus version
`1`, engine `number`, seeds `[7, 11]`, horizon `60`, and strategy `greedy`.
Always inspect the manifest before consuming arbitrary workflows: a sheet- or
scenario/model-invalid variant has `scenario: null` and an error. A failing refresh
can still publish the legacy baseline `scenario.json`; a null manifest entry means
it is not a valid executable handoff. Invalid nonbaseline variants have no file.

Variant export is optional and defaults to `false`; without it, only
`scenario.json`, `inputs.csv`, `results.csv`, `results.json`, and `provenance.json`
are published. Export-enabled workflows allow at most 59 total variants,
including the baseline, under the 64-artifact preflight cap. Byte limits, atomic
publication, and freshness verification cover all exported artifacts.

## Replay and compare

`compare` and `tune` use the Number engine and do not accept `--engine`.

```sh
for SEED in 7 11; do
  idk simulate "$GEN/scenario.json" --engine number --seed "$SEED" --format json
done

idk compare "$GEN/scenario.json" "$GEN/scenario-001.json" \
  --seed 7 --metric endNetWorth --format json
```

To compare spreadsheet revisions instead, save the earlier refresh's printed
`generationPath`, edit the CSV, refresh, set `GEN` to the new printed path, then:

```sh
PREV='<generationPath saved from the earlier refresh>'
idk compare "$PREV/scenario.json" "$GEN/scenario.json" \
  --seed 7 --metric endNetWorth --format json
```

Each input's declared strategy is used unless you pass `--strategy`; that flag
overrides both sides. For a strategy comparison, copy a generated scenario to a
working directory, change the copy's `strategy.id` and/or `strategy.params`, and
compare without the override:

```sh
mkdir -p ./tmp/balance-analysis
cp "$GEN/scenario.json" ./tmp/balance-analysis/candidate.json
# Edit the strategy in candidate.json, then compare.
idk compare "$GEN/scenario.json" ./tmp/balance-analysis/candidate.json \
  --seed 7 --metric endNetWorth --format json
```

Never edit the immutable published generation; doing so makes it stale.

## Tune the strategy

```sh
idk tune "$GEN/scenario.json" \
  --tune examples/balance/linear/tune.json --format json
```

This searches the greedy strategy's `objective` parameter among `maximizeIncome`,
`minPayback`, and `maximizeNetWorth`, scored by `endNetWorthLog10`. The budget is
3; trials use the TuneSpec's seeds `[7, 11]` and 60-second duration. `tune --seed`
is metadata, not a replacement for `runner.seeds`.

TuneSpec changes strategy parameters, not the model's growth values. It neither
mutates `parameters.csv` nor writes the best strategy into your template. Review
the result, apply a chosen strategy configuration to a working template, and
refresh the balance workflow to check it.

## Exercise the offline policy

```sh
idk experience "$GEN/scenario.json" --engine number --seed 7 \
  --session-pattern offline-heavy --days 1 --format json
```

The explicit one-day session horizon replaces the 60-second pacing horizon for
this analysis. The scenario has a 3,600-second offline cap, clamp overflow, no
decay, and `actions.mode: "none"`. Expect 86,400 wall seconds, 300 active seconds,
86,100 offline wall seconds, 3,600 credited offline seconds, and 82,500 lost reward
seconds. The reward clock advances by 3,900 seconds. Ordinary balance pacing uses
`runScenario`; it retains the offline policy but does not exercise the cap.

## Understand the seed boundary

```sh
idk experience "$GEN/scenario.json" --engine number --seed 7 --draws 4 \
  --session-pattern offline-heavy --days 1 --format json
```

The linear example is deterministic, so repeated seeds or Monte Carlo draws do
not provide evidence of uncertainty. A stochastic model/plugin must actually
consume seeded randomness for draws to vary. Experience derives its draw seeds
from the base seed independently of the workflow's pacing seed list.

In experience Monte Carlo summaries, a missing `firstVisibleChangeSec` currently
falls back to `totalActiveSec`, or `0` if absent, before quantile aggregation. That
is not an observed milestone or a pacing pass/fail gate; balance timing metrics
separately report an absent action as `unreached`.

These handoffs use the existing analysis commands and produce separate reports.
They are not included in the balance generation's atomic bundle or freshness
checks. If saving command output, use a directory outside the published generation.
