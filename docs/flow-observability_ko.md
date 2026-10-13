# 흐름 관측

영문 원문: [flow-observability.md](./flow-observability.md)

`PR-15`는 선택적 자원과 공정 샘플을 읽는다. 처리량, 용량, 대기열, 포화 시간, 자재 부족 시간, 대기 시간을 증거 구간과 함께 보고한다. 생산 네트워크 런타임을 넣지 않고, 두 번째 시뮬레이터 루프를 시작하지 않는다.

흐름을 관측하지 않는 모델은 `unsupported`다. 샘플이 없는 `flowResult("statically-known")`는 `insufficient-data`이고 이유는 `flow observations were not supplied`다. 성장 정체는 용량 병목이 아니다. `stallMapped`는 false다.

확정된 용량 제약은 포화된 공정, 그보다 큰 상류 공급, 관측된 하류 용량이 있을 때의 여유, 그리고 그 공정을 가리키는 인과 모델 또는 실험이 필요하다. 그 기록이 없으면 같은 결합은 의심이다. 용량과 상류 샘플은 간선이 가리키는 자원과 하나의 증거 구간으로 맞춘다. 결합 없는 굶주림 시간은 의심되는 자재 부족이다. 결합 없는 막힘 시간은 의심되는 수요 부족이다. 굶주림과 막힘은 공정마다 따로 판단하므로 한 보고서에 가설이 여러 개 있을 수 있다. 포화된 공정은 모두 후보다. 인과 기록이 가리키는 결합이 확정되어 먼저 오고, 나머지는 의심으로 남는다. 굶주림과 막힘이 둘 다 있는 공정은 `insufficient-data` 가설을 갖는다. 간선은 있지만 끝 공정이 없는 그래프는 최종 처리량을 보고하지 않는다. 용량도 대기도 없는 처리량 하나만 있으면 `insufficient-data`다.

리틀의 법칙은 능력이 statically known이고, 구간이 안정이며, 작업 흐름이 정의된 경우에만 적용한다. 램프업은 `not-applicable`이다. 일치 결과만으로 원인을 확정하지 않는다.

목적 단위가 다른 간선은 `inflow * numerator / denominator * (1 - loss)`를 쓴다. 대기열과 미보관 합은 목적 단위의 그 양과 맞아야 한다. 원천 단위를 목적 단위에 더하지 않는다. 대기열과 미보관은 간선의 목적 자원에 대해, 원천 샘플과 같은 구간에서 읽는다. 원천 구간은 모두 시도한다. 유한한 수를 넘쳐흐르는 양이나 곱은 일치로 보지 않는다. 물류, 제작, 원정 슬롯 픽스처가 같은 문서 모양을 쓴다. 자원 이름은 `examples/analysis/flow-pipeline.json`에만 둔다. 시드 `15`가 그 파일을 가리킨다.

사실과 가설은 분리된다. 가설은 `evidenceRefs`로 샘플에 연결된다.

양은 부호와 지수를 허용하는 십진 와이어 표기(`1e2` 등)를 쓴다. `parseFlowObservation`은 유한한 음이 아닌 십진수가 아닌 양, 간선 비율, 리틀의 법칙 입력, 그리고 `endSec`가 `startSec`보다 앞선 샘플을 거부한다.

구조 계약은 `idlekit.flow.v1`이고 경로는 [docs/schemas/flow.v1.schema.json](./schemas/flow.v1.schema.json)이다. 생성기는 [docs/schemas/generated/flow.v1.schema.json](./schemas/generated/flow.v1.schema.json)도 쓴다. 이것은 `ScenarioV1`이나 화폐 지표를 바꾸지 않는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.
