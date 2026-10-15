# 튜토리얼 예제

개인용 초안, 대표 플러그인, 특수한 플레이 패턴 순으로 실행한다.
모두 가상 게임이며 실제 유저의 재미·리텐션·매출을 입증하는 데이터는 포함하지 않는다.

## 내 게임 시작

- `11-my-game-v1.json`: 플러그인 없이 실행하는 선형 기본형
- `12-my-game-compare-b.json`: 비용과 성장률을 바꾼 비교안
- `13-my-game-tune.json`: 전략 파라미터 탐색용 TuneSpec

```sh
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json
```

`tune`은 정해진 후보와 조건 안에서만 탐색한다. 최상위 점수가 같으면 개선을
확인하지 못한 것이다. 같은 horizon과 seed로 원래 전략의 점수도 비교한다.

## 대표 플러그인: Orbital Foundry

- `14-orbital-foundry-v1.json`: CREDIT, 생산기, 자동화, 회수 코어를 가진 가상 경제
- `15-orbital-foundry-compare-b.json`: 비용·성장률을 바꾼 비교안
- `16-orbital-foundry-tune.json`: 플레이 패턴을 반영하는 전략 튜닝

같은 조건에서 자산 가치, 사용 가능한 현금, 마일스톤 시간을 함께 읽는다.
한 지표의 우위가 모든 조건에서의 우위를 뜻하지 않는다. 플러그인 설치와 실행은
[플러그인 예제](../plugins/README_ko.md)를 따른다.

## 플레이 패턴별 예제

- `17/18/19 Session Arcade`: 짧은 세션과 잦은 진행 변화
- `20/21/22 Longrun Colony`: 오프라인 보상과 장기 성장
- `23/24/25 Prestige Reactor`: 프레스티지 리셋과 배율 유지

각 세트는 baseline, 비교안, TuneSpec 순서다. 목적에 맞는 세트 하나부터 고른다.
구형 설계·장르 예제 `05`~`10`은 위 세트로 통합했다. 남은 파일의 번호는 유지한다.

## 개별 명령 익히기

- `01-cafe-baseline.json`: validate, simulate, eta, report
- `02-cafe-fast.json`: fast와 step 차이
- `03-cafe-compare-b.json`: compare
- `04-cafe-tune.json`: tune

seed에 따른 변화와 검열 표본은 [피드백 예제](../experience/README_ko.md),
checkpoint 재개는 [저장·재개 예제](../reset-cycle/README_ko.md)를 실행한다.
