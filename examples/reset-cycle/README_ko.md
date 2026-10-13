# Reset cycle 저장과 재개

`bun install` 후 저장소 루트에서 실행한다.

```bash
bun examples/reset-cycle/save-resume.ts
```

이 예제는 초당 코인 하나를 얻고, reset 때 지갑을 유지하며, 10초마다 prestige
포인트 하나를 얻는다. 시뮬레이션 세 step 뒤에 checkpoint를
`tmp/reset-cycle-example/checkpoint.json`에 저장한다. JSON을 다시 읽고 scenario와
상태 없는 strategy를 새로 만들어 재개한다. 첫 번째 인자로 다른 저장 경로를
지정할 수도 있다.

저장된 checkpoint는 `nextIndex: 0`, `elapsedSec: 3`, `pendingSec: 3`,
`pendingDurationSec: 10`이다. 중단한 사이클에는 7초가 더 필요하다. 새 10초
사이클을 시작하는 것이 아니다. fixed-interval policy에서 재개할 때는
`cycles: totalCycles - checkpoint.nextIndex`를 사용한다. 중단된 사이클도 남은
사이클 하나로 센다.

기대 결과는 `matchesContinuous: true`, 총 30초, 30코인, prestige 포인트 3,
누적 reset 보상 3이다. 완료된 세 행의 시간 구간은 `[0, 10]`, `[10, 20]`,
`[20, 30]`이다. budget으로 중단한 행은 `resetAtSec: null`이며 재개 실행에서
완료된 대체 행을 얻는다. 따라서 실행 이력을 합칠 때 중단된 임시 행을 제외한다.

스크립트는 최종 checkpoint 전체와 완료된 행을 연속 실행 결과와 비교한다.
Core conformance helper로 사이클 중간과 경계에서 재개 동등성도 확인한다.
이 관계는 일정한 수입과 상태 없는 strategy를 사용하는 이 fixture에 선언한다.

이 예제는 number engine과 JSON으로 표현되는 vars를 사용하므로 일반 JSON으로
저장할 수 있다. 다른 engine에는 해당 값의 codec이 필요하고, 상태가 있는
strategy나 RNG에는 snapshot/restore hook과 일치하는 identity가 필요하다.
Checkpoint는 상태이므로 같은 model·policy·런타임 구성 요소를 다시 만들어
재개한다.
