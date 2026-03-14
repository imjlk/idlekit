# 가상 시나리오 설계 가이드 (Idle 게임 초기 기획용)

이 문서는 "아이들 게임을 처음 설계할 때 무엇을 먼저 결정해야 하는지"를 시나리오 파일로 바로 연결하는 가이드입니다.

추천 읽기 순서:

- `examples/tutorials/11-my-game-v1.json` - 개인용 기본형
- `examples/tutorials/12-my-game-compare-b.json` - 개인용 대조군
- `examples/tutorials/13-my-game-tune.json` - 개인용 튜닝
- `examples/tutorials/14-orbital-foundry-v1.json` - canonical 실전 예제 baseline
- `examples/tutorials/15-orbital-foundry-compare-b.json` - canonical A/B variant
- `examples/tutorials/16-orbital-foundry-tune.json` - canonical design-oriented tuning
- `examples/tutorials/17-session-arcade-v1.json` - session-heavy family baseline
- `examples/tutorials/18-session-arcade-compare-b.json` - session-heavy family compare
- `examples/tutorials/19-session-arcade-tune.json` - session-heavy family tune
- `examples/tutorials/20-longrun-colony-v1.json` - longrun family baseline
- `examples/tutorials/21-longrun-colony-compare-b.json` - longrun family compare
- `examples/tutorials/22-longrun-colony-tune.json` - longrun family tune
- `examples/tutorials/23-prestige-reactor-v1.json` - prestige-heavy family baseline
- `examples/tutorials/24-prestige-reactor-compare-b.json` - prestige-heavy family compare
- `examples/tutorials/25-prestige-reactor-tune.json` - prestige-heavy family tune
- `examples/tutorials/05-idle-design-v1.json` - worked example
- `examples/tutorials/06-idle-design-balance-b.json` - worked example 대조군
- `examples/tutorials/07-idle-design-tune.json` - worked example 튜닝
- `examples/tutorials/08-idle-design-city-factory.json`
- `examples/tutorials/09-idle-design-loot-camp.json`
- `examples/tutorials/10-idle-design-space-port.json`

빠르게 scaffold부터 만들려면:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json
bun run --cwd packages/cli dev -- init scenario --track personal --preset session --out ../../tmp/my-session-game.json
bun run --cwd packages/cli dev -- init scenario --track personal --preset longrun --out ../../tmp/my-longrun-game.json
```

## 0. 가상 시나리오 캔버스 먼저 작성

시나리오 JSON을 바로 수정하기 전에 아래 5칸을 먼저 채우면 설계 의도가 흔들리지 않습니다.

- 재화: `COIN`(결제), `GEM`(장기가치)처럼 역할을 분리
- 생산 루프: 어떤 액션이 분당/시간당 수입을 키우는지
- 소비 싱크: 어떤 액션이 지출 압력을 만들고 선택을 강제하는지
- 액션 우선순위: 초반/중반/후반에 무엇을 먼저 사게 만들지
- KPI 구간: `30m/2h/24h/7d/30d/90d`에서 어떤 숫자를 목표로 볼지

권장 매핑 템플릿:

- 재화 `COIN`: `unit.code`, `wallet.money`, `Action.cost`
- 재화 `GEM`: `vars.gems`, `exchange.gem` 결과, objective 가중치
- 생산 요소: `vars.producers`
- 배율 요소: `vars.upgrades`
- 희귀 요소: `vars.gems`

## 1. 설계 목표부터 고정

V1 목표:

- 40분 플레이 구간에서 `producer -> upgrade -> gem` 선택 압력이 생긴다.
- 단일 주 재화(`COIN`)로 결제하면서도, 2차 재화(`GEM`)를 가치 축으로 반영한다.
- 비교/튜닝으로 밸런스 변경 효과를 측정할 수 있다.

## 2. 재화 종류 결정 방법

권장 분류:

- 주 재화(필수): 실시간 수입/지출에 쓰는 기본 통화
- 2차 재화(선택): 액션 우선순위/장기 목표를 바꾸는 가치 재화

예제 반영:

- `COIN`:
  - Scenario `unit.code`
  - 모든 `Action.cost()` 지불 재화
- `GEM`:
  - `initial.vars.gems`, `exchange.gem` 액션 결과
  - Objective `plugin.gemsAndWorthLog10`에서 가치 보정에 사용

## 3. 게임 요소 -> 상태 변수 매핑

초기 설계 템플릿:

- 생산 요소: `vars.producers`
- 배율 요소: `vars.upgrades`
- 희귀 요소: `vars.gems`

예제 모델(`plugin.generators`)에서의 의미:

- `producers`가 늘수록 기본 income 증가
- `upgrades`가 늘수록 income 배율 증가
- `gems`는 즉시 income을 올리지는 않지만 objective 가치(목표 함수)에 반영

## 4. 액션 설계 규칙

액션은 "비용 -> 효과 -> 의사결정 이유" 3개가 명확해야 합니다.

예제 액션:

- `buy.producer`
  - 비용: COIN
  - 효과: `producers +1` (bulk 지원)
  - 이유: baseline 성장
- `buy.upgrade`
  - 비용: COIN
  - 효과: `upgrades +1`
  - 이유: mid-game 배율 가속
- `exchange.gem`
  - 비용: COIN
  - 효과: `gems +1`
  - 이유: long-term 가치 축

## 5. 개인용 기본형부터 시작

검증:

```bash
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/11-my-game-v1.json
```

실행:

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/11-my-game-v1.json --format json
```

