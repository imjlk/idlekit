# Compare a model's retention assumptions with player observations

Korean version: [player-telemetry_ko.md](./player-telemetry_ko.md)

`experience` measures progression in a game model. To test the retention assumptions
used by LTV estimates, export a complete, separate install cohort from the game
and compare its observed exact-day retention with explicit scenario assumptions:

```sh
idk calibrate examples/telemetry/cohort.csv --observed-through-day 7 --scenario examples/tutorials/14-orbital-foundry-v1.json --format md
idk calibrate examples/telemetry/cohort.csv --observed-through-day 7 --scenario examples/tutorials/14-orbital-foundry-v1.json --format json --out tmp/cohort-comparison.json
```

The supplied cohort is synthetic and deliberately small. It is a runnable example,
not validation data for Orbital Foundry. In a source checkout, build once with
`bun run build`, then replace `idk` with `bun packages/cli/dist/main.js`.
Reading assumptions does not load or execute the scenario's plugin.

## Export contract

- Select one install cohort with a common install date and observation cutoff.
  `--observed-through-day` is the last **fully observed** day since install for
  every user, including users who stopped playing. Do not infer it from their last
  activity. Split cohorts with different install ages before comparison.
- Export one aggregated row per user/day. Include a day 0 install record for
  **every installed user**, including those who never return. An active-only user
  list overstates retention; the CLI cannot detect omitted users or dropped events.
- Export every active day through the cutoff. Missing days within that complete
  export count as inactive. An explicit `active=false` row also counts as inactive.
- CSV requires explicit `user_id` and `day`; JSON requires string `userId` and
  numeric `day`. Day is a nonnegative integer. Duplicate user/day rows, missing
  install records, rows after the cutoff, and negative/nonfinite amounts fail.
  Revenue columns may be omitted when measuring retention only. An omitted column
  is unmeasured, not zero, and `diagnostics.unmeasured` lists it. With both IAP and
  ad revenue absent, JSON output has no `monetization.revenue`,
  `monetization.uncertainty` or revenue totals. With one of them present, those
  objects hold only the fields that source measures: IAP gives `payerConversion`,
  `arppuDaily` and `totalIap`, ad revenue gives `adArpDau` and `totalAd`, and
  `correlation` keeps only pairs whose sources were exported. Without an
  acquisition cost column there is no `monetization.acquisition`. A JSON revenue
  field must be on every row or none.
- Use the same currency for revenue rows. Export refunds separately; this
  calibration input accepts nonnegative gross revenue. User IDs should be local
  pseudonymous identifiers; this command reads local files and sends no telemetry.

Retention is `active on day N / installed users`, with a Wilson 95% binomial
interval for the cohort proportion. A zero rate after a complete observation
window is measured zero. D30 in a seven-day export is `not-observed`, with a null
rate and interval. No zero, interpolation, or monotonic clamping is substituted.
Exact-day return rates can rise when a player returns after missing an earlier day;
they are not a survival curve. The LTV model interpolates linearly between the
anchors it is given and does not clamp them, so a rise would be projected as is.

## Use the core API

The same observation and patch planning used by the CLI is exported by `@idlekit/core`:
`observeCohort`, `assertCohortObservation`, `observedRetentionRates`, `compareRetention`,
`planRetentionPatch` and `applyRetentionPatch`. The public `CohortActivityRow` type requires
only `userId` and `day`; `active` is optional (default true), and optional revenue/cost
fields are validated when supplied. Omission does not mean measured zero revenue.

[The runnable SDK example](../examples/telemetry/cohort-sdk.ts) reads synthetic activity
directly, without temporary CSV files or a CLI subprocess. From a source checkout:

```sh
bun --preload @ttsc/unplugin/bun-register examples/telemetry/cohort-sdk.ts
```

