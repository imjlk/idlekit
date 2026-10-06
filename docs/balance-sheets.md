# Typed balance sheets and pacing checks

`idk balance` refreshes a typed CSV input sheet into a scenario, bounded pacing
checks, and result sheets. It works with registered models and explicitly trusted
local plugins. It does not run Excel, evaluate formulas, or install a watcher.

For a small public example using only the built-in `linear` model, see
[`examples/balance/linear`](../examples/balance/linear/README.md). It also shows how
to pass exported scenarios to the existing simulate, compare, tune, and experience
commands.

## Refresh loop

Prepare four files beside one another:

- `scenario.json`: an existing valid scenario for your model
- `schema.json`: the numeric fields that spreadsheet users may edit
- `parameters.csv`: `id,value,unit` rows matching that schema
- `workflow.json`: input paths, declared run conditions, metrics, and targets

Run the workflow from the directory where the CLI is installed:

```sh
idk balance ./my-balance/workflow.json
idk balance ./my-balance/workflow.json --check true
```

If the scenario uses a local plugin, pass the existing explicit trust options:

```sh
idk balance ./my-balance/workflow.json \
  --allow-plugin true --plugin ./my-plugin.ts --plugin-root .
```

From a repository checkout, build with `bun run build` and substitute
`bun packages/cli/dist/main.js` for `idk`.

Open the CSV in Excel or import it into a Google Sheets tab, edit `value`, export
that tab as UTF-8 comma-separated CSV, and rerun the same command. Use a separate
results tab to import the generated `results.csv`. This boundary accepts CSV;
arbitrary XLSX layouts are not parsed. If a spreadsheet uses formulas, calculate
them there and export values only. Formula text, blank numeric cells, NaN, and
Infinity are rejected. Zero is valid when the field's bounds permit it.

By default, the command prints a `generationPath` containing exactly
`scenario.json`, `inputs.csv`, `results.csv`, `results.json`, and `provenance.json`.
Opt-in variant exports are described below. For later reads, follow the
`generation` in `results/current.json` to `results/generations/<generation>/`.

## Field schema and authoritative inputs

`schema.json` has `version: 1` and a `fields` array. Each field declares:

- `id`: a stable identifier, independent of row position
- `path`: a JSON pointer to an existing numeric value under `/model/params/`
- `type`: `number` or `integer`
- `unit`: an exact unit label, such as the scenario currency, `seconds`, or `ratio`
- optional inclusive `min` and `max`
- optional `parentId`: the containing object's own `id`, guarding array-backed fields

The CSV's IDs must match the schema exactly. Missing, unknown, and duplicate IDs
fail validation. Units must match literally. Rows can be reordered. Quoted commas,
quotes, embedded newlines, and Unicode are supported. Extra columns such as notes
are preserved in the generated input snapshot. Formula-like text in those columns
is safely escaped on export. The original CSV is never rewritten.

Numbers must be finite decimal or scientific literals; integers must be exactly
representable safe integers. Paths cannot be duplicate, overlapping, nonexistent,
or prototype-related. A `parentId` mismatch fails rather than writing a value into
the wrong array entity. Structural fields, names, and IDs remain in the scenario
template. Unlisted scenario fields are preserved.

The CSV is authoritative for listed numeric values. `pacing.parameters` is
forbidden in a workflow to avoid two sources of truth. Two optional explicit
bindings derive commonly repeated initial values from a field:

- `{"field":"yourCashField","path":"initial.wallet.amount"}` requires that field's unit to match both the scenario and wallet currency
- `{"field":"yourCapField","path":"sim.offline.maxSec"}` requires `seconds`

These bindings are assignments with unit checks, not expression strings or an
arbitrary evaluation language. The command uses the Number engine; string-valued
money and large-number model parameters are outside this CSV version's numeric
schema. Keep those strings in the scenario template; unlisted values are retained
unchanged. For example, the public linear sheet edits numeric `buyCostGrowth`,
while `incomePerSec`, `buyCostBase`, and `buyIncomeDelta` remain strings.

An offline-cap binding preserves the declared cap in the materialized scenario.
Pacing uses ordinary `runScenario`, so that offline cap is inactive during pacing
runs. Use a session analysis with `experience` to exercise it.

## Workflow configuration

`workflow.json` version 1 contains:

- `sheet`, `schema`, `scenario`, and `outputDir` paths, relative to the workflow file
- optional `bindings`
- optional root-level `exportVariants`: boolean, default `false`
- `pacing`: explicit `horizonSec`, unique uint32 `seeds`, a registered `strategy`, and `targets`
- `metrics`: definitions for the target metric IDs

Each target has `metric`, `unit`, and `min`, `max`, or both. Bounds are inclusive.
The supported metric definitions are:

- `firstAction` with `actionId`: elapsed seconds until that committed action
- `firstActionPrefix` with `prefix`: elapsed seconds until the first matching action
- `endWallet` and `endNetWorth`: scenario currency units; net worth requires model support
- `prestigeCount` and `actionCount`: `count`

Timing target units must be `seconds`. Currency metric units must match the
scenario. A target is never silently converted between units.

Optional `pacing.sensitivity` entries have `path` (a stable sheet ID) and explicit
numeric `values`. The evaluator runs a baseline and one field changed at a time
using the same seed set, horizon, and strategy. This is a local one-at-a-time
probe, not a Cartesian optimization search. Seeds, targets, and variants use
deterministic ordering. The callback API `runPacingChecks` supports custom metrics
without adding game-specific extraction rules to the CLI.

## Opt-in scenario exports

