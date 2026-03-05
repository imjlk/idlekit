# Output JSON Schemas

공식 CLI JSON 출력 계약(Contract)입니다.

- `simulate.output.schema.json`
- `eta.output.schema.json`
- `compare.output.schema.json`
- `tune.output.schema.json`
- `ltv.output.schema.json`
- `calibrate.output.schema.json`

주의:

- 스키마는 JSON 출력(`--format json`) 기준입니다.
- 모든 JSON 출력에는 재현성 메타 `_meta`가 포함됩니다.
- `_meta`에는 `command`, `generatedAt`, `cliVersion`, `gitSha`(가능 시), `scenarioHash`/`telemetryHash`가 포함됩니다.
