# Tutorials Example Set

이 디렉터리는 idlekit 문서에서 쓰는 예제 시나리오 모음입니다.

## Start Here

- scaffold 생성:
  - `bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json`
  - `bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json --name "Space Miner"`
  - `bun run --cwd packages/cli dev -- init scenario --track personal --preset session --out ../../tmp/my-session-game.json`
  - `bun run --cwd packages/cli dev -- init scenario --track personal --preset longrun --out ../../tmp/my-longrun-game.json`
- `11-my-game-v1.json`
  - 자기 게임 V1을 바로 시작하는 개인용 기본형
  - 플러그인 없이 `validate -> simulate -> ltv`가 바로 동작
  - 먼저 바꿀 값: `unit`, `model.params`, `clock.durationSec`
- `12-my-game-compare-b.json`
  - `11`과 바로 비교하는 개인용 대조군
  - `compare --metric endNetWorth` 첫 실험용
- `13-my-game-tune.json`
  - `11`을 대상으로 한 개인용 TuneSpec
  - `tune`로 greedy preview 파라미터 탐색 시작점

## Learn Commands

- `01-cafe-baseline.json`
  - `validate`, `simulate`, `eta`, `report` 체험용
- `02-cafe-fast.json`
  - `sim.fast=true`와 step/duration 차이 확인용
- `03-cafe-compare-b.json`
  - `compare` 체험용 대조군
- `04-cafe-tune.json`
  - `tune` 체험용 baseline 튜닝 스펙

## Worked Design Example

- `05-idle-design-v1.json`
  - 플러그인 기반 설계 예시 본편
  - `COIN`, `GEM`, `producers`, `upgrades`, `exchange.gem`이 들어간 worked example
- `06-idle-design-balance-b.json`
  - `05`의 대조군 밸런스 프로파일
- `07-idle-design-tune.json`
  - `05`를 대상으로 한 전략 파라미터 탐색 스펙

## Genre Templates

- `08-idle-design-city-factory.json`
  - 장기 성장형(인프라 확장)
- `09-idle-design-loot-camp.json`
  - 세션 반복형(30m/2h 중심)
- `10-idle-design-space-port.json`
  - 초장기 고성장형(7d/30d/90d 중심)

## Recommended Order

1. 내 게임을 바로 만들기: `11 -> 12 -> 13`
2. 명령만 익히기: `01 -> 03 -> 04`
3. 설계 예시 이해: `05 -> 06 -> 07`
4. 장르 분기 찾기: `08/09/10`

## What To Look At

- `11`: 재화 이름과 성장 곡선만 바꿔도 자기 게임 초안이 바로 돌아가는지
- `12`: cost/growth를 조금 바꿨을 때 compare 결과가 어떻게 달라지는지
- `13`: greedy preview horizon/bulk 설정을 바꿨을 때 best params가 어떻게 나오는지
- `01/03/04`: `simulate`, `compare`, `tune`의 기본 출력이 어떻게 생기는지
- `05/06/07`: 재화/요소/액션 변경이 KPI와 objective에 어떤 차이를 만드는지
- `08/09/10`: 30m/2h/24h/7d/30d/90d 지표 곡선이 장르별로 어떻게 달라지는지
