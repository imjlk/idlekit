# 플러그인과 어댑터 패턴 가이드

## 1. 플러그인 모듈 형식

CLI 플러그인은 아래 구조를 export 하면 됩니다.

```ts
import type { ModelFactory, ObjectiveFactory, StrategyFactory } from "@idlekit/core";

const plugin: {
  models?: readonly ModelFactory[];
  strategies?: readonly StrategyFactory[];
  objectives?: readonly ObjectiveFactory[];
} = {
  models: [],
  strategies: [],
  objectives: [],
};

export default plugin;
```

또는 named export (`models`, `strategies`, `objectives`)도 지원됩니다.

로드:

```bash
bun run --cwd packages/cli dev -- models list --plugin ./my-plugin.ts --allow-plugin true
```

## 2. Engine 어댑터(핵심)

`@idlekit/core`는 `Engine<N>` 인터페이스로 숫자 엔진을 추상화합니다.

```ts
export interface Engine<N> {
  zero(): N;
  from(input: number | string | N): N;
  add(a: N, b: N): N;
  sub(a: N, b: N): N;
  mul(a: N, k: number): N;
  div(a: N, k: number): N;
  mulN(a: N, b: N): N;
  divN(a: N, b: N): N;
  cmp(a: N, b: N): -1 | 0 | 1;
  absLog10(a: N): number;
  isFinite(a: N): boolean;
  toString(a: N): string;
  toNumber(a: N): number;
}
```

핵심 포인트:

- `toNumber`는 분석/휴리스틱용 보조값으로만 사용
- 결제/누적/상태 업데이트는 항상 `N` 타입 연산으로 처리
- `absLog10` 품질이 strategy/objective 안정성에 중요

## 3. 결정론 규약

전략/모델 구현 시 아래를 지켜야 튜닝/플래닝 결과가 재현됩니다.

- `Math.random()`, `Date.now()` 사용 금지
- 입력 동일하면 `actions()`와 `bulk()` 결과 순서 동일
- tie-break 규칙을 고정해서 사용
- `ctx`, `state`를 mutate 하지 않기

관련 코드:

- `packages/core/src/sim/strategy/contracts.ts`
- `packages/core/src/sim/strategy/stability.ts`

## 4. stepOnce 의존 규약

planner/optimizer 롤아웃은 `runScenario` 로직 복제가 아니라 `stepOnce`를 사용해야 합니다.

- 단일 틱 전이 SSOT: `packages/core/src/sim/step.ts`
- planner deps: `packages/core/src/sim/strategy/planner.ts`

## 5. 어댑터 예제 프로젝트

실행 가능한 예제:

- `examples/adapter-pattern/README.md`
- `examples/adapter-pattern/fixedPointEngine.ts`
- `examples/adapter-pattern/run.ts`

이 예제는 `bigint` 고정소수점 엔진을 `Engine<bigint>`로 어댑팅해서 시뮬레이터를 실행합니다.
