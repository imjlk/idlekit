# `production-chain` 모델

English version: [production-chain.md](./production-chain.md)

레시피가 입력을 출력으로 바꾼다. 광석은 주괴로, 주괴는 기어로, 기어는 코인으로 바뀐다. 레시피마다 배치 시간, 레벨당 건설 비용, 선택적 레벨 게이트와 레벨 상한이 있다. 자원에는 저장 상한을 둘 수 있고, 상한은 그 자원을 채우는 레시피를 역으로 늦춘다. `analyzeProductionChain`은 정상 상태 흐름을 읽어 병목을 지목한다.

```json
"model": {
  "id": "production-chain",
  "version": 1,
  "params": {
    "primary": { "idleIncome": "2" },
    "resources": [
      { "id": "ore", "valueInPrimary": 0.5 },
      { "id": "ingot", "valueInPrimary": 2.5, "cap": "200" },
      { "id": "gear", "valueInPrimary": 12 }
    ],
    "recipes": [
      { "id": "mine", "outputs": { "ore": "1" }, "timeSec": 1, "build": { "currency": "primary", "base": "10", "growth": 1.12 } },
      { "id": "smelter", "inputs": { "ore": "2" }, "outputs": { "ingot": "1" }, "timeSec": 2, "build": { "base": "40", "growth": 1.15 }, "unlock": [{ "recipe": "mine", "level": 3 }] },
      { "id": "assembler", "inputs": { "ingot": "3" }, "outputs": { "gear": "1" }, "timeSec": 4, "build": { "base": "150", "growth": 1.18 }, "unlock": [{ "recipe": "smelter", "level": 2 }] },
      { "id": "market", "inputs": { "gear": "1" }, "outputs": { "primary": "30" }, "timeSec": 2, "build": { "base": "400", "growth": 1.2 }, "maxLevel": 20, "unlock": [{ "recipe": "assembler", "level": 1 }] }
    ]
  }
},
"initial": { "vars": { "levels": { "mine": 0, "smelter": 0, "assembler": 0, "market": 0 }, "stock": { "ore": "0", "ingot": "0", "gear": "0" } } }
```

## Params

| 필드 | 기본값 | 의미 |
| --- | --- | --- |
| `primary.idleIncome` | `"1"` | 레시피가 없을 때 지갑의 초당 수입 |
| `resources[]` | `[]` | `id`, `initial`(`"0"`), `cap`(저장 상한), `valueInPrimary`(`0`, 순자산·건설 견적·병목 순위에 사용) |
| `recipes[]` | 1개 이상 | 아래 참고 |
| `recipes[].inputs` | `{}` | 배치당 소비량, 자원 id 또는 `primary` 기준 |
| `recipes[].outputs` | 1개 이상 | 배치당 생산량, 자원 id 또는 `primary` 기준 |
| `recipes[].timeSec` | `1` | 레벨 하나가 배치 하나를 끝내는 초. 용량은 초당 `level / timeSec` 배치 |
| `recipes[].build` | `{ "currency": "primary", "base": "10", "growth": 1.15 }` | `L + 1`레벨 가격은 `base * growth^L`, `primary` 또는 자원으로 결제 |
| `recipes[].maxLevel` | 없음 | 이 레벨에서 건설이 멈춘다 |
| `recipes[].unlock` | `[]` | `{ recipe, level }` 게이트. 모두 만족해야 건설하고 가동한다 |

`primary`는 예약어다. 자기 출력을 소비하는 레시피, 자원을 통한 레시피 간 순환, 알 수 없는 참조, 중복 id는 `validateScenarioV1`이 거부한다. `primary`는 양쪽에 있어도 순환으로 보지 않는다.

Vars: 레시피 id별 `levels`, 자원 id별 10진 문자열 `stock`.

## 매 틱

레시피는 생산자부터 소비자 순으로, 같은 순위는 선언 순서대로 돌아서 한 틱 안에 광석이 코인까지 흘러갈 수 있다. 레벨이 있고 게이트가 열린 레시피의 이번 틱 배치 수는 다음 중 최솟값이다.

- 용량: `level * dt / timeSec`
- 보유한 각 입력량 ÷ 배치당 소비량
- 상한 있는 각 출력의 남은 공간 ÷ 배치당 생산량(역압)

입력을 소비하고 출력을 더하며, `primary` 출력은 프레스티지 배율을 곱해 지갑에 지급한다. 지갑은 `income`을 통해 초당 `primary.idleIncome * multiplier`도 받는다.

## 액션과 마일스톤

- `build.<recipe>`(kind `buy`): 게이트를 만족하고 `maxLevel` 미만일 때 가능하다. primary로 결제하면 묶음 크기 1, 10, 25, 100, 자원으로 결제하면 재고를 확인·차감하고 크기 1 견적 하나만 있다. `deltaIncomePerSec`는 추가 레벨이 더하는 정상 상태 가치(초당 primary + 잉여 자원의 `valueInPrimary`)에 배율을 곱한 값이다. 그래서 greedy는 체인을 막는 단계를 먼저 짓는다.
- 게이트가 있는 레시피의 게이트가 처음 열리면 `production-chain.<recipe>.unlocked` 마일스톤이 발생한다.

순자산은 지갑 + `Σ 재고 * valueInPrimary` + 모든 레시피 레벨에 지불한 가격이다.

## 병목 분석

`analyzeProductionChain(params, levels)`는 Number 도메인으로 다음을 돌려준다.

- `depth`, 레시피별 `depth`, `level`, `capacityBatchesPerSec`, `batchesPerSec`, `utilization`, `limitedBy`(`capacity`, `unbuilt`, `locked`, `{ input }`), 한 레벨 더 지을 때의 `marginalValuePerSec`
- 자원별 `producedPerSec`, `consumedPerSec`, `surplusPerSec`
- 레시피에서 나오는 `primaryPerSec`(유휴 수입과 배율 제외), 잉여 가치를 포함한 `valuePerSec`
- `bottleneck`: 다음 레벨이 가장 큰 가치를 더하는 레시피와 그 제약
- `starved`: 입력 부족으로 용량 이하로 도는 레시피
- `assumptions`: 이미 보유한 재고와 저장 상한은 정상 상태에 포함하지 않는다

튜토리얼 실행 끝에서는 `assembler`가 병목, `market`이 기어 부족 상태로 나온다.

## 실행해 보기

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/29-factory-chain-v1.json --format md
```

```ts
import { analyzeProductionChain } from "@idlekit/core";

const report = analyzeProductionChain(scenario.model.params, { mine: 65, smelter: 47, assembler: 31, market: 16 });
report.bottleneck; // { recipe: "assembler", marginalValuePerSec: 1.875, limitedBy: "capacity" }
```

Node.js and browser runtimes are not part of the v1 compatibility contract.
