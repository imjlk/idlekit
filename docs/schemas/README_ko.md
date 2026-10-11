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

`docs/schemas/generated/scenario.v1.schema.json`은 `ScenarioV1`의 생성 구조 schema다. `docs/schemas/generated/analysis.artifact.v1.schema.json`은 분석 artifact v1이다. 둘 다 CLI `_meta` schema가 아니다. replay `artifact.v1.schema.json`은 replay envelope로 남는다. [계약 생성](../contract-generation_ko.md)과 [분석 계약](../analysis-contracts_ko.md)을 본다.

주의:

- 스키마는 JSON 출력(`--format json`) 기준입니다.
- 모든 JSON 출력에는 재현성 메타 `_meta`가 포함됩니다.
- `_meta`에는 `command`, `contractVersion`, `schemaRef`, `cliVersion`, `gitSha`, `pluginDigest`, `scenarioHash`/`telemetryHash`가 포함됩니다.
- `simulate`, `experience`, `ltv`, `evaluate`는 선택적으로 `effectiveRunHash`, `effectiveEngine`, `stageScope`를 더할 수 있다. 이 필드는 필수가 아니다. `scenarioHash`는 원래 시나리오 객체다.
- replay artifact(`artifact.v1.schema.json`)는 `replay.verify` 블록에 `runId/seed/scenarioHash/gitSha/pluginDigest/resultHash`를 필수로 포함합니다.
