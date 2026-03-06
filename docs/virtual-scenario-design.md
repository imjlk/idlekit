# 가상 시나리오 설계 가이드 (Idle 게임 초기 기획용)

이 문서는 "아이들 게임을 처음 설계할 때 무엇을 먼저 결정해야 하는지"를 시나리오 파일로 바로 연결하는 가이드입니다.

대상 예제:

- `examples/tutorials/05-idle-design-v1.json`
- `examples/tutorials/06-idle-design-balance-b.json`
- `examples/tutorials/07-idle-design-tune.json`
- `examples/tutorials/08-idle-design-city-factory.json`
- `examples/tutorials/09-idle-design-loot-camp.json`
- `examples/tutorials/10-idle-design-space-port.json`

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

## 5. 시나리오 파일로 구체화

검증:

```bash
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/05-idle-design-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true
```

실행:

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/05-idle-design-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

성공 조건:

- `endMoney`, `endNetWorth`, `stats`가 존재

## 6. 대조군 밸런스 작성 (A/B)

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

## 7. 튜닝으로 전략 파라미터 탐색

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
2. V1 시나리오 작성
3. 대조군(B) 작성
4. `simulate`/`compare`로 측정
5. `tune`으로 전략 파라미터 탐색
6. KPI 기반으로 다시 1~5 반복

KPI 추천:

- `endNetWorth`
- `growthLog10PerHour`
- `plugin.gemsAndWorthLog10`

장르 템플릿 시작점:

- City/Factory(장기형): `08-idle-design-city-factory.json`
- Loot/Camp(세션형): `09-idle-design-loot-camp.json`
- Space/Port(초장기형): `10-idle-design-space-port.json`

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