Call `observeCohort(rows, observedThroughDay)` and inspect `planRetentionPatch(observation,
scenario.monetization?.retention)`. Then `applyRetentionPatch({ scenario, observation })`
recomputes readiness against the current scenario, validates it and returns a deep copy
with only observed retention anchors changed. It rejects `unavailable`/`requires-review`
plans. It never accepts an arbitrary patch object or reuses a plan computed for another
scenario. Unobserved retention and all revenue, fee, acquisition, uncertainty and cohort
size assumptions remain intact. Reading serialized observations through any public
consumer also checks counts, rates, cutoff and interval consistency. The 95% Wilson
bounds are recomputed from installed and retained counts. Preserve the unrounded
bounds when saving SDK observations as JSON; round only for display.

Both SDK and CLI require the complete export described above. The SDK does not collect
telemetry, fit missing revenue, prove completeness or replace held-out validation.

## Read and apply the result

The human table states installed and retained counts, observed rate, interval,
configured assumption, and signed difference in **percentage points**. An assumed
D1 of 80% and an observed D1 of 50% differ by -30 percentage points. The report
compares only explicitly configured retention values, without filling in defaults
or running a simulation. `unconfigured` and `not-observed` rows have no difference.

JSON includes `observation`, optional `comparison`, and the scenario and telemetry
hashes in `_meta`. The observation cutoff participates in the telemetry hash.
`scenarioPatch.monetization.retention` contains only observed retention points.
`patchStatus` is `ready`, `unavailable` (no mature retention day), or
`requires-review`. A rise in observed exact-day retention, or a conflict with a
retained explicit assumption, breaks the scenario rule that a complete retention
curve satisfies d1 >= d7 >= d30 >= d90; the LTV model would interpolate the rise
as given. In that case the retention patch is empty and `patchWarnings` explains
the conflict; the raw observations and comparison remain intact. Review and fit
the curve explicitly instead of clipping the observations. Unobserved days with
unspecified assumptions also require review: the LTV defaults could conflict with
the observations. Provide an explicit assumption for every unobserved target day
to obtain a ready short-horizon patch.
Only merge a ready patch into a **copy** of the scenario's retention object;
preserve unobserved points, cohort-size assumptions, revenue, fees, and uncertainty.
Validate the merged scenario before running LTV. Defaults are not treated as
measured or explicitly reviewed assumptions.
An observation window shorter than one day produces an empty retention patch.
The other `monetization` estimates remain suggestions, including assumed defaults;
the bounded patch deliberately excludes them.

Fit with one cohort and validate with a held-out cohort under matched release,
acquisition, and observation conditions. Re-run LTV with reviewed assumptions and
compare its predictions with later measurements. Fitting and testing on the same
players does not establish predictive value. These observations do not establish
fun, causal improvement from a balance change, or future revenue. An A/B experiment
and qualitative playtesting answer different questions.

Without `--observed-through-day`, the existing exploratory calibration remains
available. Its retention ratios lack a declared observation window and must not be
read as evidence of mature retention; use the explicit cohort mode for validation.
`--scenario` therefore requires `--observed-through-day` or a cohort batch, which
carries its own cutoff. `calibrate` reports differences; it does not declare a game
good or fail CI. Threshold alerts are the opt-in job of `idk telemetry drift` below.

CSV reports include `interval95Min` and `interval95Max`, using fractions from 0 to 1;
future days retain `null`. JSON Schema checks the D1/D7/D30/D90 order and requires
withheld patches to stay empty. The CLI also checks cross-field counts, rates,
observation cutoffs, and confidence intervals before output.
An `--out` path that aliases the telemetry or scenario input is rejected, including
hardlinks and directory aliases. Choose a separate report path.

## Cohort batches

Several complete install cohorts (install weeks, release versions or experiment
groups) travel together in one **cohort batch**. Every cohort in a batch follows the
export contract above on its own. The JSON form is
[`cohort-batch.v1.schema.json`](./schemas/cohort-batch.v1.schema.json):

```json
{
  "schemaVersion": 1,
  "cohorts": [
    {
      "id": "2026-w40-control",
      "variant": "control",
      "installDate": "2026-10-05",
      "observedThroughDay": 7,
      "rows": [{ "userId": "p-7f3a", "day": 0 }, { "userId": "p-7f3a", "day": 1, "iapRevenue": 0.99 }]
    }
  ]
}
```

