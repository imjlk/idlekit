# `exponential` 모델

English version: [exponential.md](./exponential.md)

생산기 하나. 레벨이 오를수록 레벨당 추가 수입이 커지고 다음 레벨 가격도 커진다. 방치형 게임의 전형적인 "건물" 곡선을 JSON으로 선언한다.

```json
"model": {
  "id": "exponential",
  "version": 1,
  "params": {
    "idleIncome": "1",
    "baseIncome": "1.5",
    "growthRate": 1.04,
    "costBase": "15",
    "costGrowth": 1.12,
    "maxLevel": 150,
    "softCap": { "kind": "pow", "startsAt": "2000", "strength": 0.6 }
  }
},
"initial": { "vars": { "level": 0 } }
```

## Params

| 필드 | 기본값 | 의미 |
| --- | --- | --- |
| `idleIncome` | `"1"` | 레벨 0의 초당 수입 |
| `baseIncome` | `"1"` | 첫 레벨이 더하는 수입 |
| `growthRate` | `1.07` | 각 레벨은 직전 레벨이 더한 양의 `growthRate`배를 더한다. `1`이면 선형 생산기 |
| `costBase` | `"10"` | 첫 레벨 가격 |
| `costGrowth` | `1.15` | 각 레벨 가격은 직전 가격의 `costGrowth`배 |
| `maxLevel` | 없음 | 이 레벨에서 구매가 멈춘다 |
| `softCap.kind` | `"pow"` | `pow`, `sqrt`, `log` |
| `softCap.startsAt` | 필수 | 이 값을 넘는 생산량을 압축한다 |
| `softCap.strength` | `0.5` | `(0, 1]`. `pow`의 지수, `log`의 기울기. `sqrt`는 무시 |
| `stochastic` | 없음 | 수입 위에 얹는 시드 고정 치명타, 드롭, 시간 이벤트. [고급 분석](../advanced-analysis_ko.md#시드-고정-확률-이벤트) 참고 |

Vars: `level` (기본 `0`).

## 공식

`g = growthRate`, `L = level`, 프레스티지 배율 `m`일 때:

- 원 생산량 `P(L) = idleIncome + baseIncome * (g^L - 1) / (g - 1)`, `g = 1`이면 `idleIncome + baseIncome * L`
- `S = startsAt` 초과분 소프트캡: `pow`는 `S * (P/S)^strength`, `sqrt`는 `S * (P/S)^0.5`, `log`는 `S * (1 + strength * ln(P/S))`
- 초당 수입 `= 소프트캡 적용 P(L) * m`
- `L + 1`레벨 가격: `costBase * costGrowth^L`. `n`개 묶음 구매는 등비합 `costBase * costGrowth^L * (costGrowth^n - 1) / (costGrowth - 1)`
- 순자산 `= 지갑 + 현재 레벨에 지불한 총 가격`

큰 지수는 로그 공간에서 계산하므로 `growthRate: 2`, 레벨 2000에서도 `breakInfinity`에서 유한하다.

## 액션과 마일스톤

- `buy.generator` (kind `buy`): 묶음 크기 1, 10, 25, 100, `maxLevel`에 맞춰 잘린다. 견적마다 소프트캡과 배율을 반영한 정확한 수입 변화가 들어 있다.
- 마일스톤: `exponential.level-10`, `-25`, `-50`, `-100`, `-250`, `-500`, `-1000`, `exponential.max-level`, `exponential.softcap-reached`.

## 분석 훅

- `growthRate`가 `1`이고 소프트캡이 없으면 `analytic`이 `incomeKind: "linear"`와 생산기 힌트를 보고하므로 exact ETA가 닫힌 해를 쓸 수 있다. 그 밖에는 `costExp`와 소프트캡을 담은 `incomeKind: "custom"`을 보고한다.
- `stochastic` 블록이 켜져 있으면 `analytic`은 `null`이고 exact ETA는 시뮬레이션한다.
- 모델에 `evolve`가 없어 guarded advance와 exact ETA가 받아들인다.
- `exponentialLevelIncrement(E, params, level)`은 표 작성용으로 다음 레벨의 원 증가분을 돌려준다.

## 실행해 보기

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/26-exponential-forge-v1.json --format md
bun run --cwd packages/cli dev -- growth ../../examples/tutorials/26-exponential-forge-v1.json --format md
```

Node.js and browser runtimes are not part of the v1 compatibility contract.
