# CLI 디자이너 시작 문서

이 문서는 "내 idle 게임 초안을 바로 시나리오로 실행해보고 싶은 사람"을 위한 가장 짧은 시작 경로입니다.

기준:

- 명령은 프로젝트 루트에서 실행
- 개발형 표준: `bun run --cwd packages/cli dev -- ...`
- 설치형 동등 명령: `idk ...`

내 복제본부터 만들고 시작하려면:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json
```

이름까지 같이 바꾸려면:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json --name "Space Miner"
```

세션형/장기형으로 바로 시작하려면:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset session --out ../../tmp/my-session-game.json
bun run --cwd packages/cli dev -- init scenario --track personal --preset longrun --out ../../tmp/my-longrun-game.json
```

`personal` track은 항상 아래 3개를 같이 만듭니다.

- `../../tmp/my-game-v1.json`
- `../../tmp/my-game-v1-compare-b.json`
- `../../tmp/my-game-v1-tune.json`

`--name`을 주면 파일 stem과 `meta.id/title`도 같이 바뀝니다. 위 예시는 `space-miner-v1*.json` 세트를 만듭니다.

## 1. 첫 실행

```bash
bun install

bun run --cwd packages/cli dev -- validate ../../examples/tutorials/11-my-game-v1.json
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/11-my-game-v1.json --format json
```

동등 명령:

```bash
idk validate examples/tutorials/11-my-game-v1.json
idk simulate examples/tutorials/11-my-game-v1.json --format json
```

성공 조건:

- `validate`는 `OK: ...11-my-game-v1.json`을 출력하고 `simulate` JSON에는 `endMoney`, `endNetWorth`, `stats`가 존재합니다.

실패 대응:

- `[SCENARIO_INVALID]`가 뜨면 [11-my-game-v1.json](../examples/tutorials/11-my-game-v1.json)의 필수 필드 타입부터 확인합니다.

## 2. 가장 먼저 바꿀 3개

[11-my-game-v1.json](../examples/tutorials/11-my-game-v1.json)에서 아래만 먼저 바꾸면 됩니다.

1. `unit`
2. `model.params`
3. `clock.durationSec`

권장 1차 수정:

- `unit.code`, `unit.symbol`
- `model.params.incomePerSec`
- `model.params.buyCostBase`
- `model.params.buyCostGrowth`
- `clock.durationSec`

성공 조건:

- 수정 후 다시 `validate`와 `simulate`가 그대로 통과합니다.

실패 대응:

- 수치가 너무 커서 감이 안 오면 `buyCostGrowth`를 낮추고 `durationSec`를 1800 또는 3600으로 줄여 다시 확인합니다.
- scaffold를 다시 만들 때 같은 파일명이 이미 있으면 `[CLI_USAGE] Output file already exists`가 나옵니다. 이 경우 `--force true`를 붙입니다.

## 3. 다시 시뮬레이션

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/11-my-game-v1.json --format json
```

동등 명령:

```bash
idk simulate examples/tutorials/11-my-game-v1.json --format json
```

읽는 법:

- `endMoney`: 종료 시점 지갑 재화
- `endNetWorth`: 종료 시점 총 가치
- `stats.actions.applied`: 실제로 구매가 일어난 횟수
- `stats.actions.skippedInsufficientFunds`: 사고 싶었지만 돈이 부족했던 횟수

성공 조건:

- 수정 전후 결과를 보고 "너무 빠르다 / 너무 느리다 / 비용이 너무 가볍다" 같은 첫 판단을 말할 수 있습니다.

실패 대응:

- 구매가 너무 안 일어나면 `buyCostBase`를 낮추고, 너무 잦으면 `incomePerSec`를 낮추거나 `buyCostGrowth`를 높입니다.

## 4. 장기 구간 보기

```bash
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/11-my-game-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --format json
```

동등 명령:

```bash
idk ltv examples/tutorials/11-my-game-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --format json
```

우선 볼 필드:

- `summary.at30m`
- `summary.at2h`
- `summary.at24h`
- `summary.at7d`
- `summary.at30d`
- `summary.at90d`

성공 조건:

- 각 구간에서 가치가 어떻게 커지는지, 그리고 `stallRatio`가 어느 시점부터 높아지는지 확인할 수 있습니다.

실패 대응:

- 장기 구간 수치가 너무 들쭉날쭉하면 `--step 300`으로 다시 돌려 봅니다.

## 5. 비교용 대조군 만들기

기본형을 한 번 돌렸으면 바로 대조군을 돌려 보는 편이 빠릅니다.

```bash
bun run --cwd packages/cli dev -- compare \
  ../../examples/tutorials/11-my-game-v1.json \
  ../../examples/tutorials/12-my-game-compare-b.json \
  --metric endNetWorth \
  --format json
```

