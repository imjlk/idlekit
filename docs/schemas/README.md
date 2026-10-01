# Output JSON Schemas

Korean version: [README_ko.md](./README_ko.md)

These are the canonical JSON output contracts for the CLI.

## Schemas

- `simulate.output.schema.json`
- `eta.output.schema.json`
- `compare.output.schema.json`
- `doctor.output.schema.json`
- `evaluate.output.schema.json`
- `experience.output.schema.json`
- `setup.output.schema.json`
- `tune.output.schema.json`
- `ltv.output.schema.json`
- `calibrate.output.schema.json`
- `artifact.v1.schema.json`
- `replay.verify.output.schema.json`
- `kpi.regress.output.schema.json`

`docs/schemas/generated/scenario.v1.schema.json` is the generated structural schema for `ScenarioV1`. `docs/schemas/generated/analysis.artifact.v1.schema.json` is analysis artifact v1. `docs/schemas/generated/eta.estimate.v1.schema.json` is the ETA estimate. `docs/schemas/generated/reset.cycle.v1.schema.json` is the reset-cycle artifact. `docs/schemas/generated/growth.fit.v1.schema.json` is the growth fit. `docs/schemas/generated/reset.policy.v1.schema.json` is the reset-policy artifact. `docs/schemas/generated/distribution.v1.schema.json` is the distribution artifact. `docs/schemas/generated/experiment.v1.schema.json` is the experiment artifact. `docs/schemas/generated/balance-checks.v1.schema.json` and `docs/schemas/balance-checks.v1.schema.json` are the balance-check document. `docs/schemas/generated/judge.v1.schema.json` and `docs/schemas/judge.output.schema.json` are the rules judge report. `docs/schemas/generated/flow.v1.schema.json` and `docs/schemas/flow.v1.schema.json` are the flow report. None of those is a CLI `_meta` schema. Handwritten `eta.output.schema.json` stays the legacy ETA output. Replay `artifact.v1.schema.json` stays the replay envelope. See [Contract generation](../contract-generation.md), [Analysis contracts](../analysis-contracts.md), [ETA semantics](../eta-semantics.md), [Reset cycle execution](../reset-cycle.md), [Reset policy analysis](../reset-cycle-analysis.md), [Growth classification](../growth-classification.md), [Simulation distribution](../simulation-distribution.md), [Parameter experiments](../parameter-experiments.md), [Balance checks](../balance-checks.md), [Optional analysis judge](../optional-analysis-judge.md), and [Flow observability](../flow-observability.md).

## Notes

- Schemas apply to `--format json` outputs
- Every JSON output includes reproducibility metadata in `_meta`
- `_meta` typically includes `command`, `contractVersion`, `schemaRef`, `cliVersion`, `gitSha`, `pluginDigest`, and scenario or telemetry hashes
- `simulate`, `experience`, `ltv`, and `evaluate` may add optional `effectiveRunHash`, `effectiveEngine`, and `stageScope`. Those fields are not required. `scenarioHash` stays the original scenario object.
- Replay artifacts require `runId`, `seed`, `scenarioHash`, `gitSha`, `pluginDigest`, and `resultHash` inside their replay verification block