성공 조건:

- `endMoney`, `endNetWorth`, `stats`가 존재

먼저 바꿀 값:

- `unit.code`, `unit.symbol`
- `model.params.incomePerSec`
- `model.params.buyCostBase`
- `model.params.buyCostGrowth`
- `clock.durationSec`

첫 반복 루프:

1. `idk init scenario --track personal --preset builder|session|longrun`으로 scaffold 생성
2. `11-my-game-v1.json` 또는 생성된 scaffold 수정
3. `validate`
4. `simulate`
5. `ltv --horizons 30m,2h,24h,7d,30d,90d`
6. `12-my-game-compare-b.json`으로 대조군 비교
7. `13-my-game-tune.json`으로 전략 파라미터 탐색

## 6. worked example 보기 (A/B)

개인용 루프 기준:

- `11-my-game-v1.json`: 기본안
- `12-my-game-compare-b.json`: cost/growth 차이를 넣은 대조군
- `13-my-game-tune.json`: `11`용 greedy preview 튜닝

`14/15/16`은 publish-facing canonical worked example입니다.

- `14`: 장기 가치와 long-horizon worth를 더 강하게 가져가는 baseline
- `15`: 첫 업그레이드 milestone을 더 빠르게 여는 A/B variant
- `16`: `experienceBalancedLog10` 기준으로 producer-first 전략을 조정하는 TuneSpec

추가 design library family:

- `17/18/19 Session Arcade`
  - short-burst 세션에서 visible progression을 더 강하게 보려는 경우
- `20/21/22 Longrun Colony`
  - offline-heavy / 30d / 90d worth를 보고 싶은 경우
- `23/24/25 Prestige Reactor`
  - prestige reset, multiplier carryover, first prestige timing을 보고 싶은 경우

`05/06/07`은 그보다 더 단순한 plugin worked example입니다.

`06-idle-design-balance-b.json`은 V1 대비 다음을 변경:

- producer 계열은 더 비싸고 증가폭은 약하게
- upgrade/gem 계열은 상대적으로 빠르게 접근 가능하게

비교 실행:

```bash
bun run --cwd packages/cli dev -- compare \
  ../../examples/tutorials/05-idle-design-v1.json \
  ../../examples/tutorials/06-idle-design-balance-b.json \
  --metric endNetWorth \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

## 7. worked example 튜닝

`07-idle-design-tune.json`은 `plugin.producerFirst`의 임계값 탐색:

- `allowUpgrade: bool`
- `preferUpgradeAtProducers: 4..20`

튜닝 실행:

```bash
bun run --cwd packages/cli dev -- tune ../../examples/tutorials/05-idle-design-v1.json \
  --tune ../../examples/tutorials/07-idle-design-tune.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

