# ETA 의미

영어 원문: [eta-semantics.md](./eta-semantics.md)

`PR-09`는 기존 ETA 객체를 유지하고 그 옆에 ETA estimate를 둔다. `docs/schemas/eta.output.schema.json`의 `seconds`는 계속 number다. estimate의 `seconds`는 `null`일 수 있다.

## 의미

money와 net worth 목표는 `etaGoalForTarget`을 공유한다. analytic과 simulate가 그 목표를 쓴다. `exact`는 action, evolve, prestige, strategy, policy constraint가 없는 상수 money 미분일 때만이다. 국소 rate만 있는 나머지는 `analytic-local`이다. `incomeKind: "constant"`만으로 모든 전략이 exact가 되지는 않는다.

모델 `netWorth` 함수는 `unsupported-local`이다. money income을 그 미분으로 쓰지 않는다. legacy `seconds`는 그 초기 수입 비율이 유한한 수일 때 예전 값을 유지할 수 있으며, 그 수는 net worth 결과가 아니다. `netWorth` 함수가 없어도 `unsupported-local`이다. 그때 legacy `seconds`는 지갑 금액을 재사용할 수 있다.

fixed-step `seconds`는 첫 관측이다. 단조인 상수 모델은 연속 비율부터 그 관측까지의 bracket을 둘 수 있다. 그 밖에는 `observationResolutionSec`만 기록하고 bracket을 만들지 않는다. horizon 안에 남은 목표는 `censored`다. unreachable이라고 하지 않는다. legacy `seconds`는 horizon 숫자로 남는다.

비율은 `E.divN(E.sub(target, current), rate)`이다. `toNumber`는 그 다음, 유한하고 표현 가능한 초일 때만 호출한다. `readEtaOutput`은 legacy `seconds`와 artifact를 섞지 않는다.

이전의 fail-closed 규칙은 유지한다. 목표나 horizon 전에 `maxSteps`로 멈춘 실행은 예외를 던지고, 관측 초는 `t` 차이가 아니라 시뮬레이션한 초다. 유한하지 않은 지갑, net worth, 목표, 수입은 t=0에 도달한 것으로 보지 않는다. 그때 money 추정은 `invalid`, net worth 추정은 `unsupported`이고, legacy `seconds`는 낮은 confidence의 `Infinity`다.

모든 추정은 `target`을 kind, 엔진 decimal, 단위로 기록하므로 목표값이 다른 추정이 구별된다. `maxLogGap` tick policy는 수입을 버리거나 쌓아 둘 수 있고, 남은 `accumulate` bucket은 다음 tick에 지갑으로 들어가므로 둘 다 `exact`를 막는다. 수 범위보다 작은 양의 비율은 0초가 아니라 `secondsDecimal`이 있는 `invalid`다. simulate에서 유한하지 않은 목표나 관측값은 목표 도달로 실행을 끝내지 않으며 추정은 `invalid`다. `Model.netWorth` 없는 net worth 목표는 legacy 필드가 지갑 대리값을 유지해도 추정에서는 `unsupported`다. ok가 아닌 모든 추정은 `seconds: null`이다.

`DX-02`는 이 함수를 감쌀 수 있다. ETA 엔진을 새로 만들지 않는다.

Node.js and browser runtimes are not part of the v1 compatibility contract.
