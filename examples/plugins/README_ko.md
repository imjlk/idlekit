# Plugin Example (Model + Strategy + Objective)

이 예제는 커스텀 플러그인으로 아래 3개를 동시에 확장하는 방법을 보여줍니다.

- Model: `plugin.generators@1`
- Strategy: `plugin.producerFirst`
- Objective: `plugin.gemsAndWorthLog10`

파일:

- `custom-econ-plugin.ts`: 플러그인 본체
- `plugin-scenario.json`: 플러그인 모델/전략 사용 시나리오
- `plugin-tune.json`: 플러그인 전략/목표 기반 튜닝 스펙

이 플러그인을 기반으로 한 canonical worked example:

- `../tutorials/14-orbital-foundry-v1.json`
- `../tutorials/15-orbital-foundry-compare-b.json`
- `../tutorials/16-orbital-foundry-tune.json`

안정적으로 기대할 수 있는 milestone key:

- `progress.first-upgrade`
- `progress.first-automation`
- `system.first-core`
- `system.fabricator-line-online`

## 1) 목록 확인

저장소 밖에서도 원본 플러그인을 그대로 쓸 수 있다. 새 폴더에서 아래 패키지를 설치하고
`custom-econ-plugin.ts`, `14-orbital-foundry-v1.json`, `15-orbital-foundry-compare-b.json`,
`16-orbital-foundry-tune.json`을 복사한다. Bun 1.4.2 이상이 필요하다.

```sh
npm init -y
npm install @idlekit/core@^0.4.0 @idlekit/cli@^0.4.0
bun node_modules/@idlekit/cli/dist/main.js validate 14-orbital-foundry-v1.json --plugin ./custom-econ-plugin.ts --plugin-root . --allow-plugin true
bun node_modules/@idlekit/cli/dist/main.js review compare 14-orbital-foundry-v1.json 15-orbital-foundry-compare-b.json --bundle full --days 1 --draws 1 --seed 19 --plugin ./custom-econ-plugin.ts --plugin-root . --allow-plugin true
```

공개 `@idlekit/core`를 import하므로 소스 경로나 컴파일러 hook을 고칠 필요가 없다.
플러그인 허용 옵션은 로컬 코드를 실행하므로 먼저 내용을 검토한다. 예제는 가상 게임이며
실제 리텐션·매출을 입증하지 않는다. `bun run install:smoke`는 이 원본을 패키지 소비자
폴더에 그대로 복사해 배포용 Core·CLI와 함께 시뮬레이션한다.

루트에서 실행:

```bash
bun run --cwd packages/cli dev -- models list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- strategies list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- objectives list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
```

설치형 동등 명령:

```bash
idk models list --plugin examples/plugins/custom-econ-plugin.ts --allow-plugin true
idk strategies list --plugin examples/plugins/custom-econ-plugin.ts --allow-plugin true
idk objectives list --plugin examples/plugins/custom-econ-plugin.ts --allow-plugin true
```

## 2) 시나리오 검증/실행

```bash
bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true

bun run --cwd packages/cli dev -- simulate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

## 3) 튜닝 실행

```bash
bun run --cwd packages/cli dev -- tune ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --tune ../../examples/plugins/plugin-tune.json \
  --format json
```

## 4) 플러그인 작성 포인트

- `models/strategies/objectives` 배열을 export(default 또는 named)
- `paramsSchema`와 `defaultParams`를 함께 제공하면 UX가 안정적
- 전략/모델은 결정론을 유지해야 planner/tuner 재현성이 보장됨
- 운영 환경에서는 `--plugin-root`/`--plugin-sha256`로 로드 범위와 무결성을 함께 제한 권장
