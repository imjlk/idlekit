# Output JSON Schemas

공식 CLI JSON 출력 계약(Contract)입니다.

- `simulate.output.schema.json`
- `eta.output.schema.json`
- `compare.output.schema.json`
- `tune.output.schema.json`
- `ltv.output.schema.json`
- `calibrate.output.schema.json`
- `artifact.v1.schema.json`
- `replay.verify.output.schema.json`
- `kpi.regress.output.schema.json`

주의:

- 스키마는 JSON 출력(`--format json`) 기준입니다.
- 모든 JSON 출력에는 재현성 메타 `_meta`가 포함됩니다.
- `_meta`에는 `command`, `contractVersion`, `schemaRef`, `cliVersion`, `gitSha`, `pluginDigest`, `scenarioHash`/`telemetryHash`가 포함됩니다.
- replay artifact(`artifact.v1.schema.json`)는 `replay.verify` 블록에 `runId/seed/scenarioHash/gitSha/pluginDigest/resultHash`를 필수로 포함합니다.
