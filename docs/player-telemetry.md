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
  Revenue columns may be omitted when measuring retention only.
- Use the same currency for revenue rows. Export refunds separately; this
  calibration input accepts nonnegative gross revenue. User IDs should be local
  pseudonymous identifiers; this command reads local files and sends no telemetry.

Retention is `active on day N / installed users`, with a Wilson 95% binomial
interval for the cohort proportion. A zero rate after a complete observation
window is measured zero. D30 in a seven-day export is `not-observed`, with a null
rate and interval. No zero, interpolation, or monotonic clamping is substituted.
Exact-day return rates can rise when a player returns after missing an earlier day;
they are not a survival curve. The LTV model may impose its own curve assumptions.

## Read and apply the result

The human table states installed and retained counts, observed rate, interval,
configured assumption, and signed difference in **percentage points**. An assumed
D1 of 80% and an observed D1 of 50% differ by -30 percentage points. The report
compares only explicitly configured retention values, without filling in defaults
or running a simulation. `unconfigured` and `not-observed` rows have no difference.

JSON includes `observation`, optional `comparison`, and the scenario and telemetry
hashes in `_meta`. The observation cutoff participates in the telemetry hash.
`scenarioPatch.monetization.retention` contains only observed retention points.
Merge those individual fields into a **copy** of the scenario's retention object;
preserve unobserved points, cohort-size assumptions, revenue, fees, and uncertainty.
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
`--scenario` therefore requires `--observed-through-day`. The command reports
differences; it does not automatically declare a game good or fail CI by a retention
threshold.
