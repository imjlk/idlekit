# 흐름 관측

영문 원문: [flow-observability.md](./flow-observability.md)

`PR-15`는 선택적 자원과 공정 샘플을 읽는다. 처리량, 용량, 대기열, 포화 시간, 자재 부족 시간, 대기 시간을 증거 구간과 함께 보고한다. 생산 네트워크 런타임을 넣지 않고, 두 번째 시뮬레이터 루프를 시작하지 않는다.

흐름을 관측하지 않는 모델은 `unsupported`다. 샘플이 없는 `flowResult("statically-known")`는 `insufficient-data`이고 이유는 `flow observations were not supplied`다. 성장 정체는 용량 병목이 아니다. `stallMapped`는 false다.

확정된 용량 제약은 포화된 공정, 그보다 큰 상류 공급, 관측된 하류 용량이 있을 때의 여유, 그리고 그 공정을 가리키는 인과 모델 또는 실험이 필요하다. 그 기록이 없으면 같은 결합은 의심이다. 용량과 상류 샘플은 간선이 가리키는 자원과 하나의 증거 구간으로 맞춘다. 하류 여유는 그 목적지로 들어오는 모든 공급을 합해 판단하고, 결합은 사용한 간선과 하류 증거를 인용한다. 단위가 맞지 않는 하류 용량, 상류 공급, 곁가지 공급은 쓰지 않는다. 초 단위의 결합 없는 굶주림 시간은 의심되는 자재 부족이다. 결합 없는 막힘 시간은 의심되는 수요 부족이다. 굶주림과 막힘은 공정마다 가장 늦은 구간으로 따로 판단하므로(최근 0은 이전 대기를 지운다) 한 보고서에 가설이 여러 개 있을 수 있다. 포화된 공정은 모두 후보이고, 가장 늦은 포화 구간으로만 판단한다. 인과 기록이 가리키는 결합이 확정되어 먼저 오고, 나머지는 의심으로 남는다. 굶주림과 막힘이 둘 다 있는 공정은 `insufficient-data` 가설을 갖는다. 끝 공정은 전달받는 자원마다 가장 늦은 구간의 최종 처리량을 보고한다. 반올림 단위보다 작은 0이 아닌 양은 자기 표기를 유지한다. 상류 공급은 처리량에서, 처리량이 없으면 유입에서 읽는다. 간선은 있지만 끝 공정이 없는 그래프는 최종 처리량을 보고하지 않는다. 간선이 없으면 처리량 계열마다 하나씩 보고한다. 용량도 대기도 없는 처리량 하나만 있으면 `insufficient-data`다.

리틀의 법칙은 능력이 statically known이고, 관측과 구간이 모두 안정이며, 작업 흐름이 정의된 경우에만 적용한다. 램프업은 `not-applicable`이다. 일치 결과만으로 원인을 확정하지 않는다.

목적 단위가 다른 간선은 `inflow * numerator / denominator * (1 - loss)`를 쓴다. 보존은 비율을 비교하므로 대기열과 미보관은 목적지 비율 단위의 구간당 양이다. 품목 단위의 재고로 보고한 대기열은 사실이지만 보존 입력이 아니다. 대기열과 미보관 합은 목적 단위의 그 양과 맞아야 한다. 원천 단위를 목적 단위에 더하지 않는다. 대기열과 미보관은 간선의 목적 자원에 대해, 원천 샘플과 같은 구간에서, 목적지 처리량이 관측되면 그 단위로 읽는다. 원천 구간은 모두 시도하고, 같은 목적 자원으로 들어오는 간선은 합산한다. 유한한 수를 넘쳐흐르는 양이나 곱은 일치로 보지 않고, 0은 0과만 같다. 여러 구간이 보존되면 가장 늦은 구간을 보고한다. 물류, 제작, 원정 슬롯 픽스처가 같은 문서 모양을 쓴다. 자원 이름은 `examples/analysis/flow-pipeline.json`에만 둔다. 시드 `15`가 그 파일을 가리킨다.

사실과 가설은 분리된다. 모든 사실은 공정과 자원을 밝힌다. 가설은 `evidenceRefs`로 샘플에 연결된다. 확정된 용량 제약은 근거가 된 기록인 `causal`도 인용한다.

양은 부호와 지수를 허용하는 십진 와이어 표기(`1e2` 등)를 쓴다. `parseFlowObservation`은 유한한 음이 아닌 십진수가 아닌 양, 간선 비율, 리틀의 법칙 입력, `endSec`가 `startSec`보다 앞선 샘플, 중복된 샘플 키, 중복된 간선, 0인 분모, 1보다 큰 손실을 거부한다.

Flow 계산은 JavaScript number를 사용한다. `1e-400`처럼 0이 아닌 와이어 값이 0으로 반올림되면 거부하며, 실제 0 표기와 표현 가능한 비정규 수는 허용한다. 0이 아닌 간선 변환이나 리틀의 법칙 곱이 언더플로로 0이 되면 보존식이나 일관성의 증거로 쓰지 않는다.

손실률이 숫자 1로 반올림되면 와이어 표기도 정확히 1이어야 한다. `0.99999999999999999`처럼 1에 가까운 값은 잔여 비율이 잘못된 전량 손실 보존식으로 바뀌지 않도록 거부하며, 정확한 `1.00`이나 `100e-2` 표기는 허용한다.

구조 계약은 `idlekit.flow.v1`이고 경로는 [docs/schemas/flow.v1.schema.json](./schemas/flow.v1.schema.json)이다. 생성기는 [docs/schemas/generated/flow.v1.schema.json](./schemas/generated/flow.v1.schema.json)도 쓴다. 이것은 `ScenarioV1`이나 화폐 지표를 바꾸지 않는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## Graph

커밋 `023d2bf78831584b33404e5fa1092e34e2a69e91`을 `ttsc-graph` 0.30.4, 프로토콜 `2025-11-25`로 조회했다. `packages/core/tsconfig.json`을 확장하고 `packages/core/src/sim/analysis/flow.ts`, `packages/core/src/sim/analysis/flow.test.ts`, `packages/core/src/sim/observation.ts`를 루트로 삼은 프로그램이다. generation 식별자는 반환되지 않았다. `diagnoseFlow`는 `packages/core/src/sim/analysis/flow.ts:414–762`, `parseFlowObservation`은 같은 파일의 `192–201`, `recordFlowSample`은 `packages/core/src/sim/observation.ts:132–135`에 있다. 깊이 1의 `diagnoseFlow` 영향 추적은 `declaresFlowAdapter`, `diagnosesSteadyPipeline`, `checksFlowConservation`, `leavesUnknownModelsUnsupported`, `separatesFactsFromCauses`를 가리키며 잘린 결과다. `recordFlowSample`의 깊이 1 영향 추적은 `packages/core/src/sim/analysis/flow.test.ts:144`의 호출을 통해 `declaresFlowAdapter`에 도달하며 잘리지 않았다. 이들은 해당 프로그램에서 컴파일러가 확인한 호출자다. JSON 픽스처 `examples/analysis/flow-pipeline.json`은 Graph 밖이므로 직접 읽었다.
