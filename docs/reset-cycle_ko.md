# 리셋 사이클 실행

English version: [reset-cycle.md](./reset-cycle.md)

`executeResetCycles`는 고정 간격이나 명시된 길이 목록을 실행하고, 끝난 회차마다 reset을 한 번 커밋한다. reset은 `stepOnce`와 같은 결제 경로인 `applyDecisions`를 통과한다. reset을 위해 수입을 한 틱 지급하지 않는다. adapter는 현재 상태에 맞춰 action을 만들므로 `applyDecisions`를 `resolveAgainstModel: false`로 부르고, `model.actions`에 없는 spec이나 custom action을 버리지 않는다. `stepOnce`는 계속 `model.actions`를 다시 읽는다.

모델에 prestige action이 있으면 기본 adapter는 그 action을 쓴다. 그 경로에서는 `pointsFrom`, `resetState`, `multiplierFrom`을 다시 적용하지 않는다. prestige action이 없고 `Model.prestige`가 있으면 spec이 adapter다. `pointsFrom`은 획득량이고, `resetState`가 다음 상태를 쓰며, `multiplierFrom`은 비교만 한다. adapter는 reset 경계마다 그 시점 상태에서 고르므로 interval 중에 생긴 prestige action도 쓴다. 경계에서 둘 다 없으면 명시 adapter가 필요하다. 그때 첫 interval을 실행한 뒤 status는 `unsupported`이고 reset은 커밋하지 않는다. interval 동안 strategy는 reset action을 보지 못하므로 reset 권한은 executor에만 있다. `horizonSec`은 study origin부터 runner 결과마다 더해 checkpoint에 남기는 시뮬레이션 초로 센다. runner가 budget으로 멈추면 그 cycle은 censored다. class 기반 model도 interval 필터를 거쳐 private field를 포함한 메서드와 receiver를 유지한다. reset과 id가 같은 일반 custom action은 계속 쓸 수 있다. horizon이 0이면 interval을 허용하지 않는다. undefined인 strategy나 RNG snapshot도 복원한다. cycle duration은 runner가 시뮬레이션한 초다. 경계 action은 현재 constraints를 보고, checkpoint는 strategy와 RNG snapshot을 복사한다.

각 회차는 절대 `startSec`와 `endSec`, 회차 로컬 `durationSec`, `resetAtSec`, `rewardDelta`, `accumulatedReward`를 기록한다. delta는 그 reset이 만든 보상이다. 이미 가진 재고를 다시 더하지 않는다. 조건, 비용, cooldown 실패는 `resetSkippedReason`이며 보상을 지급하지 않는다. `cycles`가 `0`, `NaN`, `Infinity`이거나 간격이 `0`이면 거부한다. horizon, `maxCycles`, step budget은 남은 reset을 만들지 않고 멈춘다. `maxCycles: 0`은 첫 reset 전에 실행을 censored로 끝낸다. 체크포인트는 전략에 `snapshotState`와 `restoreState`가 모두 있을 때만 전략 스냅샷을 담는다.

`analyzePrestigeCycle`은 기존 interval scan으로 남는다. 그 `stability`, `breakEvenSec`, 복사된 `cycles`는 커밋된 reset의 증거가 아니다. 반환값의 경고가 그 뜻을 말한다. 이 artifact에는 그 필드가 없다. [리셋 정책 분석](./reset-cycle-analysis_ko.md)이 한 horizon에서 간격을 비교한다. 그 경험적 stability는 증명된 정상상태가 아니다.

Node.js와 브라우저 런타임은 v1 호환 계약에 포함되지 않는다.