동등 명령:

```bash
idk compare \
  examples/tutorials/11-my-game-v1.json \
  examples/tutorials/12-my-game-compare-b.json \
  --metric endNetWorth \
  --format json
```

읽는 법:

- `better`: A/B 중 어느 쪽이 현재 metric에서 나았는지
- `detail.source`: 실제 실행값 기반인지(`measured`) 확인
- `detail.measured`: 시나리오별 측정 결과
- `insights.drivers`: 어떤 지표가 승부를 갈랐는지 요약

성공 조건:

- `detail.source = "measured"`이고 `better`가 채워집니다.

실패 대응:

- 차이가 거의 없으면 `12-my-game-compare-b.json`에서 `buyCostGrowth` 또는 `buyIncomeDelta` 차이를 더 크게 벌립니다.

## 6. 개인용 템플릿 튜닝

`13-my-game-tune.json`은 `11`을 대상으로 greedy preview 파라미터를 탐색합니다.

```bash
bun run --cwd packages/cli dev -- tune \
  ../../examples/tutorials/11-my-game-v1.json \
  --tune ../../examples/tutorials/13-my-game-tune.json \
  --format json
```

동등 명령:

```bash
idk tune examples/tutorials/11-my-game-v1.json \
  --tune examples/tutorials/13-my-game-tune.json \
  --format json
```

읽는 법:

- `report.best`: 가장 좋은 전략 파라미터
- `report.top`: 상위 후보군
- `report.tried`: 평가한 후보 수
- `insights.patterns`: 상위 후보에 반복해서 나타나는 파라미터 패턴
- `insights.scoreSpread.plateau`: 상위 후보가 거의 비슷한 plateau 구간인지 여부

성공 조건:

- `report.best`가 존재하고 `report.tried`가 0보다 큽니다.

실패 대응:

- 튜닝 시간이 길면 `13-my-game-tune.json`의 `runner.budget`을 줄이거나 `overrideDurationSec`을 900으로 낮춥니다.

## 7. 다음 분기

여기까지 끝나면 다음 셋 중 하나로 이동하면 됩니다.

- 명령 흐름을 더 익히기: [tutorial-step-by-step.md](./tutorial-step-by-step.md)
- 재화/액션/KPI를 설계 언어로 정리하기: [virtual-scenario-design.md](./virtual-scenario-design.md)
- 플러그인 기반 worked example 보기: [05-idle-design-v1.json](../examples/tutorials/05-idle-design-v1.json), [06-idle-design-balance-b.json](../examples/tutorials/06-idle-design-balance-b.json), [07-idle-design-tune.json](../examples/tutorials/07-idle-design-tune.json)

추천 분기:

- 아직 장르를 못 정했다: `11`과 `12`를 계속 수정
- 세션형 게임을 원한다: [09-idle-design-loot-camp.json](../examples/tutorials/09-idle-design-loot-camp.json)
- 장기 성장형을 원한다: [08-idle-design-city-factory.json](../examples/tutorials/08-idle-design-city-factory.json)
- 초장기 고성장을 원한다: [10-idle-design-space-port.json](../examples/tutorials/10-idle-design-space-port.json)

## 8. 실전 worked example로 이동

개인용 scaffold 흐름이 감 잡혔다면, 다음 단계는 canonical 실전 예제인 Orbital Foundry 세트입니다.

- [14-orbital-foundry-v1.json](../examples/tutorials/14-orbital-foundry-v1.json)
- [15-orbital-foundry-compare-b.json](../examples/tutorials/15-orbital-foundry-compare-b.json)
- [16-orbital-foundry-tune.json](../examples/tutorials/16-orbital-foundry-tune.json)

이 세트는 아래 질문에 답하도록 구성돼 있습니다.

- 장기 가치가 더 높은 안은 무엇인가?
- 첫 업그레이드 milestone이 더 빠른 안은 무엇인가?
- `experienceBalancedLog10` 기준으로 전략을 어떻게 조정할 수 있는가?

## 9. 고급 단계

재현성까지 같이 잡고 싶을 때만 아래를 추가합니다.

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/11-my-game-v1.json \
  --seed 77 \
  --run-id my-game-v1 \
  --artifact-out ../../tmp/my-game-v1.artifact.json \
  --format json

bun run --cwd packages/cli dev -- replay verify ../../tmp/my-game-v1.artifact.json --format json
```

성공 조건:

- `replay verify` 결과가 `ok=true`입니다.

실패 대응:

- artifact 재실행이 어긋나면 먼저 시나리오 파일 변경 여부와 `seed/run-id` 고정 여부를 확인합니다.
