# @idlekit/money 사용 가이드

`@idlekit/money`는 idle 게임 화폐 처리에 필요한 핵심 기능만 분리한 패키지입니다.

포함 범위:

- `Engine<N>` 숫자 엔진 어댑터
- `Money / MoneyState`
- `tickMoney` 정책(`drop`/`accumulate`) + 이벤트
- 금액 표기/파싱(`formatMoney`/`parseMoney`, `alphaInfinite`)
- 상태 직렬화(`serializeMoneyState`/`deserializeMoneyState`)
- 표시 변화 감지(`VisibilityTracker`)

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

## 4. 엔진 어댑터 패턴

커스텀 숫자 타입(`bigint`, decimal, big-number)을 쓰려면 `Engine<N>`만 구현하면 됩니다.

- 인터페이스: `packages/money/src/engine/types.ts`
- 고정소수점 어댑터 예제: `examples/adapter-pattern`

실행:

```bash
bun examples/adapter-pattern/run.ts
```

## 5. core와의 관계

- `@idlekit/core`는 money 관련 모듈을 `@idlekit/money`에서 re-export합니다.
- 즉, 시뮬레이터를 쓰면 기존처럼 `@idlekit/core`만 써도 되고,
- 화폐 처리만 독립 사용하려면 `@idlekit/money`만 바로 써도 됩니다.

## 6. 프로덕션 체크리스트

- 엔진의 `absLog10`/`cmp` 정확도 검증
- `toNumber` 의존 최소화(분석/휴리스틱 한정)
- `maxLogGap`를 UX(표시 자릿수)와 함께 튜닝
- 정책/표기/직렬화 회귀 테스트를 CI에 고정