Set `"exportVariants": true` at the workflow root to hand the sensitivity cases
to other commands. The default five artifacts are unchanged when this option is
omitted or `false`, even when pacing sensitivity is configured.

With the option enabled, the generation additionally contains `variants.json`
and one scenario JSON file per valid nonbaseline variant. The baseline remains
`scenario.json`; nonbaseline filenames are `scenario-001.json`,
`scenario-002.json`, and so on in deterministic one-field-at-a-time order.
Read the manifest to associate each variant ID with its file rather than deriving
a filename from an ID.

The public linear example produces this manifest:

```json
{
  "version": 1,
  "engine": "number",
  "seeds": [7, 11],
  "horizonSec": 60,
  "strategy": "greedy",
  "variants": [
    { "id": "baseline", "scenario": "scenario.json" },
    { "id": "buyCostGrowth=1.05", "scenario": "scenario-001.json" },
    { "id": "buyCostGrowth=1.25", "scenario": "scenario-002.json" }
  ]
}
```

Scenario filenames are relative to the printed `generationPath`. Exported variants
use the same resolved horizon, strategy, bindings, and numeric engine boundary as
the pacing runs. A sheet- or scenario/model-invalid variant has `"scenario": null`
and an `error` string in the manifest, with the corresponding pacing error in the
results. Consumers must check for `null` before opening a scenario. A failing
refresh can still publish the legacy baseline `scenario.json`; a null manifest
entry means that file is not a valid executable handoff. Invalid nonbaseline
variants have no scenario file.

Artifact-count preflight permits at most 64 files per generation. With exports
enabled, this allows at most 59 total variants, including the baseline: five
ordinary files, one manifest, and up to 58 additional scenarios. This limit is
checked before running pacing; ordinary run, result, and byte limits still apply.
All exported files participate in atomic publication, artifact hashes, and
freshness checks.

## Results, reproduction, and limits

Each target and run reports `pass`, `breach`, `unreached`, or `error`. A missing
action is unreached, not zero. Missing/nonfinite metrics and simulation errors are
errors. Results retain the seed, strategy, horizon, variant, parameter overlay,
bounds, value, and explanation. A failed target makes the command exit nonzero,
but publishes the complete result bundle for inspection. Validation failures
before evaluation and transaction failures preserve the previous bundle.

The exported baseline scenario uses the declared horizon and strategy, clears
the template's `untilExpr`, and disables fast approximation. Parameters of the
same strategy ID are preserved; selecting a different ID uses its defaults.
Replay with `idk simulate <scenario.json> --engine number --seed <reported-seed>`
and the same plugin options. Runtime caps and the `simulate:<seed>` trial scope
are recorded in provenance. Custom plugins must respect the deterministic model
and strategy contracts for reproducible results.

Caller limits `maxRuns`, `maxResults`, and `maxHorizonSec` can lower the generic
evaluator's hard caps. The CLI also limits work to 100,000 steps per run and
1,000,000 total steps. Retained action history is capped at 100,000 records;
truncation is an error, not a passing timing observation. Run/result/byte limits
are checked before publication, and the evaluator checks run counts before any
callback. Passing short-horizon targets does not establish long-term balance.

## Freshness and atomic publication

`--check true` reports `missing`, `stale`, or `current` without rerunning the
simulation, and exits nonzero for missing/stale results. It still requires explicit
plugin trust when loading local code. Freshness and target success are independent:
a current bundle can contain a breached target.

The provenance manifest fingerprints exact input bytes and resolved paths with SHA-256,
records plugin source-closure digests and toolkit/runtime context, and hashes every
output artifact. Status checks verify artifacts and metadata as well as inputs.
Moving the input directory changes its fingerprint even if values are unchanged.

A refresh takes a cooperative output lock, snapshots inputs, computes and stages
an immutable generation, rechecks inputs and plugin digests, then atomically
publishes `current.json`. Readers following that pointer never mix generations.
Concurrent refreshes, edits during computation, and failed callbacks cannot replace
the previous complete publication. Inputs must stay outside the output tree.

The command does not overwrite source CSVs, remove old generations, or break another
process's lock. After an interrupted run, verify no writer is active before manually
recovering its lock. This is a cooperative publication protocol, not a global lock
on spreadsheet programs or arbitrary external writers. Avoid editing during
publication and rerun `--check true` after external changes. Run a fresh process
after editing trusted plugin code.

## Handoff to existing analysis commands

Use the printed generation path as the handoff boundary. From the repository root:

```sh
idk balance examples/balance/linear/workflow.json
# Replace the placeholder with generationPath printed above.
GEN='<printed generationPath>'
cat "$GEN/variants.json"
idk simulate "$GEN/scenario.json" --engine number --seed 7 --format json
```

The [linear example walkthrough](../examples/balance/linear/README.md) gives full
commands for comparing variants or earlier generations, tuning strategy
parameters, and running one-day offline-heavy and Monte Carlo session analyses.
`compare` uses each scenario's strategy unless `--strategy` overrides both sides;
`tune` searches strategy parameters and does not mutate the CSV. Both commands
use the Number engine and have no `--engine` flag. `experience` exercises offline
caps with its session horizon rather than the pacing horizon. Deterministic seed
repeats do not establish uncertainty, and its missing-first-visible-change Monte
Carlo fallback is not a pacing gate; see the walkthrough's reporting boundaries.

These are existing analysis commands, not another balance wrapper. Their reports
are separate from the balance atomic bundle and freshness checks. Write saved
reports and editable candidate copies outside the immutable generation. Carry
explicit plugin trust options into each command when using your own plugin.
