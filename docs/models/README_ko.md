# 빌트인 모델

English version: [README.md](./README.md)

`@idlekit/core`는 `linear` 외에 네 가지 모델을 기본 제공한다. CLI가 모두 등록하므로 시나리오의 `model.id`에 이름만 쓰면 플러그인 없이 쓸 수 있다. 각 모델은 params 스키마와 vars 스키마를 가진 `ModelFactory`라서 `validateScenarioV1`, `compileScenario`, `runScenario`, `analyzeGrowth`, 리셋 사이클 분석이 플러그인 모델과 똑같이 읽는다.

| `model.id` | 모델링 대상 | 튜토리얼 | params 스키마 |
| --- | --- | --- | --- |
| `exponential` | 수입과 가격이 함께 기하급수로 늘어나는 생산기 하나, 레벨 상한과 소프트캡 선택 | [`26-exponential-forge-v1.json`](../../examples/tutorials/26-exponential-forge-v1.json) | [`exponential.params.v1.schema.json`](../schemas/models/exponential.params.v1.schema.json) |
| `prestige` | `exponential` 생산기 + 1급 리셋: 포인트, 배율, 런 길이, 유지 레벨 | [`27-prestige-loop-v1.json`](../../examples/tutorials/27-prestige-loop-v1.json) | [`prestige.params.v1.schema.json`](../schemas/models/prestige.params.v1.schema.json) |
| `multi-currency` | 지갑 통화 + 상한 있는 보조 통화, 수수료 있는 환전, 자동 변환 | [`28-twin-currency-v1.json`](../../examples/tutorials/28-twin-currency-v1.json) | [`multi-currency.params.v1.schema.json`](../schemas/models/multi-currency.params.v1.schema.json) |
| `production-chain` | 자원을 자원이나 현금으로 바꾸는 레시피, 배치 시간, 건설 비용, 레벨 게이트, 병목 분석 | [`29-factory-chain-v1.json`](../../examples/tutorials/29-factory-chain-v1.json) | [`production-chain.params.v1.schema.json`](../schemas/models/production-chain.params.v1.schema.json) |

모델별 문서: [exponential](./exponential_ko.md), [prestige](./prestige_ko.md), [multi-currency](./multi-currency_ko.md), [production-chain](./production-chain_ko.md).

## 공통 규칙

- params와 vars의 금액은 `"10"`, `"1.5e12"` 같은 10진 문자열이다. 그래야 `breakInfinity` 엔진에서도 값이 정확하다. 비율과 성장 계수는 숫자다.
- 기본값이 있는 필드는 생략할 수 있다. 필수 필드가 모두 기본값을 가지면(`exponential`, `prestige`) `model.params`와 `initial.vars` 자체를 생략해도 된다.
- 모든 모델은 결정적이다. 같은 시나리오는 비트 단위로 같게 재생되고, 테스트가 튜토리얼마다 두 번 실행해 확인한다.
- 수입, 비용, 순자산은 유한해야 하며 아니면 `BuiltinModelRangeError`를 던진다. `1e308`을 넘는 경제는 `--engine breakInfinity`를 쓴다.
- `state.prestige.multiplier`의 프레스티지 배율이 모델이 지급하는 모든 수입에 곱해진다. 플러그인이나 리셋 실행기가 이 값을 움직일 수 있다.
- 같은 `id@version`의 플러그인 모델은 `linear`와 마찬가지로 빌트인 모델을 대체한다.
- params JSON 스키마는 `bun run models:schemas`로 zod 스키마에서 생성하고, 단위 테스트와 `bun run models:schemas:check`가 드리프트를 확인한다. 구조 스키마일 뿐이며 상호 참조, 중복 id, 레시피 순환, `> 0` 금액은 `validateScenarioV1`에서만 검사한다.

## 전략이 보는 것

`greedy`는 회수 기간(`equivalentCost / deltaIncomePerSec`)으로 구매를 고른다. 빌트인 구매는 모두 정확한 수입 변화를 견적한다. 보조 통화로 결제하는 구매는 비용과 수입을 primary 환산 가치로 견적하므로 지갑 구매와 비교할 수 있다. production-chain 건설은 정상 상태 한계 가치를 견적하므로 greedy가 병목부터 짓는다.

`greedy`는 `prestige` 모델을 스스로 리셋하지 않는다. 리셋 액션은 비용도 수입 증가도 없어 greedy가 순위를 매길 수 없다. 리셋 시점은 `executeResetCycles`나 `analyzeResetPolicies`로 정한다. [prestige](./prestige_ko.md)를 참고한다.

Node.js and browser runtimes are not part of the v1 compatibility contract.
