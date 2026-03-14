# Output JSON Schemas

Korean version: [README_ko.md](./README_ko.md)

These are the canonical JSON output contracts for the CLI.

## Schemas

- `simulate.output.schema.json`
- `eta.output.schema.json`
- `compare.output.schema.json`
- `experience.output.schema.json`
- `tune.output.schema.json`
- `ltv.output.schema.json`
- `calibrate.output.schema.json`
- `artifact.v1.schema.json`
- `replay.verify.output.schema.json`
- `kpi.regress.output.schema.json`

## Notes

- Schemas apply to `--format json` outputs
- Every JSON output includes reproducibility metadata in `_meta`
- `_meta` typically includes `command`, `contractVersion`, `schemaRef`, `cliVersion`, `gitSha`, `pluginDigest`, and scenario or telemetry hashes
- Replay artifacts require `runId`, `seed`, `scenarioHash`, `gitSha`, `pluginDigest`, and `resultHash` inside their replay verification block