The CSV form is one long table. `cohort_id`, `observed_through_day`, `user_id` and
`day` are required; `variant`, `install_date`, `active`, `iap_revenue`, `ad_revenue`
and `acquisition_cost` are optional. Cohort-level columns must hold one value per
cohort, and unknown columns are rejected, so a stray `email` column fails instead of
being carried along:

```csv
cohort_id,variant,install_date,observed_through_day,user_id,day,active
2026-w40-control,control,2026-10-05,7,p-7f3a,0,true
2026-w40-control,control,2026-10-05,7,p-7f3a,1,true
```

Validation collects every issue with its file and JSON path (unknown fields, duplicate
or malformed ids, invalid install dates, a revenue field on only some rows, and each
cohort's observation errors), so one pass fixes an export. Cohort ids must be unique
across all files given to one command. The examples are synthetic:
[`cohorts.csv`](../examples/telemetry/cohorts.csv) holds three 300-install cohorts
observed through day 7, and [`cohorts.json`](../examples/telemetry/cohorts.json)
two small ones.

`calibrate` reads a batch too. `--cohort <id>` selects one cohort and its cutoff;
`--observed-through-day`, if given, must match it:

```sh
idk calibrate examples/telemetry/cohorts.csv --cohort 2026-w41-control --scenario examples/tutorials/11-my-game-v1.json --format md
```

## The telemetry loop

`idk telemetry` chains observation, comparison, patching and monitoring on batches.
Every subcommand accepts several batch files, `--input-format auto|csv|json`,
`--format json|md` and `--out`. JSON carries `_meta` with the telemetry hash.

```sh
idk telemetry validate examples/telemetry/cohorts.csv examples/telemetry/cohorts.json --format md
idk telemetry compare examples/telemetry/cohorts.csv --baseline 2026-w40-control --scenario examples/tutorials/11-my-game-v1.json --format md
idk telemetry drift examples/telemetry/cohorts.csv --scenario examples/tutorials/11-my-game-v1.json --threshold-pp 5 --fail-on-drift --format md
idk telemetry patch examples/telemetry/cohorts.csv --cohort 2026-w41-control --scenario examples/tutorials/11-my-game-v1.json --scenario-out tmp/my-game-w41.json --format md
idk telemetry experiment control=examples/tutorials/11-my-game-v1.json fast-start=examples/tutorials/12-my-game-compare-b.json --day 1 --mde-pp 5 --daily-installs 400 --format md
```

### Compare cohorts

`compare` lays out D1/D7/D30/D90 for every cohort with counts, rate and Wilson 95%
interval, the difference from a baseline cohort (`--baseline`, default the first
cohort) and, with `--scenario`, from the explicit assumption. Each non-baseline
cell has a significance hint from a pooled two-proportion z-test at `--alpha`
(default 0.05): `significant`, `not-significant`, or `insufficient-sample` when an
expected count is below 5. In the example, fast-start's +7 pp D1 is
`not-significant` (p ≈ 0.08) with 300 installs per cohort, while the week 41 drop of
-8 pp is `significant` (p ≈ 0.04).

Treat hints as hints. They assume independent installs and one pre-planned
comparison. Many cohorts, many days, and repeated looks all inflate false
positives; plan the test with `experiment` instead of searching the table.

### Detect drift

`drift` compares each cohort with the scenario's explicit assumptions. A day drifts
when the absolute difference is at least `--threshold-pp` (default 5 percentage
points) **and** the assumption lies outside the cohort's Wilson 95% interval, so a
noisy small cohort does not alert. `--no-require-interval` drops the interval rule.
The report status is `drift`, `within-threshold` or `no-comparable-days`. With
`--fail-on-drift` the command writes the report first and then exits with status
**2** on drift. Other failures keep the usual CLI exit codes, so a monitor can tell
"retention moved" from "the export is broken".

Drift says the observed curve moved. It does not explain why: check the release,
acquisition mix and export completeness before patching.

### Patch and re-simulate

`patch` runs the whole loop for one cohort:

1. observe the cohort (`observeCohort`);
2. plan the retention patch against the scenario (`planRetentionPatch`);
3. apply it to a copy and validate the patched scenario;
4. run `ltv` on the original and the patched scenario with **one seed**, so only the
   retention assumptions differ;
5. report the assumption changes and a per-horizon before/after table of LTV per
   user, net revenue per user and pacing (`endNetWorth`, time to first upgrade,
   growth per day).

The source scenario is never modified. `--scenario-out` writes the patched scenario
only when the plan is `ready`. Otherwise nothing is written, the report keeps the
warnings, and the command exits with status **3**. Retention feeds the LTV
projection, not the economy simulation, so pacing should be unchanged; the report
flags any pacing change because it means something other than retention moved.
`--horizons`, `--strategy`, `--seed` and the plugin options mean what they mean for
`ltv`. Validate the patched copy against a held-out cohort before adopting it.

### Plan an A/B experiment

`experiment` maps scenario variants to groups with `<group>=<scenario.json>`; the first
group is the control. It reads each variant's assumption for `--day` (1, 7, 30 or 90)
and returns:

- the minimum sample size per group for a two-sided two-proportion test at `--alpha`
  and `--power` (default 0.05 and 0.8), Bonferroni-adjusted when there are several
  treatments. The minimum detectable effect is `--mde-pp`, or by default the smallest
  assumed difference between variants; equal assumptions require `--mde-pp`;
- the observation window: with `--daily-installs`, enrollment days (at least one whole
  week) and the earliest readout day, which waits until every enrolled install is
  fully observed through the test day;
- deterministic assignment: `assignExperimentGroup(userId, experimentId, groups)` in
  `@idlekit/core` hashes a pseudonymous id with FNV-1a, so the game and the analysis
  agree on groups without a server.

The example asks for 1,534 installs per group to detect 40% → 45% D1. Export each
group as its own cohort (with `variant`) and read it with `compare` after the readout
day. Fix the metric and readout day before launch, and do not stop early on a hint.

## Monitoring

[`monitor.sh`](../examples/telemetry/monitor.sh) validates an export and runs `drift`
with `--fail-on-drift`, writing timestamped reports. It exits 0 without drift, 2 on
drift, and passes other failures through. A crontab line:

```sh
0 9 * * 1 cd /srv/my-game && COHORTS=exports/cohorts.csv SCENARIO=scenarios/live.json ./examples/telemetry/monitor.sh
```

[`github-actions-monitor.yml`](../examples/telemetry/github-actions-monitor.yml) is a
weekly GitHub Actions job built on the same script that uploads the report as an
artifact. It is an example to copy into your own repository; idlekit does not run it.

## Core API for batches

`@idlekit/core` exports the loop for direct use: `validateCohortBatch`,
`observeCohortBatch`, `compareCohorts`, `twoProportionSignificance`,
`detectRetentionDrift`, `planScenarioRetentionUpdate`, `planRetentionExperiment` and
`assignExperimentGroup`. [`telemetry-loop-sdk.ts`](../examples/telemetry/telemetry-loop-sdk.ts)
runs them on synthetic cohorts:

```sh
bun --preload @ttsc/unplugin/bun-register examples/telemetry/telemetry-loop-sdk.ts
```

## Privacy and anonymization

Every command reads local files and writes local reports. Nothing is uploaded, and
reading assumptions does not run scenario plugins. The inputs still describe real
players, so prepare exports to need no personal data:

- Use a pseudonymous `userId`, for example an HMAC of the internal id with a secret
  salt kept outside the export. Never export emails, names, device or advertising
  ids, account ids or IP addresses. Unknown columns are rejected for this reason.
- Export only what the contract needs: day since install, activity, and optionally
  aggregated daily revenue and acquisition cost. Do not export event logs, locations
  or timestamps finer than a day.
- Round revenue to the currency's minor unit and remove free-text fields.
- Keep cohorts large. A cohort of a few players can identify them, and its retention
  is too noisy to act on anyway.
- Store exports and reports with the same access controls as the source data. Alerts
  should carry the drift report, not player rows.
- Rotate the salt per export when cohorts do not need to be joined over time; keep it
  stable only for the life of one experiment.
