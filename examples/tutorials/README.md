# Tutorials Example Set (2트랙)

이 디렉터리는 `docs/tutorial-step-by-step.md`에서 사용하는 전용 예제 파일 모음입니다.

## 파일 구성

- `01-cafe-baseline.json`
  - 입문 트랙 기준 시나리오
  - 내장 `linear@1` + `greedy`
- `02-cafe-fast.json`
  - 같은 도메인에서 `sim.fast=true`, step/duration 변경
- `03-cafe-compare-b.json`
  - 비교용 대조군 시나리오
  - baseline 대비 cost/income 파라미터만 변경
- `04-cafe-tune.json`
  - baseline 시나리오에 적용하는 튜닝 스펙
- `05-idle-design-v1.json`
  - 설계 중심 가상 시나리오(재화/요소/액션 의사결정 반영)
  - 플러그인 모델 `plugin.generators` + 전략 `plugin.producerFirst`
- `06-idle-design-balance-b.json`
  - `05`의 대조군 밸런스 프로파일
  - producer/upgrade/gem 파라미터만 다르게 설정
- `07-idle-design-tune.json`
  - `05`를 대상으로 한 튜닝 스펙
  - 목표: `plugin.gemsAndWorthLog10`

## 권장 실행 순서

1. `01-cafe-baseline.json`으로 validate/simulate/eta/report
2. `03-cafe-compare-b.json`와 baseline 비교(compare)
3. `04-cafe-tune.json`으로 튜닝(tune)
4. `02-cafe-fast.json`으로 fast 모드 해석
5. 설계 중심 트랙: `05` -> `06` compare -> `07` tune

## 기대 관찰 포인트

- baseline vs compare-b에서 `detail.source=measured` 기준 성능 차이
- tune 결과에서 `report.best`와 `top` 후보군 비교
- fast 모드에서 이벤트 수 감소/처리 속도 향상 경향
- 설계 트랙에서 재화/요소/액션이 KPI(`endNetWorth`, `gemsAndWorthLog10`)에 주는 영향

## 설계 중심 트랙 개요

`05/06/07`은 "아이들 게임 초기 기획을 시나리오로 내리는 연습"을 위한 세트입니다.

- 재화:
  - `COIN`: 기본 지불/수입 재화(`wallet.money`)
  - `GEM`: 고가치 2차 재화(`vars.gems`, `exchange.gem` 액션으로 획득)
- 핵심 요소:
  - `producers`: 기본 수입량 증가
  - `upgrades`: 전체 수입 배율 강화
- 액션:
  - `buy.producer`
  - `buy.upgrade`
  - `exchange.gem`
