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

`docs/schemas/generated/scenario.v1.schema.json`은 `ScenarioV1`의 생성 구조 schema다. `docs/schemas/generated/analysis.artifact.v1.schema.json`은 분석 artifact v1이다. `docs/schemas/generated/eta.estimate.v1.schema.json`은 ETA estimate다. `docs/schemas/generated/reset.cycle.v1.schema.json`은 reset-cycle artifact다. `docs/schemas/generated/growth.fit.v1.schema.json`은 growth fit이다. `docs/schemas/generated/reset.policy.v1.schema.json`은 reset-policy artifact다. `docs/schemas/generated/distribution.v1.schema.json`은 distribution artifact다. `docs/schemas/generated/experiment.v1.schema.json`은 experiment artifact다. `docs/schemas/generated/balance-checks.v1.schema.json`과 `docs/schemas/balance-checks.v1.schema.json`은 balance-check 문서다. `docs/schemas/generated/judge.v1.schema.json`과 `docs/schemas/judge.output.schema.json`은 rules judge 보고서다. `docs/schemas/generated/flow.v1.schema.json`과 `docs/schemas/flow.v1.schema.json`은 flow 보고서다. `docs/schemas/generated/advance.v1.schema.json`과 `docs/schemas/advance.v1.schema.json`은 guarded advance 보고서다. `docs/schemas/generated/jev.advisory.v1.schema.json`과 `docs/schemas/jev.advisory.v1.schema.json`은 선택적 Jev advisory 보고서다. 이것들은 CLI `_meta` schema가 아니다. 직접 쓴 `docs/schemas/jev.judge.output.schema.json`은 `idk judge --provider jev` JSON 출력이고, rules 보고서, advisory, `_meta`를 참조로 담는다. 손으로 쓴 `eta.output.schema.json`이 legacy ETA 출력으로 남는다. replay `artifact.v1.schema.json`은 replay envelope로 남는다. [계약 생성](../contract-generation_ko.md), [분석 계약](../analysis-contracts_ko.md), [ETA 의미](../eta-semantics_ko.md), [리셋 사이클 실행](../reset-cycle_ko.md), [리셋 정책 분석](../reset-cycle-analysis_ko.md), [성장 분류](../growth-classification_ko.md), [시뮬레이션 분포](../simulation-distribution_ko.md), [파라미터 실험](../parameter-experiments_ko.md), [밸런스 검사](../balance-checks_ko.md), [선택적 분석 judge](../optional-analysis-judge_ko.md), [흐름 관측](../flow-observability_ko.md), [가드된 해석적 전진](../guarded-analytic-advance_ko.md), [Jev 연동](../jev-integration_ko.md)을 본다.

주의:

- 스키마는 JSON 출력(`--format json`) 기준입니다.
- 모든 JSON 출력에는 재현성 메타 `_meta`가 포함됩니다.
- `_meta`에는 `command`, `contractVersion`, `schemaRef`, `cliVersion`, `gitSha`, `pluginDigest`, `scenarioHash`/`telemetryHash`가 포함됩니다.
- `simulate`, `experience`, `ltv`, `evaluate`는 선택적으로 `effectiveRunHash`, `effectiveEngine`, `stageScope`를 더할 수 있다. 이 필드는 필수가 아니다. `scenarioHash`는 원래 시나리오 객체다.
- replay artifact(`artifact.v1.schema.json`)는 `replay.verify` 블록에 `runId/seed/scenarioHash/gitSha/pluginDigest/resultHash`를 필수로 포함합니다.
