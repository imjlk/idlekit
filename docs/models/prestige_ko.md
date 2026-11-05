# `prestige` 모델

English version: [prestige.md](./prestige.md)

[`exponential`](./exponential_ko.md) 생산기에 1급 리셋을 더한 모델이다. 리셋은 런의 순자산을 프레스티지 포인트로 바꾸고, 포인트는 영구 수입 배율을 정하며, 런은 처음부터 다시 시작한다. 기존 `state.prestige` 필드와 리셋 사이클 실행기에 그대로 연결되므로 어댑터 없이 리셋 분석을 돌릴 수 있다.

```json
"model": {
  "id": "prestige",
  "version": 1,
  "params": {
    "generator": { "idleIncome": "1", "baseIncome": "1", "growthRate": 1.03, "costBase": "12", "costGrowth": 1.13 },
    "prestige": {
      "requirement": "2e4",
      "formula": { "kind": "root", "scale": 1, "exponent": 0.5 },
      "multiplierPerPoint": 0.25,
      "multiplierMode": "additive",
      "minRunSec": 300,
      "minGain": 1,
      "starterCash": "10",
      "keepLevels": 2
    }
  }
},
"initial": { "vars": { "level": 0, "runStartT": 0 } }
```

## Params

`generator`는 `stochastic`을 포함해 [`exponential`](./exponential_ko.md)의 params를 모두 받는다. `prestige`:

| 필드 | 기본값 | 의미 |
| --- | --- | --- |
| `requirement` | `"1e6"` | 리셋이 처음 포인트를 주는 순자산. `> 0`이어야 한다 |
| `formula` | `{ "kind": "root", "scale": 1, "exponent": 0.5 }` | `root`: `floor(scale * (worth / requirement)^exponent)`, exponent는 `(0, 1]`. `log10`: `floor(scale * (log10(worth / requirement) + 1))` |
| `multiplierPerPoint` | `0.1` | 누적 포인트당 배율 |
| `multiplierMode` | `"additive"` | `additive`: `1 + perPoint * points`. `compound`: `(1 + perPoint)^points` |
| `minRunSec` | `0` | 런이 이만큼 지나야 리셋이 제공된다. `constraints.minPrestigeIntervalSec`도 따로 적용된다 |
| `minGain` | `1` | 이보다 적은 포인트를 주는 리셋은 제공하지 않는다 |
| `starterCash` | `"0"` | 리셋 후 지갑 |
| `keepLevels` | `0` | 리셋 후에도 유지하는 생산기 레벨 |

Vars: `level`, 그리고 현재 런이 시작된 `t`인 `runStartT`(기본 `0`).

## 리셋

`prestige.reset`(kind `prestige`, 비용 없음)은 런이 `minRunSec` 이상 지났고 획득량이 `minGain` 이상일 때 제공된다. 획득량은 지갑과 현재 레벨에 지불한 가격을 더한 순자산에서 읽으므로 구매해도 줄지 않는다. 적용하면:

- 지갑을 `starterCash`로, 정산 버킷을 0으로, `maxMoneyEver`를 `starterCash`로 설정한다
- `prestige.count`에 1을, `prestige.points`에 획득량을 더하고, 총 포인트로 `prestige.multiplier`를 다시 계산한다
- 레벨을 `min(keepLevels, level)`로 남기고 `runStartT`를 리셋 시각으로 둔다

같은 규칙을 `Model.prestige` 스펙(`pointsFrom`, `multiplierFrom`, `resetState`)으로도 노출한다. 런에서 리셋이 처음 가능해지면 `prestige.reset-available` 마일스톤이 발생한다.

## 리셋 시점은 누가 정하나

[리셋 사이클 실행](../reset-cycle_ko.md)의 계약대로 리셋 권한은 실행기에만 있다. 리셋 액션은 비용도 수입 견적도 없어서 `greedy`는 리셋하지 않는다. 다음 중 하나를 쓴다.

- `executeResetCycles({ scenario, policy: { kind: "fixed-interval", intervalSec, cycles } })`: `resetAdapterFor`가 `prestige.reset`을 고르고 경계마다 리셋 한 번을 커밋한다
- `analyzeResetPolicies({ createScenario, scan, horizonSec, ... })`: 실현 포인트(`state.prestige.points`)로 간격을 비교한다. [리셋 정책 분석](../reset-cycle-analysis_ko.md) 참고
- `prestige.reset`을 내는 플러그인 전략

`previewPrestigeGain(E, params, worth, currentPoints)`는 설계용 훅이다. 런 시간이나 쿨다운 없이 주어진 순자산에서 `eligible`, `gainedPoints`, `nextPoints`, `nextMultiplier`를 돌려준다. 리셋 곡선을 표로 만들거나 리셋 정책 결과를 손으로 검산할 때 쓴다. `prestigePointsFor`와 `prestigeMultiplierFor`는 두 공식을 따로 쓴다.

```ts
import { analyzeResetPolicies, compileScenario, createNumberEngine } from "@idlekit/core";

const artifact = analyzeResetPolicies({
  createScenario: () => compileScenario({ E: createNumberEngine(), scenario, registry, strategyRegistry }),
  scan: { fromSec: 600, toSec: 1800, stepSec: 600 },
  horizonSec: 5400,
  cycleBudget: 10,
  objective: "cumulative-reset-reward",
  recovery: { metric: "pre-reset-net-worth" },
  stability: { minObservedCycles: 3, windows: [2, 3], absoluteTolerance: "0", relativeTolerance: 0.5 },
});
```

`idk prestige-cycle`은 레거시 간격 스캔이다. 간격마다 시나리오 전략을 돌릴 뿐 리셋하지 않으므로, `pointsPerHour`는 커밋한 포인트에 각 간격 끝에서 가능한 리셋(`Model.prestige.pointsFrom`)을 더해 센다. `idk reset-policy`는 CLI에서 `analyzeResetPolicies`를 실행하고 리셋하지 않는 경우 대비 ROI, 타이밍 창, 안정성을 더한다. [고급 분석](../advanced-analysis_ko.md#리셋-정책-idk-reset-policy)을 본다.

## 실행해 보기

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/27-prestige-loop-v1.json --format md
bun run --cwd packages/cli dev -- prestige-cycle ../../examples/tutorials/27-prestige-loop-v1.json --scan 600..2400 --step 600 --horizon 7200 --format md
bun run --cwd packages/cli dev -- reset-policy ../../examples/tutorials/27-prestige-loop-v1.json --scan 600..1800 --step 600 --horizon 5000 --format md
```

Node.js and browser runtimes are not part of the v1 compatibility contract.
