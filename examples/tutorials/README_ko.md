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

- `14-orbital-foundry-v1.json`
  - canonical 실전 worked example baseline
  - 장기 가치와 7d/30d/90d worth를 더 강하게 가져가는 안
- `15-orbital-foundry-compare-b.json`
  - canonical A/B variant
  - 첫 업그레이드 milestone을 조금 더 빨리 여는 안
- `16-orbital-foundry-tune.json`
  - Orbital Foundry용 design-oriented TuneSpec
- `05-idle-design-v1.json`
  - 플러그인 기반 설계 예시 본편
  - `COIN`, `GEM`, `producers`, `upgrades`, `exchange.gem`이 들어간 worked example
- `06-idle-design-balance-b.json`
  - `05`의 대조군 밸런스 프로파일
- `07-idle-design-tune.json`
  - `05`를 대상으로 한 전략 파라미터 탐색 스펙

## Design Library Families

- `17-session-arcade-v1.json`
  - session-heavy family baseline
  - 짧은 세션에서 빠른 체감과 잦은 숫자 변화를 보는 예제
- `18-session-arcade-compare-b.json`
  - opening 감각은 더 빠르지만 장기 가치가 약한 대조군
- `19-session-arcade-tune.json`
  - session-heavy family 튜닝 스펙
- `20-longrun-colony-v1.json`
  - longrun family baseline
  - offline-heavy / 30d / 90d worth를 보는 예제
- `21-longrun-colony-compare-b.json`
  - 초반은 더 빠르지만 장기 colony scale은 약한 대조군
- `22-longrun-colony-tune.json`
  - longrun family 튜닝 스펙
- `23-prestige-reactor-v1.json`
  - prestige-heavy family baseline
  - reset / multiplier carryover / first prestige timing을 보는 예제
- `24-prestige-reactor-compare-b.json`
  - 더 빠른 prestige 진입 대신 carryover가 약한 대조군
- `25-prestige-reactor-tune.json`
  - prestige-heavy family 튜닝 스펙

## Genre Templates

- `08-idle-design-city-factory.json`
  - 장기 성장형(인프라 확장)
- `09-idle-design-loot-camp.json`
  - 세션 반복형(30m/2h 중심)
- `10-idle-design-space-port.json`
  - 초장기 고성장형(7d/30d/90d 중심)

## Recommended Order

1. 내 게임을 바로 만들기: `11 -> 12 -> 13`
2. canonical 실전 예제 보기: `14 -> 15 -> 16`
3. session-heavy family 보기: `17 -> 18 -> 19`
4. longrun family 보기: `20 -> 21 -> 22`
5. prestige-heavy family 보기: `23 -> 24 -> 25`
6. 명령만 익히기: `01 -> 03 -> 04`
7. 설계 예시 이해: `05 -> 06 -> 07`
8. 장르 분기 찾기: `08/09/10`

## What To Look At

- `11`: 재화 이름과 성장 곡선만 바꿔도 자기 게임 초안이 바로 돌아가는지
- `12`: cost/growth를 조금 바꿨을 때 compare 결과가 어떻게 달라지는지
- `13`: greedy preview horizon/bulk 설정을 바꿨을 때 best params가 어떻게 나오는지
- `01/03/04`: `simulate`, `compare`, `tune`의 기본 출력이 어떻게 생기는지
- `05/06/07`: 재화/요소/액션 변경이 KPI와 objective에 어떤 차이를 만드는지
- `08/09/10`: 30m/2h/24h/7d/30d/90d 지표 곡선이 장르별로 어떻게 달라지는지