성공 조건:

- `report.best`, `report.top`, `report.tried` 확인

## 8. 설계 루프(권장)

1. 재화/요소/액션 정의
2. `11-my-game-v1.json` 수정
3. `simulate`/`ltv`로 1차 측정
4. `12-my-game-compare-b.json` 같은 대조군(B) 작성
5. `compare`로 차이 측정
6. `13-my-game-tune.json` 같은 TuneSpec으로 전략 파라미터 탐색
7. KPI 기반으로 다시 1~6 반복

KPI 추천:

- `endNetWorth`
- `growthLog10PerHour`
- `plugin.gemsAndWorthLog10`

장르 분기 템플릿:

- City/Factory(장기형): `08-idle-design-city-factory.json`
- Loot/Camp(세션형): `09-idle-design-loot-camp.json`
- Space/Port(초장기형): `10-idle-design-space-port.json`
- 바로 개인용 초안 시작: `11-my-game-v1.json`
- 개인용 대조군 시작: `12-my-game-compare-b.json`
- 개인용 튜닝 시작: `13-my-game-tune.json`

`11-my-game-v1.json`은 "장르 템플릿을 아직 못 골랐다"는 상황을 위한 개인용 기본형입니다.

- 가장 먼저 바꿀 값:
  - `unit.code`, `unit.symbol`
  - `model.params.incomePerSec`
  - `model.params.buyCostBase`
  - `model.params.buyCostGrowth`
  - `clock.durationSec`
- 첫 검증 루프:
  - `validate`
  - `simulate`
  - `ltv --horizons 30m,2h,24h,7d,30d,90d`
- 이후 분기:
  - 세션형이면 `09` 쪽으로 이동
  - 장기 인프라형이면 `08` 쪽으로 이동
  - 초장기 고성장이면 `10` 쪽으로 이동

## 9. LTV용 장기 구간 스냅샷(30m/2h/24h/7d/30d/90d)

`idk ltv` 명령으로 요청 구간을 한 번에 계산할 수 있습니다.

```bash
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/05-idle-design-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --value-per-worth 0.001 \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

출력 해석:

- `horizons[].endNetWorth`: 각 시점 누적 가치
- `horizons[].deltaNetWorth`: 직전 구간 대비 증가분
- `horizons[].deltaPerDay`: 해당 구간의 일 환산 증가 속도
- `horizons[].ltvProxy`: `endNetWorth * valuePerWorth`
- `horizons[].monetization.cumulativeLtvPerUser`: 유저당 누적 LTV 추정
- `horizons[].monetization.cumulativeLtvQuantiles`: 불확실성 켠 경우 분위수(`q50/q90`)
- `summary.at30m/at2h/at24h/at7d/at30d/at90d`: 핵심 구간 빠른 참조

운영 팁:

- 장기 구간은 `--step 300` 또는 `--step 600`으로 coarse step을 권장
- 정확도 검증이 필요하면 `--fast false`로 재실행해 차이를 비교
- 리스크 민감한 시뮬레이션이면 `monetization.uncertainty.correlation`을 설정해
  retention/결제전환/ARPPU가 함께 움직이도록 모델링

## 10. 실데이터 캘리브레이션 (calibrate)

텔레메트리 CSV/JSON에서 `monetization` 블록을 추정할 수 있습니다.

```bash
bun run --cwd packages/cli dev -- calibrate ./tmp/telemetry.csv \
  --input-format csv \
  --format json \
  --out ./tmp/calibrated-monetization.json
```

출력의 `scenarioPatch.monetization`을 시나리오에 붙인 뒤 `idk ltv`를 재실행하면
실데이터 기반 LTV 추정치로 바로 갱신됩니다.

캘리브레이션 기본 출력에는 `uncertainty.correlation` 기본값도 포함되므로,
초기에는 그대로 사용하고 데이터가 쌓이면 상관계수를 교정하는 방식이 안전합니다.
