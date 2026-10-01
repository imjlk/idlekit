# 분석 계약

영어 원문: [analysis-contracts.md](./analysis-contracts.md)

`PR-08`은 ScenarioV1 옆에 분석 artifact v1을 더한다. ETA, growth, CLI `_meta`를 바꾸지 않는다. `contractVersion`은 `1.4.0`이다.

## 레지스트리

`ModelAnalysisAdapter`는 모델 버전이 metric, goal, reset, flow, advance를 제공하는지 말한다. 모델 id와 version으로 등록한다. `Model`에 필수 메서드를 넣지 않는다.

`AnalyzerRegistry`는 `DX-02`다. 분석법을 고르는 쪽이다. 이 변경은 그것을 실행하지 않는다. flow와 advance 본체는 이후 작업이다. flow나 reset capability가 없는 모델은 `unsupported`다. 0점이나 안정 상태가 아니다. adapter가 없으면 `unknown`이다. `DX-03` inspect가 정적으로 알지 못한다고 말할 수 있는 값이다.

## 목표와 지표

기본 목표는 지갑 금액, 순자산, prestige points, milestone 키다. ETA, 실험, check adapter는 같은 predicate를 호출한다. 금액은 `Engine`에 남고 wire에서는 십진 문자열이다. 개수, 시간, ratio는 유한 number다. 없는 값은 생략한다. 실제 0은 0으로 남긴다.

단위, `vars`, metric id는 호출자가 등록한다. core는 그 자원 이름을 박아 두지 않는다.

## Artifact

생성 schema는 `docs/schemas/generated/analysis.artifact.v1.schema.json`이다. `contracts:check`가 비교하고 덮어쓰지 않는다. provenance는 schema, algorithm version, assumption 본문의 hash다. `linkAnalysisArtifact`는 artifact를 `_meta` 옆에 둔다. JSON과 Markdown 렌더는 core에 있다.

기존 `eta.ts`와 `growth.ts`는 일부 금액에 `toNumber` 또는 `Number`를 아직 쓴다. 그 호출은 추정 경로로 분류한다. artifact 계약이 아니다. 유한 변환을 전부 금지하지 않는다.

Node.js and browser runtimes are not part of the v1 compatibility contract.
