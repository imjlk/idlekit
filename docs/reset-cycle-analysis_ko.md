# 리셋 정책 분석

English version: [reset-cycle-analysis.md](./reset-cycle-analysis.md)

`analyzeResetPolicies`는 하나의 유한 horizon에서 reset 간격을 비교한다. 각 후보는 호출자의 `createScenario`에서 시작한다. 커밋된 reset과, 아직 reset하지 않은 끝 구간은 따로 둔다. `realizedReward`는 커밋된 delta의 합이며 이미 가진 재고를 넣지 않는다. `unrealizedReward`는 커밋하지 않은 reset이다. `rewardRate`는 그 합을 완결 cycle 시간으로 나눈다. 재고를 horizon으로 나누지 않는다.

## legacy 필드를 바꾸는 정의

`analyzePrestigeCycle`은 기존 interval scan을 그대로 반환한다.

| Legacy 필드 | 이전 의미 | 대체 |
|---|---|---|
| `breakEvenSec` | `min(interval, horizon)` | 선택한 지표가 reset 직전 기준을 넘는 시각인 `recovery.seconds`. 넘지 못하면 `recovery.status: "censored"`이고 `seconds`는 null |
| `cycles >= 5`일 때의 `stability: "stable"` | 복사된 cycle 수 | 요청한 최소 cycle 수, trailing window, 절대·상대 tolerance로 정한 `stability.status` |

새 상태는 `insufficient-data`, `stable`, `drifting`, `non-stationary`, `oscillating`이다. `provedSteadyState`는 false다. window 안의 일치는 정상상태의 수학적 증명이 아니다. fixture와 값이 같다는 Evidence도 그 증명이 아니다.

새 wire object는 `ResetPolicyArtifactV1`이고 schema는 `idlekit.reset-policy.v1`이다. `breakEvenSec`를 복사하지 않는다. legacy 출력의 부족한 근거를 숨기도록 변환하지 않는다. `idk prestige-cycle`은 계속 `analyzePrestigeCycle`을 호출한다.

`best`는 objective와 그 읽기(`flow`, `stock`, `time`), scan 범위, `scope: "scan-range"`, `globalOptimum: false`, session 가정, 관측 상태를 담는다. 순위는 `Engine.cmp`다. `toNumber`에서 같은 값이 `Engine.cmp`에서도 같은 값은 아니다. 승자는 scan한 후보 중 최선이지 전역 최적이 아니다.

session 패턴은 active block 안에서만 수동 reset을 커밋한다. `resetDelaySec`는 호출자가 준 시간 비용이다. wall time만 밀고 수입은 주지 않는다. 오프라인 공백에서는 reset을 커밋하지 않는다. 그 공백은 `simulateSessionPattern`처럼 시나리오의 오프라인 진행(cap과 decay 포함)을 적용하고, 모델이 session clock을 읽으면 active block에 그 값을 준다. cycle budget에 닿거나 reset이 거절되면 이후 reset만 멈추고 일정은 계속 재생하므로, 모든 후보가 같은 horizon까지 진행한다. 일정이 있는 후보의 recovery는 그 후보의 첫 reset부터 잰다.

재생 중에는 전략이 reset action을 보지 못하므로 policy만 reset을 커밋한다. reset adapter는 각 경계에서 현재 constraints로 다시 고른다. `horizonSec`는 시나리오 시작부터의 경과 시간이다. 목표 시간은 목표를 만족한 첫 커밋 상태의 시간이며 reset 사이도 포함한다. `goal-reach-sec`에는 goal이 필요하고 `absoluteTolerance`는 0 이상의 유한한 값이어야 한다. 중간에 거절된 승자가 있으면 artifact 상태는 `incomplete`다.

## 기준 예

RNG는 없다. 엔진은 number engine이다. 시작 points는 100, 시작 money는 50이다. 수입은 초당 1코인이다. reset은 point를 1 주고 multiplier는 1로 두며 money를 지우지 않는다. scan은 10..10 step 10이다. horizon은 45초다. cycle budget은 8이다. stability는 cycle 4개, window 2와 4, 절대 tolerance `0`, 상대 tolerance 0을 요구한다. recovery는 reset 직전 income을 읽는다. 알려진 보상률은 [reset-policy-rate.json](../fixtures/conformance/reset-policy-rate.json)이다.

기대 결과:

- 커밋된 reset 4회, 실현 보상 `"4"`, 최종 points `"104"`
- 완결 cycle 시간 40, 보상률 `"0.1"`
- 미완결 구간 40..45, 미실현 보상 `"1"`
- 최종 순자산 `"95"`
- recovery 초는 `0`이다. income이 떨어지지 않기 때문이다. 이것은 `min(10, 45)`가 아니다
- stability는 `stable`, `provedSteadyState`는 false, known solution은 일치
- best objective는 `cumulative-reset-reward`, reading `flow`, 값 `"4"`
- scope는 `scan-range`, `globalOptimum`은 false, session은 `always-active`

같은 모델을 horizon 40에서 간격 10과 20으로 비교하면 실현 보상은 `"4"`와 `"2"`다. 최종 points는 `"104"`와 `"102"`다. 최선 간격은 10이다.

다른 income fixture는 25에서 시작하고 reset 때 0이 되며 초당 1씩 오른다. 교차는 25초다. horizon 20이면 censored다.

Node.js와 브라우저 런타임은 v1 호환 계약에 포함되지 않는다.
