# @idlekit/money 사용 가이드

`@idlekit/money`는 idle 게임 화폐 처리에 필요한 핵심 기능만 분리한 패키지입니다.

포함 범위:

- `Engine<N>` 숫자 엔진 어댑터
- `Money / MoneyState`
- `tickMoney` 정책(`drop`/`accumulate`) + 이벤트
- 금액 표기/파싱(`formatMoney`/`parseMoney`, `alphaInfinite`)
- 상태 직렬화(`serializeMoneyState`/`deserializeMoneyState`)
- 표시 변화 감지(`VisibilityTracker`)

기본 엔진 선택:

- `createBreakInfinityEngine()` / `breakInfinityEngine`: 대형 수 대응 기본값
- `createNumberEngine()`: 경량 테스트/소규모 시뮬레이션용

## 1. 빠른 시작

워크스페이스 기준:

```bash
bun install
bun run --cwd packages/money typecheck
bun run --cwd packages/money test
bun examples/money-package/run.ts
```

## 2. 최소 사용 예시

```ts
import {
  createNumberEngine,
  tickMoney,
  formatMoney,
  parseMoney,
  serializeMoneyState,
  deserializeMoneyState,
  VisibilityTracker,
  type MoneyState,
} from "@idlekit/money";

const E = createNumberEngine();
const unit = { code: "COIN" as const };

let state: MoneyState<number, "COIN"> = {
  money: { unit, amount: 1e9 },
  bucket: 0,
};

const res = tickMoney({
  E,
  state,
  delta: { unit, amount: 1 },
  policy: { mode: "accumulate", maxLogGap: 6 },
});

state = res.state;
console.log(formatMoney(E, state.money));

const parsed = parseMoney(E, "12.3aa COIN", {
  suffix: { kind: "alphaInfinite", minLen: 2 },
  allowUnitInString: true,
});

const json = serializeMoneyState(E, state, { engineName: "number" });
const restored = deserializeMoneyState(E, json);

const tracker = new VisibilityTracker(E, { significantDigits: 3 });
console.log(tracker.observe(restored.money));
```

## 3. 정책 동작 규칙

- `drop`: 너무 작은 delta는 버립니다.
- `accumulate`: 너무 작은 delta를 `bucket`에 누적하고, 의미가 생기면 flush 후 적용합니다.
- tooSmall 판정: `logGap = log10(|base|) - log10(|delta|)`가 `maxLogGap`보다 크면 tooSmall.

이벤트 타입:

- `blocked` (unit mismatch)
- `applied`
- `dropped`
- `queued`
- `flushed`

성능 옵션:

- `options.collectEvents = false`면 이벤트 생성/발행을 생략합니다.
- `options.collectFacts = true`를 함께 설정하면 이벤트를 보관하지 않아도 읽기 전용 `facts`의 `applied`, `dropped`, `queued`, `flushed`, `blocked` 카운트를 받습니다. 지갑과 bucket 결과는 동일합니다.
- 해당 이벤트가 발생한 경우 `appliedDelta`는 실제 적용량, `flushedBucket`은 이전 bucket을 담습니다. 기본 결과 형태는 유지되며 facts 수집은 이벤트 수집과 독립적입니다. Core는 돈 이벤트 생략 시 이 정보로 카운터와 정확한 양수 보상 판정을 유지합니다.

### 표기·파싱 경계 규칙

- `formatMoney`는 `significantDigits`(1~100 정수, 기본 3, 그 외 값은 `RangeError`)로 반올림합니다. 반올림한 가수가 1000이 되면 다음 suffix로 넘어갑니다. `999.9`는 `1.00e+3`이 아니라 `1aa`입니다. 자릿수가 정수부보다 적어도 지수 표기 없이 출력합니다. `123`을 1자리로 표기하면 `100`입니다.
- `table` suffixer는 마지막 항목에서 멈춥니다. 그보다 큰 값은 마지막 suffix에 큰 가수를 붙입니다. `["", "K", "M"]`에서 `1e12`는 잘못된 작은 수가 아니라 `1000000M`입니다.
- 부호는 값 자체에서 읽습니다. `cmp`가 0과 같다고 보는 `-1e-13`도 `-1e-13`으로 출력합니다. 지수 표기도 일반 표기처럼 0을 정리합니다(`trimTrailingZeros`가 false가 아니면 `1.00e-7` 대신 `1e-7`).
- `parseMoney`는 부호, 소수, 지수, suffix가 붙은 ASCII 숫자만 받습니다. 로케일 구분자(`1,000`, `1.000,5`), 전각 숫자, `1_000`, `0x10`, `5.`, `NaN`, `Infinity`는 거부합니다. 엔진 범위를 넘는 값은 엔진이 표현하는 그대로 돌려줍니다(Number 엔진의 `1e400`은 `Infinity`, underflow는 0). 그래서 `isFinite`로 확인해야 하며, core의 ETA와 compare는 이 값을 fail closed로 처리합니다. `table` suffixer는 대소문자를 무시한 일치보다 정확한 일치를 먼저 씁니다.
- `createNumberEngine().from`은 빈 문자열과 숫자가 아닌 문자열을 0이나 `NaN`으로 바꾸지 않고 거부합니다. 자신의 `toString`이 쓰는 `NaN`, `Infinity`, `-Infinity`는 그대로 읽습니다. `cmp(Infinity, Infinity)`는 0입니다. `cmp`에는 `NaN`용 결과가 없으므로 `isFinite`로 먼저 걸러야 합니다.
- `deserializeMoneyState`는 `unit`, `amount`, `bucket`이 문자열인지 확인합니다. Number 엔진은 `-0`을 `0`으로 씁니다.

## 4. 엔진 어댑터 패턴

커스텀 숫자 타입(`bigint`, decimal, big-number)을 쓰려면 `Engine<N>`만 구현하면 됩니다.

- 인터페이스: `packages/money/src/engine/types.ts`
- 고정소수점 어댑터 예제: `examples/adapter-pattern`

실행:

```bash
bun examples/adapter-pattern/run.ts
```

## 5. core와의 관계

- 엔진, `Money`/`MoneyState`, `tickMoney`, 표기, 화폐 serde의 공식 import 경로는 `@idlekit/money`입니다. 구현도 `@idlekit/money`에만 있습니다.
- `@idlekit/core`는 같은 심볼을 얇은 wrapper 모듈로 re-export합니다. 기존 시뮬레이터 코드는 그대로 동작합니다.
- core의 re-export는 v1 호환성 계약에 포함되어 v1 안에서는 제거하지 않지만, deprecation 예정입니다. 화폐 기능만 쓰는 새 코드는 `@idlekit/money`에서 직접 import하세요.
- `breakEternityEngine`과 `createBreakEternityEngine`은 v1에서 구현되지 않은 placeholder입니다. 모든 메서드가 `BREAK_ETERNITY_EXPERIMENTAL_MESSAGE` 오류를 던지며, 공개 API 형태를 유지하려고만 export합니다. 큰 수는 `breakInfinityEngine`(`createBreakInfinityEngine`)이나 직접 구현한 `Engine<N>` 어댑터를 쓰세요.

## 6. 프로덕션 체크리스트

- 엔진의 `absLog10`/`cmp` 정확도 검증
- `toNumber` 의존 최소화(분석/휴리스틱 한정)
- `maxLogGap`를 UX(표시 자릿수)와 함께 튜닝
- 정책/표기/직렬화 회귀 테스트를 CI에 고정
