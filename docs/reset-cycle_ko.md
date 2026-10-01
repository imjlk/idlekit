# 리셋 사이클 실행

English version: [reset-cycle.md](./reset-cycle.md)

`executeResetCycles`는 고정 간격이나 명시된 길이 목록을 실행하고, 끝난 회차마다 reset을 한 번 커밋한다. reset은 `stepOnce`와 같은 결제 경로인 `applyDecisions`를 통과한다. reset을 위해 수입을 한 틱 지급하지 않는다. adapter는 현재 상태에 맞춰 action을 만들므로 `applyDecisions`를 `resolveAgainstModel: false`로 부르고, `model.actions`에 없는 spec이나 custom action을 버리지 않는다. `stepOnce`는 계속 `model.actions`를 다시 읽는다.

모델에 prestige action이 있으면 기본 adapter는 그 action을 쓴다. 그 경로에서는 `pointsFrom`, `resetState`, `multiplierFrom`을 다시 적용하지 않는다. prestige action이 없고 `Model.prestige`가 있으면 spec이 adapter다. `pointsFrom`은 획득량이고, `resetState`가 다음 상태를 쓰며, `multiplierFrom`은 비교만 한다. 둘 다 없으면 명시 adapter가 필요하다. 그때 status는 `unsupported`이고 state는 바뀌지 않는다.

각 회차는 절대 `startSec`와 `endSec`, 회차 로컬 `durationSec`, `resetAtSec`, `rewardDelta`, `accumulatedReward`를 기록한다. delta는 그 reset이 만든 보상이다. 이미 가진 재고를 다시 더하지 않는다. 조건, 비용, cooldown 실패는 `resetSkippedReason`이며 보상을 지급하지 않는다. `cycles`가 `0`, `NaN`, `Infinity`이거나 간격이 `0`이면 거부한다. horizon, `maxCycles`, step budget은 남은 reset을 만들지 않고 멈춘다.

`analyzePrestigeCycle`은 기존 interval scan으로 남는다. 그 `stability`, `breakEvenSec`, 복사된 `cycles`는 커밋된 reset의 증거가 아니다. 반환값의 경고가 그 뜻을 말한다. 이 artifact에는 그 필드가 없다. 정책 비교와 정상상태 판정은 이후 변경이다.

Node.js와 브라우저 런타임은 v1 호환 계약에 포함되지 않는다.
