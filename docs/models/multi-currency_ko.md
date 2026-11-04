# `multi-currency` 모델

English version: [multi-currency.md](./multi-currency.md)

지갑 통화(`primary`)와 하나 이상의 보조 통화를 다룬다. 생산기는 통화 하나를 생산하고 통화 하나로 구매한다. 보조 통화에는 상한을 둘 수 있고, 환전은 수수료를 떼고 통화 간에 가치를 옮기며, 자동 변환 규칙은 매 틱 넘친 양이나 잉여분을 다른 통화로 바꾼다.

```json
"model": {
  "id": "multi-currency",
  "version": 1,
  "params": {
    "primary": { "idleIncome": "1" },
    "currencies": [{ "id": "gem", "initial": "0", "cap": "40", "valueInPrimary": 12, "idleIncome": "0.01" }],
    "generators": [
      { "id": "mine", "produces": "primary", "incomePerLevel": "1.2", "costCurrency": "primary", "costBase": "12", "costGrowth": 1.12 },
      { "id": "drill", "produces": "gem", "incomePerLevel": "0.02", "costCurrency": "primary", "costBase": "150", "costGrowth": 1.3, "maxLevel": 25 },
      { "id": "foundry", "produces": "primary", "incomePerLevel": "12", "costCurrency": "gem", "costBase": "5", "costGrowth": 1.25 }
    ],
    "exchanges": [{ "id": "sell-gems", "from": "gem", "to": "primary", "rate": 10, "fee": 0.1, "lot": "1" }],
    "autoConvert": [{ "exchange": "sell-gems", "mode": "overflow" }]
  }
},
"initial": { "vars": { "levels": { "mine": 0, "drill": 0, "foundry": 0 }, "balances": { "gem": "0" } } }
```

## Params

| 필드 | 기본값 | 의미 |
| --- | --- | --- |
| `primary.idleIncome` | `"1"` | 생산기가 없을 때 지갑의 초당 수입 |
| `primary.cap` | 없음 | 매 틱 뒤 지갑을 이 값으로 자른다. 넘친 양은 `overflow` 규칙으로 보낼 수 있다 |
| `currencies[]` | 1개 이상 | `id`, `initial`(`"0"`), `cap`, `valueInPrimary`(`1`, 순자산과 견적에 사용. `0`이면 제외), `idleIncome`(`"0"`) |
| `generators[]` | 1개 이상 | `id`, `produces`(`"primary"`), `incomePerLevel`(`"1"`), `costCurrency`(`"primary"`), `costBase`(`"10"`), `costGrowth`(`1.15`), `maxLevel` |
| `exchanges[]` | `[]` | `id`, `from`, `to`, `rate`(`from` 1단위당 `to` 수량), `fee`는 `[0, 1)`, `lot`(`"1"`, 수동 환전 1회 수량) |
| `autoConvert[]` | `[]` | `exchange`, `mode`(`overflow`는 상한이 버릴 양을, `surplus`는 `keep` 초과분 전부를 변환), `keep`(`"0"`) |

`primary`는 예약어다. 알 수 없는 통화·생산기·환전 참조, 중복 id, 같은 통화끼리의 환전은 `validateScenarioV1`이 거부한다.

Vars: 생산기 id별 `levels`, 보조 통화 id별 10진 문자열 `balances`. `balances`에 없는 통화는 `initial`에서 시작한다.

## 매 틱

1. 전략의 구매가 정산된다.
2. 지갑이 primary 수입 `(primary.idleIncome + Σ incomePerLevel * level) * multiplier`를 받는다.
3. `evolve`가 지갑을 `primary.cap`으로 자르고, 각 보조 통화에 수입 × `dt`를 더해 상한으로 자른 뒤, `autoConvert` 규칙을 선언 순서대로 실행한다. 변환량은 `amount * rate * (1 - fee)`다.

## 액션과 마일스톤

- `buy.<generator>`(kind `buy`). primary로 결제하면 묶음 크기 1, 10, 25, 100을 가진 일반 구매다. 보조 통화로 결제하면 지갑 비용이 `null`이고, `canApply`가 잔액을 확인하고 `apply`가 차감하며, 크기 1 견적 하나가 `equivalentCost`와 `deltaIncomePerSec`를 primary 환산 가치(`valueInPrimary`)로 담는다. 그래서 `greedy`가 보석 구매와 코인 구매를 비교할 수 있다.
- `exchange.<id>`(kind `custom`): `lot` 하나를 환전한다. primary에서 환전하면 lot이 지갑 비용이다.
- 잔액(또는 지갑, `primary`)이 상한에 닿으면 `multi-currency.<currency>.capped` 마일스톤이 발생한다.

순자산은 지갑 + `Σ 잔액 * valueInPrimary` + 모든 생산기 레벨에 지불한 가격을 primary 환산 가치로 더한 값이다. `multiCurrencyRate(E, params, levels, currency, multiplier)`는 한 통화의 초당 생산량을 돌려준다.

## 실행해 보기

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/28-twin-currency-v1.json --format md
```

튜토리얼에서는 보석 상한 40이 차면 `sell-gems`가 넘친 양을 보석당 9코인으로 바꾸고, greedy는 보석 가치가 다음 코인 구매보다 나을 때 보석으로 `foundry` 레벨을 산다.

Node.js and browser runtimes are not part of the v1 compatibility contract.
