# Plugin Example (Model + Strategy + Objective)

이 예제는 커스텀 플러그인으로 아래 3개를 동시에 확장하는 방법을 보여줍니다.

- Model: `plugin.generators@1`
- Strategy: `plugin.producerFirst`
- Objective: `plugin.gemsAndWorthLog10`

파일:

- `custom-econ-plugin.ts`: 플러그인 본체
- `plugin-scenario.json`: 플러그인 모델/전략 사용 시나리오
- `plugin-tune.json`: 플러그인 전략/목표 기반 튜닝 스펙

## 1) 목록 확인

루트에서 실행:

```bash
bun run --cwd packages/cli dev -- models list --plugin ../../examples/plugins/custom-econ-plugin.ts
bun run --cwd packages/cli dev -- strategies list --plugin ../../examples/plugins/custom-econ-plugin.ts
bun run --cwd packages/cli dev -- objectives list --plugin ../../examples/plugins/custom-econ-plugin.ts
```

설치형 동등 명령:

```bash
idk models list --plugin examples/plugins/custom-econ-plugin.ts
idk strategies list --plugin examples/plugins/custom-econ-plugin.ts
idk objectives list --plugin examples/plugins/custom-econ-plugin.ts
```

## 2) 시나리오 검증/실행

```bash
bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts

bun run --cwd packages/cli dev -- simulate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --format json
```

## 3) 튜닝 실행

```bash
bun run --cwd packages/cli dev -- tune ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --tune ../../examples/plugins/plugin-tune.json \
  --format json
```

## 4) 플러그인 작성 포인트

- `models/strategies/objectives` 배열을 export(default 또는 named)
- `paramsSchema`와 `defaultParams`를 함께 제공하면 UX가 안정적
- 전략/모델은 결정론을 유지해야 planner/tuner 재현성이 보장됨
