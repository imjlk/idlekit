# Seeded feedback and censored draws

Korean version: [README_ko.md](./README_ko.md)

Run these commands from the repository root after `bun install`.
The local model samples a payout and a delay once per run with `createStreamRng`
and the run's seed. It stores both choices in `vars`. Income then stays at zero,
or starts at one token per reward second after the chosen delay. It has no actions.
The ten-second step keeps this one-day experiment small.

## Mixed observed and censored draws

```bash
bun run --cwd packages/cli dev -- experience ../../examples/experience/mixed-feedback.json \
  --plugin ../../examples/experience/seeded-feedback-plugin.ts \
  --plugin-root ../../examples/experience --allow-plugin true \
  --engine number --session-pattern short-bursts --days 1 --draws 16 --seed 7 --format json
```

With the current v1 algorithms, expect these `monteCarlo.firstVisible` fields:

- `accounting`: 16 draws, 9 observed, 7 right-censored, no failed or unsupported draws
- `uncertainty.zeroVariance`: `false`
- completed-only q10 / q50 / q90: `20` / `30` / `50` reward seconds
- population p95: `status: "outside-observed-range"`, `value: null`

The completed-only quantiles read the nine observed draws. The population p95
includes all eligible draws and remains unresolved. Running the same command
again produces the same Monte Carlo summary. More draws alone cannot make a
model with a permanent no-payout outcome produce feedback in that outcome.

## No feedback within the observation horizon

```bash
bun run --cwd packages/cli dev -- experience ../../examples/experience/censored-feedback.json \
  --plugin ../../examples/experience/seeded-feedback-plugin.ts \
  --plugin-root ../../examples/experience --allow-plugin true \
  --engine number --session-pattern short-bursts --days 1 --draws 16 --seed 7 --format json
```

This scenario sets `model.params.payoutProbability` to `0`. Expect 0 observed
and 16 right-censored draws, `firstVisible.status: "unavailable"`, and an
unavailable population p95 with `value: null`. The legacy
`firstVisibleChangeSec` summary is `null`. An unobserved change is never filled
in as a zero-second completion.

Both experiments share an observation horizon of 51,900 reward seconds: the
end of the last active block in `short-bursts`. The session still covers 86,400
wall seconds. Feedback is observed during active blocks; the session's wall
horizon is a separate clock.

## A deterministic control

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/11-my-game-v1.json \
  --engine number --session-pattern short-bursts --days 1 --draws 3 --seed 1 --format json
```

The starter's linear model and greedy strategy consume no randomness. All three
draws have the same result, and `firstVisible.uncertainty.zeroVariance` is `true`.
That is a useful control; it does not provide evidence of uncertainty.
See [the seed boundary](../balance/linear/README.md#understand-the-seed-boundary).

After these checks, try `--format md` and read **Next checks**. Inspect the
accounting and observation horizon alongside the quantiles when deciding what
to change in a game model.
